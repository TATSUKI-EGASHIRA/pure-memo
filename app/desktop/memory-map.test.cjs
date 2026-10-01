const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('./store.cjs');
const {localThemes,selectMemoryNotes,validateThemes,memoryPrompt}=require('./memory-map.cjs');
function fresh(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-map-')),store=new Store(path.join(dir,'pure.sqlite'));t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});return {dir,store};}
function recipe(items){return {themes:[{label:'静けさ',description:'別の場面で静かな環境について書いています。好みかどうかは原文から確認が必要です。',evidence:items.map(n=>({revisionId:n.revisionId,quote:n.text.slice(0,20)}))}]};}
test('local themes require shared original words and do not invent preferences',()=>{
 const notes=[{id:'a',revisionId:'ra',text:'静かな場所で作業',date:'2020-01-01'},{id:'b',revisionId:'rb',text:'静かな映画の余韻',date:'2020-01-02'}];
 const themes=localThemes(notes);assert.equal(themes.length,1);assert.equal(themes[0].label,'静けさ');assert.equal(themes[0].origin,'local');assert.equal(themes[0].evidence.length,2);assert.equal(localThemes(notes.slice(0,1)).length,0);
});
test('analysis samples recent and historical originals with bounded payload',()=>{
 const notes=Array.from({length:180},(_,i)=>({id:String(i),date:new Date(2020,0,i+1).toISOString(),text:'a'.repeat(2000)}));
 const selected=selectMemoryNotes(notes);assert.equal(selected.length,72);assert.equal(new Set(selected.map(n=>n.id)).size,72);assert(selected.some(n=>n.id==='0'));assert(selected.some(n=>n.id==='179'));assert(selected.every(n=>n.text.length===1800));
});
test('memory validates distinct source notes, exact quotations and empty results',()=>{
 const items=[{id:'a',revisionId:'ra',text:'静かなカフェにいた'},{id:'b',revisionId:'rb',text:'静かな映画を観た'}],good=recipe(items);
 assert.equal(validateThemes(good,items).length,1);assert.deepEqual(validateThemes({themes:[]},items),[]);
 for(const evidence of [[{revisionId:'made-up',quote:'静かなカフェ'},good.themes[0].evidence[1]],[{revisionId:'ra',quote:'好きだから行く'},good.themes[0].evidence[1]],[good.themes[0].evidence[0],good.themes[0].evidence[0]]])assert.throws(()=>validateThemes({themes:[{...good.themes[0],evidence}]},items));
 assert(memoryPrompt(items,[]).includes('reference/quote'));assert(memoryPrompt(items,[]).includes('性格診断ではない'));
});
test('memory review, hidden undo, feedback and backup retain traceable originals',async t=>{
 const {dir,store}=fresh(t);store.saveNote({text:'静かなカフェにいた',sourceKind:'thought'});store.saveNote({text:'静かな映画を観た',sourceKind:'thought'});store.saveNote({text:'提案した静かな店',originKind:'generated'});
 const items=store.searchableNotes();assert.equal(items.length,2);
 let map=store.saveMemoryThemes({items,result:recipe(items),model:'fixture'});const id=map.themes[0].id;
 assert.equal(map.total,2);assert.equal(map.themes[0].origin,'ai');assert.equal(map.sampleCount,2);
 assert.equal(store.reviewMemoryTheme({id,decision:'confirm'}).themes[0].state,'confirmed');
 map=store.reviewMemoryTheme({id,decision:'correct',comment:'静かな場所より、音の間合いが気になっています。'});assert.equal(map.themes[0].state,'corrected');assert.equal(store.memoryFeedbackFor('静かな場所が好き？').length,1);
 assert.equal(store.memoryFeedbackFor('昨日のランチ').length,0);assert.throws(()=>store.reviewMemoryTheme({id,decision:'correct',comment:''}));
 map=store.reviewMemoryTheme({id,decision:'hide'});assert.equal(map.themes.length,0);assert.equal(map.hiddenThemes.length,1);
 assert.equal(store.reviewMemoryTheme({id,decision:'reset'}).themes.length,1);assert.equal(store.memoryFeedbackFor().length,0);
 await store.backupTo(path.join(dir,'copy.sqlite'));const copy=new Store(path.join(dir,'copy.sqlite'));try{assert.equal(copy.memoryMapData().themes[0].id,id);assert.equal(copy.memoryMapData().notes.length,2)}finally{copy.close()}
});
test('excluded and edited notes invalidate themes, dependent feedback and late saves',t=>{
 const {store}=fresh(t);const first=store.saveNote({text:'静かなカフェにいた'});store.saveNote({text:'静かな映画を観た'});const items=store.searchableNotes();
 let map=store.saveMemoryThemes({items,result:recipe(items),model:'fixture'});store.reviewMemoryTheme({id:map.themes[0].id,decision:'correct',comment:'好みとは違う'});
 const feedback=store.memoryFeedbackFor(),other=store.saveNote({text:'別の記録を書いた'});
 store.saveMemoryThemes({items:[other],result:{themes:[]},model:'fixture',contextRunIds:feedback.map(f=>f._runId)});
 store.setAiExcluded({id:first.id,excluded:true});assert.equal(store.memoryMapData().notes.length,3);assert.equal(store.memoryMapData().themes.length,0);assert.equal(store.memoryFeedbackFor().length,0);assert.equal(store.db.prepare("SELECT ai_blocked FROM runs WHERE purpose='memory' ORDER BY rowid DESC LIMIT 1").get().ai_blocked,1);
 assert.throws(()=>store.saveMemoryThemes({items,result:recipe(items),model:'fixture'}));store.setAiExcluded({id:first.id,excluded:false});assert.equal(store.memoryMapData().themes.length,0);
 const freshItems=store.searchableNotes().filter(n=>n.id!==other.id);map=store.saveMemoryThemes({items:freshItems,result:recipe(freshItems),model:'fixture'});assert.equal(map.themes.length,1);
 store.saveNote({id:first.id,text:'音の間合いが気になる'});assert.equal(store.memoryMapData().themes.length,0);assert.throws(()=>store.reviewMemoryTheme({id:map.themes[0].id,decision:'confirm'}));
});
test('a newer review replaces historical feedback for the same theme and reset clears it',t=>{
 const {store}=fresh(t);store.saveNote({text:'静かなカフェにいた'});store.saveNote({text:'静かな映画を観た'});const items=store.searchableNotes();
 let map=store.saveMemoryThemes({items,result:recipe(items),model:'fixture'});store.reviewMemoryTheme({id:map.themes[0].id,decision:'correct',comment:'古い訂正'});
 map=store.saveMemoryThemes({items,result:recipe(items),model:'fixture',contextRunIds:store.memoryFeedbackFor().map(f=>f._runId)});
 store.reviewMemoryTheme({id:map.themes[0].id,decision:'confirm'});assert.equal(store.memoryFeedbackFor().length,1);assert.equal(store.memoryFeedbackFor()[0].rating,'good');
 store.reviewMemoryTheme({id:map.themes[0].id,decision:'reset'});assert.equal(store.memoryFeedbackFor().length,0);
});
test('editing a feedback source invalidates derived themes and answers even when the source was not resampled',t=>{
 const {store}=fresh(t);const first=store.saveNote({text:'静かなカフェにいた'});store.saveNote({text:'静かな映画を観た'});
 let map=store.saveMemoryThemes({items:store.searchableNotes(),result:recipe(store.searchableNotes()),model:'fixture'});
 store.reviewMemoryTheme({id:map.themes[0].id,decision:'correct',comment:'音の間合いが気になる'});const contextRunIds=store.memoryFeedbackFor().map(f=>f._runId);
 const a=store.saveNote({text:'音の間合いが気になった'}),b=store.saveNote({text:'制作でも間合いを見ている'}),items=store.searchableNotes().filter(n=>[a.id,b.id].includes(n.id));
 const result=recipe(items);result.themes[0].label='間合い';map=store.saveMemoryThemes({items,result,model:'fixture',contextRunIds});assert.equal(map.themes.length,1);
 const answer=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'fixture',items,question:'間合いについて',contextRunIds,result:{status:'ready',text:'音と制作の間合いについての記録があります。',pattern:'',evidenceRevisionIds:items.map(n=>n.revisionId)}});
 store.saveNote({id:first.id,text:'好みについてはまだ分からない'});
 assert.equal(store.memoryMapData().themes.length,0);assert.equal(store.memoryFeedbackFor().length,0);assert.throws(()=>store.assertAiSnapshot(items,contextRunIds));
 assert.equal(store.db.prepare('SELECT status FROM outputs WHERE id=?').get(answer.id).status,'stale');assert.throws(()=>store.saveMemoryThemes({items,result,model:'fixture',contextRunIds}));
});
