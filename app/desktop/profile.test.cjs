const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {ProfileWorker,groupFacts,profileContext,PROFILE_VERSION}=require('./profile.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-profile-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}
const DAY=86400000,NOW=Date.parse('2026-10-02T00:00:00Z');
function addNote(store,text,daysAgo,facts){
  const note=store.saveNote({text});
  const revisionId=store.listNotes().find(n=>n.id===note.id).revisionId;
  const at=new Date(NOW-daysAgo*DAY).toISOString();
  store.db.prepare('UPDATE notes SET created_at=? WHERE id=?').run(at,note.id);
  store.replaceMemoryFacts({noteId:note.id,revisionId,model:'m'},facts.map(f=>({kind:'preference',entityType:'artist',polarity:'positive',speaker:'self',period:'',quote:text.slice(0,4),statement:f.subject+'が好き',...f})));
  return note;
}
// A stand-in that writes "line for <key>" and remembers which topics it was asked about.
function writer(){
  const asked=[];
  return {asked,generate:async({prompt})=>{
    const topics=JSON.parse(prompt.slice(prompt.lastIndexOf('topics: ')+8));
    asked.push(topics.map(topic=>topic.key));
    return {entries:topics.map(topic=>({key:topic.key,label:topic.subject,line:`${topic.subject}: ${topic.facts.length}件の記録`,status:topic.facts.some(f=>f.polarity==='negative')?'past':'current'}))};
  }};
}

test('facts are grouped by topic; a single passing mention is not a topic',()=>{
  const facts=[{id:1,noteId:'a',revisionId:'ra',subject:'ハナレグミ',entityType:'artist',kind:'preference',polarity:'positive',speaker:'self',date:'2026-09-01',statement:'',quote:''},
    {id:2,noteId:'b',revisionId:'rb',subject:'ハナ レグミ',entityType:'artist',kind:'experience',polarity:'positive',speaker:'self',date:'2026-09-20',statement:'',quote:''},
    {id:3,noteId:'c',revisionId:'rc',subject:'牛乳',entityType:'product',kind:'other',polarity:'neutral',speaker:'self',date:'2026-09-21',statement:'',quote:''},
    {id:4,noteId:'d',revisionId:'rd',subject:'名言',entityType:'topic',kind:'opinion',polarity:'neutral',speaker:'external',date:'2026-09-21',statement:'',quote:''}];
  const groups=groupFacts(facts,{now:NOW});
  assert.deepEqual(groups.map(g=>[g.subject,g.mentions,g.factIds]),[['ハナ レグミ',2,[1,2]]]);
});

test('only topics whose facts changed are rewritten, gone topics leave at once, and a weekly rebuild starts from the facts',async()=>{
  const {dir,store}=fresh();
  try{
    let now=NOW;
    const ai=writer();
    const worker=new ProfileWorker(store,ai,{model:()=>'m',now:()=>now});
    addNote(store,'ハナレグミ最高',30,[{subject:'ハナレグミ'}]);
    const suits=addNote(store,'スーツ5周目',10,[{subject:'SUITS',entityType:'work'}]);
    await worker.run();
    assert.deepEqual(ai.asked.map(keys=>[...keys].sort()),[['suits','ハナレグミ']]);
    assert.equal(store.profileMeta().version,PROFILE_VERSION);
    // A new note about one topic: only that topic is sent.
    addNote(store,'坂本慎太郎の新譜',1,[{subject:'坂本慎太郎'}]);
    await worker.run();
    assert.deepEqual(ai.asked[1],['坂本慎太郎']);
    await worker.run();
    assert.equal(ai.asked.length,2,'nothing changed, nothing sent');
    // Closing a note to AI removes the line built from it right away, before any rewrite.
    store.setAiExcluded({id:suits.id,excluded:true});
    assert.ok(!store.profileEntries().some(entry=>entry.key==='suits'));
    await worker.run();
    assert.equal(ai.asked.length,2,'a topic without facts is not rewritten, just gone');
    // A week later everything is written again from the facts alone.
    now+=8*DAY;
    await worker.run();
    assert.deepEqual(ai.asked[2].sort(),['ハナレグミ','坂本慎太郎']);
    assert.doesNotMatch(JSON.stringify(ai.asked),/previous/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a past topic stays in the profile but is not given to other prompts or used for news',async()=>{
  const {dir,store}=fresh();
  try{
    addNote(store,'ボルダリングはもうやめた',20,[{subject:'ボルダリング',entityType:'activity',kind:'experience',polarity:'negative'}]);
    addNote(store,'インターステラー最高',5,[{subject:'インターステラー',entityType:'work'}]);
    await new ProfileWorker(store,writer(),{model:()=>'m',now:()=>NOW}).run();
    const entries=store.profileEntries();
    assert.equal(entries.find(e=>e.key==='ボルダリング').status,'past');
    assert.deepEqual(profileContext(entries).map(e=>e.topic),['インターステラー']);
    const {interestSubjects}=require('./interests.cjs');
    assert.deepEqual(interestSubjects(store.memoryFacts(),{profile:entries,now:NOW}).map(s=>s.subject),['インターステラー']);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('nothing is sent without a model or while processing is off',async()=>{
  const {dir,store}=fresh();
  try{
    addNote(store,'ハナレグミ最高',3,[{subject:'ハナレグミ'}]);
    const ai=writer();
    assert.deepEqual(await new ProfileWorker(store,ai,{model:()=>''}).run(),{skipped:true});
    assert.deepEqual(await new ProfileWorker(store,ai,{model:()=>'m',enabled:()=>false}).run(),{skipped:true});
    assert.equal(ai.asked.length,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
