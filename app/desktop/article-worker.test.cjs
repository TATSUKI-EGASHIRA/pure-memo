const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {ArticleWorker}=require('./article-worker.cjs');
const {publicArticleUrl,publicIPv4,parseArticleMetadata,requestArticle}=require('./article-fetch.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-article-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}

test('article preview accepts public URLs and extracts external metadata',async()=>{
  assert.equal(publicIPv4('8.8.8.8'),true);
  for(const address of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.1.1','100.64.1.1','192.0.2.1','198.51.100.1','203.0.113.1'])assert.equal(publicIPv4(address),false);
  assert.equal(publicArticleUrl('https://example.com/article').hostname,'example.com');
  for(const url of ['file:///etc/passwd','http://127.0.0.1/','http://localhost/','http://example.com:8080/','https://user:pass@example.com/'])assert.throws(()=>publicArticleUrl(url));
  assert.throws(()=>requestArticle('http://127.0.0.1/'));
  const preview=parseArticleMetadata('<title>Fallback</title><meta content="A &amp; B" name="description"><meta property="og:title" content="映画 &#12398;話"><meta content="Journal" property="og:site_name">','https://example.com/story');
  assert.deepEqual(preview,{title:'映画 の話',description:'A & B',siteName:'Journal'});
});

test('article preview follows current revisions and never changes original text',async()=>{
  const {dir,store}=fresh();
  try{
    const article=store.saveNote({text:'https://example.com/story'});
    const withComment=store.saveNote({text:'気になる記事 https://example.com/commented。'});
    assert.equal(withComment.sourceKind,'unspecified');
    assert.equal(withComment.sourceUrl,'https://example.com/commented');
    assert.equal(store.listNotes().find(note=>note.id===withComment.id).articleStatus,'pending');
    const worker=new ArticleWorker(store,async()=>({title:'An article',description:'A third-party summary.',siteName:'Example'}));
    worker.start();await worker.drain();
    const current=store.listNotes().find(note=>note.id===article.id);
    assert.equal(current.text,article.text);
    assert.equal(current.articleStatus,'ready');
    assert.equal(current.articleTitle,'An article');
    assert.equal(store.articleUrl(article.id),article.sourceUrl);
    const backupFile=path.join(dir,'article-backup.sqlite');
    await store.backupTo(backupFile);
    const copy=new Store(backupFile);
    try{assert.equal(copy.listNotes().find(note=>note.id===article.id).articleTitle,'An article');}finally{copy.close();}
    const edited=store.saveNote({id:article.id,text:'https://example.com/other'});
    assert.equal(store.listNotes().find(note=>note.id===article.id).articleStatus,'pending');
    assert.equal(store.finishArticlePreview(article.revisionId,{title:'Stale'}),false);
    store.markArticlePreviewRunning(edited.revisionId);
    store.failArticlePreview(edited.revisionId,new Error('Offline'));
    assert.equal(store.listNotes().find(note=>note.id===article.id).articleStatus,'failed');
    assert.equal(store.retryArticlePreview(article.id),true);
    assert.equal(store.listNotes().find(note=>note.id===article.id).articleStatus,'pending');
    store.trashNote(article.id);
    assert.equal(store.nextArticlePreviewJob(),undefined);
    store.purgeNote(article.id);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM article_previews WHERE revision_id IN (?,?)').get(article.revisionId,edited.revisionId).count,0);
    worker.stop();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
