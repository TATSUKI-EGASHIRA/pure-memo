import React from 'react';
import SynapseField from './SynapseField.jsx';
import './hero-visual.css';

const positions=[[287,53],[285,129],[86,49],[72,130]];

export default function HeroVisual({page,reduced,categories=[],sourceNoteCount=0,nextStepCount=0}){
  if(page==='Trash')return null;
  if(page==='Notes')return <div className="native-hero-art"><SynapseField reduced={reduced}/></div>;

  const userCategories=categories.filter(category=>!['all','other'].includes(category.id));
  let art;
  if(page==='Collections'||page==='Categories'){
    const visible=userCategories.slice(0,4);
    art=<svg viewBox="0 0 360 180" aria-hidden="true">
      <circle className="hero-halo" cx="180" cy="89" r="47"/>
      <circle className="hero-core" cx="180" cy="89" r="17"/>
      <circle className="hero-core-center" cx="180" cy="89" r="3"/>
      {visible.length?visible.map((item,index)=>{
        const [x,y]=positions[index];
        return <g key={item.id}>
          <path className="hero-link" d={`M180 89 Q${(180+x)/2} ${y<89?20:158} ${x} ${y}`}/>
          <circle className="hero-node-ring" cx={x} cy={y} r={Math.min(11,6+Math.sqrt(Math.max(0,item.count||0)))}/>
          <circle className="hero-node" cx={x} cy={y} r="2"/>
          <text className="hero-node-label" x={x} y={y+23} textAnchor="middle">{item.name.length>10?`${item.name.slice(0,10)}…`:item.name}</text>
        </g>;
      }):<path className="hero-link hero-link-pending" d="M180 89 Q230 24 291 59"/>}
    </svg>;
  }else if(page==='Next Steps'){
    const count=Math.min(nextStepCount,4);
    art=<svg viewBox="0 0 360 180" aria-hidden="true">
      <path className={count?'hero-route':'hero-route hero-link-pending'} d="M35 112 C100 112 94 47 167 67 S274 120 328 55"/>
      {Array.from({length:count},(_,index)=>{const [x,y]=[[35,112],[167,67],[268,94],[328,55]][index];return <g key={index}><circle className="hero-node-ring" cx={x} cy={y} r="9"/><circle className="hero-node" cx={x} cy={y} r="2"/></g>})}
      {!count&&<circle className="hero-node-ring" cx="35" cy="112" r="9"/>}
    </svg>;
  }else{
    const dots=Math.min(sourceNoteCount,12);
    art=<svg viewBox="0 0 360 180" aria-hidden="true">
      <circle className="hero-query-ring" cx="180" cy="90" r="30"/>
      <circle className="hero-query-ring hero-query-ring-outer" cx="180" cy="90" r="62"/>
      <circle className="hero-core-center" cx="180" cy="90" r="4"/>
      {Array.from({length:dots},(_,index)=>{const angle=index*2.39996;return <circle className="hero-query-dot" key={index} cx={180+Math.cos(angle)*64} cy={90+Math.sin(angle)*64} r="2.4"/>})}
    </svg>;
  }
  const label=page==='Next Steps'?`${nextStepCount} STEP${nextStepCount===1?'':'S'} READY`:page==='Ask'?`${sourceNoteCount} SOURCE NOTE${sourceNoteCount===1?'':'S'}`:`${userCategories.length} ${page==='Categories'?'YOUR CATEGORIES':'CATEGORIES'} · ${sourceNoteCount} NOTES`;
  return <div className="native-hero-art hero-data-art"><div className="hero-data-drawing">{art}<span>{label}</span></div></div>;
}
