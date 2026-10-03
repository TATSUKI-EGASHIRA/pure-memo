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

const zlib=require('node:zlib');
const {extractArticleText,decodeBody,parseArticle}=require('./article-fetch.cjs');
const {promptFor}=require('./analysis.cjs');

test('the readable text of a page is extracted without its navigation and asides',()=>{
  const html=`<html><head><script>var tracking=1</script><style>p{}</style></head><body>
    <nav><ul><li>ホーム メニュー リンク一覧</li></ul></nav><header><p>サイトの共通ヘッダーです。長めの説明文がここに入ります。</p></header>
    <article><h1>静かな音楽の話</h1><p><a href="/a">ハナレグミ</a>の<b>新譜</b>を聴いた。声の揺れが印象に残る。</p>
    <p>二曲目は<ruby>発光体<rt>はっこうたい</rt></ruby>という曲で、ライブでも定番になっている。<sup class="reference">[1]</sup></p>
    <aside><p>関連記事: ほかの記事へのリンクがここに並びます。</p></aside></article>
    <footer><p>Copyright example media all rights reserved.</p></footer></body></html>`;
  const text=extractArticleText(html);
  assert.equal(text,'静かな音楽の話\n\nハナレグミの新譜を聴いた。声の揺れが印象に残る。\n\n二曲目は発光体という曲で、ライブでも定番になっている。');
  const body='段落'.repeat(150);
  assert.equal(extractArticleText(`<script type="application/ld+json">{"@graph":[{"@type":"Article","articleBody":"${body}"}]}</script><p>短い</p>`),body);
  const parsed=parseArticle('<title>T</title><meta name="author" content="Ann"><meta property="article:published_time" content="2026-09-30"><article><p>This is a long enough paragraph of the article body text.</p></article>','https://example.com/a');
  assert.deepEqual([parsed.title,parsed.author,parsed.publishedAt],['T','Ann','2026-09-30']);
});

test('compressed pages are decoded with a size cap',()=>{
  const page=Buffer.from('<p>圧縮されたページの本文です。十分な長さがあります。</p>');
  assert.equal(decodeBody(zlib.gzipSync(page),'gzip').toString(),page.toString());
  assert.equal(decodeBody(zlib.brotliCompressSync(page),'br').toString(),page.toString());
  assert.equal(decodeBody(zlib.deflateSync(page),'deflate').toString(),page.toString());
  assert.throws(()=>decodeBody(zlib.gzipSync(Buffer.alloc(7*1024*1024)),'gzip'));
  assert.throws(()=>decodeBody(page,'compress'));
});

test('the linked page text is kept, reaches AI as external material and sorting waits for it briefly',async()=>{
  const {dir,store}=fresh();
  try{
    store.createCategory('music');
    const note=store.saveNote({text:'これ良さそう https://example.com/live',model:'test'});
    assert.equal(store.nextClassificationJob(),undefined);
    const worker=new ArticleWorker(store,async()=>({title:'ライブ評',description:'短い説明',siteName:'Example',text:'記事の本文。'.repeat(50),author:'',publishedAt:''}));
    worker.start();await worker.drain();worker.stop();
    const listed=store.listNotes().find(item=>item.id===note.id);
    assert.equal(listed.articleChars,300);
    assert.equal(listed.articleText,undefined);
    assert.equal(store.articleText(note.id).text.length,300);
    const job=store.nextClassificationJob();
    assert.equal(job.noteId,note.id);
    assert.equal(job.article.title,'ライブ評');
    const items=store.analysisNotesFor('all');
    assert.equal(items[0].article.text.length,300);
    const prompt=promptFor('ask',items,[],'どんなライブ？');
    assert.match(prompt,/"article":\{"title":"ライブ評"/);
    assert.match(prompt,/articleは、メモのURLからpureが取得したページの本文/);
    assert.ok(store.searchableNotes()[0].article);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('links saved before page text was kept are read again once',()=>{
  const {dir,store}=fresh();
  const file=path.join(dir,'pure.sqlite');
  try{
    const note=store.saveNote({text:'https://example.com/old'});
    store.markArticlePreviewRunning(note.revisionId);
    store.finishArticlePreview(note.revisionId,{title:'Old',description:'d',siteName:'s'});
    store.db.exec("DELETE FROM app_state WHERE key='article_body_v1'");
    store.close();
    const reopened=new Store(file);
    try{
      assert.equal(reopened.listNotes()[0].articleStatus,'pending');
      reopened.markArticlePreviewRunning(note.revisionId);reopened.finishArticlePreview(note.revisionId,{title:'Old',description:'d',siteName:'s',text:''});
    }finally{reopened.close();}
    const again=new Store(file);
    try{assert.equal(again.listNotes()[0].articleStatus,'ready');}finally{again.close();}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
