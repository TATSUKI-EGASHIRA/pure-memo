const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('./store.cjs');
const {AnalysisExecutor}=require('./analysis-executor.cjs');
const {Classifier}=require('./classifier.cjs');
const {DigestWorker}=require('./digest-worker.cjs');
const {retrieve}=require('./retrieval.cjs');
const {promptFor}=require('./analysis.cjs');

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-exclusion-test-'));
  const file=path.join(dir,'pure.sqlite');
  const store=new Store(file);
  const category=store.createCategory('Music');
  const secret=store.saveNote({text:'非公開のライブで感じた秘密の印象。',model:'test'});
  const other=store.saveNote({text:'朝はピアノを聴いた。',model:'test'});
  const third=store.saveNote({text:'休日はジャズを聴いた。',model:'test'});
  for(const note of [secret,other,third])store.assignNote(note.id,category.id);
  return {dir,file,store,category,secret,other,third};
}
function result(items){return {status:'ready',text:'音楽についての記録。',pattern:'場面の違いがある。',action:'次の感想を残す。',evidenceRevisionIds:items.map(item=>item.revisionId),categories:[],claims:[{text:'音楽について記録した。',kind:'observation',speaker:'self',period:'',evidenceRevisionIds:items.map(item=>item.revisionId),counterRevisionIds:[]}]};}
const noEmbedding=async()=>{throw new Error('unavailable');};

test('excluded notes remain visible locally but stay out of every AI candidate set and cache',async()=>{
  const {dir,store,category,secret}=fixture();
  try{
    const privateFirst=store.saveNote({text:'保存前に対象外にした思いつき',model:'test',aiExcluded:true});
    assert.equal(store.processingJobs().some(job=>job.id===privateFirst.id),false);
    store.saveEmbeddings('test',[{revisionId:secret.revisionId,vector:[1,0]}]);
    assert.equal(store.cachedEmbeddings('test').size,1);
    store.setAiExcluded({id:secret.id,excluded:true});
    assert.equal(store.listNotes().find(note=>note.id===secret.id).aiExcluded,true);
    assert.ok(store.listNotes().some(note=>note.text.includes('秘密')));
    assert.equal(store.notesFor(category.id).length,3);
    assert.equal(store.graphData().notes.some(note=>note.id===secret.id),true);
    assert.equal(store.analysisNotesFor(category.id).length,2);
    assert.equal(store.analysisNotesFor('other').some(note=>note.id===privateFirst.id),false);
    assert.equal(store.searchableNotes().some(note=>note.id===secret.id),false);
    assert.equal(store.insightSourceIds(category.id).includes(secret.revisionId),false);
    assert.equal(store.processingJobs().some(job=>job.id===secret.id),false);
    assert.equal(store.cachedEmbeddings('test').size,0);
    const selected=await retrieve(store,'ライブの印象は？',{embedder:noEmbedding,useDigest:true});
    assert.equal(selected.some(note=>[secret.id,privateFirst.id].includes(note.id)),false);
    store.saveEmbeddings('test',[{revisionId:secret.revisionId,vector:[1,0]}]);
    assert.equal(store.cachedEmbeddings('test').size,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('feedback dependencies are blocked transitively while unrelated tracked results remain usable',()=>{
  const {dir,store,category,secret,other,third}=fixture();
  try{
    const original=store.saveAnalysis({purpose:'collection',categoryId:category.id,model:'test',items:store.analysisNotesFor(category.id),result:result(store.analysisNotesFor(category.id))});
    store.rate(original.id,'bad','incorrect','秘密の印象についての訂正');
    const feedback=store.feedbackFor(category.id);
    assert.equal(feedback[0]._runId,original.run_id);
    assert.equal(promptFor('collection',[other,third],feedback).includes('"_runId"'),false);
    const derivative=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:[other,third],result:{status:'insufficient',text:'訂正をふまえると分からない。',pattern:'',action:'',evidenceRevisionIds:[],categories:[]},question:'音楽の好みは？',contextRunIds:feedback.map(item=>item._runId)});
    store.rate(derivative.id,'bad','incorrect','以前の印象に由来した訂正');
    const independent=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:[other],result:{status:'insufficient',text:'一件では判断できない。',pattern:'',action:'',evidenceRevisionIds:[],categories:[]},question:'ピアノは？'});
    store.rate(independent.id,'good');
    store.setAiExcluded({id:secret.id,excluded:true});
    assert.equal(store.latestOutput('summary',category.id),undefined);
    assert.equal(store.nextSteps().length,0);
    assert.equal(store.feedbackFor(category.id).length,0);
    assert.equal(store.feedbackForAsk('音楽の好みは？').length,0);
    assert.equal(store.feedbackForAsk('ピアノは？').length,1);
    assert.equal(store.questions().length,2);
    assert.equal(store.questions().find(q=>q.output.id===derivative.id).output.status,'stale');
    store.setAiExcluded({id:secret.id,excluded:false});
    assert.equal(store.feedbackFor(category.id).length,0);
    assert.equal(store.feedbackForAsk('音楽の好みは？').length,0);
    assert.throws(()=>store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:[other],result:{status:'insufficient',text:'古い訂正を再利用する。',pattern:'',action:'',evidenceRevisionIds:[],categories:[]},question:'音楽は？',contextRunIds:[original.run_id]}),/changed during analysis/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('exclusion changes during AI startup prevent upload, even after switching back on',async()=>{
  const {dir,store,secret}=fixture();
  try{
    let started,release,uploads=0;
    const beginning=new Promise(resolve=>started=resolve);
    const executor=new AnalysisExecutor(store,{generate:async({beforeSend})=>{
      started();await new Promise(resolve=>release=resolve);beforeSend();uploads++;return {};
    }});
    const pending=executor.generate({items:[secret],model:'test',prompt:secret.text});
    const failure=assert.rejects(pending,/changed during analysis/);
    await beginning;
    store.setAiExcluded({id:secret.id,excluded:true});store.setAiExcluded({id:secret.id,excluded:false});
    release();await failure;
    assert.equal(uploads,0);
    assert.equal(executor.active.size,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('late manual results and newly excluded feedback cannot be saved or reused',async()=>{
  const {dir,store,secret,other}=fixture();
  try{
    let started,release,signal;
    const beginning=new Promise(resolve=>started=resolve);
    const executor=new AnalysisExecutor(store,{generate:async options=>{signal=options.signal;started();return new Promise(resolve=>release=()=>resolve(result([secret])));}});
    const pending=executor.generate({items:[secret],model:'test',prompt:secret.text});
    const rejected=assert.rejects(pending,{name:'AbortError'});
    await beginning;store.setAiExcluded({id:secret.id,excluded:true});executor.cancelInvalid();
    assert.equal(signal.aborted,true);release();await rejected;
    assert.throws(()=>store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:[secret],result:{status:'insufficient',text:'遅れて返った回答',pattern:'',action:'',evidenceRevisionIds:[],categories:[]},question:'好みは？'}),/changed during analysis/);
    assert.equal(store.questions().length,0);
    const fresh=await new AnalysisExecutor(store,{generate:async()=>({ok:true})}).generate({items:[other],model:'test',prompt:other.text});
    assert.deepEqual(fresh,{ok:true});
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('running classification and digest discard excluded sources and continue with allowed notes',async()=>{
  for(const kind of ['classification','digest']){
    const {dir,store,category,secret}=fixture();let worker;
    try{
      store.autoDigestEnabled(true,'test');store.queueStaleDigests();
      // Choose the private note as the first classification regardless of timestamps.
      store.db.prepare("UPDATE classification_jobs SET updated_at='2000-01-01' WHERE note_id=?").run(secret.id);
      let started,release,calls=0;
      const beginning=new Promise(resolve=>started=resolve);
      const executor=new AnalysisExecutor(store,{generate:async({prompt})=>{
        calls++;
        const input=kind==='digest'?JSON.parse(prompt.slice(prompt.lastIndexOf('原文: ')+4)).map(item=>({revisionId:item.revisionId})):null;
        if(calls===1){started();return new Promise(resolve=>release=()=>resolve(kind==='digest'?result(input):{categoryIds:[category.id]}));}
        assert.equal(prompt.includes(secret.text),false);
        return kind==='digest'?result(input):{categoryIds:[]};
      }});
      worker=kind==='classification'?new Classifier(store,executor):new DigestWorker(store,executor,{idle:async()=>{}});
      const draining=worker.drain();await beginning;
      store.setAiExcluded({id:secret.id,excluded:true});executor.cancelInvalid();release();await draining;
      assert.equal(store.processingJobs().some(job=>job.kind==='classification'&&job.id===secret.id),false);
      assert.equal(store.db.prepare("SELECT count(*) AS n FROM analysis_inputs WHERE revision_id=?").get(secret.revisionId).n,0);
      if(kind==='digest')assert.equal(store.insightState(category.id).status,'current');
      assert.ok(calls>=2);
    }finally{worker?.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('a retrieval snapshot cannot reintroduce a note excluded while embedding is running',async()=>{
  const {dir,store,secret}=fixture();
  try{
    let calls=0;
    const selected=await retrieve(store,'ライブの印象は？',{embedder:async texts=>{
      if(++calls===2){store.setAiExcluded({id:secret.id,excluded:true});store.setAiExcluded({id:secret.id,excluded:false});}
      return {model:'fake',vectors:texts.map(()=>[1,0])};
    }});
    assert.equal(selected.some(note=>note.id===secret.id),false);
    assert.equal(store.cachedEmbeddings('fake').has(secret.revisionId),false);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('exclusion survives edits, draft recovery, trash, restart, backups and older same-Mac restores',async()=>{
  const {dir,file,store,secret}=fixture();let reopened;
  try{
    const oldBackup=path.join(dir,'old.sqlite');await store.backupTo(oldBackup);
    store.setAiExcluded({id:secret.id,excluded:true});
    const edited=store.saveNote({id:secret.id,text:'編集しても非公開',model:'test',aiExcluded:false});
    assert.equal(edited.aiExcluded,true);
    store.saveDraftSnapshot({text:'未保存の秘密',originKind:'human',sourceKind:'thought',editingId:'',aiExcluded:true,updatedAt:100});
    store.trashNote(secret.id);assert.equal(store.listTrash().find(note=>note.id===secret.id).aiExcluded,true);
    assert.equal(store.restoreNote(secret.id).aiExcluded,1);
    const excludedBackup=path.join(dir,'excluded.sqlite');await store.backupTo(excludedBackup);
    const copy=new Store(excludedBackup);assert.equal(copy.listNotes().find(note=>note.id===secret.id).aiExcluded,true);assert.equal(copy.draftAiExcluded(),true);copy.close();
    store.close();reopened=new Store(file);
    assert.equal(reopened.draftAiExcluded(),true);
    assert.equal(reopened.listNotes().find(note=>note.id===secret.id).aiExcluded,true);
    await reopened.restoreFrom(oldBackup,path.join(dir,'rollback.sqlite'));
    assert.equal(reopened.listNotes().find(note=>note.id===secret.id).aiExcluded,true);
    const originalBackup=new Store(oldBackup);assert.equal(originalBackup.listNotes().find(note=>note.id===secret.id).aiExcluded,false);originalBackup.close();
  }finally{(reopened||store).close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('old note schemas migrate with AI enabled and unknown historical feedback is not reused after exclusion',()=>{
  const {dir,file,store,secret,other}=fixture();let reopened;
  try{
    const answer=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:[other],result:{status:'insufficient',text:'過去の回答',pattern:'',action:'',evidenceRevisionIds:[],categories:[]},question:'音楽は？'});
    store.rate(answer.id,'bad','incorrect','古い訂正');store.close();
    const old=new DatabaseSync(file);old.exec('DROP TABLE run_contexts; ALTER TABLE runs DROP COLUMN context_tracked; ALTER TABLE runs DROP COLUMN ai_blocked; ALTER TABLE notes DROP COLUMN ai_excluded; ALTER TABLE notes DROP COLUMN ai_access_version;');old.close();
    reopened=new Store(file);
    assert.ok(reopened.listNotes().every(note=>note.aiExcluded===false&&note.aiAccessVersion===0));
    assert.equal(reopened.feedbackForAsk('音楽は？').length,1);
    reopened.setAiExcluded({id:secret.id,excluded:true});
    assert.equal(reopened.feedbackForAsk('音楽は？').length,0);
    assert.equal(reopened.listNotes().length,3);
  }finally{(reopened||store).close();fs.rmSync(dir,{recursive:true,force:true});}
});
