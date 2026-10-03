const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {mergeCapture,canAppend,parseCaptureUrl,describe}=require('./capture.cjs');
const {promptFor}=require('./analysis.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-capture-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}

test('selected text alone is a quote; with own words the words are a thought and the selection an excerpt',()=>{
  const {dir,store}=fresh();
  try{
    const quote=store.saveNote({excerpt:'Simple is better than complex.',sourceUrl:'https://example.com/zen',sourceTitle:'The Zen',sourceApp:'Safari'});
    const listed=id=>store.listNotes().find(note=>note.id===id);
    assert.equal(listed(quote.id).text,'Simple is better than complex.');
    assert.equal(listed(quote.id).sourceKind,'quote');
    assert.equal(listed(quote.id).excerpt,'');
    assert.equal(listed(quote.id).sourceUrl,'https://example.com/zen');
    assert.equal(listed(quote.id).sourceTitle,'The Zen');
    const thought=store.saveNote({text:'引き算の設計に効く',excerpt:'Simple is better than complex.',sourceUrl:'https://example.com/zen',sourceApp:'Safari'});
    assert.equal(listed(thought.id).sourceKind,'thought');
    assert.equal(listed(thought.id).excerpt,'Simple is better than complex.');
    // An ordinary edit keeps the captured excerpt and source.
    store.saveNote({id:thought.id,text:'引き算の設計に効く。あとで読む'});
    assert.equal(listed(thought.id).excerpt,'Simple is better than complex.');
    assert.equal(listed(thought.id).sourceUrl,'https://example.com/zen');
    assert.equal(store.recentCaptureFor('https://example.com/zen').id,thought.id);
    assert.equal(store.recentCaptureFor('https://example.com/other'),null);
    assert.throws(()=>store.saveNote({text:'',excerpt:''}));
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('captures from the same page within ten minutes are appended',()=>{
  const now=Date.parse('2026-10-01T10:10:00Z');
  const quoteOnly={id:'a',text:'first quote',excerpt:'',sourceKind:'quote',sourceUrl:'https://x.test/p',sourceTitle:'P',sourceApp:'Safari',date:'2026-10-01T10:05:00Z'};
  assert.equal(canAppend(quoteOnly,'https://x.test/p',now),true);
  assert.equal(canAppend(quoteOnly,'https://x.test/q',now),false);
  assert.equal(canAppend({...quoteOnly,date:'2026-10-01T09:50:00Z'},'https://x.test/p',now),false);
  assert.deepEqual(mergeCapture(quoteOnly,{text:'my take',excerpt:'second quote'}),{id:'a',text:'my take',excerpt:'first quote\n\nsecond quote',sourceUrl:'https://x.test/p',sourceTitle:'P',sourceApp:'Safari',sourceKind:'unspecified'});
  const withWords={...quoteOnly,text:'earlier words',excerpt:'first quote',sourceKind:'thought'};
  assert.equal(mergeCapture(withWords,{text:'',excerpt:'second quote'}).text,'earlier words');
  assert.equal(mergeCapture(withWords,{text:'',excerpt:'second quote'}).excerpt,'first quote\n\nsecond quote');
});

test('pure:// links only pre-fill the panel and accept web URLs only',()=>{
  assert.deepEqual(parseCaptureUrl('pure://new?text=hello&quote=%E5%BC%95%E7%94%A8&url=https%3A%2F%2Fexample.com&title=Ex'),{text:'hello',excerpt:'引用',sourceUrl:'https://example.com',sourceTitle:'Ex'});
  assert.equal(parseCaptureUrl('pure://new?url=javascript:alert(1)').sourceUrl,'');
  assert.equal(parseCaptureUrl('pure://delete?id=1'),null);
  assert.equal(parseCaptureUrl('https://example.com'),null);
});

test('secure input and excluded apps give no selection to the panel',()=>{
  assert.equal(describe({trusted:true,secureInput:true,excluded:false,app:{name:'Safari',bundleId:'com.apple.Safari'}}).blocked,'secure');
  assert.equal(describe({trusted:true,secureInput:false,excluded:true,app:{name:'1Password',bundleId:'com.1password.1password'}}).blocked,'excluded');
  const ok=describe({trusted:true,secureInput:false,excluded:false,app:{name:'Safari',bundleId:'com.apple.Safari'},selection:'text',selectionVia:'ax',url:'https://a.test',pageTitle:'A'});
  assert.deepEqual([ok.selection,ok.source.url,ok.source.title,ok.blocked],['text','https://a.test','A',null]);
});

test('the analysis prompt marks an excerpt as someone else\'s words',()=>{
  const prompt=promptFor('collection',[{revisionId:'r1',text:'my words',excerpt:'their words',date:'2026-10-01',sourceKind:'thought',sourceUrl:'https://a.test',sourceTitle:'A'}],[]);
  assert.match(prompt,/"excerpt":"their words"/);
  assert.match(prompt,/excerptは外部の文章で本人の意見ではありません/);
});

test('excluded apps are stored as a clean list',()=>{
  const {dir,store}=fresh();
  try{
    assert.deepEqual(store.captureExcluded(),[]);
    assert.deepEqual(store.captureExcluded([' Slack ','Slack','Messages','']),['Slack','Messages']);
    assert.throws(()=>store.captureExcluded('Slack'));
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
