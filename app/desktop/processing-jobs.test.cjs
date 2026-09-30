const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('./store.cjs');
const {Classifier}=require('./classifier.cjs');
const {DigestWorker}=require('./digest-worker.cjs');
const {retryDelay,abortError}=require('./job-policy.cjs');

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-queue-test-'));
  const file=path.join(dir,'pure.sqlite');
  const store=new Store(file);
  const category=store.createCategory('Music');
  const first=store.saveNote({text:'朝はピアノを聴く。',model:'test-model'});
  const second=store.saveNote({text:'休日にジャズを聴く。',model:'test-model'});
  store.assignNote(first.id,category.id);store.assignNote(second.id,category.id);
  store.autoDigestEnabled(true,'test-model');store.queueStaleDigests();
  return {dir,file,store,category,first,second};
}
function digestAnswer(prompt){
  const notes=JSON.parse(prompt.slice(prompt.lastIndexOf('原文: ')+4));
  const ids=notes.map(note=>note.revisionId);
  return {status:'ready',text:'二つの音楽の記録。',pattern:'場面が異なる。',action:'次に聴いた曲を記録する。',evidenceRevisionIds:ids,categories:[],claims:[{text:'音楽の記録がある。',kind:'observation',speaker:'self',period:'',evidenceRevisionIds:ids,counterRevisionIds:[]}]};
}
const noClassifier={idle:async()=>{}};

test('pending cancellations persist through restart and manual retry requires an enabled setting',()=>{
  const {dir,file,store,category,first}=fixture();let reopened;
  try{
    const jobs=store.processingJobs();
    assert.equal(jobs.filter(job=>job.kind==='classification').length,2);
    assert.equal(jobs.find(job=>job.kind==='digest').title,'Music');
    for(const job of jobs)assert.equal(store.updateProcessingJob({...job,action:'cancel'}),true);
    store.queueStaleDigests();
    assert.equal(store.digestStatus().cancelled,1);
    assert.equal(store.nextDigestJob(),undefined);
    assert.equal(store.nextClassificationJob(),undefined);
    store.close();reopened=new Store(file);
    assert.equal(reopened.processingJobs().filter(job=>job.state==='cancelled').length,3);
    const job=reopened.processingJobs().find(job=>job.id===first.id);
    reopened.autoClassifyEnabled(false);
    assert.throws(()=>reopened.updateProcessingJob({...job,action:'retry'}),/オン/);
    reopened.autoClassifyEnabled(true);
    assert.equal(reopened.updateProcessingJob({...job,action:'retry'}),true);
    assert.notEqual(reopened.nextClassificationJob().token,job.token);
    assert.equal(reopened.updateProcessingJob({...job,action:'cancel'}),false);
    // Content changes create fresh jobs, without reviving the cancelled fingerprint.
    reopened.saveNote({id:first.id,text:'今朝は新しいピアノ曲を聴いた。',model:'test-model'});
    reopened.queueStaleDigests();
    assert.equal(reopened.digestStatus().pending,1);
    assert.equal(reopened.notesFor(category.id).length,2);
  }finally{(reopened||store).close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a cancelled classification can neither apply nor fail a newer attempt of the same revision',()=>{
  const {dir,store,category}=fixture();
  try{
    const old=store.nextClassificationJob();store.markClassificationRunning(old.noteId,old.revisionId,old.token);
    const job=store.processingJobs().find(item=>item.id===old.noteId);
    store.updateProcessingJob({...job,action:'cancel'});store.updateProcessingJob({...job,action:'retry'});
    const fresh=store.nextClassificationJob();
    // Select the same note directly; the other queued note may be first by timestamp.
    const current=fresh.noteId===old.noteId?fresh:{...old,token:store.processingJobs().find(item=>item.id===old.noteId).token};
    store.markClassificationRunning(current.noteId,current.revisionId,current.token);
    assert.equal(store.applyClassification(old,[category.id]),false);
    store.failClassification(old.noteId,old.revisionId,new Error('timeout'),old.token);
    assert.equal(store.processingJobs().find(item=>item.id===old.noteId).state,'running');
    assert.equal(store.applyClassification(current,[category.id]),true);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('stopping one running classification interrupts its signal and other notes continue',async()=>{
  const {dir,store,category}=fixture();let worker;
  try{
    let started,signal;
    const beginning=new Promise(resolve=>started=resolve);
    let calls=0;
    worker=new Classifier(store,{generate:async options=>{
      calls++;
      if(calls===1){signal=options.signal;started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(abortError()),{once:true}));}
      return {categoryIds:[category.id]};
    }});
    const draining=worker.drain();await beginning;
    const job=store.processingJobs().find(item=>item.kind==='classification'&&item.state==='running');
    store.updateProcessingJob({...job,action:'cancel'});worker.cancel(job.id,job.token);
    await draining;
    assert.equal(signal.aborted,true);
    assert.equal(store.classificationStatus().cancelled,1);
    assert.equal(store.classificationStatus().done,1);
    assert.equal(calls,2);
  }finally{worker?.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a late digest result after cancel and immediate retry saves only the new attempt',async()=>{
  const {dir,store,category}=fixture();let worker;
  try{
    let started,release,calls=0;
    const beginning=new Promise(resolve=>started=resolve);
    worker=new DigestWorker(store,{generate:async({prompt})=>{
      calls++;
      if(calls===1){started();return new Promise(resolve=>release=()=>resolve(digestAnswer(prompt)));}
      return digestAnswer(prompt);
    }},noClassifier);
    const draining=worker.drain();await beginning;
    const old=store.processingJobs().find(job=>job.kind==='digest');
    store.updateProcessingJob({...old,action:'cancel'});worker.cancel(old.id,old.token);
    store.updateProcessingJob({...old,action:'retry'});
    release();await draining;
    assert.equal(calls,2);
    assert.equal(store.insightState(category.id).status,'current');
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs WHERE purpose='collection'").get().n,1);
  }finally{worker?.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('temporary failures have durable backoff and stop after three attempts for both kinds',()=>{
  const {dir,file,store,first}=fixture();let reopened;
  try{
    for(const job of store.processingJobs().filter(item=>item.kind==='classification'&&item.id!==first.id))store.updateProcessingJob({...job,action:'cancel'});
    for(const kind of ['classification','digest']){
      for(let attempt=1;attempt<=3;attempt++){
        const job=kind==='classification'?store.nextClassificationJob():store.nextDigestJob();
        assert.ok(job);
        kind==='classification'?store.markClassificationRunning(job.noteId,job.revisionId,job.token):store.markDigestRunning(job);
        const before=Date.now();
        kind==='classification'?store.failClassification(job.noteId,job.revisionId,new Error('AI analysis timed out.'),job.token):store.failDigest(job,new Error('503 Service unavailable'));
        const queued=store.processingJobs().find(item=>item.kind===kind&&item.id===(job.noteId||job.categoryId));
        assert.equal(queued.attempts,attempt);
        if(attempt<3){
          assert.equal(queued.state,'pending');
          assert.ok(queued.retryAfter>=before+(attempt===1?15000:60000));
          const {table,key}=store.jobTable(kind);
          // Advance the durable deadline without sleeping in the test.
          store.db.prepare(`UPDATE ${table} SET retry_after=0 WHERE ${key}=?`).run(queued.id);
        }else{
          assert.equal(queued.state,'failed');assert.equal(queued.retryAfter,null);
        }
      }
    }
    const failed=store.processingJobs().find(job=>job.kind==='digest');
    store.updateProcessingJob({...failed,action:'retry'});
    const job=store.nextDigestJob();store.markDigestRunning(job);store.failDigest(job,new Error('network error'));
    const deadline=store.processingJobs().find(item=>item.kind==='digest').retryAfter;
    store.close();reopened=new Store(file);
    assert.equal(reopened.processingJobs().find(item=>item.kind==='digest').retryAfter,deadline);
    assert.equal(reopened.nextDigestJob(),undefined);
    assert.ok(reopened.nextJobDelay('digest')>0);
  }finally{(reopened||store).close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('authentication, limits, malformed output, cancellation and unknown failures are not retried',()=>{
  for(const message of ['401 authentication required','429 rate limit','quota exceeded','AI returned invalid JSON.','permission denied','offline','unknown failure'])assert.equal(retryDelay(new Error(message),1),null,message);
  assert.equal(retryDelay(abortError(),1),null);
  assert.equal(retryDelay(Object.assign(new Error('socket reset'),{code:'ECONNRESET'}),1),15000);
  assert.equal(retryDelay(new Error('connection closed'),2),60000);
  assert.equal(retryDelay(new Error('timeout'),3),null);
});

test('old job tables gain tokens and retry deadlines without losing queued notes',()=>{
  const {dir,file,store}=fixture();let reopened;
  try{
    store.close();const old=new DatabaseSync(file);
    for(const table of ['classification_jobs','digest_jobs']){old.exec(`ALTER TABLE ${table} DROP COLUMN token; ALTER TABLE ${table} DROP COLUMN retry_after`);}
    old.close();reopened=new Store(file);
    assert.equal(reopened.processingJobs().length,3);
    assert.ok(reopened.processingJobs().every(job=>job.token&&job.retryAfter===null));
  }finally{(reopened||store).close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('rapidly turning processing off and back on cannot strand an aborted running job',async()=>{
  for(const kind of ['classification','digest']){
    const {dir,store}=fixture();let worker;
    try{
      let started,calls=0;
      const beginning=new Promise(resolve=>started=resolve);
      const ai={generate:async({signal,prompt})=>{
        calls++;
        if(calls===1){started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(abortError()),{once:true}));}
        return kind==='digest'?digestAnswer(prompt):{categoryIds:[]};
      }};
      worker=kind==='classification'?new Classifier(store,ai):new DigestWorker(store,ai,noClassifier);
      const draining=worker.drain();await beginning;
      worker.stop();worker.start();await draining;
      assert.equal(store.processingJobs().filter(job=>job.kind===kind&&job.state==='running').length,0);
      assert.equal(store.processingJobs().filter(job=>job.kind===kind&&job.state==='pending').length,0);
      assert.ok(calls>=2);
    }finally{worker?.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('the worker wakes at a retry deadline without a manual action',async()=>{
  const {dir,store,first}=fixture();let worker,guard;
  try{
    for(const job of store.processingJobs().filter(item=>item.kind==='classification'&&item.id!==first.id))store.updateProcessingJob({...job,action:'cancel'});
    const fail=store.failClassification.bind(store);
    store.failClassification=(...args)=>{
      fail(...args);
      // Keep the scheduling test fast; the production delays are checked above.
      store.db.prepare("UPDATE classification_jobs SET retry_after=? WHERE note_id=? AND state='pending'").run(Date.now()+20,args[0]);
    };
    let calls=0,finished;
    const complete=new Promise((resolve,reject)=>{finished=resolve;guard=setTimeout(()=>reject(new Error('retry did not wake')),2000);});
    worker=new Classifier(store,{generate:async()=>{if(++calls===1)throw new Error('network error');return {categoryIds:[]};}},()=>{
      if(store.classificationStatus().done===1)finished();
    });
    worker.start();await complete;await worker.idle();
    assert.equal(calls,2);
    assert.equal(store.processingJobs().filter(job=>job.state==='failed').length,0);
  }finally{clearTimeout(guard);worker?.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
