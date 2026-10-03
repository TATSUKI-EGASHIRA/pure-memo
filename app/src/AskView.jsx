import React,{useEffect,useState} from 'react';
import {ArrowRightIcon,Link2Icon,PlusIcon,QuestionMarkCircledIcon} from '@radix-ui/react-icons';
import {PageHeading,CenterStage,Disc,Dial,Drop,MonoLabel,InfoDetails} from './UiPrimitives.jsx';
import {SourceLinks,Rating,sourceLabels} from './OutputParts.jsx';
import {t,dateLocale} from './i18n.js';

const DROP_LIMIT=60;
const EXAMPLES=['最近の興味に共通するものは？','今、どのアイデアを深めるとよさそう？'];

// S5: the disc on the hole is the question field; the ring carries one drop per target memo.
export default function AskView({askText,onAskText,onAsk,busy,canAsk,sourceNoteCount,questions,connected,onConnect,onAddNote,activity,onRate,onOpenNote}){
  const [narrow,setNarrow]=useState(()=>window.innerWidth<1200);
  useEffect(()=>{const sync=()=>setNarrow(window.innerWidth<1200);window.addEventListener('resize',sync);return()=>window.removeEventListener('resize',sync)},[]);
  const examples=(questions.length===0||!connected)&&<div className="ask-examples">{questions.length>0?null:sourceNoteCount?<><MonoLabel as="h2">{t('質問の例')}</MonoLabel>{EXAMPLES.map(example=><button key={example} className="ask-example" onClick={()=>onAskText(t(example))}>{t(example)}<ArrowRightIcon/></button>)}</>
    :<><MonoLabel as="h2">{t('まずはメモをひとつ')}</MonoLabel><button className="ask-example" onClick={onAddNote}><PlusIcon/>{t('メモを追加')}</button></>}
    {!connected&&<div className="ask-connection-line"><Link2Icon aria-hidden="true"/><span>{t('Codex · 未接続')}</span><button className="text-button" onClick={onConnect}>{t('接続する')} <ArrowRightIcon/></button></div>}</div>;
  return <div className="native-scroll ask-page">
    <PageHeading Icon={QuestionMarkCircledIcon} title={t('質問')}/>
    <CenterStage className="ask-stage">{stage=>{
      const s=stage.s,disc=440*s,ring=300*s,count=sourceNoteCount;
      const length=2*Math.PI*ring;
      const room=Math.min(340,stage.x-ring-36),below=narrow||room<240;
      return <>
        <Dial r={250*s} className="stage-center" style={{left:stage.x,top:stage.y}}/>
        <svg className="stage-center ask-ring" width={ring*2+24} height={ring*2+24} style={{left:stage.x,top:stage.y}} aria-hidden="true" focusable="false">
          {/* Over 60 memos the ring shows density with its dashes instead of drops. */}
          <circle cx={ring+12} cy={ring+12} r={ring} strokeDasharray={count>DROP_LIMIT?`2 ${Math.max(1.2,length/count-2)}`:'2 5'}/>
          {count<=DROP_LIMIT&&Array.from({length:count},(_,i)=>{const a=-Math.PI/2+i*2*Math.PI/count;return <circle key={i} className="ask-ring-drop" cx={ring+12+Math.cos(a)*ring} cy={ring+12+Math.sin(a)*ring} r="3.5"/>})}
        </svg>
        <Disc size={disc} className="stage-center ask-disc" style={{left:stage.x,top:stage.y}}>
          <div className="ask-disc-copy" style={{width:Math.min(330,disc*.76)}}>
            <MonoLabel>{t('対象のメモ · {n}件',{n:sourceNoteCount})}</MonoLabel>
            <label htmlFor="ask-input" className="sr-only">{t('質問')}</label>
            <textarea id="ask-input" className="ask-input" rows={3} value={askText} onChange={e=>onAskText(e.target.value)} placeholder={t('最近、どんな音楽が気になっている？')}/>
            <InfoDetails label={t('質問と原文 最大30件をCodexへ送信')}><p>{t('関連する原文と評価・訂正を送ります。まとめは検索の手掛かりにのみ使い、質問を好みの事実として登録しません。')}</p></InfoDetails>
            <button className="primary" onClick={onAsk} disabled={!canAsk}>{busy?t('回答を作成中…'):t('質問する')}<ArrowRightIcon/></button>
          </div>
        </Disc>
        {/* While an answer is being made, its progress takes the examples' place beside the disc. */}
        {(activity||examples)&&<div className={below?'ask-examples-wrap is-below':'ask-examples-wrap'} style={below?{left:stage.x,top:stage.y+ring+36}:{top:stage.y,width:room}}>{activity||examples}</div>}
      </>;
    }}</CenterStage>
    {questions.length>0&&<section className="ask-answers" aria-label={t('回答')}>{questions.map(q=><article className="native-answer" key={q.output_id}><MonoLabel>{new Date(q.created_at).toLocaleDateString(dateLocale(),{month:'short',day:'numeric'})}</MonoLabel><h3>{q.question}</h3><p>{q.output.text}</p>{q.output.analysis_status==="insufficient"&&<span className="native-stale">{t('根拠となるメモが不足しています')}</span>}{q.output.limitation&&<p className="native-limitation">{q.output.limitation}</p>}{q.output.status!=="current"&&<span className="native-stale">{t('元のメモが変わった回答')}</span>}<SourceLinks output={q.output} onOpen={onOpenNote}/>{q.output.claims?.length>0&&<InfoDetails className="answer-claims" label={t('回答の根拠 · {claimsCount}',{claimsCount:q.output.claims.length})} Icon={Link2Icon}>{q.output.claims.map(claim=><div className="answer-claim" key={claim.id}><small>{claim.kind} / {claim.speaker}{claim.period?` / ${claim.period}`:''}</small><p>{claim.text}</p><div>{claim.sources.map(source=><button key={source.revisionId} onClick={()=>onOpenNote(source.noteId)}><Link2Icon/>{t(sourceLabels[source.sourceKind]||'メモ')} · {source.text.slice(0,85)}{source.text.length>85?'…':''}</button>)}</div></div>)}</InfoDetails>}<Rating output={q.output} onRate={onRate}/></article>)}</section>}
  </div>;
}
