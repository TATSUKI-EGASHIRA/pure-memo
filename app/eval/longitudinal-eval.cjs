const fs=require('node:fs');
const path=require('node:path');
const {rank}=require('../desktop/retrieval.cjs');
const fixture=require('./longitudinal-fixture.cjs');
const {notes:existing}=require('./memory-fixture.cjs');

const excluded=new Set(['x_generated','x_deleted']);
const existingRows=existing.filter(([key,,,,kind])=>kind!=='generated'&&kind!=='trash').map(([key,category,date,text])=>({key,revisionId:key,categoryNames:category,text,date}));
const newRows=fixture.notes.filter(([key,,,,kind])=>kind!=='generated'&&kind!=='trash').map(([key,category,date,text])=>({key,revisionId:key,categoryNames:category,text,date}));
const rows=[...existingRows,...newRows];
const keys=new Set(rows.map(row=>row.key));
const categoryByKey=new Map(rows.map(row=>[row.key,row.categoryNames]));
if(keys.size!==rows.length)throw new Error('Duplicate note key.');
if(new Set(fixture.cases.map(item=>item.id)).size!==fixture.cases.length)throw new Error('Duplicate case ID.');
for(const item of fixture.cases)if(!item.question||item.required.some(key=>!keys.has(key)))throw new Error(`Invalid case ${item.id}`);

const details=fixture.cases.map(item=>{
  const selected=rank(item.question,rows,new Map(),null,10);
  const ranked=selected.map(note=>note.key);
  const found=item.required.filter(key=>ranked.includes(key));
  return {id:item.id,type:item.type,question:item.question,required:item.required,found,ranked,
    distractors:ranked.filter(key=>key.startsWith('z')),offTopic:ranked.filter(key=>!item.relevantCategories.includes(categoryByKey.get(key))),excludedLeaks:ranked.filter(key=>excluded.has(key))};
});
const answerable=details.filter(item=>item.required.length);
const requiredTotal=answerable.reduce((sum,item)=>sum+item.required.length,0);
const summary={cases:details.length,sourceNotes:rows.length,requiredFound:answerable.reduce((sum,item)=>sum+item.found.length,0),requiredTotal,
  completeCases:answerable.filter(item=>item.found.length===item.required.length).length,casesWithRequiredSources:answerable.length,
  distractorsAt10:details.reduce((sum,item)=>sum+item.distractors.length,0),offTopicAt10:details.reduce((sum,item)=>sum+item.offTopic.length,0),excludedLeaks:details.reduce((sum,item)=>sum+item.excludedLeaks.length,0)};
const report={createdAt:new Date().toISOString(),synthetic:true,embedding:'unavailable/text-only',scope:'retrieval candidates only; answer and correction quality not measured',summary,details};
const output=path.join(__dirname,'results','longitudinal-report.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary,misses:details.filter(item=>item.found.length<item.required.length).map(({id,required,found})=>({id,required,found})),output},null,2));
if(summary.excludedLeaks)process.exitCode=1;
