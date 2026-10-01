import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryLayout,inPeriod,histogram,DAY} from './memoryMap.js';
test('time changes do not change coordinates and layout does not invent notes',()=>{
 const notes=Array.from({length:12},(_,i)=>({id:`n${i}`,text:'original',date:new Date(i*DAY).toISOString()}));
 const theme={id:'theme',label:'静けさ',evidence:[{noteId:'n1'},{noteId:'n2'}]};
 const a=memoryLayout(notes,[theme]),b=memoryLayout([...notes].reverse(),[theme]);
 for(const node of a.nodes){const other=b.nodes.find(n=>n.note.id===node.note.id);assert.equal(node.x,other.x);assert.equal(node.y,other.y)}
 assert.equal(a.nodes.length,12);assert.equal(a.nodes.filter(n=>n.groups.length).length,2);assert.equal(memoryLayout([],[]).nodes.length,0);
});
test('render cap prioritizes an old cited source and histogram preserves actual counts',()=>{
 const notes=Array.from({length:1000},(_,i)=>({id:`n${i}`,date:new Date(i*DAY).toISOString()}));
 const graph=memoryLayout(notes,[],['n999']);assert.equal(graph.nodes.length,360);assert(graph.nodes.some(n=>n.note.id==='n999'));
 const crowded=memoryLayout(notes,[{id:'all',label:'光',evidence:notes.map(n=>({noteId:n.id}))}],['n999']);assert(crowded.nodes.some(n=>n.note.id==='n999'));
 assert.equal(histogram(notes,0,999*DAY).reduce((a,b)=>a+b),1000);assert(inPeriod(notes[998].date,999*DAY,7));assert(!inPeriod(notes[1].date,999*DAY,7));assert(!inPeriod(notes[999].date,900*DAY,0));
});
