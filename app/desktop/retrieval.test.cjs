const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {retrieve,blendCandidates}=require('./retrieval.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-retrieval-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}

test('Ask retrieves an older paraphrase and excludes generated or trashed notes',async()=>{
  const {dir,store}=fresh();
  try{
    const target=store.saveNote({text:'土を焼いて器を作る時間が楽しい。'});
    for(let index=0;index<45;index++)store.saveNote({text:`映画の感想 ${index}。`});
    const generated=store.saveNote({text:'陶芸が好き',originKind:'generated'});
    const trashed=store.saveNote({text:'陶芸を始めたい'});store.trashNote(trashed.id);
    let calls=0;
    const embedder=async texts=>{calls++;return {model:'test-vector-v1',vectors:texts.map(text=>text.includes('陶芸')||text.includes('器を作る')?[1,0]:[0,1])}};
    const selected=await retrieve(store,'陶芸について教えて',{embedder,limit:10});
    assert.equal(selected[0].id,target.id);
    assert.ok(!selected.some(note=>[generated.id,trashed.id].includes(note.id)));
    assert.equal(calls,2);
    await retrieve(store,'陶芸について教えて',{embedder,limit:10});
    assert.equal(calls,3,'cached note vectors should be reused');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('retrieval metadata follows the exact Ask input snapshot',async()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'以前は映画が好きだった。今はあまり観ない。'});
    const embedder=async texts=>({model:'test-vector-v1',vectors:texts.map(()=>[1,0])});
    const selected=await retrieve(store,'映画の好みは変わった？',{embedder});
    const result={status:'ready',text:'以前は好きでしたが、今はあまり観ていません。',pattern:'時期によって違います。',action:'',evidenceRevisionIds:[note.revisionId],categories:[]};
    const answer=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:selected,result,question:'映画の好みは変わった？',retrieval:selected});
    const item=store.db.prepare('SELECT revision_id AS revisionId,rank,method FROM retrieval_items WHERE run_id=?').get(answer.run_id);
    assert.deepEqual({...item},{revisionId:note.revisionId,rank:1,method:'local-semantic+text'});
    store.saveNote({id:note.id,text:'今は映画をよく観る。'});
    assert.equal(store.cachedEmbeddings('test-vector-v1').size,0);
    assert.equal(store.questions()[0].output.status,'stale');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Ask keeps working with local text matching when embedding assets are unavailable',async()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'映画館で映画を観た。'});
    store.saveNote({text:'雨の日に料理をした。'});
    const selected=await retrieve(store,'映画の感想は？',{embedder:async()=>{throw new Error('No local model')}});
    assert.equal(selected[0].id,note.id);
    assert.equal(selected[0].method,'local-text');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('optional digest search adds current supporting notes while Ask still receives originals',async()=>{
  const {dir,store}=fresh();
  try{
    const old=store.saveNote({text:'以前はジャズが苦手だった。'});
    const recent=store.saveNote({text:'最近は小さな店のライブで好きになった。'});
    const music=store.createCategory('Music',[old.id,recent.id]);
    for(let index=0;index<12;index++)store.saveNote({text:`ジャズのライブ記事 ${index} を保存した。`});
    const items=store.notesFor(music.id);
    store.saveAnalysis({purpose:'collection',categoryId:music.id,model:'test',items,result:{status:'ready',text:'ジャズの印象が変わった。',pattern:'最近は好意的。',action:'ライブの感想を書く。',evidenceRevisionIds:[old.revisionId,recent.revisionId],categories:[],claims:[{text:'最近はジャズのライブをきっかけに好きになった。',kind:'change',speaker:'self',period:'最近',evidenceRevisionIds:[recent.revisionId],counterRevisionIds:[]}]}});
    const question='ジャズの好みは変わった？';
    const embedder=async()=>{throw new Error('No local model')};
    const raw=await retrieve(store,question,{embedder,limit:3});
    const assisted=await retrieve(store,question,{embedder,limit:3,useDigest:true});
    assert.ok(!raw.some(note=>note.revisionId===recent.revisionId));
    assert.ok(assisted.some(note=>note.revisionId===recent.revisionId&&note.method==='digest-assisted'));
    assert.ok(assisted.every(note=>store.searchableNotes().some(source=>source.revisionId===note.revisionId)));
    store.saveNote({id:recent.id,text:'今はライブに行っていない。'});
    assert.equal(store.searchableDigestClaims().length,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('unrelated digest claims do not displace raw Ask candidates',()=>{
  const raw=Array.from({length:5},(_,index)=>({revisionId:`r${index}`,score:0.2-index*0.01,method:'local-text'}));
  const unrelated=[{score:0.01,sourceRevisionIds:['r4']}];
  assert.deepEqual(blendCandidates(raw,unrelated,3).map(note=>note.revisionId),['r0','r1','r2']);
});
