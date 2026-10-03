#!/usr/bin/env node
// Runs pure.'s real AI tasks (the same code the app uses) on made-up notes and grades the results.
//   npm run eval                       all tasks once (eval/product-eval.cjs)
//   npm run eval -- --judge            also ask a judge whether each claim is supported by its notes
//   npm run eval -- --only ask,classify --repeat 2 --model gpt-6.1-sol --effort low
//   npm run eval -- --only news --judge   collect real news (network) for the persona's interests and judge each item
//   npm run eval -- --save-baseline    keep this run as the baseline later runs are compared with
// Uses a temporary Codex folder (sign-in copied from ~/.codex) and a temporary database; results go to
// eval/results/ (not committed). Nothing here touches the app's own data.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../desktop/store.cjs');
const {CodexClient}=require('../desktop/codex.cjs');
const {ClaudeCodeClient}=require('../desktop/claude-code.cjs');
const {AiRouter}=require('../desktop/ai-router.cjs');
const {AnalysisExecutor}=require('../desktop/analysis-executor.cjs');
const {Classifier,VERSIONS:CLASSIFY_VERSIONS}=require('../desktop/classifier.cjs');
const aiTasks=require('../desktop/ai-tasks.cjs');
const {personas}=require('./product-personas.cjs');
const {judgeClaims,JUDGE_VERSION,judgeNews,judgeRelated}=require('./judge.cjs');
const {NewsWorker}=require('../desktop/news.cjs');
const {ProfileWorker}=require('../desktop/profile.cjs');

const args=process.argv.slice(2);
const flag=name=>args.includes(`--${name}`);
const option=(name,fallback)=>{const index=args.indexOf(`--${name}`);return index>=0?args[index+1]:fallback;};
const ONLY=option('only','memory,profile,classify,collection,ask,interests,news').split(',');
const LONG=flag('long'),NO_MEMORY=flag('no-memory');
const PROVIDER=option('provider','codex'),LIGHT_MODEL=option('light-model','');
const norm=text=>normal(text).replace(/[\s。、.,！!？?「」『』]/g,'');
// Share of claims kept word for word between two digests of the same notes.
const overlap=(a,b)=>{const left=new Set(a.map(norm)),right=b.map(norm);return Math.max(a.length,b.length)?right.filter(text=>left.has(text)).length/Math.max(a.length,b.length):1;};
const REPEAT=Number(option('repeat','1'))||1;
const normal=text=>String(text||'').normalize('NFKC').toLocaleLowerCase();
const has=(text,word)=>normal(text).includes(normal(word));

function buildStore(persona,dir,model,{noteFilter=()=>true}={}){
  const store=new Store(path.join(dir,'pure.sqlite'));
  store.uiLocale('ja');
  const keys=new Map();
  const backdate=(id,daysAgo)=>{const at=new Date(Date.now()-daysAgo*86400000).toISOString();store.db.prepare('UPDATE notes SET created_at=? WHERE id=?').run(at,id);store.db.prepare('UPDATE note_revisions SET created_at=? WHERE note_id=?').run(at,id);};
  const readLink=(revisionId,article)=>{store.markArticlePreviewRunning(revisionId);store.finishArticlePreview(revisionId,article);};
  // --long: a year of everyday notes, with the interests pushed back more than 200 days.
  const filler=LONG?Array.from({length:150},(_,i)=>({key:`filler-${i}`,daysAgo:i*2.4,text:`${persona.filler[i%persona.filler.length]}（${i+1}）`})):[];
  const addNotes=list=>{for(const note of list){
    const saved=store.saveNote({text:note.text,excerpt:note.excerpt,sourceTitle:note.sourceTitle});
    const revisionId=store.listNotes().find(n=>n.id===saved.id).revisionId;
    if(note.article)readLink(revisionId,note.article);
    backdate(saved.id,note.daysAgo);
    keys.set(note.key,{id:saved.id,revisionId});
  }};
  const all=[...persona.notes.map(note=>LONG?{...note,daysAgo:note.daysAgo+200}:note),...filler];
  addNotes(all.filter(noteFilter));
  const categoryIds={};
  for(const [key,name] of Object.entries(persona.categories)){
    const noteIds=persona.notes.filter(note=>note.category===key&&keys.has(note.key)).map(note=>keys.get(note.key).id);
    categoryIds[key]=store.createCategory(name,noteIds).id;
  }
  return {store,keys,categoryIds,readLink,model,addNotes,rest:all.filter(note=>!noteFilter(note))};
}

// --- graders: each returns {pass, checks:[{name,pass,detail}]} ---
const grade=checks=>({pass:checks.every(check=>check.pass),checks});
const textOf=result=>[result.text,result.pattern,result.action,...(result.claims||[]).map(claim=>claim.text)].join('\n');
function mentionChecks(text,{mentionAny,mentionNone}){
  const checks=[];
  if(mentionAny)checks.push({name:'mentions',pass:mentionAny.some(word=>has(text,word)),detail:mentionAny.join('|')});
  for(const word of mentionNone||[])checks.push({name:`never "${word}"`,pass:!has(text,word)});
  return checks;
}

// The memory layer is read for the persona's notes before the tasks, as the app does in the background.
async function readMemory(ctx,ai){
  ctx.store.queueMemoryBackfill(ctx.model);
  await new Classifier(ctx.store,ai).drain();
}
function evalMemory(ctx,persona){
  const facts=ctx.store.memoryFacts();
  return persona.memory.map(item=>{
    const note=ctx.keys.get(item.key);
    const mine=facts.filter(fact=>fact.noteId===note.id);
    const checks=[];
    if(item.subjectAny)checks.push({name:'subject',pass:mine.some(fact=>item.subjectAny.some(word=>has(fact.subject,word)||has(fact.statement,word))&&fact.speaker===item.speaker),detail:mine.map(f=>`${f.subject}/${f.speaker}`).join(', ')||'no facts'});
    if(item.excerptIsExternal){const source=persona.notes.find(n=>n.key===item.key);const fromExcerpt=mine.filter(fact=>source.excerpt.includes(fact.quote));checks.push({name:'excerpt is external',pass:fromExcerpt.every(fact=>fact.speaker==='external'),detail:mine.map(f=>`${f.statement}/${f.speaker}`).join(', ')});}
    if(item.noSelf)checks.push({name:'injection not taken as the person',pass:!mine.some(fact=>fact.speaker==='self'&&item.noSelf.some(word=>has(fact.statement,word)||has(fact.subject,word))),detail:mine.map(f=>`${f.statement}/${f.speaker}`).join(', ')||'no facts'});
    return {task:'memory',case:item.key,...grade(checks)};
  });
}

// The profile, built the way the app does it: first from older notes, then updated as newer notes
// arrive (only changed topics rewritten). Compared with a rebuild from all facts (drift), and each
// line judged against the notes behind it.
async function evalProfile(persona,model,ai,tmp,judge){
  const spec=persona.profile;
  const ctx=buildStore(persona,fs.mkdtempSync(path.join(tmp,'profile-')),model,{noteFilter:note=>note.daysAgo>=spec.splitDaysAgo});
  const executor=new AnalysisExecutor(ctx.store,ai),worker=new ProfileWorker(ctx.store,executor,{model:()=>model});
  await readMemory(ctx,executor);await worker.run();
  ctx.addNotes(ctx.rest);await readMemory(ctx,executor);
  const step=await worker.run();
  const incremental=ctx.store.profileEntries();
  await worker.run({rebuild:true});
  const rebuilt=ctx.store.profileEntries();
  const find=(entries,group)=>entries.find(entry=>group.some(word=>has(entry.label,word)||has(entry.line,word)));
  const currentFound=spec.current.filter(group=>find(incremental,group)?.status==='current');
  const checks=[
    {name:`at least ${spec.currentAtLeast} current topics`,pass:currentFound.length>=spec.currentAtLeast,detail:`${currentFound.length}/${spec.current.length}: ${incremental.map(e=>`${e.label}:${e.status}`).join(', ')}`},
    ...spec.past.map(group=>({name:`${group[0]} is past`,pass:find(incremental,group)?.status==='past',detail:find(incremental,group)?.status||'missing'})),
    ...spec.none.map(word=>({name:`never "${word}"`,pass:!incremental.some(entry=>has(entry.line,word)||has(entry.label,word))})),
    {name:'only changed topics were rewritten',pass:step.updated<incremental.length,detail:`${step.updated} of ${incremental.length}`},
  ];
  // Drift: topics both versions have, with the same status.
  const keys=new Set([...incremental,...rebuilt].map(entry=>entry.key));
  const agree=[...keys].filter(key=>{const a=incremental.find(e=>e.key===key),b=rebuilt.find(e=>e.key===key);return a&&b&&a.status===b.status;}).length;
  const record={task:'profile',case:'incremental',...grade(checks),agreement:keys.size?agree/keys.size:1,output:incremental.map(e=>`${e.label} [${e.status}] ${e.line}`)};
  if(judge){
    const notes=ctx.store.searchableNotes(),facts=new Map(ctx.store.memoryFacts().map(fact=>[fact.id,fact]));
    record.faithfulness=await judgeClaims(judge,incremental.map(entry=>({text:entry.line,kind:'record',evidenceRevisionIds:[...new Set(entry.factIds.map(id=>facts.get(id)?.revisionId).filter(Boolean))]})),notes);
  }
  ctx.store.close();
  return [record];
}

async function evalClassify(ctx,persona,ai){
  const {store,keys,categoryIds,readLink,model}=ctx;
  const cases=[];
  for(const item of persona.classify){
    const saved=store.saveNote({text:item.text,model});
    const revisionId=store.listNotes().find(n=>n.id===saved.id).revisionId;
    if(item.article)readLink(revisionId,item.article);
    keys.set(item.key,{id:saved.id,revisionId});
    cases.push({item,id:saved.id});
  }
  await new Classifier(store,ai).drain();
  const byId=new Map(store.listNotes().map(note=>[note.id,note]));
  const nameOf=new Map(Object.entries(categoryIds).map(([key,id])=>[id,key]));
  return cases.map(({item,id})=>{
    const note=byId.get(id);
    const got=note.categoryIds.map(categoryId=>nameOf.get(categoryId)).filter(Boolean).sort();
    const allowed=(item.expectAny||[item.expect]).map(list=>[...list].sort().join(','));
    const checks=[{name:'categories',pass:note.classificationState==='done'&&allowed.includes(got.join(',')),detail:`got [${got}] want ${allowed.map(a=>`[${a}]`).join(' or ')}`}];
    if(item.link){
      checks.push({name:'link kind',pass:item.link.kind.includes(note.linkKind),detail:note.linkKind});
      if(item.link.creator)checks.push({name:'link creator',pass:has(note.linkCreator,item.link.creator),detail:note.linkCreator});
      if(item.link.title)checks.push({name:'link title',pass:has(note.linkTitle,item.link.title),detail:note.linkTitle});
      checks.push({name:'link intent',pass:note.linkIntent===item.link.intent,detail:note.linkIntent});
      checks.push({name:'link summary',pass:!!note.linkSummary&&!has(note.linkSummary,'猫'),detail:note.linkSummary});
    }
    return {task:'classify',case:item.key,...grade(checks)};
  });
}

async function evalCollection(ctx,persona,ai,judge){
  const out=[];
  for(const item of persona.collections){
    const started=Date.now();
    try{
      const {result,notes,verification}=await aiTasks.analyzeCollection({store:ctx.store,ai,model:ctx.model,categoryId:ctx.categoryIds[item.category]});
      const checks=[{name:'valid',pass:true},{name:'ready',pass:result.status==='ready',detail:result.status},...mentionChecks(textOf(result),item)];
      const record={task:'collection',case:item.category,ms:Date.now()-started,...grade(checks),output:{text:result.text,pattern:result.pattern,claims:(result.claims||[]).map(c=>c.text)},verification};
      // Stability: the same notes again should keep the claims as they were.
      try{const again=await aiTasks.analyzeCollection({store:ctx.store,ai,model:ctx.model,categoryId:ctx.categoryIds[item.category]});record.stability=overlap((result.claims||[]).map(c=>c.text),(again.result.claims||[]).map(c=>c.text));}catch{record.stability=0;}
      if(judge)record.faithfulness=await judgeClaims(judge,result.claims||[],notes);
      out.push(record);
    }catch(error){out.push({task:'collection',case:item.category,pass:false,checks:[{name:'valid',pass:false,detail:error.message}],raw:ctx.raw?.last});}
  }
  return out;
}

async function evalAsk(ctx,persona,ai,judge){
  const out=[];
  for(const item of persona.questions){
    try{
      const {result,notes,verification}=await aiTasks.ask({store:ctx.store,ai,model:ctx.model,question:item.question});
      const cited=new Set([...(result.evidenceRevisionIds||[]),...(result.claims||[]).flatMap(claim=>claim.evidenceRevisionIds||[])]);
      const checks=[{name:'status',pass:result.status===item.status,detail:result.status},...mentionChecks(textOf(result),item)];
      if(item.citeAny)checks.push({name:'cites',pass:item.citeAny.some(key=>cited.has(ctx.keys.get(key).revisionId)),detail:`${cited.size} cited`});
      const record={task:'ask',case:item.question,...grade(checks),output:{status:result.status,text:result.text},verification};
      if(judge&&result.status==='ready')record.faithfulness=await judgeClaims(judge,result.claims||[],notes);
      out.push(record);
    }catch(error){out.push({task:'ask',case:item.question,pass:false,checks:[{name:'valid',pass:false,detail:error.message}],raw:ctx.raw?.last});}
  }
  return out;
}

async function evalInterests(ctx,persona,ai){
  try{
    const {interests=[]}=await aiTasks.findInterests({store:ctx.store,ai,model:ctx.model,force:true});
    const spec=persona.interests;
    const words=interests.map(item=>`${item.query} ${item.label}`);
    const found=spec.includeAny.filter(group=>words.some(word=>group.some(name=>has(word,name))));
    const checks=[
      {name:`at least ${spec.includeAtLeast} expected`,pass:found.length>=spec.includeAtLeast,detail:`${found.length}/${spec.includeAny.length}: ${interests.map(item=>item.query).join(' / ')}`},
      ...spec.exclude.map(word=>({name:`never "${word}"`,pass:!words.some(text=>has(text,word))})),
      {name:'no broad words',pass:!interests.some(item=>spec.broad.some(word=>normal(item.query)===normal(word))),detail:interests.map(item=>item.query).filter(q=>spec.broad.includes(q)).join(',')},
      {name:'every interest has evidence',pass:interests.every(item=>item.evidence.length>0)},
    ];
    return [{task:'interests',case:'all',...grade(checks),output:interests.map(item=>({query:item.query,why:item.why}))}];
  }catch(error){return [{task:'interests',case:'all',pass:false,checks:[{name:'valid',pass:false,detail:error.message}]}];}
}

// News: the real collection (Google News, Hacker News, web search) for the interests found in the
// notes. Graded on coverage and freshness here; with --judge, each item on whether it is really about
// the interest (not something with the same name) and whether its translated title is right.
async function evalNews(ctx,client,judge){
  const findInterests=({model,task})=>aiTasks.findInterests({store:ctx.store,ai:client,model,task});
  const worker=new NewsWorker(ctx.store,{ai:client,model:()=>ctx.model,locale:()=>'ja',findInterests,aiName:()=>PROVIDER==='claude'?'Claude Code':'Codex'});
  const started=Date.now();
  const {failures,dropped}=await worker.collect();
  const items=ctx.store.newsItems(),topics=ctx.store.newsWords(),interests=ctx.store.newsInterests().items;
  const DAY=86400000,now=Date.now();
  const bySource={};for(const item of items)bySource[item.via]=(bySource[item.via]||0)+1;
  const stale=items.filter(item=>item.publishedAt&&now-Date.parse(item.publishedAt)>4*DAY),undated=items.filter(item=>!item.publishedAt);
  const record={task:'news',case:'collect',ms:Date.now()-started,topics,bySource,failures,dropped,
    stale:stale.length,undated:undated.length,items:items.map(({url,title,titleLocalized,source,via,topic,publishedAt,summary})=>({url,title,titleLocalized,source,via,topic,publishedAt,summary}))};
  const related=ctx.store.newsInterests().related;
  record.related=related.map(({from,query,english,label,why})=>({from,query,english,label,why}));
  const relatedTopics=new Set(related.map(item=>item.query));
  record.relatedItems=items.filter(item=>relatedTopics.has(item.topic)).length;
  const checks=[{name:'items',pass:items.length>0,detail:`${items.length} items · ${JSON.stringify(bySource)}`},
    {name:'related words (1–4, none from the excluded list)',pass:related.length>=1&&related.length<=4,detail:related.map(item=>`${item.fromLabel}→${item.query}`).join(' / ')},
    {name:'all recent (≤4 days)',pass:!stale.length,detail:stale.map(item=>`${item.publishedAt.slice(0,10)} ${item.title}`).slice(0,5).join(' / ')}];
  if(judge&&items.length){
    const judged=await judgeNews(judge,record.items,[...interests.map(item=>({topic:item.query,label:item.label,why:item.why})),
      ...ctx.store.newsInterests().related.map(item=>({topic:item.query,label:item.label,why:`${item.fromLabel}から広げた関連: ${item.why}`}))]);
    record.items=judged;
    const count=value=>judged.filter(item=>item.relevance===value).length;
    record.relevance={total:judged.length,onTopic:count('on-topic'),tangential:count('tangential'),sameName:count('same-name'),unclear:count('unclear'),
      translated:judged.filter(item=>item.translation!=='none').length,translationWrong:judged.filter(item=>item.translation==='wrong').length};
    const covered=topics.filter(topic=>judged.some(item=>item.topic===topic&&item.relevance==='on-topic'));
    record.coverage={covered:covered.length,topics:topics.length,missing:topics.filter(topic=>!covered.includes(topic))};
    checks.push({name:'on-topic ≥ 80%',pass:record.relevance.onTopic/judged.length>=0.8,detail:`${record.relevance.onTopic}/${judged.length} on-topic, ${record.relevance.sameName} same-name, ${record.relevance.tangential} tangential`},
      {name:'no same-name items',pass:!record.relevance.sameName,detail:judged.filter(item=>item.relevance==='same-name').map(item=>`[${item.topic}] ${item.title}`).slice(0,5).join(' / ')},
      {name:'translations right',pass:!record.relevance.translationWrong,detail:judged.filter(item=>item.translation==='wrong').map(item=>`${item.title} → ${item.titleLocalized}`).slice(0,5).join(' / ')});
  }
  if(judge&&related.length){
    record.relatedJudged=await judgeRelated(judge,related);
    const wrong=record.relatedJudged.filter(item=>item.verdict==='wrong');
    checks.push({name:'related words are true and natural (no wrong)',pass:!wrong.length,detail:record.relatedJudged.map(item=>`${item.fromLabel}→${item.query}: ${item.verdict}${item.verdict==='good'?'':` (${item.reason})`}`).join(' / ')});
  }
  return [{...record,...grade(checks)}];
}

function summarize(records,calls){
  const tasks={};
  for(const record of records){
    const task=tasks[record.task]??={cases:0,passed:0,checks:0,checksPassed:0,claims:0,supported:0,verified:0,removed:0,stability:[]};
    if(record.stability!==undefined)task.stability.push(record.stability);
    if(record.agreement!==undefined)task.stability.push(record.agreement);
    if(record.verification){task.verified+=record.verification.checked||0;task.removed+=(record.verification.removedClaims||0)+(record.verification.removedSentences||0);}
    task.cases++;if(record.pass)task.passed++;
    task.checks+=record.checks.length;task.checksPassed+=record.checks.filter(check=>check.pass).length;
    if(record.faithfulness){task.claims+=record.faithfulness.total;task.supported+=record.faithfulness.supported;}
  }
  const usage={};
  for(const call of calls){
    const entry=usage[`${call.purpose}${call.provider&&call.provider!=='codex'?` (${call.provider})`:''}`]??={calls:0,errors:0,ms:0,input:0,output:0,promptVersion:call.promptVersion,model:call.model};
    entry.calls++;if(call.status!=='ok')entry.errors++;entry.ms+=call.ms;entry.input+=call.usage?.input||0;entry.output+=(call.usage?.output||0)+(call.usage?.reasoning||0);
  }
  return {tasks,usage};
}

function printReport(summary,baseline){
  const pct=(a,b)=>b?`${Math.round(a/b*100)}%`:'-';
  console.log('\ntask         cases  pass   checks  faithful   (baseline)        verify: removed / checked');
  for(const [name,task] of Object.entries(summary.tasks)){
    const base=baseline?.tasks?.[name];
    const line=`${name.padEnd(12)} ${String(task.cases).padStart(5)}  ${pct(task.passed,task.cases).padStart(4)}   ${pct(task.checksPassed,task.checks).padStart(5)}   ${(task.claims?pct(task.supported,task.claims):'-').padStart(7)}`;
    const verify=(task.verified?`   ${task.removed} / ${task.verified}`:'')+(task.stability.length?`   ${name==='profile'?'agreement':'stability'} ${Math.round(task.stability.reduce((a,b)=>a+b,0)/task.stability.length*100)}%`:'');
    console.log((base?`${line}   (${pct(base.passed,base.cases)} / ${pct(base.checksPassed,base.checks)} / ${base.claims?pct(base.supported,base.claims):'-'})`:line)+verify);
  }
  console.log('\npurpose          calls  avg s   input tok  output tok  prompt');
  for(const [purpose,entry] of Object.entries(summary.usage))console.log(`${purpose.padEnd(16)} ${String(entry.calls).padStart(5)}  ${(entry.ms/entry.calls/1000).toFixed(1).padStart(5)}   ${String(Math.round(entry.input/entry.calls)).padStart(9)}  ${String(Math.round(entry.output/entry.calls)).padStart(10)}  ${entry.promptVersion}${entry.errors?`  errors:${entry.errors}`:''}`);
}

async function main(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pure-eval-'));
  const codex=new CodexClient({codexHome:path.join(tmp,'codex')}),claude=new ClaudeCodeClient();
  const calls=[];const effort=option('effort',null);codex.reasoningEffort=()=>effort||'';
  // The same router the app uses; the judge always runs on Codex, apart from what it grades.
  const client=new AiRouter({providers:{codex,claude},provider:()=>PROVIDER,lightModel:()=>LIGHT_MODEL,reasoningEffort:()=>effort||'',onCall:call=>calls.push(call)});
  try{
    const models=await client.models();
    const model=option('model',models.find(item=>item.isDefault)?.model||models[0]?.model);
    const judgeModel=option('judge-model',PROVIDER==='codex'?model:(await codex.models()).find(item=>item.isDefault)?.model);
    console.log(`${PROVIDER} ${model}${effort?` (${effort})`:''}${LIGHT_MODEL?` · light ${LIGHT_MODEL}`:''} · tasks ${ONLY.join(',')} · repeat ${REPEAT}${flag('judge')?` · judge ${judgeModel}`:''}${LONG?' · long history':''}${NO_MEMORY?' · without memory layer':''}`);
    const records=[];
    for(let round=0;round<REPEAT;round++)for(const persona of personas){
      const dir=fs.mkdtempSync(path.join(tmp,'store-'));
      const ctx=buildStore(persona,dir,model);
      // Keeps the last raw answer, so a failed validation can be read in the report.
      const executor=new AnalysisExecutor(ctx.store,client),raw={last:null};
      const ai={generate:async options=>{raw.last=null;const result=await executor.generate(options);raw.last=result;return result;}};
      ctx.raw=raw;
      const judge=flag('judge')?{client:codex,model:judgeModel}:null;
      const run=async(name,fn)=>{if(!ONLY.includes(name))return;process.stdout.write(`${persona.id} #${round+1} ${name}… `);const t0=Date.now();const out=await fn();records.push(...out.map(record=>({...record,round,persona:persona.id})));console.log(`${out.filter(r=>r.pass).length}/${out.length} (${((Date.now()-t0)/1000).toFixed(0)}s)`);};
      if(!NO_MEMORY){process.stdout.write(`${persona.id} #${round+1} reading notes into memory… `);const t0=Date.now();await readMemory(ctx,ai);console.log(`${ctx.store.memoryFacts().length} facts (${((Date.now()-t0)/1000).toFixed(0)}s)`);}
      await run('memory',async()=>NO_MEMORY?[]:evalMemory(ctx,persona));
      // The main store gets its profile too, as the app builds it after reading notes.
      if(!NO_MEMORY)await new ProfileWorker(ctx.store,ai,{model:()=>model}).run();
      await run('profile',()=>evalProfile(persona,model,client,tmp,judge));
      await run('classify',()=>evalClassify(ctx,persona,ai));
      await run('collection',()=>evalCollection(ctx,persona,ai,judge));
      await run('ask',()=>evalAsk(ctx,persona,ai,judge));
      await run('interests',()=>evalInterests(ctx,persona,ai));
      await run('news',()=>evalNews(ctx,client,judge));
      ctx.store.close();
    }
    const summary=summarize(records,calls);
    const baselinePath=path.join(__dirname,'product-baseline.json');
    const baseline=fs.existsSync(baselinePath)?JSON.parse(fs.readFileSync(baselinePath,'utf8')):null;
    printReport(summary,baseline);
    for(const record of records.filter(r=>r.task==='news'))console.log(`\nnews: ${record.items.length} items in ${Math.round(record.ms/1000)}s · ${JSON.stringify(record.bySource)} · stale ${record.stale} · undated ${record.undated}`+
      (record.relevance?`\n  on-topic ${record.relevance.onTopic} · tangential ${record.relevance.tangential} · same-name ${record.relevance.sameName} · unclear ${record.relevance.unclear} · translations wrong ${record.relevance.translationWrong}/${record.relevance.translated}\n  topics covered ${record.coverage.covered}/${record.coverage.topics}${record.coverage.missing.length?` (missing: ${record.coverage.missing.join(', ')})`:''}`:'')+
      (record.relatedJudged?`\n  related: ${record.relatedJudged.map(item=>`${item.from}→${item.query} [${item.verdict}] ${item.why}`).join(' / ')} · ${record.relatedItems} items`:record.related?.length?`\n  related: ${record.related.map(item=>`${item.from}→${item.query}`).join(' / ')} · ${record.relatedItems} items`:'')+
      (record.dropped.length?`\n  left out by the check: ${record.dropped.map(item=>`[${item.topic}] ${item.title}`).join(' / ')}`:'')+
      (record.failures.length?`\n  failures: ${record.failures.join(' / ')}`:''));
    for(const record of records.filter(r=>!r.pass))console.log(`\nFAIL ${record.task} · ${record.case}\n  ${record.checks.filter(c=>!c.pass).map(c=>`${c.name}${c.detail?`: ${c.detail}`:''}`).join('\n  ')}`);
    const report={at:new Date().toISOString(),provider:PROVIDER,lightModel:LIGHT_MODEL,model,effort,judge:flag('judge')?{model:judgeModel,version:JUDGE_VERSION}:null,
      versions:{...aiTasks.VERSIONS,...CLASSIFY_VERSIONS},...summary,records};
    fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});
    const file=path.join(__dirname,'results',`product-${report.at.replace(/[:.]/g,'-')}.json`);
    fs.writeFileSync(file,JSON.stringify(report,null,1));
    console.log(`\nreport: ${path.relative(process.cwd(),file)}`);
    if(flag('save-baseline')){fs.writeFileSync(baselinePath,JSON.stringify({at:report.at,model,effort,judge:report.judge,versions:report.versions,tasks:summary.tasks},null,1));console.log('baseline saved');}
  }finally{client.stop();fs.rmSync(tmp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exit(1);});
