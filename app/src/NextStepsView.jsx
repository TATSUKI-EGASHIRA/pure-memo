import React,{useEffect,useRef,useState} from 'react';
import {ArrowRightIcon,ChevronLeftIcon,ChevronRightIcon,LightningBoltIcon,PlusIcon} from '@radix-ui/react-icons';
import {PageHeading,CenterStage,Disc,Dial,Drop,MonoLabel} from './UiPrimitives.jsx';
import {SourceLinks,Rating} from './OutputParts.jsx';
import {memoStamp} from './orbitLayout.js';
import {t} from './i18n.js';

const SATELLITES=5;
// Referenced memos sit on the dotted ring, left half (130°–230°), newest at the top.
function satelliteAngles(count){
  if(count<=1)return [180];
  return Array.from({length:count},(_,i)=>230-i*100/(count-1));
}

// S4: one proposal at a time inside the disc on the hole.
export default function NextStepsView({steps,notes,sourceNoteCount,onRate,onStart,onOpenNote,onAddNote,onCollections}){
  const [index,setIndex]=useState(0),[narrow,setNarrow]=useState(()=>window.innerWidth<1200);
  const sources=useRef(null);
  useEffect(()=>{const sync=()=>setNarrow(window.innerWidth<1200);window.addEventListener('resize',sync);return()=>window.removeEventListener('resize',sync)},[]);
  useEffect(()=>{if(index>=steps.length)setIndex(Math.max(0,steps.length-1))},[steps.length,index]);
  const step=steps[index];
  const evidence=(step?.evidence||[]).map(e=>({...e,note:notes.find(n=>n.id===e.noteId)}))
    .sort((a,b)=>(b.note?.date||'').localeCompare(a.note?.date||''));
  const shown=evidence.slice(0,SATELLITES),rest=evidence.length-shown.length;
  const label=e=>{const stamp=e.note?memoStamp(e.note.date):null;return stamp?`${stamp.date.slice(0,5)} · ${stamp.time}`:t('以前の版')};
  const openRest=()=>{const el=sources.current?.querySelector('details');if(el){el.open=true;el.querySelector('summary')?.focus()}};
  return <div className="native-scroll steps-page">
    <PageHeading Icon={LightningBoltIcon} title={t('提案')} meta={t('{stepsCount}件',{stepsCount:steps.length})}/>
    <CenterStage className="steps-stage">{stage=>{
      const s=stage.s,disc=500*s;
      // Labels need room between the left column and the ring; otherwise they stack under the disc.
      const room=Math.min(280,stage.x-330*s-38),stacked=narrow||room<180;
      return <>
        <Dial r={272*s} className="stage-center" style={{left:stage.x,top:stage.y}}/>
        <svg className="stage-center steps-ring" width={680*s} height={680*s} style={{left:stage.x,top:stage.y}} aria-hidden="true" focusable="false"><circle cx={340*s} cy={340*s} r={330*s}/></svg>
        {step&&!stacked&&<ol className="steps-satellites" aria-label={t('参照メモ {evidenceCount}件',{evidenceCount:evidence.length})}>
          {shown.map((e,i)=>{const angle=satelliteAngles(shown.length)[i]*Math.PI/180,x=stage.x+Math.cos(angle)*330*s,y=stage.y+Math.sin(angle)*330*s;
            return <li key={e.revisionId} style={{left:x,top:y}}><button type="button" className="steps-satellite" onClick={()=>onOpenNote(e.noteId)} aria-label={t('{n}（{n2}）を開く',{n:e.text.slice(0,60),n2:label(e)})}><span className="steps-satellite-copy" aria-hidden="true" style={{width:room}}><MonoLabel>{label(e)}</MonoLabel><span>{e.text}</span></span><Drop size={9}/></button></li>;})}
          {rest>0&&<li className="steps-more" style={{left:stage.x+Math.cos(130*Math.PI/180)*330*s,top:stage.y+Math.sin(130*Math.PI/180)*330*s+44}}><button type="button" className="ghost" onClick={openRest}>+{rest}</button></li>}
        </ol>}
        <Disc size={disc} className="stage-center steps-disc" style={{left:stage.x,top:stage.y}}>
          <div className="steps-disc-copy" style={{width:Math.min(360,disc*.74)}}>
            {step?<>
              <MonoLabel>{String(index+1).padStart(2,'0')} / {step.categoryName}</MonoLabel>
              <p className="steps-text">{step.text}</p>
              <div ref={sources}><SourceLinks output={step} onOpen={onOpenNote}/></div>
              <Rating output={step} onRate={onRate}/>
              <button className="primary" onClick={()=>onStart(step)}><PlusIcon/>{t('メモを作成')}<ArrowRightIcon/></button>
            </>:<>
              <h2 className="steps-empty-title">{t('提案はまだありません')}</h2>
              <p className="steps-empty-copy">{sourceNoteCount<2?t('作成まであと{sourceNoteCount}件のメモ',{sourceNoteCount:2-sourceNoteCount}):t('まとめから提案を作れます。')}</p>
              <div className="empty-actions">{sourceNoteCount<2&&<button className="primary" onClick={onAddNote}><PlusIcon/>{t('メモを追加')}</button>}<button className={sourceNoteCount<2?'text-button':'primary'} onClick={onCollections}>{t('まとめを開く')} <ArrowRightIcon/></button></div>
            </>}
          </div>
        </Disc>
        {steps.length>1&&<div className="stage-center steps-pager" style={{left:stage.x,top:stage.y+disc/2+44}} role="group" aria-label={t('提案の切り替え')}>
          <button type="button" className="icon-button" onClick={()=>setIndex(i=>Math.max(0,i-1))} disabled={index===0} aria-label={t('前の提案')}><ChevronLeftIcon/></button>
          <MonoLabel aria-live="polite">{index+1} / {steps.length}</MonoLabel>
          <button type="button" className="icon-button" onClick={()=>setIndex(i=>Math.min(steps.length-1,i+1))} disabled={index===steps.length-1} aria-label={t('次の提案')}><ChevronRightIcon/></button>
        </div>}
        {step&&stacked&&shown.length>0&&<ol className="steps-list-narrow" style={{left:stage.x,top:stage.y+disc/2+(steps.length>1?104:40)}} aria-label={t('参照メモ {evidenceCount}件',{evidenceCount:evidence.length})}>
          {shown.map(e=><li key={e.revisionId}><button type="button" onClick={()=>onOpenNote(e.noteId)}><Drop/><MonoLabel>{label(e)}</MonoLabel><span>{e.text}</span></button></li>)}
          {rest>0&&<li><button type="button" className="ghost" onClick={openRest}>+{rest}</button></li>}
        </ol>}
      </>;
    }}</CenterStage>
  </div>;
}
