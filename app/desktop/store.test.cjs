const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('./store.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}
test('older databases gain source fields without assigning an assumed speaker',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-old-')),file=path.join(dir,'pure.sqlite');
  const old=new DatabaseSync(file);
  old.exec("CREATE TABLE note_revisions(id TEXT PRIMARY KEY,note_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL); INSERT INTO note_revisions VALUES('r1','n1','ジャズがよい','2026-09-01');");
  old.close();
  const store=new Store(file);
  try{const row=store.db.prepare('SELECT source_kind AS kind,source_url AS url FROM note_revisions WHERE id=?').get('r1');assert.equal(row.kind,'unspecified');assert.equal(row.url,'');}
  finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('source context follows revisions, recognizes bare links, and survives backup',async()=>{
  const {dir,store}=fresh();
  try{
    const link=store.saveNote({text:'https://example.com/story'});
    assert.equal(link.sourceKind,'reference');
    assert.equal(link.sourceUrl,'https://example.com/story');
    const changed=store.saveNote({id:link.id,text:'感想: 面白かった',sourceKind:'thought'});
    assert.equal(changed.sourceKind,'thought');
    assert.equal(store.db.prepare('SELECT source_kind AS kind FROM note_revisions WHERE id=?').get(link.revisionId).kind,'reference');
    assert.equal(store.searchableNotes()[0].sourceKind,'thought');
    store.draftSource('quote');
    const backupPath=path.join(dir,'source.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.listNotes()[0].sourceKind,'thought');
    assert.equal(copy.draftSource(),'quote');
    copy.close();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('draft snapshots keep an interrupted edit and ignore late older writes',async()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'元の本文'});
    assert.equal(store.saveDraftSnapshot({text:'編集の続き',originKind:'human',sourceKind:'thought',editingId:note.id,updatedAt:101}),true);
    assert.equal(store.saveDraftSnapshot({text:'古い文字',originKind:'human',sourceKind:'unspecified',editingId:'',updatedAt:100}),false);
    assert.equal(store.draft(),'編集の続き');
    assert.equal(store.draftEditing(),note.id);
    const backupPath=path.join(dir,'unfinished.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.draftEditing(),note.id);
    assert.equal(copy.draftSource(),'thought');
    copy.close();
    store.saveNote({id:note.id,text:'編集後の本文',draftClearedAt:100});
    assert.equal(store.saveDraftSnapshot({text:'編集の続き',originKind:'human',sourceKind:'thought',editingId:note.id,updatedAt:102}),false);
    assert.equal(store.draft(),'');
    assert.equal(store.draftEditing(),'');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('source revisions, feedback and category names remain separate',()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'夜の散歩に音楽を聴く。'});
    const second=store.saveNote({text:'作業中はピアノの音楽がよい。'});
    const items=store.notesFor('all');
    const categoryId=store.createCategory('Music',[first.id,second.id]).id;
    const result={text:'音楽を場面で選ぶ。',pattern:'散歩と作業で異なる。',action:'2曲を聴き比べる。',evidenceRevisionIds:items.map(i=>i.revisionId),categories:[{name:'Made up by AI',revisionIds:items.map(i=>i.revisionId)}]};
    const output=store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items,result});
    assert.equal(store.categories().length,3);
    assert.equal(store.notesFor(categoryId).length,2);
    store.renameCategory(categoryId,'静かな音楽');
    assert.equal(store.categories().find(c=>c.name==='静かな音楽').id,categoryId);
    assert.equal(store.notesFor(categoryId).length,2);
    assert.equal(output.evidence.length,2);
    assert.equal(store.rate(output.id,'bad','incorrect','雨の日のメモには歌詞の有無は書いていない').rating.comment,'雨の日のメモには歌詞の有無は書いていない');
    assert.equal(store.feedbackFor('all')[0].comment,'雨の日のメモには歌詞の有無は書いていない');
    assert.equal(store.rate(output.id,'good','').rating.rating,'good');
    assert.equal(store.rate(output.id,'clear','').rating.rating,'clear');
    assert.equal(store.feedbackFor('all').length,0);
    const changed=store.saveNote({id:first.id,text:'散歩では無音の方が好き。'});
    assert.notEqual(changed.revisionId,first.revisionId);
    assert.equal(store.latestOutput('summary','all'),undefined);
    assert.equal(store.notesFor(categoryId).length,2);
    assert.throws(()=>store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items,result,question:'好みは？'}),/changed during analysis/);
    store.trashNote(second.id);
    assert.equal(store.listNotes().length,1);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('editing or trashing an uncited AI input marks the answer stale',()=>{
  const {dir,store}=fresh();
  try{
    const cited=store.saveNote({text:'作業中はピアノを聴く。'});
    const uncited=store.saveNote({text:'休日は歌詞のある曲も聴く。'});
    const items=store.notesFor('all');
    const result={status:'ready',text:'作業中はピアノを聴きます。',pattern:'',action:'',evidenceRevisionIds:[cited.revisionId],categories:[]};
    const first=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items,result,question:'作業中は？'});
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM analysis_inputs WHERE run_id=?').get(first.run_id).count,2);
    assert.equal(first.evidence.length,1);
    store.saveNote({id:uncited.id,text:'休日は音楽を聴かない。'});
    assert.equal(store.questions()[0].output.status,'stale');
    const next=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items:store.notesFor('all'),result,question:'作業中は？'});
    store.trashNote(uncited.id);
    assert.equal(store.questions()[0].output.id,next.id);
    assert.equal(store.questions()[0].output.status,'stale');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a new note makes an older insight and next step need refresh',()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'作業中はピアノを聴く。'});
    const second=store.saveNote({text:'雨の日もピアノを聴く。'});
    const music=store.createCategory('Music',[first.id,second.id]);
    const items=store.notesFor(music.id);
    const result={status:'ready',text:'ピアノの記録がある。',pattern:'場面によって聴く。',action:'曲名を一つ書く。',evidenceRevisionIds:items.map(note=>note.revisionId),categories:[]};
    store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items:store.notesFor('all'),result});
    store.saveAnalysis({purpose:'collection',categoryId:music.id,model:'test',items,result});
    assert.equal(store.insightState(music.id).status,'current');
    assert.equal(store.insightState('all').status,'current');
    assert.equal(store.nextSteps().length,2);
    const added=store.saveNote({text:'散歩ではジャズを聴いた。'});
    assert.equal(store.insightState('all').status,'needs-refresh');
    assert.equal(store.latestOutput('summary','all'),undefined);
    assert.equal(store.nextSteps().length,1);
    store.assignNote(added.id,music.id);
    assert.equal(store.insightState(music.id).status,'needs-refresh');
    assert.equal(store.latestOutput('summary',music.id),undefined);
    assert.equal(store.nextSteps().length,0);
    const updated=store.notesFor(music.id);
    store.saveAnalysis({purpose:'collection',categoryId:music.id,model:'test',items:updated,result:{...result,evidenceRevisionIds:updated.map(note=>note.revisionId)}});
    assert.equal(store.insightState(music.id).status,'current');
    assert.equal(store.nextSteps().length,1);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('digest claims keep supporting and counter source revisions separate',()=>{
  const {dir,store}=fresh();
  try{
    const old=store.saveNote({text:'以前はジャズが苦手だった。'});
    const current=store.saveNote({text:'最近はジャズが好きになった。'});
    const music=store.createCategory('Music',[old.id,current.id]);
    const items=store.notesFor(music.id);
    const result={status:'ready',text:'ジャズへの印象が変わった。',pattern:'時期で異なる。',action:'今の好みを書き留める。',evidenceRevisionIds:[old.revisionId,current.revisionId],categories:[],claims:[{text:'最近はジャズを好む。',kind:'preference',speaker:'self',period:'最近',evidenceRevisionIds:[current.revisionId],counterRevisionIds:[old.revisionId]}]};
    const output=store.saveAnalysis({purpose:'collection',categoryId:music.id,model:'test',items,result});
    assert.deepEqual(output.claims[0].sources.map(source=>[source.revisionId,source.relation]),[[old.revisionId,'counter'],[current.revisionId,'support']]);
    assert.throws(()=>store.saveAnalysis({purpose:'collection',categoryId:music.id,model:'test',items,result:{...result,claims:[{...result.claims[0],evidenceRevisionIds:['invented']} ]}}),/invalid digest claim evidence/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Ask answer claims retain their own source links',()=>{
  const {dir,store}=fresh();
  try{
    const article=store.saveNote({text:'記事の筆者は「ジャズは退屈」と書いた。私はそう思わない。'});
    const recent=store.saveNote({text:'最近はジャズのライブが楽しかった。'});
    const items=store.notesFor('all');
    const result={status:'ready',text:'記事の筆者は退屈と述べましたが、本人はライブを楽しみました。',pattern:'',action:'',evidenceRevisionIds:[article.revisionId,recent.revisionId],categories:[],claims:[
      {text:'退屈と述べたのは記事の筆者。',kind:'record',speaker:'external',period:'',evidenceRevisionIds:[article.revisionId]},
      {text:'本人は最近ライブを楽しんだ。',kind:'record',speaker:'self',period:'最近',evidenceRevisionIds:[recent.revisionId]}
    ]};
    const output=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items,result,question:'ジャズはどう思う？'});
    assert.deepEqual(output.claims.map(claim=>claim.sources.map(source=>source.revisionId)),[[article.revisionId],[recent.revisionId]]);
    assert.equal(store.questions()[0].output.claims.length,2);
    assert.throws(()=>store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items,result:{...result,claims:[{...result.claims[0],evidenceRevisionIds:['fake']} ]},question:'ジャズは？'}),/unsupported answer claim/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('legacy import is idempotent and demonstration text never becomes evidence',()=>{
  const {dir,store}=fresh();
  try{
    const rows=[{id:'rain',text:'デモ',date:'2026-09-27'},{id:'user-1',text:'自分のメモ',date:'2026-09-28'},{id:'generated-1',text:'AI下書き',origin:{type:'outline'},date:'2026-09-28'}];
    assert.equal(store.importLegacy(rows),3);
    assert.equal(store.importLegacy(rows),0);
    assert.equal(store.listNotes().length,3);
    assert.deepEqual(store.notesFor('all').map(n=>n.text),['自分のメモ']);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('suggestion drafts stay outside source evidence after save and backup',async()=>{
  const {dir,store}=fresh();
  try{
    store.draft('AIが提案した次の一歩');
    store.draftOrigin('generated');
    const suggestion=store.saveNote({text:store.draft(),originKind:store.draftOrigin()});
    assert.equal(suggestion.originKind,'generated');
    assert.equal(store.notesFor('all').length,0);
    const edited=store.saveNote({id:suggestion.id,text:'AI案を少し直した'});
    assert.equal(edited.originKind,'generated');
    assert.equal(store.notesFor('all').length,0);
    const backupPath=path.join(dir,'draft.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.draftOrigin(),'generated');
    assert.equal(copy.notesFor('all').length,0);
    copy.close();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('AI classifies only into user categories; unmatched notes remain in Other',()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'雨の日にピアノを聴く'});
    const second=store.saveNote({text:'作業中に静かなピアノを聴く'});
    const third=store.saveNote({text:'映画を観たい'});
    const music=store.createCategory('Music');
    const items=store.notesFor('all');
    const base={status:'ready',text:'ピアノの記録が二つある。',pattern:'場面が違う。',action:'聴いた曲を残す。',evidenceRevisionIds:items.map(n=>n.revisionId)};
    store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items,result:{...base,categories:[{name:'Music',revisionIds:[first.revisionId,second.revisionId]},{name:'AI invented category',revisionIds:[third.revisionId]}]}});
    assert.deepEqual(store.categories().map(c=>c.name),['All notes','Other','Music']);
    assert.equal(store.notesFor(music.id).length,2);
    assert.deepEqual(store.notesFor('other').map(n=>n.id),[third.id]);
    const musicItems=store.notesFor(music.id);
    store.saveAnalysis({purpose:'collection',categoryId:music.id,model:'test',items:musicItems,result:{...base,evidenceRevisionIds:musicItems.map(n=>n.revisionId),categories:[]}});
    assert.ok(store.latestOutput('summary',music.id));
    store.assignNote(third.id,music.id);
    assert.equal(store.notesFor('other').length,0);
    assert.equal(store.latestOutput('summary',music.id),undefined);
    assert.equal(store.nextSteps().length,1);
    store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items,result:{...base,categories:[]}});
    assert.deepEqual(store.notesFor(music.id).map(n=>n.id),[third.id]);
    assert.equal(store.notesFor('other').length,2);
    const answer=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items,question:'仕事での悩みは？',result:{status:'insufficient',text:'記録からは分かりません。',pattern:'仕事の悩みを示す記録がありません。',action:'',evidenceRevisionIds:[],categories:[]}});
    assert.equal(answer.analysis_status,'insufficient');
    assert.equal(answer.evidence.length,0);
    assert.equal(store.questions()[0].output.limitation,'仕事の悩みを示す記録がありません。');
    store.rate(answer.id,'bad','too-vague','仕事の話ではない');
    assert.equal(store.feedbackForAsk('仕事での悩みは？').length,1);
    assert.equal(store.feedbackForAsk('映画の感想は？').length,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('older AI created categories become unconfirmed without deleting history',()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'ピアノを聴く'});
    store.db.prepare("INSERT INTO categories(id,name,created_at) VALUES('legacy-ai','AI Music',?)").run(new Date().toISOString());
    store.db.prepare("INSERT INTO category_revisions(id,category_id,name,origin,created_at) VALUES('rev-ai','legacy-ai','AI Music','ai',?)").run(new Date().toISOString());
    store.db.prepare("INSERT INTO assignments(note_id,category_id,revision_id,origin) VALUES(?,?,?,'ai')").run(note.id,'legacy-ai',note.revisionId);
    store.db.prepare("INSERT INTO categories(id,name,created_at) VALUES('legacy-no-history','AI Film',?)").run(new Date().toISOString());
    store.db.exec('PRAGMA user_version = 1');
    store.close();
    const reopened=new Store(path.join(dir,'pure.sqlite'));
    assert.deepEqual(reopened.categories().map(c=>c.name),['All notes','Other']);
    assert.equal(reopened.notesFor('other')[0].id,note.id);
    assert.equal(reopened.db.prepare("SELECT state FROM categories WHERE id='legacy-ai'").get().state,'unconfirmed');
    assert.equal(reopened.db.prepare("SELECT state FROM categories WHERE id='legacy-no-history'").get().state,'unconfirmed');
    reopened.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('category management keeps manual exclusions and supports archive restore',()=>{
  const {dir,store}=fresh();
  try{
    const first=store.saveNote({text:'ピアノを聴く'});
    const second=store.saveNote({text:'雨の日もピアノ'});
    const category=store.createCategory('Music',[first.id]);
    assert.equal(store.categoryOverview().find(c=>c.id===category.id).count,1);
    store.unassignNote(first.id,category.id);
    assert.equal(store.notesFor('other').length,2);
    const items=store.notesFor('all');
    store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items,result:{status:'ready',text:'ピアノの記録',pattern:'二つの場面',action:'曲を記録する',evidenceRevisionIds:items.map(n=>n.revisionId),categories:[{name:'Music',revisionIds:items.map(n=>n.revisionId)}]}});
    assert.deepEqual(store.notesFor(category.id).map(n=>n.id),[second.id]);
    store.archiveCategory(category.id);
    assert.equal(store.archivedCategories()[0].id,category.id);
    assert.equal(store.notesFor('other').length,2);
    store.restoreCategory(category.id);
    assert.deepEqual(store.notesFor(category.id).map(n=>n.id),[second.id]);
    store.assignNote(first.id,category.id);
    assert.equal(store.notesFor(category.id).length,2);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('category merge preserves exclusions and history while invalidating old insights',async()=>{
  const {dir,store}=fresh();
  try{
    const one=store.saveNote({text:'ピアノを聴く'});
    const both=store.saveNote({text:'映画の音楽を聴く'});
    const excluded=store.saveNote({text:'歌詞のある曲'});
    const targetOnly=store.saveNote({text:'映画を観た'});
    const source=store.createCategory('Sounds',[one.id,both.id,excluded.id]);
    const target=store.createCategory('Music',[both.id,excluded.id,targetOnly.id]);
    store.db.prepare("UPDATE assignments SET origin='ai' WHERE note_id=? AND category_id=?").run(both.id,target.id);
    store.unassignNote(excluded.id,target.id);
    const items=store.notesFor(target.id);
    store.saveAnalysis({purpose:'collection',categoryId:target.id,model:'test',items,result:{status:'ready',text:'音楽について',pattern:'作品と音楽',action:'曲名を残す',evidenceRevisionIds:items.map(n=>n.revisionId),categories:[]}});
    assert.equal(store.nextSteps().length,1);
    assert.throws(()=>store.mergeCategory(source.id,source.id),/different/);
    const merged=store.mergeCategory(source.id,target.id);
    assert.equal(merged.movedCount,1);
    assert.equal(merged.skippedCount,1);
    assert.equal(store.categories().some(c=>c.id===source.id),false);
    assert.deepEqual(new Set(store.notesFor(target.id).map(n=>n.id)),new Set([one.id,both.id,targetOnly.id]));
    assert.equal(store.db.prepare('SELECT origin FROM assignments WHERE note_id=? AND category_id=?').get(both.id,target.id).origin,'human');
    assert.equal(store.notesFor('other').some(n=>n.id===excluded.id),true);
    assert.equal(store.insightState(target.id).status,'needs-refresh');
    assert.equal(store.nextSteps().length,0);
    assert.equal(store.categoryMerges()[0].sourceId,source.id);
    assert.throws(()=>store.restoreCategory(source.id),/Archived category not found/);
    store.renameCategory(target.id,'Soundtracks');
    assert.equal(store.categoryMerges()[0].targetName,'Soundtracks');
    const backupPath=path.join(dir,'merged.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.categoryMerges().length,1);
    assert.equal(copy.notesFor(target.id).length,3);
    copy.close();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a category merge discards classification based on the old category list',()=>{
  const {dir,store}=fresh();
  try{
    const source=store.createCategory('Old');
    const target=store.createCategory('New');
    const note=store.saveNote({text:'分類待ち',model:'test'});
    const oldJob=store.nextClassificationJob();
    assert.equal(store.markClassificationRunning(oldJob.noteId,oldJob.revisionId),true);
    store.mergeCategory(source.id,target.id);
    assert.equal(store.classificationStatus().pending,1);
    assert.equal(store.applyClassification(oldJob,[source.id]),false);
    const next=store.nextClassificationJob();
    assert.equal(store.markClassificationRunning(next.noteId,next.revisionId),true);
    assert.equal(store.applyClassification(next,[target.id]),true);
    assert.deepEqual(store.notesFor(target.id).map(item=>item.id),[note.id]);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('splitting a category moves selected notes, keeps exclusions and invalidates old insights',async()=>{
  const {dir,store}=fresh();
  try{
    const one=store.saveNote({text:'ピアノの感想'});
    const two=store.saveNote({text:'映画の音楽がよかった'});
    const three=store.saveNote({text:'別のピアノの感想'});
    const source=store.createCategory('Culture',[one.id,two.id,three.id]);
    const other=store.createCategory('Films',[two.id]);
    const pending=store.saveNote({text:'新しい分類待ち',model:'test'});
    const oldJob=store.nextClassificationJob();
    assert.equal(store.markClassificationRunning(oldJob.noteId,oldJob.revisionId),true);
    const items=store.notesFor(source.id);
    store.saveAnalysis({purpose:'collection',categoryId:source.id,model:'test',items,result:{status:'ready',text:'文化の記録',pattern:'音楽と映画',action:'感想を書く',evidenceRevisionIds:items.map(item=>item.revisionId),categories:[]}});
    assert.throws(()=>store.splitCategory(source.id,'Music',[one.id,two.id,three.id]),/Leave at least one/);
    assert.throws(()=>store.splitCategory(source.id,'Music',[one.id,'missing']),/no longer/);
    assert.equal(store.categories().some(item=>item.name==='Music'),false);
    const split=store.splitCategory(source.id,'Music',[one.id,three.id]);
    assert.equal(split.movedCount,2);
    assert.equal(store.applyClassification(oldJob,[source.id]),false);
    const newJob=store.nextClassificationJob();
    assert.equal(newJob.noteId,pending.id);
    assert.equal(store.markClassificationRunning(newJob.noteId,newJob.revisionId),true);
    assert.equal(store.applyClassification(newJob,[split.targetId]),true);
    assert.deepEqual(store.notesFor(source.id).map(item=>item.id),[two.id]);
    assert.deepEqual(new Set(store.notesFor(split.targetId).map(item=>item.id)),new Set([one.id,three.id,pending.id]));
    assert.deepEqual(store.notesFor(other.id).map(item=>item.id),[two.id]);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM assignment_exclusions WHERE category_id=?').get(source.id).count,2);
    assert.equal(store.insightState(source.id).status,'needs-refresh');
    assert.equal(store.nextSteps().length,0);
    assert.equal(store.categorySplits()[0].targetName,'Music');
    const backupPath=path.join(dir,'split.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.categorySplits().length,1);
    assert.equal(copy.notesFor(split.targetId).length,3);
    copy.close();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Graph uses current category membership and excludes generated, trashed and archived links',()=>{
  const {dir,store}=fresh();
  try{
    const bridge=store.saveNote({text:'映画音楽についての感想'});
    const other=store.saveNote({text:'分類前のメモ'});
    const hidden=store.saveNote({text:'消すメモ'});
    const generated=store.saveNote({text:'生成した下書き',originKind:'generated'});
    const music=store.createCategory('Music',[bridge.id]);
    const films=store.createCategory('Films',[bridge.id]);
    const archived=store.createCategory('Unused',[other.id]);
    store.archiveCategory(archived.id);
    store.trashNote(hidden.id);
    const data=store.graphData();
    assert.equal(data.total,2);
    assert.equal(data.shown,2);
    assert.deepEqual(new Set(data.categories.map(item=>item.id)),new Set([music.id,films.id,'other']));
    assert.deepEqual(new Set(data.notes.find(item=>item.id===bridge.id).categories.map(item=>item.id)),new Set([music.id,films.id]));
    assert.deepEqual(data.notes.find(item=>item.id===other.id).categories,[]);
    assert.ok(!data.notes.some(item=>[hidden.id,generated.id].includes(item.id)));
    store.unassignNote(bridge.id,music.id);
    assert.deepEqual(store.graphData().notes.find(item=>item.id===bridge.id).categories.map(item=>item.id),[films.id]);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Collection can explain insufficient evidence without creating an Ask question',()=>{
  const {dir,store}=fresh();
  try{
    store.saveNote({text:'映画を観たい'});
    store.saveNote({text:'最近は料理も気になる'});
    const items=store.notesFor('all');
    const output=store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items,result:{status:'insufficient',text:'二つの記録だけでは共通する傾向を判断できません。',pattern:'',action:'',evidenceRevisionIds:[],categories:[]}});
    assert.equal(output.analysis_status,'insufficient');
    assert.equal(store.latestOutput('summary','all').id,output.id);
    assert.equal(store.latestOutput('action','all'),undefined);
    assert.equal(store.questions().length,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('SQLite backup preserves notes and feedback',async()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'読んだ本の感想'});
    store.draft('まだ保存していない言葉');
    const backupPath=path.join(dir,'backup.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.listNotes()[0].id,note.id);
    assert.equal(copy.draft(),'まだ保存していない言葉');
    copy.close();
    store.saveNote({text:'バックアップ後のメモ'});
    const rollback=path.join(dir,'rollback.sqlite');
    await store.restoreFrom(backupPath,rollback);
    assert.equal(store.listNotes().length,1);
    const prior=new Store(rollback);
    assert.equal(prior.listNotes().length,2);
    prior.close();
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('restore snapshots a source with uncheckpointed WAL data',async()=>{
  const {dir,store}=fresh();
  const source=new Store(path.join(dir,'source.sqlite'));
  try{
    const expected=source.saveNote({text:'WALにある最新のメモ',sourceKind:'thought'});
    assert.equal(fs.existsSync(source.file+'-wal'),true);
    const rollback=path.join(dir,'before-restore.sqlite');
    await store.restoreFrom(source.file,rollback);
    assert.equal(store.listNotes()[0].id,expected.id);
    assert.equal(store.listNotes()[0].sourceKind,'thought');
    assert.equal(fs.existsSync(rollback),true);
  }finally{source.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('restore rejects a broken current revision and leaves the live database open',async()=>{
  const {dir,store}=fresh();
  const live=store.saveNote({text:'残すメモ'});
  const broken=new Store(path.join(dir,'broken.sqlite'));
  broken.saveNote({text:'壊れたメモ'});
  broken.db.exec("UPDATE notes SET current_revision_id='missing'");
  broken.close();
  try{
    const rollback=path.join(dir,'before-restore.sqlite');
    await assert.rejects(store.restoreFrom(path.join(dir,'broken.sqlite'),rollback),/current version/);
    assert.deepEqual(store.listNotes().map(note=>note.id),[live.id]);
    assert.equal(fs.existsSync(rollback),false);
    assert.equal(store.saveNote({text:'復元失敗後も保存できる'}).text,'復元失敗後も保存できる');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a backup cannot resurrect a permanently deleted note on the same Mac',async()=>{
  const {dir,store}=fresh();
  try{
    const removed=store.saveNote({text:'消した記録',sourceKind:'thought'});
    const kept=store.saveNote({text:'残す記録',sourceKind:'thought'});
    const oldBackup=path.join(dir,'before-delete.sqlite');
    await store.backupTo(oldBackup);
    store.trashNote(removed.id);
    store.purgeNote(removed.id);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM purged_notes WHERE id=?').get(removed.id).count,1);
    await assert.rejects(store.restoreFrom(oldBackup,path.join(dir,'rollback.sqlite')),/permanently deleted note/);
    assert.deepEqual(store.listNotes().map(note=>note.id),[kept.id]);
    const safeBackup=path.join(dir,'after-delete.sqlite');
    await store.backupTo(safeBackup);
    store.saveNote({text:'一時的な記録'});
    await store.restoreFrom(safeBackup,path.join(dir,'safe-rollback.sqlite'));
    assert.deepEqual(store.listNotes().map(note=>note.id),[kept.id]);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM purged_notes WHERE id=?').get(removed.id).count,1);
    await assert.rejects(store.restoreFrom(oldBackup,path.join(dir,'second-rollback.sqlite')),/permanently deleted note/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('restore carries deletion history forward and legacy import cannot reuse a purged ID',async()=>{
  const {dir,store}=fresh();
  try{
    const kept=store.saveNote({text:'残すメモ'});
    const backupPath=path.join(dir,'before-new-note.sqlite');
    await store.backupTo(backupPath);
    const removed=store.saveNote({text:'あとから消したメモ'});
    store.trashNote(removed.id);
    store.purgeNote(removed.id);
    await store.restoreFrom(backupPath,path.join(dir,'rollback.sqlite'));
    assert.deepEqual(store.listNotes().map(note=>note.id),[kept.id]);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM purged_notes WHERE id=?').get(removed.id).count,1);
    assert.equal(store.importLegacy([{id:removed.id,text:'古い書き出しから戻るメモ'}]),0);
    assert.deepEqual(store.listNotes().map(note=>note.id),[kept.id]);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('trash lists notes, restore keeps identity and does not revive stale analysis',()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'復元するメモ'});
    const category=store.createCategory('Music',[note.id]);
    const items=store.notesFor('all');
    const result={status:'ready',text:'復元するメモについての要約',pattern:'音楽の傾向',action:'もう一曲聴く',evidenceRevisionIds:[note.revisionId]};
    store.saveAnalysis({purpose:'collection',categoryId:'all',model:'test',items,result});
    store.trashNote(note.id);
    assert.equal(store.listNotes().length,0);
    assert.equal(store.searchableNotes().length,0);
    assert.equal(store.listTrash()[0].id,note.id);
    assert.throws(()=>store.trashNote(note.id),/Active note not found/);
    const restored=store.restoreNote(note.id);
    assert.equal(restored.revisionId,note.revisionId);
    assert.equal(store.listTrash().length,0);
    assert.equal(store.listNotes().length,1);
    assert.equal(store.notesFor(category.id).length,1);
    assert.equal(store.latestOutput('summary','all'),undefined);
    assert.throws(()=>store.restoreNote(note.id),/Trashed note not found/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('permanent deletion removes note revisions and all AI copies from live database',()=>{
  const {dir,store}=fresh();
  const canary='PURE_PURGE_CANARY_84f18d387422';
  try{
    const note=store.saveNote({text:canary});
    const keep=store.saveNote({text:'Keep this unrelated note'});
    const category=store.createCategory('Music',[note.id]);
    store.saveNote({id:note.id,text:canary+' edited'});
    const items=store.notesFor('all');
    const evidenceId=items.find(n=>n.id===note.id).revisionId;
    const output=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'test',items,question:'What about '+canary+'?',result:{status:'ready',text:'Answer: '+canary,pattern:'Limitation: '+canary,evidenceRevisionIds:[evidenceId]},retrieval:[{revisionId:evidenceId,score:1,method:'test'}]});
    store.rate(output.id,'bad','incorrect',canary);
    assert.throws(()=>store.purgeNote(keep.id),/Move the note to trash/);
    store.trashNote(note.id);
    assert.equal(store.purgeNote(note.id).analysisCount,1);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM note_revisions WHERE note_id=?').get(note.id).count,0);
    for(const table of ['assignments','assignment_exclusions','runs','outputs','evidence','feedback','ask_questions','retrieval_items'])assert.equal(store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,0,table);
    assert.equal(store.listNotes()[0].id,keep.id);
    assert.ok(store.categories().some(c=>c.id===category.id));
    assert.equal(store.questions().length,0);
    for(const suffix of ['', '-wal']){const file=store.file+suffix;if(fs.existsSync(file))assert.equal(fs.readFileSync(file).includes(Buffer.from(canary)),false,file);}
    assert.throws(()=>store.purgeNote(note.id),/Move the note to trash/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('image attachment survives backup and restore, follows trash and permanent deletion',async()=>{
  const {dir,store}=fresh();
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
  try{
    const note=store.saveNote({text:'',attachments:[{mediaType:'image/png',fileName:'thought.png',dataBase64:png}]});
    assert.equal(note.attachments.length,1);
    assert.equal(store.notesFor('all').length,1);
    assert.equal(store.searchableNotes().length,0);
    assert.equal(store.nextClassificationJob(),undefined);
    const id=note.attachments[0].id;
    assert.equal(store.readAttachment(id).dataBase64,png);
    assert.throws(()=>store.saveNote({text:'',attachments:[{mediaType:'image/png',dataBase64:Buffer.from('fake').toString('base64')}] }),/Image content/);
    assert.throws(()=>store.removeAttachment(id),/last image/);
    const backupPath=path.join(dir,'images.sqlite');
    await store.backupTo(backupPath);
    const copy=new Store(backupPath);
    assert.equal(copy.readAttachment(id).dataBase64,png);
    copy.close();
    store.trashNote(note.id);
    assert.throws(()=>store.readAttachment(id),/Image not found/);
    store.restoreNote(note.id);
    assert.equal(store.readAttachment(id).dataBase64,png);
    const rollback=path.join(dir,'rollback.sqlite');
    store.saveNote({id:note.id,text:'Caption after restoring'});
    store.removeAttachment(id);
    assert.equal(store.attachmentsFor(note.id).length,0);
    await store.restoreFrom(backupPath,rollback);
    assert.equal(store.readAttachment(id).dataBase64,png);
    store.trashNote(note.id);
    store.purgeNote(note.id);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM attachments').get().count,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('listed notes show the current category links and the waiting classification',()=>{
  const {dir,store}=fresh();
  try{
    const music=store.createCategory('music');
    const film=store.createCategory('film');
    const note=store.saveNote({text:'ハナレグミの発光体好き',model:'test'});
    const plain=store.saveNote({text:'分類しないメモ'});
    const listed=id=>store.listNotes().find(item=>item.id===id);
    assert.deepEqual(listed(note.id).categoryIds,[]);
    assert.equal(listed(note.id).classificationState,'pending');
    assert.equal(listed(plain.id).classificationState,null);
    const job=store.nextClassificationJob();
    assert.equal(store.markClassificationRunning(job.noteId,job.revisionId),true);
    assert.equal(listed(note.id).classificationState,'running');
    assert.equal(store.applyClassification(job,[music.id,film.id]),true);
    assert.deepEqual(listed(note.id).categoryIds,[film.id,music.id].sort());
    assert.equal(listed(note.id).classificationState,'done');
    store.archiveCategory(film.id);
    assert.deepEqual(listed(note.id).categoryIds,[music.id]);
    store.saveNote({id:note.id,text:'ハナレグミの発光体が好き',model:'test'});
    assert.equal(listed(note.id).classificationState,'pending');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('reasoning effort is stored for every Codex turn and rejects odd values',()=>{
  const {dir,store}=fresh();
  try{
    assert.equal(store.reasoningEffort(),'');
    assert.equal(store.reasoningEffort('high'),'high');
    assert.equal(store.reasoningEffort(),'high');
    assert.throws(()=>store.reasoningEffort('high; drop'));
    assert.equal(store.reasoningEffort(''),'');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
