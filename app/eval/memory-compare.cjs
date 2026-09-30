const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../desktop/store.cjs');
const {rank,embed}=require('../desktop/retrieval.cjs');
const {notes,digests,cases}=require('./memory-fixture.cjs');

const noteKeys=new Set(notes.map(note=>note[0]));
if(noteKeys.size!==notes.length)throw new Error('Duplicate fixture note keys.');
if(new Set(cases.map(item=>item[0])).size!==cases.length)throw new Error('Duplicate fixture case IDs.');
for(const [id,,question,required] of cases){
  if(!question.trim()||required.some(key=>!noteKeys.has(key)||key==='x_generated'||key==='x_deleted'))throw new Error(`Invalid expected sources for ${id}`);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-memory-eval-'));
const store=new Store(path.join(dir,'pure.sqlite'));
const ids=new Map(),categoryIds=new Map();
const categories=[...new Set(notes.map(note=>note[1]).filter(Boolean))];
for(const name of categories)categoryIds.set(name,store.createCategory(name).id);
for(const [index,[key,category,date,body,kind]] of notes.entries()){
  const saved=store.saveNote({text:body,originKind:kind==='generated'?'generated':'human'});
  ids.set(key,saved.id);
  const timestamp=`${date}T${String(Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}:00.000Z`;
  store.db.prepare('UPDATE notes SET created_at=? WHERE id=?').run(timestamp,saved.id);
  store.db.prepare('UPDATE note_revisions SET created_at=? WHERE id=?').run(timestamp,saved.revisionId);
  if(category&&kind!=='trash'&&kind!=='generated')store.assignNote(saved.id,categoryIds.get(category));
  if(kind==='trash')store.trashNote(saved.id);
}
const raw=store.searchableNotes();
const digestRows=digests.map(([key,category,text,sourceKeys])=>{
  for(const sourceKey of sourceKeys)if(!ids.has(sourceKey))throw new Error(`Unknown digest source ${sourceKey}`);
  return {id:key,revisionId:key,text,date:'2026-09-28T00:00:00.000Z',categoryNames:category,sourceKeys};
});
const keyById=new Map([...ids].map(([key,id])=>[id,key]));
const rawRows=raw.map(note=>({...note,key:keyById.get(note.id)}));
const holdout=new Set(['s04','s07','s12','s18','g02','g09','g14','x03','x07','n02']);

async function vectorsFor(items){
  const values=new Map();let model='';
  for(let offset=0;offset<items.length;offset+=64){
    const batch=items.slice(offset,offset+64);
    const result=await embed(batch.map(item=>item.text));
    if(model&&result.model!==model)throw new Error('Embedding model changed during evaluation.');
    model=result.model;
    for(let index=0;index<batch.length;index++)if(Array.isArray(result.vectors[index]))values.set(batch[index].revisionId,result.vectors[index]);
  }
  if(values.size!==items.length)throw new Error('Missing evaluation embedding.');
  return {model,values};
}
function unique(keys,limit){return [...new Set(keys)].slice(0,limit);}
function digestCandidates(rows,limit){return unique(rows.flatMap(row=>row.sourceKeys),limit);}
function score(name,rows){
  const byType={},bySplit={};let found=0,required=0,complete=0,answerable=0,excluded=0;
  const details=cases.map(([id,type,question,must])=>{
    const selected=rows.get(id)||[];
    const hits=must.filter(key=>selected.includes(key));
    for(const bucket of [byType[type]||=( {found:0,required:0,complete:0,cases:0}),bySplit[holdout.has(id)?'holdout':'development']||=( {found:0,required:0,complete:0,cases:0})]){
      bucket.found+=hits.length;bucket.required+=must.length;bucket.complete+=Number(must.length>0&&hits.length===must.length);bucket.cases++;
    }
    found+=hits.length;required+=must.length;answerable+=Number(must.length>0);complete+=Number(must.length>0&&hits.length===must.length);
    excluded+=selected.filter(key=>key==='x_generated'||key==='x_deleted').length;
    return {id,type,split:holdout.has(id)?'holdout':'development',question,required:must,found:hits,ranked:selected};
  });
  return {name,sourceBudget:10,requiredFound:found,requiredTotal:required,recallAt10:Number((found/required).toFixed(3)),completeAnswerableCases:complete,answerableCases:answerable,excludedSourceLeaks:excluded,byType,bySplit,details};
}
(async()=>{
  let model='text-only',vectors=new Map();
  try{const embedded=await vectorsFor([...rawRows,...digestRows,...cases.map(([id,,question])=>({revisionId:`q_${id}`,text:question}))]);model=embedded.model;vectors=embedded.values;}
  catch(error){console.error(`Embedding unavailable; evaluating text-only ranking: ${error.message}`);}
  const results={raw:new Map(),digest:new Map(),hybrid:new Map()};
  for(const [id,,question] of cases){
    const queryVector=vectors.get(`q_${id}`)||null;
    const rawRanked=rank(question,rawRows,vectors,queryVector,rawRows.length).map(row=>row.key);
    const digestRanked=rank(question,digestRows,vectors,queryVector,digestRows.length);
    const digestKeys=digestCandidates(digestRanked,10);
    const rawTop=unique(rawRanked,10);
    results.raw.set(id,rawTop);
    results.digest.set(id,digestKeys);
    results.hybrid.set(id,unique([...rawRanked.slice(0,6),...digestCandidates(digestRanked,10),...rawRanked],10));
  }
  const report={fixture:{notes:notes.length,activeSearchableNotes:rawRows.length,digests:digests.length,cases:cases.length,model,synthetic:true,digestsAreHandWritten:true},methods:Object.entries(results).map(([name,rows])=>score(name,rows))};
  const output=process.argv[2]||path.join(__dirname,'results','memory-baseline.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(report.methods.some(method=>method.excludedSourceLeaks))process.exitCode=1;
  console.log(JSON.stringify({fixture:report.fixture,methods:report.methods.map(({name,sourceBudget,requiredFound,requiredTotal,recallAt10,completeAnswerableCases,answerableCases,excludedSourceLeaks,byType,bySplit})=>({name,sourceBudget,requiredFound,requiredTotal,recallAt10,completeAnswerableCases,answerableCases,excludedSourceLeaks,byType,bySplit})),output},null,2));
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
