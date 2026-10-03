const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {DigestWorker}=require('./digest-worker.cjs');
const {verifying}=require('./test-helpers.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-digest-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}
function sources(prompt){return JSON.parse(prompt.slice(prompt.lastIndexOf('原文: ')+4));}
function answer(prompt){const ids=sources(prompt).map(note=>note.revisionId);return {status:'ready',text:'二つの原文をまとめた。',pattern:'場面が異なる。',action:'もう一つ記録する。',evidenceRevisionIds:ids,categories:[],claims:[{text:'二つの場面で音楽の記録がある。',kind:'observation',speaker:'self',period:'',evidenceRevisionIds:ids,counterRevisionIds:[]}]};}
const classifier={idle:async()=>{}};

test('automatic insight updates are opt-in, queued, and backed by current source versions',async()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'作業中はピアノを聴く。'});
    const second=store.saveNote({text:'雨の日は静かな曲を聴く。'});
    const category=store.createCategory('Music',[first.id,second.id]);
    assert.equal(store.autoDigestEnabled(),false);
    assert.equal(store.queueStaleDigests(),0);
    store.autoDigestEnabled(true,'test-model');
    assert.equal(store.queueStaleDigests(),1);
    assert.equal(store.digestStatus().pending,1);
    const worker=new DigestWorker(store,verifying({generate:async({prompt})=>answer(prompt)}),classifier);
    await worker.drain();
    assert.equal(store.digestStatus().pending,0);
    assert.equal(store.insightState(category.id).status,'current');
    assert.equal(store.latestOutput('summary',category.id).evidence.length,2);
    assert.equal(store.latestOutput('summary',category.id).claims[0].sources.length,2);
    assert.equal(store.nextSteps().length,1);
    worker.stop();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('an older in-flight digest cannot replace a newer note version',async()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'ピアノが好き。'});
    const second=store.saveNote({text:'雨の日に曲を聴く。'});
    const category=store.createCategory('Music',[first.id,second.id]);
    store.autoDigestEnabled(true,'test-model');store.queueStaleDigests();
    let release,started,call=0;
    const firstStarted=new Promise(resolve=>started=resolve);
    const ai={generate:async({prompt})=>{
      call++;
      if(call===1){started();return new Promise(resolve=>release=()=>resolve(answer(prompt)));}
      return answer(prompt);
    }};
    const worker=new DigestWorker(store,verifying(ai),classifier);
    const draining=worker.drain();
    await firstStarted;
    const edited=store.saveNote({id:first.id,text:'最近はジャズが好き。'});
    store.queueStaleDigests();
    release();await draining;
    assert.equal(call,2);
    assert.equal(store.insightState(category.id).status,'current');
    assert.ok(store.latestOutput('summary',category.id).evidence.some(item=>item.revisionId===edited.revisionId));
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM runs WHERE purpose='collection'").get().count,1);
    worker.stop();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('failed jobs persist and only retry when requested',async()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'ピアノを弾いた。'});
    const second=store.saveNote({text:'曲を聴いた。'});
    const category=store.createCategory('Music',[first.id,second.id]);
    store.autoDigestEnabled(true,'test-model');store.queueStaleDigests();
    const worker=new DigestWorker(store,verifying({generate:async()=>{throw new Error('offline')}}),classifier);
    await worker.drain();
    assert.equal(store.digestStatus().failed,1);
    await worker.drain();
    assert.equal(store.digestStatus().failed,1);
    worker.stop();store.close();
    const reopened=new Store(path.join(dir,'pure.sqlite'));
    assert.equal(reopened.digestStatus().failed,1);
    reopened.retryDigests();
    const resumed=new DigestWorker(reopened,verifying({generate:async({prompt})=>answer(prompt)}),classifier);
    await resumed.drain();
    assert.equal(reopened.insightState(category.id).status,'current');
    resumed.stop();reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a Bad rating can refresh a digest with the correction in context',async()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'作業中はピアノを聴く。'});
    const second=store.saveNote({text:'休日は歌詞のある曲も聴く。'});
    const category=store.createCategory('Music',[first.id,second.id]);
    store.autoDigestEnabled(true,'test-model');store.queueStaleDigests();
    const prompts=[];
    const worker=new DigestWorker(store,verifying({generate:async({prompt})=>{prompts.push(prompt);return answer(prompt)}}),classifier);
    await worker.drain();
    const firstOutput=store.latestOutput('summary',category.id);
    store.rate(firstOutput.id,'bad','incorrect','歌詞がない曲は作業中だけです。');
    store.invalidateInsight(category.id);store.queueStaleDigests();
    await worker.drain();
    assert.equal(prompts.length,2);
    assert.match(prompts[1],/歌詞がない曲は作業中だけです/);
    assert.equal(store.insightState(category.id).status,'current');
    worker.stop();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('turning automatic updates off while AI is running does not save its result',async()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'朝はピアノを聴いた。'});
    const second=store.saveNote({text:'夜はジャズを聴いた。'});
    const category=store.createCategory('Music',[first.id,second.id]);
    store.autoDigestEnabled(true,'test-model');store.queueStaleDigests();
    let release,started;
    const running=new Promise(resolve=>started=resolve);
    const worker=new DigestWorker(store,verifying({generate:async({prompt})=>{started();return new Promise(resolve=>release=()=>resolve(answer(prompt)))}}),classifier);
    const draining=worker.drain();await running;
    store.autoDigestEnabled(false);worker.stop();release();await draining;
    assert.equal(store.insightState(category.id).status,'missing');
    assert.equal(store.digestStatus().pending,1);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('after the first digest, updates wait for the notes to be quiet and for the last digest to be old enough',async()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'作業中はピアノを聴く。'});
    const second=store.saveNote({text:'休日は歌詞のある曲も聴く。'});
    const category=store.createCategory('Music',[first.id,second.id]);
    store.autoDigestEnabled(true,'test-model');store.queueStaleDigests();
    const prompts=[];
    const worker=new DigestWorker(store,verifying({generate:async({prompt})=>{prompts.push(prompt);return answer(prompt)}}),classifier);
    await worker.drain();
    assert.equal(prompts.length,1,'the first digest is made at once');
    const third=store.saveNote({text:'夜はジャズを聴く。'});store.assignNote(third.id,category.id);
    store.queueStaleDigests();await worker.drain();
    assert.equal(prompts.length,1,'a new note does not redo it right away');
    const delay=store.nextJobDelay('digest');
    assert.ok(delay>5*60*60*1000,`waits until the last digest is old enough (${delay})`);
    store.digestPacing={quietMs:0,intervalMs:0};store.queueStaleDigests();
    store.db.prepare('UPDATE digest_jobs SET retry_after=NULL').run();
    await worker.drain();
    assert.equal(prompts.length,2,'and then it is updated');
    worker.stop();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
