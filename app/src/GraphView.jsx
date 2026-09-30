import React,{useMemo,useRef,useState} from 'react';
import {ArrowRightIcon,EnterFullScreenIcon,MinusIcon,PlusIcon,Share2Icon} from '@radix-ui/react-icons';
import SynapseField from './SynapseField.jsx';
import './graph-view.css';

const WIDTH=1000,HEIGHT=620,CENTER={x:500,y:310};
function hash(value){let result=2166136261;for(const char of value){result^=char.codePointAt(0);result=Math.imul(result,16777619)}return result>>>0;}
function layout(data){
  const hubs=new Map(),nodes=new Map(),categories=data.categories||[];
  categories.forEach((category,index)=>{
    const angle=-Math.PI/2+index*2*Math.PI/Math.max(1,categories.length);
    const radius=categories.length===1?0:categories.length===2?200:218;
    hubs.set(category.id,{x:CENTER.x+Math.cos(angle)*radius,y:CENTER.y+Math.sin(angle)*radius,...category});
  });
  const groups=new Map();
  for(const note of data.notes||[]){const ids=note.categories.length?note.categories.map(item=>item.id):['other'];for(const id of ids){if(!groups.has(id))groups.set(id,[]);groups.get(id).push(note.id)}}
  for(const note of data.notes||[]){
    const ids=note.categories.length?note.categories.map(item=>item.id):['other'];
    const anchors=ids.map(id=>hubs.get(id)).filter(Boolean);
    const anchor=anchors.length?{x:anchors.reduce((sum,item)=>sum+item.x,0)/anchors.length,y:anchors.reduce((sum,item)=>sum+item.y,0)/anchors.length}:CENTER;
    const seed=hash(note.id),angle=(seed%360)*Math.PI/180;
    const radius=ids.length>1?35+(seed%45):57+(seed%93);
    nodes.set(note.id,{x:Math.max(34,Math.min(WIDTH-34,anchor.x+Math.cos(angle)*radius)),y:Math.max(34,Math.min(HEIGHT-34,anchor.y+Math.sin(angle)*radius)),bridge:ids.length>1,note,ids});
  }
  return {hubs,nodes,groups};
}
export default function GraphView({data,loading,error,reduced,selectedNoteId,onNote,onCategory,onAddNote,onRetry}){
  const [activeCategory,setActiveCategory]=useState(null),[view,setView]=useState({x:0,y:0,z:1});
  const drag=useRef(null);
  const graph=useMemo(()=>layout(data||{categories:[],notes:[]}),[data]);
  const selectedCategory=graph.hubs.get(activeCategory);
  const selectedNotes=selectedCategory?(graph.groups.get(activeCategory)||[]).map(id=>graph.nodes.get(id)?.note).filter(Boolean):[];
  const edges=[...graph.nodes.values()].flatMap(node=>node.ids.map(id=>({node,hub:graph.hubs.get(id),id})).filter(item=>item.hub));
  const highlighted=edge=>edge.node.note.id===selectedNoteId||edge.id===activeCategory;
  const zoom=amount=>setView(old=>({...old,z:Math.max(.7,Math.min(1.8,old.z+amount))}));
  const reset=()=>{setView({x:0,y:0,z:1});setActiveCategory(null)};
  return <div className="graph-page">
    <div className="graph-intro"><div><span className="terminal-label"><span className="live-tick"/> memory / connections</span><h2>Follow a thread.</h2><p>カテゴリへの所属と、複数の場所に現れるメモをたどる。</p></div><div className="graph-intro-meta"><Share2Icon/><span>{data?.shown||0} / {data?.total||0} notes</span></div></div>
    <div className="graph-explainer">線は現在のカテゴリ所属です。AIが推測した意味的な関連ではありません。傾向や提案はCollectionsで確認できます。</div>
    {loading?<div className="graph-message" role="status">Loading your connections…</div>:error?<div className="graph-message" role="alert">{error}<button onClick={onRetry}>Try again</button></div>:!data?.shown?<div className="graph-message"><h3>A thought starts here.</h3><p>メモを残すと、カテゴリとのつながりを表示します。</p><button className="primary" onClick={onAddNote}><PlusIcon/>Add a note</button></div>:
    <div className="graph-stage"><SynapseField reduced={reduced} variant="graph"/><div className="graph-stage-label">pure.network / local</div>
      <svg className="real-graph" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Notes linked to their current categories" onPointerDown={event=>{if(event.target.closest('[data-graph-node]'))return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,view}}} onPointerMove={event=>{if(!drag.current)return;const scale=WIDTH/event.currentTarget.getBoundingClientRect().width;setView({...drag.current.view,x:drag.current.view.x+(event.clientX-drag.current.x)*scale,y:drag.current.view.y+(event.clientY-drag.current.y)*scale})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
        <g transform={`translate(${CENTER.x+view.x} ${CENTER.y+view.y}) scale(${view.z}) translate(${-CENTER.x} ${-CENTER.y})`}>
          {edges.map(edge=><line key={`${edge.node.note.id}-${edge.id}`} x1={edge.hub.x} y1={edge.hub.y} x2={edge.node.x} y2={edge.node.y} className={'graph-link '+(highlighted(edge)?'lit':'')}/>) }
          {[...graph.hubs.values()].map(hub=><g key={hub.id} data-graph-node role="button" tabIndex="0" aria-label={`${hub.name} category, ${graph.groups.get(hub.id)?.length||0} notes`} className={'graph-hub '+(activeCategory===hub.id?'active':'')} transform={`translate(${hub.x} ${hub.y})`} onClick={()=>{setActiveCategory(hub.id);onNote(null)}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setActiveCategory(hub.id);onNote(null)}}}><circle className="hub-halo" r="32"/><circle className="hub-core" r="7"/><text y="-43" textAnchor="middle">{hub.name}</text><text className="hub-count" y="48" textAnchor="middle">{graph.groups.get(hub.id)?.length||0} notes</text></g>)}
          {[...graph.nodes.values()].map(node=><g key={node.note.id} data-graph-node role="button" tabIndex="0" aria-label={`Open note: ${node.note.text?.slice(0,55)||'Image note'}`} className={'graph-note '+(node.bridge?'bridge ':'')+(selectedNoteId===node.note.id?'active':'')} transform={`translate(${node.x} ${node.y})`} onClick={()=>{setActiveCategory(null);onNote(node.note.id)}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setActiveCategory(null);onNote(node.note.id)}}}><circle className="note-hit" r="17"/><circle className="note-halo" r={node.bridge?12:8}/><circle className="note-core" r={node.bridge?4:3}/><title>{node.note.text?.slice(0,120)||'Image note'}</title></g>)}
        </g>
      </svg>
      <div className="graph-controls"><button aria-label="Zoom out" onClick={()=>zoom(-.15)}><MinusIcon/></button><span>{Math.round(view.z*100)}%</span><button aria-label="Zoom in" onClick={()=>zoom(.15)}><PlusIcon/></button><button aria-label="Reset graph" onClick={reset}><EnterFullScreenIcon/></button></div>
      <div className="graph-legend"><span><i/>category membership</span><span><i className="bridge"/>multiple categories</span></div>
    </div>}
    {selectedCategory&&<section className="graph-selection"><div><span className="eyebrow">CATEGORY / {selectedCategory.name}</span><h3>{selectedNotes.length} connected notes</h3><p>このカテゴリに現在所属する原文です。</p></div><button className="text-button" onClick={()=>onCategory(selectedCategory.id)}>Open Collection <ArrowRightIcon/></button><div className="graph-selection-notes">{selectedNotes.slice(0,6).map(note=><button key={note.id} onClick={()=>onNote(note.id)}>{note.text?.slice(0,120)||'Image note'}<ArrowRightIcon/></button>)}</div></section>}
    {data?.total>data?.shown&&<p className="graph-limit">表示を軽く保つため、最近の{data.shown}件を表示しています。検索とAskは全件が対象です。</p>}
  </div>;
}
