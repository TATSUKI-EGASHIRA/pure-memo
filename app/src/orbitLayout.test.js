import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutOrbit,orbitFrame,polar,memoStamp,noteNodeIds,orbitCategories,chromeRects,PENDING_ID,UNSORTED_ID,ORBIT_LIMIT,EDGE} from './orbitLayout.js';

// Full-width glyphs take one em, everything else about 0.6 em (DM Mono's advance).
const measure=(text,font)=>{const size=Number(/([\d.]+)px/.exec(font)[1]);return [...text].reduce((sum,ch)=>sum+(ch.codePointAt(0)>0x2e80?size:size*.6),0);};
const note=(id,minutes,extra={})=>({id,text:`メモ${id}`,date:new Date(Date.UTC(2026,8,30,14,minutes)).toISOString(),categoryIds:[],classificationState:null,...extra});
const categories=[{id:'all',name:'すべて'},{id:'other',name:'Other'},{id:'music',name:'music'},{id:'netflix',name:'Netflix'},{id:'books',name:'books'},{id:'games',name:'games'},{id:'walks',name:'walks'},{id:'food',name:'food'}];
const long='ハナレグミの発光体が好き。ライブで聴いたときの声の揺れがずっと耳に残っていて、帰り道でも口ずさんでいた';

test('the reference window keeps C and scales from the window centre',()=>{
  assert.deepEqual(orbitFrame(1440,900),{width:1440,height:900,s:1,cx:945,cy:520});
  const small=orbitFrame(1100,700);
  assert.equal(small.s,Math.min(1100/1440,700/900));
  const p=polar(orbitFrame(1440,900),0,100);
  assert.deepEqual([Math.round(p.x),Math.round(p.y)],[1045,520]);
});

test('the newest note takes the inner slot and older notes move outward into +N',()=>{
  const notes=[note('a',1)];
  const first=layoutOrbit({width:1440,height:900,notes,categories,measure});
  assert.equal(first.memos[0].note.id,'a');
  assert.deepEqual([Math.round(first.memos[0].x),Math.round(first.memos[0].y)],[748,382]);
  const many=['f','e','d','c','b','a'].map((id,i)=>note(id,10-i));
  const after=layoutOrbit({width:1440,height:900,notes:many,categories,measure});
  assert.deepEqual(after.memos.map(m=>m.note.id),['f','e','d','c']);
  assert.deepEqual(after.memos.map(m=>m.slot.r),[240,272,340,380]);
  assert.equal(after.memos.length,ORBIT_LIMIT);
  assert.equal(after.older.count,2);
  assert.deepEqual([Math.round(after.older.x),Math.round(after.older.y)],[520,232]);
  assert.equal(layoutOrbit({width:1440,height:900,notes:many.slice(0,4),categories,measure}).older,null);
});

test('waiting, unsorted and classified notes link to honest nodes',()=>{
  assert.deepEqual(noteNodeIds(note('a',1,{classificationState:'pending'})),[PENDING_ID]);
  assert.deepEqual(noteNodeIds(note('a',1,{classificationState:'running'})),[PENDING_ID]);
  assert.deepEqual(noteNodeIds(note('a',1,{classificationState:'failed'})),[UNSORTED_ID]);
  assert.deepEqual(noteNodeIds(note('a',1,{classificationState:'done',categoryIds:['music']})),['music']);
  const groups=orbitCategories([note('a',1,{categoryIds:['music']}),note('b',2,{categoryIds:['music','netflix']}),note('c',3,{classificationState:'pending'})],categories);
  assert.deepEqual(groups.own.map(c=>[c.id,c.count]),[['music',2],['netflix',1]]);
  assert.equal(groups.pending.count,1);
  assert.equal(groups.unsorted,null);
});

test('classification moves the link from waiting to the category',()=>{
  const waiting=layoutOrbit({width:1440,height:900,notes:[note('a',1,{classificationState:'running'}),note('b',0,{categoryIds:['music']})],categories,measure});
  assert.deepEqual(waiting.links.map(l=>[l.noteId,l.nodeId]),[['a',PENDING_ID],['b','music']]);
  const pending=waiting.nodes.find(n=>n.id===PENDING_ID);
  assert.equal(pending.angle,140);
  const done=layoutOrbit({width:1440,height:900,notes:[note('a',1,{classificationState:'done',categoryIds:['music']}),note('b',0,{categoryIds:['music']})],categories,measure});
  assert.deepEqual(done.links.map(l=>[l.noteId,l.nodeId]),[['a','music'],['b','music']]);
  assert.equal(done.nodes.some(n=>n.id===PENDING_ID),false);
});

test('categories use their angles, skip empty ones and collapse the rest',()=>{
  const ids=['music','music','music','netflix','netflix','books','games','walks','food'];
  const notes=ids.map((id,i)=>note(`n${i}`,60-i,{categoryIds:[id]}));
  const layout=layoutOrbit({width:1440,height:900,notes:[note('w',61,{classificationState:'pending'}),...notes],categories,measure});
  assert.deepEqual(layout.nodes.slice(0,3).map(n=>[n.id,n.angle]),[['music',-108],['netflix',-24],[PENDING_ID,140]]);
  assert.equal(layout.nodes.length,6);
  assert.deepEqual(layout.nodes.slice(3).map(n=>n.angle),[-160,20,100].filter(a=>layout.nodes.some(n=>n.angle===a)).concat(layout.nodes.slice(3).map(n=>n.angle).filter(a=>![-160,20,100].includes(a))));
  assert.deepEqual(layout.more.items.map(item=>item.id),['walks']);
  assert.equal(layout.nodes.some(n=>n.count===0),false);
});

for(const [width,height] of [[1440,900],[1100,700],[1280,800],[1920,1080]]){
  test(`labels, nodes and side chrome stay apart and inside ${width}×${height}`,()=>{
    const ids=['music','netflix','books','games','walks','food'];
    const notes=[note('p',90,{text:long,classificationState:'pending'}),note('q',89,{text:long,categoryIds:['music']}),note('r',88,{text:long,categoryIds:['netflix']}),note('s',87,{text:long,categoryIds:['books']}),
      ...ids.map((id,i)=>note(`n${i}`,50-i,{categoryIds:[id]})),note('u',10,{classificationState:'failed'})];
    const layout=layoutOrbit({width,height,notes,categories,measure});
    const frame=layout.frame;
    const boxes=[...chromeRects(frame).map((box,i)=>({name:`chrome${i}`,box})),{name:'notice',box:layout.notice},
      ...layout.memos.map(m=>({name:`label-${m.note.id}`,box:m.label})),...layout.memos.map(m=>({name:`dot-${m.note.id}`,box:m.dot})),
      ...layout.nodes.map(n=>({name:`node-${n.id}`,box:n.box})),...(layout.more?[{name:'more',box:layout.more.box}]:[]),...(layout.older?[{name:'older',box:layout.older.box}]:[])];
    for(const {name,box} of boxes){
      assert.ok(box.left>=EDGE-12&&box.top>=0&&box.right<=width-EDGE+12&&box.bottom<=height,`${name} is clipped: ${JSON.stringify(box)}`);
    }
    const collisions=[];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i].box,b=boxes[j].box;
      const sameMemo=boxes[i].name.split('-')[1]===boxes[j].name.split('-')[1]&&/^(label|dot)/.test(boxes[i].name)&&/^(label|dot)/.test(boxes[j].name);
      if(!sameMemo&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)collisions.push(`${boxes[i].name} × ${boxes[j].name}`);
    }
    assert.deepEqual(collisions,[]);
    assert.ok(layout.nodes.length>=3);
  });
}

test('memo stamps use the local date, weekday and time',()=>{
  const value=new Date(2026,8,30,23,59).toISOString();
  assert.deepEqual(memoStamp(value),{date:'09.30 水',time:'23:59'});
});
