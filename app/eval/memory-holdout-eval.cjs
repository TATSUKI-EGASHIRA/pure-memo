const fs=require('node:fs');
const path=require('node:path');
const {rank,blendCandidates}=require('../desktop/retrieval.cjs');
const {CodexClient,askSchema,collectionSchema}=require('../desktop/codex.cjs');
const {promptFor,validateResult}=require('../desktop/analysis.cjs');
const {notes,digests}=require('./memory-fixture.cjs');
const cases=require('./memory-holdout.cjs');

const live=process.argv.includes('--live');
const outputIndex=process.argv.indexOf('--output');
const output=outputIndex<0?path.join(__dirname,'results',live?'memory-live-report.json':'memory-holdout-report.json'):path.resolve(process.argv[outputIndex+1]);
const model=process.env.PURE_EVAL_MODEL||'gpt-6-luna';
const budget=10;
const excluded=new Set(['x_generated','x_deleted']);
const raw=notes.filter(([key,,,,kind])=>!excluded.has(key)&&kind!=='generated'&&kind!=='trash').map(([key,category,date,text])=>({key,revisionId:key,text,date,categoryNames:category||'Other'}));
const rawKeys=new Set(raw.map(item=>item.key));
const categories=[...new Set(raw.map(item=>item.categoryNames))];
function assertFixture(){
  if(new Set(cases.map(item=>item.id)).size!==cases.length)throw new Error('Duplicate holdout ID.');
  for(const item of cases){
    if(!item.question?.trim()||!Array.isArray(item.required)||!Array.isArray(item.must)||!Array.isArray(item.forbid))throw new Error(`Invalid case ${item.id}`);
    if(item.required.some(key=>!rawKeys.has(key)))throw new Error(`Excluded or missing expected source in ${item.id}`);
  }
}
function unique(items,limit=Infinity){return [...new Set(items)].slice(0,limit)}
function ranked(question,rows){return rank(question,rows,new Map(),null,rows.length)}
function handDigests(){return digests.map(([key,category,text,sourceKeys])=>({revisionId:key,text,date:'2026-09-28T00:00:00.000Z',categoryNames:category,sourceRevisionIds:sourceKeys}));}
function candidates(question,digestRows){
  const rawRanked=ranked(question,raw);
  const digestRanked=ranked(question,digestRows);
  return {raw:rawRanked.slice(0,budget).map(item=>item.key),hybrid:blendCandidates(rawRanked,digestRanked,budget).map(item=>item.key)};
}
function retrievalReport(digestRows,label){
  const details=cases.map(item=>{
    const selected=candidates(item.question,digestRows);
    return {id:item.id,type:item.type,question:item.question,required:item.required,raw:selected.raw,hybrid:selected.hybrid,
      rawFound:item.required.filter(key=>selected.raw.includes(key)),hybridFound:item.required.filter(key=>selected.hybrid.includes(key))};
  });
  const total=details.reduce((sum,item)=>sum+item.required.length,0);
  const score=method=>({requiredFound:details.reduce((sum,item)=>sum+item[`${method}Found`].length,0),requiredTotal:total,
    completeAnswerable:details.filter(item=>item.required.length&&item[`${method}Found`].length===item.required.length).length,
    answerable:details.filter(item=>item.required.length).length,
    excludedLeaks:details.flatMap(item=>item[method]).filter(key=>excluded.has(key)).length});
  return {digestKind:label,sourceBudget:budget,raw:score('raw'),hybrid:score('hybrid'),details};
}
async function liveReport(report){
  // A throwaway Codex folder unless one is given, so a personal Codex setup cannot change the results.
  const ai=new CodexClient({codexHome:process.env.CODEX_HOME||require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'pure-eval-codex-'))});
  try{
    const generated=[];
    for(const category of categories){
      const items=raw.filter(item=>item.categoryNames===category).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
      const knownCategories=categories.map(name=>({id:name,name}));
      const data=validateResult(await ai.generate({model,prompt:promptFor('collection',items,[],null,knownCategories),schema:collectionSchema}),items,'collection');
      for(const [index,claim] of data.claims.entries())generated.push({revisionId:`generated_${category}_${index}`,text:claim.text,date:'2026-09-28T00:00:00.000Z',categoryNames:category,sourceRevisionIds:unique([...claim.evidenceRevisionIds,...claim.counterRevisionIds]),kind:claim.kind,speaker:claim.speaker,period:claim.period,evidenceRevisionIds:claim.evidenceRevisionIds,counterRevisionIds:claim.counterRevisionIds});
    }
    report.generatedDigests=generated;
    report.digestAudits=generated.map(claim=>({category:claim.categoryNames,text:claim.text,kind:claim.kind,speaker:claim.speaker,period:claim.period,
      support:claim.evidenceRevisionIds.map(id=>({id,text:raw.find(note=>note.revisionId===id)?.text||''})),
      counter:claim.counterRevisionIds.map(id=>({id,text:raw.find(note=>note.revisionId===id)?.text||''})),
      humanReview:{supported:null,attributionCorrect:null,timeCorrect:null,counterexampleHandled:null,notes:''}}));
    report.generatedRetrieval=retrievalReport(generated,'AI-generated');
    report.answerAudits=[];
    for(const item of cases){
      const selected=candidates(item.question,generated);
      for(const method of ['raw','hybrid']){
        const inputs=selected[method].map(key=>raw.find(note=>note.key===key));
        const answer=validateResult(await ai.generate({model,prompt:promptFor('ask',inputs,[],item.question),schema:askSchema}),inputs,'ask');
        report.answerAudits.push({id:item.id,type:item.type,method,question:item.question,requiredSources:item.required,
          requiredFacts:item.must,forbiddenClaims:item.forbid,expectedStatus:item.type==='unanswerable'?'insufficient':'ready',
          answer,sourceTexts:inputs.map(({revisionId,text,date})=>({revisionId,text,date})),
          claimAudits:answer.claims.map(claim=>({text:claim.text,kind:claim.kind,speaker:claim.speaker,period:claim.period,
            sources:claim.evidenceRevisionIds.map(id=>({id,text:inputs.find(note=>note.revisionId===id)?.text||''})),
            humanReview:{supported:null,attributionCorrect:null,timeCorrect:null,notes:''}})),
          checks:{requiredRetrieved:item.required.every(key=>selected[method].includes(key)),sourceIdsValid:answer.evidenceRevisionIds.every(id=>selected[method].includes(id)),statusMatches:answer.status===(item.type==='unanswerable'?'insufficient':'ready')},
          humanReview:{factsSupported:null,temporalAndAttributionCorrect:null,unsupportedGeneralization:null,notes:''}});
      }
    }
  }finally{ai.stop()}
}
async function main(){
  assertFixture();
  const report={createdAt:new Date().toISOString(),synthetic:true,holdoutFrozenBeforeGeneration:true,model:live?model:null,
    limits:{embedding:'text-only',answerSemanticQuality:'requires human review'},
    fixture:{activeNotes:raw.length,excludedNotes:excluded.size,categories:categories.length,cases:cases.length},
    handwrittenRetrieval:retrievalReport(handDigests(),'hand-written'),liveStatus:live?'running':'not-run'};
  if(live){try{await liveReport(report);report.liveStatus='completed'}catch(error){report.liveStatus='failed';report.liveError=error.message}}
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,fixture:report.fixture,handwrittenRetrieval:{raw:report.handwrittenRetrieval.raw,hybrid:report.handwrittenRetrieval.hybrid},generatedRetrieval:report.generatedRetrieval&&{raw:report.generatedRetrieval.raw,hybrid:report.generatedRetrieval.hybrid},answerAudits:report.answerAudits?.length||0,liveStatus:report.liveStatus,liveError:report.liveError},null,2));
  if(report.handwrittenRetrieval.raw.excludedLeaks||report.handwrittenRetrieval.hybrid.excludedLeaks||report.liveStatus==='failed')process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
