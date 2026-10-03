const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {Classifier,readLink}=require('./classifier.cjs');
const {ArticleWorker}=require('./article-worker.cjs');
const {parseArticle}=require('./article-fetch.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-link-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}

const youtubePage=`<html><head><meta property="og:title" content="ハナレグミ - ｢発光帯｣ Music Video"><meta property="og:site_name" content="YouTube"></head><body>
<script>var ytInitialPlayerResponse={"videoDetails":{"videoId":"x","title":"ハナレグミ - ｢発光帯｣ Music Video","lengthSeconds":"308","author":"ハナレグミ","shortDescription":"8thアルバム『発光帯』収録 {\\"quoted\\"}"}};</script>
<script>var ytInitialData={"a":{"videoAttributeViewModel":{"title":"発光帯","subtitle":"hanaregumi","secondarySubtitle":{"content":"発光帯"}}}};</script>
<footer>概要 プレスルーム 著作権</footer></body></html>`;

test('a YouTube page gives its channel, description and listed songs instead of the site footer',()=>{
  const article=parseArticle(youtubePage,'https://www.youtube.com/watch?v=x');
  assert.equal(article.title,'ハナレグミ - ｢発光帯｣ Music Video');
  assert.equal(article.author,'ハナレグミ');
  assert.match(article.text,/^8thアルバム/);
  assert.doesNotMatch(article.text,/プレスルーム/);
  assert.deepEqual(article.media,{kind:'video',duration:308,tracks:[{title:'発光帯',artist:'hanaregumi',album:'発光帯'}]});
  assert.equal(parseArticle(youtubePage,'https://example.com/x').media,undefined);
});

test('names AI gives are kept only when the page or the note contains them',()=>{
  const job={text:'https://youtu.be/x 後で聞く',article:{title:'ハナレグミ - ｢発光帯｣ Music Video',author:'ハナレグミ',text:'',tracks:[{title:'発光帯',artist:'hanaregumi',album:'発光帯'}]}};
  assert.deepEqual(readLink({kind:'music',title:'「発光帯」',creator:'ハナレグミ',intent:'listen',summary:'曲です。'},job,'ja'),
    {kind:'music',title:'「発光帯」',creator:'ハナレグミ',intent:'listen',summary:'曲です。',locale:'ja'});
  const invented=readLink({kind:'music',title:'光の速さ',creator:'星野源',intent:'listen',summary:''},job,'ja');
  assert.equal(invented.title,'');assert.equal(invented.creator,'');
  assert.equal(readLink({kind:'song',title:'',creator:'',intent:'someday',summary:''},job,'ja'),null);
});

test('a saved link is read even without categories, and the reading follows AI exclusion',async()=>{
  const {dir,store}=fresh();
  try{
    store.uiLocale('en');
    const note=store.saveNote({text:'https://youtu.be/x 後で聞く',model:'test-model'});
    assert.equal(store.classificationStatus().pending,1);
    const worker=new ArticleWorker(store,async url=>parseArticle(youtubePage,url));
    worker.start();await new Promise(resolve=>setImmediate(resolve));await worker.idle();
    let seen;
    const ai={generate:async({prompt,schema})=>{
      seen={prompt,schema};
      const revisionId=JSON.parse(prompt.slice(prompt.indexOf('notes: ')+7))[0].revisionId;
      return {notes:[{revisionId,categoryIds:[],facts:[],link:{kind:'music',title:'発光帯',creator:'ハナレグミ',intent:'listen',summary:'A music video for the song.'}}]};
    }};
    await new Classifier(store,ai).drain();
    assert.ok(seen.schema.properties.notes.items.properties.link,'the link part is asked for');
    assert.match(seen.prompt,/"tracks":\[\{"title":"発光帯"/);
    assert.match(seen.prompt,/英語で1〜2文/);
    let listed=store.listNotes().find(item=>item.id===note.id);
    assert.deepEqual([listed.linkKind,listed.linkTitle,listed.linkCreator,listed.linkIntent,listed.linkSummary],['music','発光帯','ハナレグミ','listen','A music video for the song.']);
    store.setAiExcluded({id:note.id,excluded:true});
    listed=store.listNotes().find(item=>item.id===note.id);
    assert.equal(listed.linkKind,null);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM link_readings').get().n,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('every saved note is read once while auto processing is on, even without categories or a link',async()=>{
  const {dir,store}=fresh();
  try{
    store.saveNote({text:'今日は散歩した',model:'test-model'});
    assert.equal(store.classificationStatus().pending,1);
    store.autoClassifyEnabled(false);
    store.saveNote({text:'明日も歩く',model:'test-model'});
    assert.equal(store.classificationStatus().pending,1,'nothing new is queued while it is off');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('trashing or deleting the note being edited keeps the typed draft as a new note',()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'提案の文',originKind:'generated'});
    store.saveDraftSnapshot({text:'https://youtu.be/x 後で調べよう',originKind:'generated',editingId:note.id,updatedAt:1});
    store.trashNote(note.id);
    assert.equal(store.draftEditing(),'');
    assert.equal(store.draft(),'https://youtu.be/x 後で調べよう');
    const other=store.saveNote({text:'別のメモ'});
    store.saveDraftSnapshot({text:'書きかけ',originKind:'human',editingId:other.id,updatedAt:2});
    store.trashNote(other.id);store.purgeNote(other.id);
    assert.equal(store.draftEditing(),'');
    assert.ok(store.saveNote({text:store.draft()}).id,'the draft saves as a new note');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a note with a link is read in the same call as other notes; only it gets a link reading',async()=>{
  const {dir,store}=fresh();
  try{
    const link=store.saveNote({text:'https://youtu.be/x 後で聞く',model:'m'});
    const plain=store.saveNote({text:'今日は散歩した',model:'m'});
    const worker=new ArticleWorker(store,async url=>parseArticle(youtubePage,url));
    worker.start();await new Promise(resolve=>setImmediate(resolve));await worker.idle();
    const calls=[];
    const ai={generate:async({prompt,schema,purpose})=>{
      calls.push(purpose);
      assert.ok(schema.properties.notes.items.properties.link);
      return {notes:JSON.parse(prompt.slice(prompt.indexOf('notes: ')+7)).map(note=>({revisionId:note.revisionId,categoryIds:[],facts:[],
        link:note.article?{kind:'music',title:'発光帯',creator:'ハナレグミ',intent:'listen',summary:'曲'}:{kind:'other',title:'',creator:'',intent:'none',summary:''}}))};
    }};
    await new Classifier(store,ai).drain();
    assert.deepEqual(calls,['classify'],'one call for both');
    const notes=new Map(store.listNotes().map(note=>[note.id,note]));
    assert.equal(notes.get(link.id).linkTitle,'発光帯');
    assert.equal(notes.get(plain.id).linkKind,null);
    assert.equal(notes.get(plain.id).classificationState,'done');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
