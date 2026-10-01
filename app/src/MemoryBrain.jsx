import React,{memo,useMemo,useRef,useState} from 'react';
import {PlusIcon,MinusIcon,ResetIcon} from '@radix-ui/react-icons';
import {memoryLayout,inPeriod} from './memoryMap.js';
const OUTLINE='M 130 345 C 101 318 92 276 103 238 C 115 185 153 145 209 122 C 262 91 318 78 377 87 C 422 64 477 59 524 82 C 578 71 637 91 679 123 C 737 155 777 196 777 239 C 805 287 804 339 779 364 C 809 408 777 465 727 470 C 720 513 691 541 655 536 L 641 583 L 603 580 L 604 522 C 558 506 555 457 546 423 C 501 445 441 444 416 414 C 367 440 313 417 294 400 C 229 425 158 397 156 365 C 140 362 133 354 130 345 Z';
const folds=['M137 213 C210 150 225 247 296 214 S332 130 377 87','M156 365 C192 276 245 324 284 297 S297 214 353 232 S395 176 434 141 S490 161 524 82','M244 115 C294 126 262 181 325 166 S373 139 420 189 S476 227 499 195 S536 169 571 211 S643 182 671 121','M130 345 C201 359 219 368 246 344 S300 338 294 400','M377 87 C371 133 401 151 434 141','M416 414 C405 377 365 350 391 305 S443 296 463 324 S524 369 546 423','M779 364 C740 370 735 307 683 308 S635 268 628 233 S589 227 571 211','M727 470 C727 420 671 444 654 417 S582 413 577 375 S610 339 592 310 S535 324 514 287 S483 238 463 257 S428 249 413 270','M604 522 C624 489 650 504 655 536','M777 239 C733 248 700 227 690 258','M546 423 C573 409 607 450 646 446 S700 475 727 470'];
function MemoryBrain({notes,themes,end,days,selectedNoteId,selectedThemeId,citedIds,reduced,onNote,onTheme}){
 const graph=useMemo(()=>memoryLayout(notes,themes,[...(selectedNoteId?[selectedNoteId]:[]),...citedIds]),[notes,themes,citedIds,selectedNoteId]);
 const [view,setView]=useState({x:0,y:0,z:1}),transform=useRef(null),drag=useRef(null),live=useRef(view);
 const apply=v=>{live.current=v;transform.current?.setAttribute('transform',`translate(${430+v.x} ${320+v.y}) scale(${v.z}) translate(-430 -320)`)};
 const zoom=delta=>{const v={...live.current,z:Math.min(1.8,Math.max(.7,live.current.z+delta))};apply(v);setView(v)};
 const cited=new Set(citedIds),selected=themes.find(t=>t.id===selectedThemeId);
 const active=new Set(selected?selected.evidence.map(e=>e.noteId):selectedNoteId?[selectedNoteId]:citedIds);
 const key=(e,fn)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn()}};
 return <div className={'memory-canvas '+(reduced?'motion-off':'')}>
  <svg viewBox="0 0 860 640" role="group" aria-label="脳の形で表示したメモと共通テーマの地図" onPointerDown={e=>{if(e.target.closest('[data-memory-node]'))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,v:live.current}}} onPointerMove={e=>{if(!drag.current)return;const scale=860/e.currentTarget.getBoundingClientRect().width;apply({...drag.current.v,x:drag.current.v.x+(e.clientX-drag.current.x)*scale,y:drag.current.v.y+(e.clientY-drag.current.y)*scale})}} onPointerUp={()=>{if(drag.current){setView(live.current);drag.current=null}}} onPointerCancel={()=>{setView(live.current);drag.current=null}}>
   <defs><radialGradient id="brain-light"><stop stopColor="#163a4a" stopOpacity=".45"/><stop offset="1" stopColor="#0a1520" stopOpacity="0"/></radialGradient><filter id="memory-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter></defs>
   <g ref={transform} transform={`translate(${430+view.x} ${320+view.y}) scale(${view.z}) translate(-430 -320)`}>
    <path d={OUTLINE} fill="url(#brain-light)" className="brain-outline"/>
    {folds.map((d,i)=><path key={i} d={d} className="brain-fold"/>)}
    {graph.anchors.map(t=><g key={t.id}><ellipse cx={t.x} cy={t.y} rx="85" ry="57" className="memory-region"/><ellipse cx={t.x} cy={t.y} rx="80" ry="54" className="memory-region-inner"/></g>)}
    {graph.nodes.flatMap(n=>n.groups.map(id=>{const t=graph.anchors.find(t=>t.id===id),lit=active.has(n.note.id),visible=inPeriod(n.note.date,end,days);return <path key={n.note.id+id} d={`M${t.x} ${t.y} Q${(t.x+n.x)/2+12} ${(t.y+n.y)/2-16} ${n.x} ${n.y}`} className={`memory-link ${t.state==='confirmed'?'confirmed':''} ${lit?'lit':''}`} opacity={lit?1:visible?.2:.04}/>;}))}
    {graph.nodes.map(n=>{const lit=active.has(n.note.id),recent=inPeriod(n.note.date,end,days);return <g key={n.note.id} data-memory-node role="button" tabIndex="0" aria-label={`メモ: ${n.note.text.slice(0,55)||'画像'}`} className={`memory-point ${lit?'selected':''} ${cited.has(n.note.id)?'cited':''}`} transform={`translate(${n.x} ${n.y})`} onClick={()=>onNote(n.note.id)} onKeyDown={e=>key(e,()=>onNote(n.note.id))} style={{opacity:lit?1:recent?.8:.16}}><circle r="12" fill="transparent"/><circle className="point-glow" r={lit?9:5}/><circle className="point-core" r={lit?3.8:2.2}/><title>{n.note.text.slice(0,120)||'画像メモ'}</title></g>})}
    {graph.anchors.map(t=><g data-memory-node key={t.id} role="button" tabIndex="0" aria-label={`${t.label}、原文${t.evidence.length}件`} className={'memory-anchor '+(selectedThemeId===t.id?'selected':'')} transform={`translate(${t.x} ${t.y})`} onClick={()=>onTheme(t.id)} onKeyDown={e=>key(e,()=>onTheme(t.id))}><rect x="-60" y="-72" width="120" height="100" fill="transparent"/><circle className="anchor-glow" r="10"/><circle r="3" className="point-core"/><text y="-65" textAnchor="middle">{t.label}</text><text y="-48" className="anchor-caption" textAnchor="middle">{t.evidence.length}件{t.state==='confirmed'?' · 確認済み':''}</text></g>)}
   </g>
  </svg>
  {!notes.length&&<div className="memory-empty"><h3>メモはまだありません</h3></div>}
  <div className="memory-legend"><span><i/>原文</span><span><i className="line"/>確認済みの関連</span><span><i className="dash"/>未確認の関連</span></div>
  <div className="memory-zoom"><button aria-label="地図を縮小" onClick={()=>zoom(-.15)}><MinusIcon/></button><span>{Math.round(view.z*100)}%</span><button aria-label="地図を拡大" onClick={()=>zoom(.15)}><PlusIcon/></button><button aria-label="地図の位置を戻す" onClick={()=>{const v={x:0,y:0,z:1};apply(v);setView(v)}}><ResetIcon/></button></div>
 </div>;
}
export default memo(MemoryBrain);
