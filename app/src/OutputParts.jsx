import React,{useEffect,useState} from 'react';
import {CheckIcon,Cross2Icon,Link2Icon} from '@radix-ui/react-icons';
import {InfoDetails} from './UiPrimitives.jsx';
import {t} from './i18n.js';

// Evidence links and Good/Bad rating shared by まとめ, 提案 and 質問.
export const sourceLabels={unspecified:'メモ',thought:'自分の考え',reference:'参考資料',quote:'引用'};
export function SourceLinks({output,onOpen}){if(!output?.evidence?.length)return null;return <InfoDetails className="source-disclosure" Icon={Link2Icon} label={t('参照メモ · {evidenceCount}',{evidenceCount:output.evidence.length})}><div className="native-sources">{output?.evidence?.map(e=><button key={e.revisionId} onClick={()=>onOpen(e.noteId)}><Link2Icon/><span>{e.text.slice(0,90)}{e.text.length>90?'…':''}</span><small>{e.valid?t(sourceLabels[e.sourceKind]||'メモ').toUpperCase():t('以前の版')}</small></button>)}</div></InfoDetails>}
export function Rating({output,onRate}){
  const [reason,setReason]=useState(output?.rating?.rating==='bad'?output.rating.reason||'':'');
  const [comment,setComment]=useState(output?.rating?.rating==='bad'?output.rating.comment||'':'');
  useEffect(()=>{setReason(output?.rating?.rating==='bad'?output.rating.reason||'':'');setComment(output?.rating?.rating==='bad'?output.rating.comment||'':'')},[output?.id,output?.rating?.rating,output?.rating?.reason,output?.rating?.comment]);
  if(!output)return null;
  const sameBad=output.rating?.rating==='bad'&&output.rating.reason===reason&&(output.rating.comment||'')===comment;
  return <div className="native-rating" role="group" aria-label={t('回答の評価')}><button className={output.rating?.rating==='good'?'on':''} aria-pressed={output.rating?.rating==='good'} onClick={()=>onRate(output,output.rating?.rating==='good'?'clear':'good','','')}><CheckIcon/>{t('役に立った')}</button><button className={output.rating?.rating==='bad'?'on bad':''} aria-pressed={output.rating?.rating==='bad'} onClick={()=>onRate(output,sameBad?'clear':'bad',sameBad?'':reason,sameBad?'':comment)}><Cross2Icon/>{output.rating?.rating==='bad'&&!sameBad?t('評価を更新'):t('合わない')}</button>{output.rating?.rating==='bad'&&<><select value={reason} onChange={e=>setReason(e.target.value)} aria-label={t('合わない理由')}><option value="">{t('理由（任意）')}</option><option value="incorrect">{t('内容が違う')}</option><option value="not-my-taste">{t('好みと違う')}</option><option value="not-now">{t('今は必要ない')}</option><option value="too-vague">{t('曖昧すぎる')}</option><option value="repeated">{t('前にも見た')}</option></select>{reason==='incorrect'&&<input className="native-correction" value={comment} onChange={e=>setComment(e.target.value)} maxLength={500} placeholder={t('訂正を書く（任意）')} aria-label={t('訂正')}/>}</>}</div>
}
