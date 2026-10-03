#!/usr/bin/env node
// Simulates installing pure. with a year of notes already written, then using it every day, on a
// made-up person's notes (synthetic-life.cjs), with the same workers the app runs in the background.
//   node eval/simulate-use.cjs                       Codex, 14 days, news on day 7
//   node eval/simulate-use.cjs --provider claude --days 7 --news-days ""
//   node eval/simulate-use.cjs --perf 5000           no AI: speed of saving, listing and search with 5000 notes
// Reports what it cost (calls, tokens, time, and how far the account's usage windows moved), what it
// would cost a month, and whether the app still answers, sorts and remembers correctly at the end.
// Uses a temporary database and Codex folder; results go to eval/results/ (not committed).
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../desktop/store.cjs');
const {CodexClient}=require('../desktop/codex.cjs');
const {ClaudeCodeClient}=require('../desktop/claude-code.cjs');
const {AiRouter}=require('../desktop/ai-router.cjs');
const {AiUsage}=require('../desktop/ai-usage.cjs');
const {AnalysisExecutor}=require('../desktop/analysis-executor.cjs');
const {Classifier}=require('../desktop/classifier.cjs');
const {DigestWorker}=require('../desktop/digest-worker.cjs');
const {ProfileWorker}=require('../desktop/profile.cjs');
const {NewsWorker}=require('../desktop/news.cjs');
const aiTasks=require('../desktop/ai-tasks.cjs');
const {generate,NEEDLES,UNKNOWN,CATEGORIES}=require('./synthetic-life.cjs');

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(`--${name}`);return index>=0?args[index+1]:fallback;};
const PROVIDER=option('provider','codex'),DAYS=Number(option('days','14')),HISTORY=Number(option('history','365'));
const PER_DAY=Number(option('per-day','6')),HISTORY_PER_DAY=Number(option('history-per-day','0.8'));
const NEWS_DAYS=String(option('news-days','7')).split(',').filter(Boolean).map(Number),PERF=Number(option('perf','0'));
const DAY=86400000;
const normal=text=>String(text||'').normalize('NFKC').toLocaleLowerCase();
const has=(text,word)=>normal(text).includes(normal(word));
const seconds=ms=>Math.round(ms/100)/10;

function backdate(store,id,at){store.db.prepare('UPDATE notes SET created_at=? WHERE id=?').run(at,id);store.db.prepare('UPDATE note_revisions SET created_at=? WHERE note_id=?').run(at,id);}
function addNote(store,note,model){
  const saved=store.saveNote({text:note.text,excerpt:note.excerpt,...(model?{model}:{})});
  const revisionId=store.listNotes().find(item=>item.id===saved.id).revisionId;
  if(note.article){store.markArticlePreviewRunning(revisionId);store.finishArticlePreview(revisionId,note.article);}
  backdate(store,saved.id,note.at);
  return {id:saved.id,revisionId};
}
function costOf(calls){
  const by={};let total={calls:0,errors:0,ms:0,input:0,output:0};
  for(const call of calls){
    const key=call.purpose.replace(/-retry$/,'');const entry=by[key]??={calls:0,errors:0,ms:0,input:0,output:0};
    for(const target of [entry,total]){target.calls++;if(call.status!=='ok')target.errors++;target.ms+=call.ms;target.input+=call.usage?.input||0;target.output+=(call.usage?.output||0)+(call.usage?.reasoning||0);}
  }
  return {...total,byPurpose:by};
}
const windows=state=>Object.fromEntries((state.providers.find(provider=>provider.id===PROVIDER)?.windows||[]).map(window=>[window.id,window.usedPercent]));

// Without AI: how saving, listing and searching hold up with many notes.
async function perf(count){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-sim-perf-'));
  const store=new Store(path.join(dir,'pure.sqlite'));
  try{
    const {notes}=generate({days:Math.ceil(count/3),perDay:3,needles:true});
    const list=notes.slice(0,count);
    let t=Date.now();
    for(const note of list)addNote(store,note,'');
    const insert=Date.now()-t;
    const time=fn=>{const start=process.hrtime.bigint();const value=fn();return {value,ms:Number(process.hrtime.bigint()-start)/1e6};};
    const listed=time(()=>store.listNotes()),searchable=time(()=>store.searchableNotes());
    const one=time(()=>store.saveNote({text:'新しいメモを1件保存する速さ'}));
    const {retrieve}=require('../desktop/retrieval.cjs');
    t=Date.now();let first;try{first=await retrieve(store,'妹の誕生日はいつ？',{limit:10});}catch(error){first={error:error.message};}
    const firstSearch=Date.now()-t;
    t=Date.now();let second;try{second=await retrieve(store,'パスポートの期限は？',{limit:10});}catch(error){second={error:error.message};}
    const secondSearch=Date.now()-t;
    const found=Array.isArray(second)&&second.some(note=>has(note.text,'パスポート'));
    const size=fs.statSync(path.join(dir,'pure.sqlite')).size+(fs.existsSync(path.join(dir,'pure.sqlite-wal'))?fs.statSync(path.join(dir,'pure.sqlite-wal')).size:0);
    const result={notes:list.length,insertMsPerNote:Math.round(insert/list.length*10)/10,saveOneMs:Math.round(one.ms),listNotesMs:Math.round(listed.ms),searchableNotesMs:Math.round(searchable.ms),
      firstSearchMs:firstSearch,secondSearchMs:secondSearch,searchFound:found,searchError:first?.error||second?.error||'',dbMB:Math.round(size/1e5)/10};
    console.log(JSON.stringify(result,null,1));
    return result;
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

async function simulate(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pure-sim-'));
  const codex=new CodexClient({codexHome:path.join(tmp,'codex')}),claude=new ClaudeCodeClient();
  const calls=[];let phase='install';
  const client=new AiRouter({providers:{codex,claude},provider:()=>PROVIDER,lightModel:()=>'',reasoningEffort:()=>'',onCall:call=>calls.push({...call,phase,at:Date.now()})});
  const store=new Store(path.join(tmp,'pure.sqlite'));
  const usage=new AiUsage(store,{codex,claude,provider:()=>PROVIDER});
  try{
    store.uiLocale('ja');
    const models=await client.models();
    const model=option('model',models.find(item=>item.isDefault)?.model||models[0]?.model);
    store.autoDigestEnabled(true,model);
    // Days pass in minutes here, so digests are updated once at the end of each simulated day. The app
    // waits for quiet notes and at least 6 hours between updates, so a busy day there may have two or three.
    store.digestPacing={quietMs:0,intervalMs:0};
    store.backfillDecision('all');
    const ai=new AnalysisExecutor(store,client);
    const total=HISTORY+DAYS;
    const {notes,quitClimbing,startRunning}=generate({days:total,perDay:day=>day>=HISTORY?PER_DAY:HISTORY_PER_DAY});
    const history=notes.filter(note=>note.day<HISTORY),daily=notes.filter(note=>note.day>=HISTORY);
    console.log(`${PROVIDER} ${model} · ${history.length} notes over ${HISTORY} days already there, then ${DAYS} days of use (${daily.length} notes) · news on day ${NEWS_DAYS.join(',')||'none'}`);
    const before=await usage.read({refresh:true});
    const keys=new Map();
    // Install: a year of notes, half of them already sorted by the person into their categories.
    const categoryIds={};
    for(const note of history)keys.set(note.key,addNote(store,note,''));
    for(const [thread,name] of Object.entries(CATEGORIES)){
      const sorted=history.filter(note=>note.thread===thread).filter((_,index)=>index%2===0).map(note=>keys.get(note.key).id);
      categoryIds[thread]=store.createCategory(name,sorted).id;
    }
    const classifier=new Classifier(store,ai);
    let simNow=Date.parse(history.at(-1).at);
    const profile=new ProfileWorker(store,ai,{model:()=>model,now:()=>simNow});
    const digests=new DigestWorker(store,ai,classifier);
    let t=Date.now();
    store.queueMemoryBackfill(model);
    await classifier.drain();
    await profile.run();
    await digests.drain();
    const install={ms:Date.now()-t,facts:store.memoryFacts().length,profile:store.profileEntries().length};
    const afterInstall=await usage.read({refresh:true});
    console.log(`install: ${seconds(install.ms)}s · ${install.facts} facts · ${install.profile} profile lines · ${costOf(calls).calls} calls`);
    // Daily use.
    const days=[];
    for(let day=0;day<DAYS;day++){
      phase=`day${day+1}`;
      const today=daily.filter(note=>note.day===HISTORY+day);
      const started=Date.now(),startCalls=calls.length;
      for(const note of today)keys.set(note.key,addNote(store,note,model));
      simNow=Date.parse(today.at(-1)?.at||new Date(simNow+DAY).toISOString());
      const step=async(name,fn)=>{const t0=Date.now();await fn();steps[name]=(steps[name]||0)+Date.now()-t0;};
      const steps={};
      await step('classify',()=>classifier.drain());
      await step('profile',()=>profile.run());
      await step('digest',()=>digests.drain());
      if(NEWS_DAYS.includes(day+1)){
        const findInterests=({model:m,task})=>aiTasks.findInterests({store,ai:client,model:m,task});
        const news=await new NewsWorker(store,{ai:client,model:()=>model,locale:()=>'ja',findInterests,aiName:()=>PROVIDER}).collect().catch(error=>({error:error.message}));
        console.log(`  news: ${news.added??0} items${news.error?` (${news.error})`:''}${news.failures?.length?` · failures: ${news.failures.join(' / ')}`:''}`);
      }
      const cost=costOf(calls.slice(startCalls));
      days.push({day:day+1,notes:today.length,ms:Date.now()-started,steps,...cost});
      console.log(`day ${day+1}: ${today.length} notes · ${cost.calls} calls · ${seconds(cost.ms)}s of AI · ${Math.round((cost.input+cost.output)/1000)}k tokens · ${seconds(Date.now()-started)}s on the clock (${Object.entries(steps).map(([name,ms])=>`${name} ${seconds(ms)}s`).join(', ')})`);
    }
    const afterDays=await usage.read({refresh:true});
    // Checks at the end.
    phase='checks';
    const checks=[];
    for(const needle of [...NEEDLES.filter(item=>item.question),...UNKNOWN]){
      try{
        const {result}=await aiTasks.ask({store,ai,model,question:needle.question});
        const text=[result.text,...(result.claims||[]).map(claim=>claim.text)].join('\n');
        const status=needle.status||'ready';
        const pass=result.status===status&&(needle.answer||[]).every(word=>has(text,word))&&!(needle.never||[]).some(word=>has(text,word));
        checks.push({kind:'ask',case:needle.question,pass,detail:`${result.status}: ${String(result.text).slice(0,120)}`});
      }catch(error){checks.push({kind:'ask',case:needle.question,pass:false,detail:error.message});}
    }
    const entries=store.profileEntries(),find=word=>entries.find(entry=>has(entry.label,word)||has(entry.line,word));
    checks.push({kind:'profile',case:'ボルダリングは過去',pass:find('ボルダリング')?.status==='past',detail:find('ボルダリング')?`${find('ボルダリング').status}: ${find('ボルダリング').line}`:'missing'});
    checks.push({kind:'profile',case:'ランニングは今',pass:find('ラン')?.status==='current',detail:find('ラン')?`${find('ラン').status}: ${find('ラン').line}`:'missing'});
    // Sorting of the notes written during use: a note from a thread belongs in that thread's category.
    const byId=new Map(store.listNotes().map(note=>[note.id,note]));
    const nameOf=new Map(Object.entries(categoryIds).map(([thread,id])=>[id,thread]));
    let right=0,wrong=0,missed=0,unsorted=0;const mistakes=[];
    for(const note of daily){
      const saved=byId.get(keys.get(note.key).id);const got=saved.categoryIds.map(id=>nameOf.get(id)).filter(Boolean);
      if(saved.classificationState!=='done'){unsorted++;continue;}
      if(CATEGORIES[note.thread]){if(got.includes(note.thread))right++;else{missed++;mistakes.push(`${note.text} → [${got}]`);}}
      wrong+=got.filter(thread=>thread!==note.thread).length;
      if(!CATEGORIES[note.thread]&&got.length)mistakes.push(`${note.text} → [${got}]`);
    }
    checks.push({kind:'classify',case:'new notes sorted into their category',pass:missed<=Math.ceil((right+missed)*0.15)&&wrong<=Math.ceil(daily.length*0.1),detail:`right ${right} · missed ${missed} · wrong ${wrong} · not sorted ${unsorted}`,mistakes:mistakes.slice(0,12)});
    const interests=store.newsInterests();
    if(interests.at)checks.push({kind:'interests',case:'interests from the notes',pass:['ハナレグミ','坂本慎太郎','中村佳穂','くるり','SUITS','インターステラー','スティール','プラダ'].filter(word=>interests.items.some(item=>has(`${item.query}${item.label}`,word))).length>=4&&!interests.items.some(item=>/ボルダリング|牛乳|猫/.test(item.query)),
      detail:`${interests.items.map(item=>item.query).join(' / ')} · related: ${interests.related.map(item=>item.query).join(' / ')}`});
    const end=await usage.read({refresh:true});
    // Cost: install, the days of use, and a month at the same pace.
    const installCost=costOf(calls.filter(call=>call.phase==='install'));
    const dailyCost=costOf(calls.filter(call=>call.phase.startsWith('day')));
    const perDay={calls:dailyCost.calls/DAYS,ms:dailyCost.ms/DAYS,tokens:(dailyCost.input+dailyCost.output)/DAYS};
    const w0=windows(before),w1=windows(afterInstall),w2=windows(afterDays);
    const report={at:new Date().toISOString(),provider:PROVIDER,model,history:history.length,days:DAYS,dailyNotes:daily.length,install,
      cost:{install:installCost,daily:dailyCost,perDay,month:{calls:Math.round(perDay.calls*30),tokens:Math.round(perDay.tokens*30),aiMinutes:Math.round(perDay.ms*30/60000)}},
      usageWindows:{before:w0,afterInstall:w1,afterDays:w2,end:windows(end)},days,checks,quitClimbing,startRunning};
    console.log(`\ncost: install ${installCost.calls} calls, ${seconds(installCost.ms)}s of AI, ${Math.round((installCost.input+installCost.output)/1000)}k tokens`);
    console.log(`      a day of use ${perDay.calls.toFixed(1)} calls, ${seconds(perDay.ms)}s, ${Math.round(perDay.tokens/1000)}k tokens · a month ≈ ${report.cost.month.calls} calls, ${Math.round(report.cost.month.tokens/1000)}k tokens, ${report.cost.month.aiMinutes} min of AI`);
    console.log(`      account windows (${PROVIDER}): before ${JSON.stringify(w0)} → after install ${JSON.stringify(w1)} → after ${DAYS} days ${JSON.stringify(w2)}`);
    console.log('      by purpose (all):',Object.entries(costOf(calls).byPurpose).sort((a,b)=>b[1].input+b[1].output-(a[1].input+a[1].output)).map(([key,value])=>`${key} ${value.calls}×/${Math.round((value.input+value.output)/1000)}k${value.errors?` (${value.errors} failed)`:''}`).join(' · '));
    console.log(`\nchecks: ${checks.filter(check=>check.pass).length}/${checks.length}`);
    for(const check of checks)console.log(`  ${check.pass?'ok  ':'FAIL'} ${check.kind} · ${check.case} — ${check.detail}${!check.pass&&check.mistakes?.length?`\n        ${check.mistakes.join('\n        ')}`:''}`);
    fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});
    const file=path.join(__dirname,'results',`simulate-${PROVIDER}-${report.at.replace(/[:.]/g,'-')}.json`);
    fs.writeFileSync(file,JSON.stringify(report,null,1));
    console.log(`\nreport: ${path.relative(process.cwd(),file)}`);
  }finally{store.close();client.stop();fs.rmSync(tmp,{recursive:true,force:true});}
}

(PERF?perf(PERF):simulate()).catch(error=>{console.error(error);process.exit(1);});
