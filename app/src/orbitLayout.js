// Geometry of the orbit view. Every orbit position is C + value × s, measured on a
// 1440×900 reference window; the side chrome keeps fixed sizes.
import {HOLE,holeCenter} from './hole.js';
import {t,weekday} from './i18n.js';
export const BASE={width:HOLE.width,height:HOLE.height,cx:HOLE.x,cy:HOLE.y};
// `turn` is the same angle unwound so each push outward travels clockwise.
export const MEMO_SLOTS=Object.freeze([
  {angle:-145,turn:-145,r:240,size:28},
  {angle:48,turn:48,r:272,size:24},
  {angle:160,turn:160,r:340,size:24},
  {angle:-58,turn:302,r:380,size:24},
]);
export const ORBIT_LIMIT=MEMO_SLOTS.length;
export const OUTER_RING=440;
export const INPUT_RADIUS=160;
export const TICK_RINGS={inner:184,outer:218};
export const OLDER_LINK={x:520,y:232};
export const NOTICE_OFFSET=236;
export const CATEGORY_SLOTS=Object.freeze([{angle:-108,r:428},{angle:-24,r:420}]);
export const PENDING_SLOT={angle:140,r:440};
export const EXTRA_ANGLES=Object.freeze([-160,20,100]);
// Used only when a listed angle would overlap a label or the window edge.
const FALLBACK_ANGLES=[180,0,120,-90,60,-130];
const RADIUS_STEPS=[1,.96,.92,.88,.84,1.04];
export const PENDING_ID='pending';
export const UNSORTED_ID='unsorted';
export const EDGE=24;
export const HIT=44;
export const FONTS={
  display:'"Shippori Mincho B1","Hiragino Mincho ProN",serif',
  body:'"IBM Plex Sans JP","Hiragino Sans",sans-serif',
  mono:'"DM Mono","IBM Plex Sans JP","Hiragino Sans",sans-serif',
};

// The side chrome (fixed px). orbit-view.css uses the same numbers.
export const CHROME={
  brand:{left:30,top:58,width:96,height:44},
  nav:{left:18,top:120,width:200,row:44,count:6},
  topRight:{right:24,top:22,height:44,search:230,gap:12,status:150},
  bottomLeft:{left:14,bottom:14,size:44,count:2},
  views:{width:176,height:52,bottom:22},
  legend:{right:24,bottom:22,width:136,height:44,clear:100},
};

export const TOAST={top:18,height:48,width:440};

export function orbitFrame(width,height){
  const {s,x,y}=holeCenter(width,height);
  return {width,height,s,cx:x,cy:y};
}
export function polar(frame,angle,r){
  const a=angle*Math.PI/180;
  return {x:frame.cx+Math.cos(a)*r*frame.s,y:frame.cy+Math.sin(a)*r*frame.s};
}

const pad=value=>String(value).padStart(2,'0');
export function memoStamp(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return {date:'',time:''};
  return {date:`${pad(date.getMonth()+1)}.${pad(date.getDate())} ${weekday(date)}`,time:`${pad(date.getHours())}:${pad(date.getMinutes())}`};
}
export function memoText(note){return (note.text||note.excerpt||'').replace(/\s+/g,' ').trim()||t('画像のメモ');}

// Which category nodes a note is linked to. A queued or running classification is
// shown as waiting; a note that has neither a category nor a job is unsorted.
export function noteNodeIds(note){
  if(note.categoryIds?.length)return note.categoryIds;
  if(['pending','running'].includes(note.classificationState))return [PENDING_ID];
  return [UNSORTED_ID];
}

export function memoTag(note,categories){
  const id=noteNodeIds(note)[0],name=categories.find(category=>category.id===id)?.name;
  return name?`#${name}`:id===PENDING_ID?t('分類待ち'):t('未分類');
}

export function orbitCategories(notes,categories){
  const names=new Map(categories.filter(c=>!['all','other'].includes(c.id)).map(c=>[c.id,c.name]));
  const counts=new Map();
  for(const note of notes)for(const id of noteNodeIds(note))counts.set(id,(counts.get(id)||0)+1);
  const own=[...names].map(([id,name])=>({id,name,count:counts.get(id)||0,kind:'category'})).filter(c=>c.count>0)
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ja'));
  const pending=counts.get(PENDING_ID)?{id:PENDING_ID,name:t('分類待ち'),count:counts.get(PENDING_ID),kind:'pending'}:null;
  const unsorted=counts.get(UNSORTED_ID)?{id:UNSORTED_ID,name:t('未分類'),count:counts.get(UNSORTED_ID),kind:'unsorted'}:null;
  return {own,pending,unsorted};
}

export const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height});
const overlaps=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
function circleHits(circle,box){
  const x=Math.max(box.left,Math.min(circle.x,box.right)),y=Math.max(box.top,Math.min(circle.y,box.bottom));
  return (x-circle.x)**2+(y-circle.y)**2<circle.r**2;
}
const inside=(box,frame)=>box.left>=EDGE&&box.top>=EDGE&&box.right<=frame.width-EDGE&&box.bottom<=frame.height-EDGE;

export function chromeRects(frame,{status=CHROME.topRight.status}={}){
  const {width,height}=frame,c=CHROME;
  const topRightWidth=status+c.topRight.gap+c.topRight.search+c.topRight.gap+HIT;
  return [
    rect(c.brand.left,c.brand.top,c.brand.width,c.brand.height),
    rect(c.nav.left,c.nav.top,c.nav.width,c.nav.row*c.nav.count),
    rect(width-c.topRight.right-topRightWidth,c.topRight.top,topRightWidth,c.topRight.height),
    rect(c.bottomLeft.left,height-c.bottomLeft.bottom-c.bottomLeft.size*c.bottomLeft.count,c.bottomLeft.size,c.bottomLeft.size*c.bottomLeft.count),
    rect((width-c.views.width)/2,height-c.views.bottom-c.views.height,c.views.width,c.views.height),
    // The legend plus the clear-selection button that can appear on its left.
    rect(width-c.legend.right-c.legend.width-c.legend.clear-12,height-c.legend.bottom-c.legend.height,c.legend.width+c.legend.clear+12,c.legend.height),
  ];
}

export function memoMetrics(frame,slot,focused=false){
  const s=frame.s;
  const meta=Math.max(10,11*s),body=Math.max(24,(focused?32:slot.size)*s);
  return {meta,metaLine:Math.round(meta*1.6),metaGap:Math.round(4*s),body,bodyLine:body*1.3,
    leaderFrom:11*s,leaderLength:26*s,labelGap:47*s,maxWidth:300*s,open:HIT};
}

// Narrow label columns (small windows, right edge) get a third line.
export const bodyLineLimit=maxWidth=>maxWidth<240?3:2;
function measureBody(measure,text,font,maxWidth){
  const full=measure(text.slice(0,240),font)*1.02;
  return {width:Math.min(Math.ceil(full),maxWidth),lines:Math.min(bodyLineLimit(maxWidth),Math.max(1,Math.ceil(full/maxWidth)))};
}

// Lays out the four newest notes, the older-notes link and the category nodes.
// `measure(text,font)` returns a width in px (canvas measureText in the app).
export function layoutOrbit({width,height,notes,categories,measure,statusWidth}){
  const frame=orbitFrame(width,height),s=frame.s;
  const obstacles=chromeRects(frame,{status:statusWidth});
  const toast=rect(frame.width/2-TOAST.width/2,TOAST.top,TOAST.width,TOAST.height);
  const input={x:frame.cx,y:frame.cy,r:(INPUT_RADIUS+4)*s};
  const noticeWidth=Math.min(420,measure(t('自動分類 · 原文をCodexへ送信　オフにする'),`500 12px ${FONTS.body}`)+64);
  const notice=rect(frame.cx-noticeWidth/2,frame.cy-NOTICE_OFFSET*s-HIT/2,noticeWidth,HIT);
  obstacles.push(notice);

  const memos=notes.slice(0,ORBIT_LIMIT).map((note,index)=>{
    const slot=MEMO_SLOTS[index],point=polar(frame,slot.angle,slot.r);
    const side=Math.cos(slot.angle*Math.PI/180)<0?'left':'right';
    const m=memoMetrics(frame,slot,true),edge=side==='left'?point.x-m.labelGap:point.x+m.labelGap;
    const available=side==='left'?edge-EDGE:frame.width-EDGE-edge;
    const maxWidth=Math.max(120,Math.min(m.maxWidth,available));
    const text=memoText(note),body=measureBody(measure,text,`600 ${m.body}px ${FONTS.display}`,maxWidth);
    const metaWidth=(measure(t('00.00 水 · 00:00'),`500 ${m.meta}px ${FONTS.mono}`)+measure(memoTag(note,categories),`500 ${m.meta}px ${FONTS.mono}`))*1.02+2.3*m.meta;
    const labelWidth=Math.min(maxWidth,Math.max(body.width,metaWidth));
    const height=m.metaLine+m.metaGap+m.bodyLine*body.lines+m.open;
    let top=point.y-m.metaLine-m.metaGap-m.bodyLine/2;
    // Near a window corner the block slides vertically just enough to clear the chrome.
    for(const other of obstacles){
      const box=rect(side==='left'?edge-labelWidth:edge,top,labelWidth,height);
      if(!overlaps(other,box))continue;
      const up=box.bottom-other.top+6,down=other.bottom-box.top+6;
      top+=up<=down&&top-up>=EDGE?-up:down;
    }
    const box=rect(side==='left'?edge-labelWidth:edge,top,labelWidth,height);
    return {note,index,slot,x:point.x,y:point.y,r:slot.r*s,side,edge,maxWidth,top,label:box,dot:rect(point.x-HIT/2,point.y-HIT/2,HIT,HIT)};
  });
  for(const memo of memos)obstacles.push(memo.dot,memo.label);
  // Notices stay in the top row, between the brand and the status.
  obstacles.push(toast);

  const olderCount=Math.max(0,notes.length-ORBIT_LIMIT);
  const older=olderCount?(()=>{
    const x=frame.cx+(OLDER_LINK.x-BASE.cx)*s,y=frame.cy+(OLDER_LINK.y-BASE.cy)*s;
    const w=measure(t('+{olderCount} 以前のメモ',{olderCount:olderCount}),`600 13px ${FONTS.body}`)+52;
    return {count:olderCount,x,y,box:rect(x,y-HIT/2,w,HIT)};
  })():null;
  if(older)obstacles.push(older.box);

  const groups=orbitCategories(notes,categories);
  const label=Math.max(11,14*s),small=Math.max(10,11*s);
  const nodeSize=(name,count)=>measure(name,`500 ${label}px ${FONTS.mono}`)+(count==null?0:measure(String(count),`500 ${small}px ${FONTS.mono}`)+10)+(count==null?32:72);
  const used=new Set();
  function place(item,angles,baseR,{dot=true}={}){
    const width=nodeSize(item.name,item.count);
    for(const angle of angles){
      if(used.has(angle))continue;
      for(const step of RADIUS_STEPS){
        const point=polar(frame,angle,baseR*step);
        const natural=Math.cos(angle*Math.PI/180)<-1e-6?'left':'right';
        for(const side of [natural,natural==='left'?'right':'left']){
          // A node is one pill-shaped button: the dot sits at its outer end.
          const anchor=dot?HIT/2:0;
          const box=side==='right'?rect(point.x-anchor,point.y-HIT/2,width,HIT):rect(point.x+anchor-width,point.y-HIT/2,width,HIT);
          if(!inside(box,frame)||circleHits(input,box)||obstacles.some(other=>overlaps(other,box)))continue;
          used.add(angle);obstacles.push(box);
          return {...item,angle,x:point.x,y:point.y,side,box};
        }
      }
    }
    return null;
  }
  const nodes=[],hidden=[];
  const fixed=[...groups.own.slice(0,CATEGORY_SLOTS.length).map((item,i)=>({item,angle:CATEGORY_SLOTS[i].angle,r:CATEGORY_SLOTS[i].r})),
    ...(groups.pending?[{item:groups.pending,angle:PENDING_SLOT.angle,r:PENDING_SLOT.r}]:[])];
  for(const {item,angle} of fixed)used.add(angle);
  for(const {item,angle,r} of fixed){
    used.delete(angle);
    const placed=place(item,[angle,...FALLBACK_ANGLES],r);
    if(placed)nodes.push(placed);else hidden.push(item);
  }
  // Remaining categories use the free angles in order, then the unsorted group.
  const extras=[...groups.own.slice(CATEGORY_SLOTS.length),...(groups.unsorted?[groups.unsorted]:[])];
  let free=[...EXTRA_ANGLES];
  for(const item of extras){
    if(!free.length){hidden.push(item);continue;}
    const placed=place(item,[...free,...FALLBACK_ANGLES],OUTER_RING);
    if(placed){nodes.push(placed);free=free.filter(angle=>angle!==placed.angle);if(!EXTRA_ANGLES.includes(placed.angle))free.shift();}
    else hidden.push(item);
  }
  let more=null;
  if(hidden.length){
    more=place({id:'more',name:t('+{hiddenCount} カテゴリ',{hiddenCount:hidden.length}),count:null,kind:'more',items:hidden},[...free,...FALLBACK_ANGLES,-120,150],OUTER_RING,{dot:false});
  }
  const target=new Map(nodes.map(node=>[node.id,node]));
  const hiddenIds=new Set(hidden.map(item=>item.id));
  const links=[];
  for(const memo of memos)for(const id of noteNodeIds(memo.note)){
    const node=target.get(id)||(hiddenIds.has(id)?more:null);
    if(node)links.push({key:`${memo.note.id}:${node.id}:${memo.index}`,noteId:memo.note.id,nodeId:node.id,categoryId:id,x1:memo.x,y1:memo.y,x2:node.x,y2:node.y});
  }
  return {frame,memos,older,nodes,more,links,notice};
}

export function overlapsAny(boxes){
  const found=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlaps(boxes[i].box,boxes[j].box))found.push([boxes[i].name,boxes[j].name]);
  return found;
}
