const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {Classifier,readFacts}=require('./classifier.cjs');
const {verifyResult}=require('./verify.cjs');
const {retrieve}=require('./retrieval.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-memory-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}
const fact=(over={})=>({kind:'preference',subject:'ハナレグミ',entityType:'artist',statement:'ハナレグミが好き',polarity:'positive',speaker:'self',period:'',quote:'ハナレグミの発光帯好き',...over});

test('facts are kept only when their quote is in the note, and excerpt-only quotes are someone else’s words',()=>{
  const job={text:'ハナレグミの発光帯好き。これ肝に銘じたい',excerpt:'良い文章とは、読み手の時間を奪わない文章である'};
  const facts=readFacts([fact(),fact({subject:'星野源',quote:'星野源が好き'}),fact({subject:'文章',statement:'良い文章を書きたい',quote:'読み手の時間を奪わない'}),
    fact({subject:'ハナレグミ',quote:'発光帯好き',kind:'nonsense',polarity:'??'})],job);
  assert.equal(facts.length,3,'an invented quote is dropped');
  assert.equal(facts[1].speaker,'external','a quote only in the excerpt is not the person’s own');
  assert.deepEqual([facts[2].kind,facts[2].polarity],['other','neutral']);
  assert.deepEqual(readFacts('nope',job),[]);
  const live={text:'ハナレグミのライブに行った。上司に裁量を求めた',excerpt:''};
  const labelled=readFacts([fact({subject:'ハナレグミのライブ',quote:'ハナレグミのライブに行った'}),fact({subject:'星野源のライブ',quote:'ハナレグミのライブに行った'}),fact({subject:'仕事の裁量',quote:'上司に裁量を求めた'})],live);
  assert.deepEqual(labelled.map(f=>f.subject),['ハナレグミのライブ','仕事の裁量'],'a label made from the note’s words is kept; a name not in it is not');
});

test('notes are read together, facts land in the memory layer, and older notes are read in without moving categories',async()=>{
  const {dir,store}=fresh();
  try{
    const old=store.saveNote({text:'坂本慎太郎の新譜が良い'});
    const music=store.createCategory('Music',[old.id]);
    const fresh1=store.saveNote({text:'ハナレグミの発光帯好き',model:'m'});
    const fresh2=store.saveNote({text:'牛乳を買う',model:'m'});
    const calls=[];
    const ai={generate:async({items,purpose,schema})=>{
      calls.push({purpose,count:items.length});
      assert.ok(schema.properties.notes);
      return {notes:items.map(item=>({revisionId:item.revisionId,categoryIds:item.text.includes('ハナレグミ')||item.text.includes('坂本')?[music.id]:[],
        facts:item.text.includes('ハナレグミ')?[fact()]:item.text.includes('坂本')?[fact({subject:'坂本慎太郎',statement:'坂本慎太郎の新譜が良いと思っている',quote:'坂本慎太郎の新譜が良い'})]:[]}))};
    }};
    await new Classifier(store,ai).drain();
    assert.deepEqual(calls,[{purpose:'classify',count:2}]);
    assert.deepEqual(store.memoryFacts().map(row=>row.subject),['ハナレグミ']);
    // The older note is read once in the background; its human category stays, no AI category is added.
    store.unassignNote(old.id,music.id);
    assert.equal(store.queueMemoryBackfill('m'),1);
    assert.equal(store.queueMemoryBackfill('m'),0,'queued once');
    await new Classifier(store,ai).drain();
    assert.equal(calls[1].purpose,'memory-backfill');
    assert.deepEqual(store.memoryFacts().map(row=>row.subject).sort(),['ハナレグミ','坂本慎太郎']);
    assert.deepEqual(store.listNotes().find(note=>note.id===old.id).categoryIds,[],'facts-only reading leaves categories alone');
    assert.equal(store.queueMemoryBackfill('m'),0,'a note read once is not read again');
    store.setAiExcluded({id:fresh1.id,excluded:true});
    assert.deepEqual(store.memoryFacts().map(row=>row.subject),['坂本慎太郎'],'facts go with AI exclusion');
    assert.ok(fresh2);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a question reaches a note through what the memory layer says about it',async()=>{
  const {dir,store}=fresh();
  try{
    const target=store.saveNote({text:'推しは坂本慎太郎'});
    for(let i=0;i<40;i++)store.saveNote({text:`今日の買い物メモ ${i}`});
    const revisionId=store.listNotes().find(note=>note.id===target.id).revisionId;
    store.replaceMemoryFacts({noteId:target.id,revisionId,model:'m'},[fact({subject:'坂本慎太郎',statement:'好きなアーティストは坂本慎太郎',quote:'推しは坂本慎太郎'})]);
    const ranked=await retrieve(store,'好きなアーティストは？',{limit:5,embedder:async()=>{throw new Error('no embeddings in tests')}});
    const hit=ranked.find(note=>note.id===target.id);
    assert.ok(hit,'the note is among the candidates');
    assert.equal(hit.method,'memory-assisted');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('verification removes what the notes do not support, and an answer left with nothing becomes insufficient',async()=>{
  const notes=[{revisionId:'r1',text:'一番好きな映画はインターステラー',date:'2026-08-01'}];
  const result={status:'ready',text:'一番好きな映画はインターステラーです。宇宙ものの映画を毎週観ています。',pattern:'p',action:'a',evidenceRevisionIds:['r1'],categories:[],
    claims:[{text:'インターステラーが一番好き',kind:'record',evidenceRevisionIds:['r1']},{text:'毎週映画館に行く',kind:'record',evidenceRevisionIds:['r1']}]};
  let prompt;
  const ai={generate:async options=>{prompt=options.prompt;assert.equal(options.purpose,'verify-ask');assert.equal(options.effort,'low');
    return {verdicts:[{index:0,verdict:'supported'},{index:1,verdict:'unsupported'},{index:2,verdict:'supported'},{index:3,verdict:'unsupported'}]};}};
  const {result:checked,verification}=await verifyResult(ai,{model:'m',purpose:'ask',result,notes});
  assert.match(prompt,/2026-08-01/,'dates are given for time claims');
  assert.deepEqual(checked.claims.map(claim=>claim.text),['インターステラーが一番好き']);
  assert.equal(checked.text,'一番好きな映画はインターステラーです。');
  assert.deepEqual([verification.removedClaims,verification.removedSentences],[1,1]);
  const none={generate:async()=>({verdicts:[0,1,2,3].map(index=>({index,verdict:'unsupported'}))})};
  const empty=await verifyResult(none,{model:'m',purpose:'ask',result,notes});
  assert.equal(empty.result.status,'insufficient');
  const broken={generate:async()=>{throw new Error('offline')}};
  const kept=await verifyResult(broken,{model:'m',purpose:'ask',result,notes});
  assert.equal(kept.result,result,'a failed check leaves the answer as it was');
  assert.equal(kept.verification.error,'offline');
});

test('a new digest gets the last one’s claims whose notes are all still there, unless it was rated Bad',()=>{
  const {promptFor}=require('./analysis.cjs');
  const {dir,store}=fresh();
  try{
    const a=store.saveNote({text:'ピアノを練習した'}),b=store.saveNote({text:'ジャズを聴いた'});
    const category=store.createCategory('Music',[a.id,b.id]);
    const notes=store.analysisNotesFor(category.id),[ra,rb]=[a,b].map(note=>notes.find(n=>n.id===note.id).revisionId);
    const result={status:'ready',text:'音楽の記録が二つある。',pattern:'練習と鑑賞の両方。',action:'もう一つ記録する。',evidenceRevisionIds:[ra,rb],categories:[],
      claims:[{text:'ピアノを練習している',kind:'experience',speaker:'self',period:'',evidenceRevisionIds:[ra],counterRevisionIds:[]},
        {text:'ジャズを聴く',kind:'experience',speaker:'self',period:'',evidenceRevisionIds:[rb],counterRevisionIds:[]}]};
    const output=store.saveAnalysis({purpose:'collection',categoryId:category.id,model:'m',items:notes,result,fingerprint:store.insightFingerprint(category.id)});
    let previous=store.previousDigest(category.id,store.analysisNotesFor(category.id));
    assert.deepEqual(previous.claims.map(claim=>claim.text),['ピアノを練習している','ジャズを聴く']);
    assert.match(promptFor('collection',notes,[],null,[],previous),/previous: \[\{"text":"ピアノを練習している"/);
    store.saveNote({id:b.id,text:'ジャズはもう聴かない'});
    previous=store.previousDigest(category.id,store.analysisNotesFor(category.id));
    assert.deepEqual(previous.claims.map(claim=>claim.text),['ピアノを練習している'],'a claim on a changed note is not carried over');
    store.rate(output.id,'bad','wrong');
    assert.equal(store.previousDigest(category.id,store.analysisNotesFor(category.id)),null,'a digest rated Bad is not reused');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('embeddings are prepared in the background, so the first question does not wait for them',async()=>{
  const {EmbeddingWarmer,retrieve}=require('./retrieval.cjs');
  const {dir,store}=fresh();
  try{
    for(let i=0;i<5;i++)store.saveNote({text:`メモ ${i}`});
    let embedded=0;
    const embedder=async texts=>{embedded+=texts.length;return {model:'local',vectors:texts.map((_,i)=>[1,i])};};
    const warmer=new EmbeddingWarmer(store,{embedder});
    assert.equal(await warmer.run(),5);
    embedded=0;const progress=[];
    await retrieve(store,'メモ',{embedder,onProgress:event=>progress.push(event)});
    assert.equal(embedded,1,'only the question is embedded');
    assert.ok(!progress.some(event=>event.embedTotal),'no notes left to embed');
    assert.equal(await warmer.run(),0,'nothing new, nothing done');
    warmer.stop();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a few hundred older notes are read without asking; more wait for the person to choose all, the last year, or later',()=>{
  const {dir,store}=fresh();
  try{
    const DAY=86400000;
    const add=(count,daysAgo)=>{for(let i=0;i<count;i++){const note=store.saveNote({text:`メモ ${daysAgo}-${i}`});store.db.prepare('UPDATE notes SET created_at=? WHERE id=?').run(new Date(Date.now()-(daysAgo+i/1000)*DAY).toISOString(),note.id);}};
    add(200,10);
    assert.equal(store.queueMemoryBackfill('m'),200,'200 are read at once');
    store.db.exec('DELETE FROM classification_jobs');
    add(150,500);
    let plan=store.memoryBackfillPlan();
    assert.deepEqual([plan.unread,plan.recent,plan.needsDecision],[350,200,true]);
    assert.equal(store.queueMemoryBackfill('m'),0,'over 300, nothing is read before a choice');
    store.backfillDecision('later');
    assert.equal(store.queueMemoryBackfill('m'),0);
    assert.equal(store.memoryBackfillPlan().needsDecision,false);
    store.backfillDecision('recent');
    assert.equal(store.queueMemoryBackfill('m'),200,'only the last year');
    // A note written now is read before the older ones, and the older ones newest first.
    const fresh=store.saveNote({text:'今日のメモ',model:'m'});
    assert.equal(store.nextClassificationJob().noteId,fresh.id);
    store.markClassificationRunning(fresh.id,store.listNotes().find(note=>note.id===fresh.id).revisionId);
    const first=store.nextClassificationJob();
    assert.match(store.listNotes().find(note=>note.id===first.noteId).text,/^メモ 10-0$/);
    store.backfillDecision('all');
    assert.equal(store.queueMemoryBackfill('m'),150,'and then the rest');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
