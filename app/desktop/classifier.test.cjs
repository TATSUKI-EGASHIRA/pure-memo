const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {Classifier}=require('./classifier.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-classify-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}

test('saving queues classification without blocking, and unmatched notes stay in Other',async()=>{
  const {dir,store}=fresh();
  try{
    const music=store.createCategory('Music');
    const film=store.createCategory('Films');
    const piano=store.saveNote({text:'ピアノを練習したい',model:'test-model'});
    const vague=store.saveNote({text:'今日は少し考えた',model:'test-model'});
    assert.equal(store.classificationStatus().pending,2);
    assert.equal(store.notesFor('other').length,2);
    const ai={generate:async({prompt,schema})=>{
      assert.equal(schema.properties.categoryIds.type,'array');
      return {categoryIds:prompt.includes('ピアノ')?[music.id]:[]};
    }};
    await new Classifier(store,ai).drain();
    assert.deepEqual(store.notesFor(music.id).map(n=>n.id),[piano.id]);
    assert.deepEqual(store.notesFor('other').map(n=>n.id),[vague.id]);
    assert.equal(store.notesFor(film.id).length,0);
    assert.equal(store.classificationStatus().done,2);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('classification respects manual exclusion, edits, generated drafts, and disabled setting',async()=>{
  const {dir,store}=fresh();
  try{
    const music=store.createCategory('Music');
    const note=store.saveNote({text:'ピアノ',model:'test-model'});
    store.assignNote(note.id,music.id);
    store.unassignNote(note.id,music.id);
    await new Classifier(store,{generate:async()=>({categoryIds:[music.id]})}).drain();
    assert.equal(store.notesFor('other').length,1);
    const edited=store.saveNote({id:note.id,text:'映画を見る',model:'test-model'});
    assert.notEqual(edited.revisionId,note.revisionId);
    await new Classifier(store,{generate:async()=>({categoryIds:[music.id]})}).drain();
    assert.equal(store.notesFor(music.id).length,1);
    store.autoClassifyEnabled(false);
    store.saveNote({text:'音楽のAI下書き',originKind:'generated',model:'test-model'});
    store.saveNote({text:'オフの間のメモ',model:'test-model'});
    assert.equal(store.classificationStatus().pending,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('old AI result cannot classify a newer revision; failed jobs are retried deliberately',async()=>{
  const {dir,store}=fresh();
  try{
    const music=store.createCategory('Music');
    const note=store.saveNote({text:'最初の版',model:'test-model'});
    const old=store.nextClassificationJob();
    assert.equal(store.markClassificationRunning(old.noteId,old.revisionId),true);
    store.saveNote({id:note.id,text:'新しい版',model:'test-model'});
    assert.equal(store.applyClassification(old,[music.id]),false);
    const classifier=new Classifier(store,{generate:async()=>{throw new Error('offline')}});
    await classifier.drain();
    assert.equal(store.classificationStatus().failed,1);
    store.close();
    const reopened=new Store(path.join(dir,'pure.sqlite'));
    assert.equal(reopened.classificationStatus().failed,1);
    reopened.retryClassifications();
    await new Classifier(reopened,{generate:async()=>({categoryIds:[music.id]})}).drain();
    assert.equal(reopened.notesFor(music.id)[0].revisionId,reopened.listNotes()[0].revisionId);
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a running classification resumes after reopening the database',async()=>{
  const {dir,store}=fresh();
  try{
    const category=store.createCategory('Music');
    store.saveNote({text:'練習したピアノ曲',model:'test-model'});
    const job=store.nextClassificationJob();
    assert.equal(store.markClassificationRunning(job.noteId,job.revisionId),true);
    store.close();
    const reopened=new Store(path.join(dir,'pure.sqlite'));
    assert.equal(reopened.classificationStatus().pending,1);
    await new Classifier(reopened,{generate:async()=>({categoryIds:[category.id]})}).drain();
    assert.equal(reopened.notesFor(category.id).length,1);
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
