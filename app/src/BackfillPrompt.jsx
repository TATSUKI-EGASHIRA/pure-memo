import React,{useState} from 'react';
import {t} from './i18n.js';

const api=window.pureDesktop;
const aiName=provider=>provider==='claude'?'Claude Code':'Codex';
const cost=estimate=>t('約{calls}回 · 約{minutes}分',{calls:estimate.calls,minutes:estimate.minutes});

// Before many existing notes are read with AI (their AI account is used for a while), the person
// chooses: all of them, the last year, or later. New notes are read as before whatever they choose.
export default function BackfillPrompt({plan,onDone}){
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  if(!plan?.needsDecision)return null;
  async function choose(value){
    setPending(value);setError('');
    try{onDone(await api.backfillDecide(value));}catch(cause){setError(cause.message);}finally{setPending('');}
  }
  return <div className="backfill-backdrop" role="presentation">
    <section className="backfill-dialog" role="dialog" aria-modal="true" aria-labelledby="backfill-title">
      <h2 id="backfill-title">{t('これまでのメモ {n}件をAIで読み込みますか？',{n:plan.unread.toLocaleString()})}</h2>
      <p>{t('読み込むと、質問への回答・プロフィール・ニュースの関心探しに、これまでのメモも使えるようになります。{ai}の利用枠を使い、終わるまで裏で動きます（サイドバーで進み具合が見えます）。',{ai:aiName(plan.provider)})}</p>
      <div className="backfill-options">
        <button type="button" className="primary" disabled={!!pending} onClick={()=>choose('all')}>
          <strong>{t('全部読む')}</strong><small>{t('{n}件',{n:plan.unread.toLocaleString()})} · {cost(plan.all)}</small></button>
        {plan.recent>0&&plan.recent<plan.unread&&<button type="button" className="secondary" disabled={!!pending} onClick={()=>choose('recent')}>
          <strong>{t('最近1年だけ')}</strong><small>{t('{n}件',{n:plan.recent.toLocaleString()})} · {cost(plan.lastYear)}</small></button>}
        <button type="button" className="text-button" disabled={!!pending} onClick={()=>choose('later')}>{t('あとで')}</button>
      </div>
      <p className="backfill-note">{t('時間は目安です。新しく書くメモはこれまで通り読み込みます。あとから設定の「処理状況」で始められます。')}</p>
      {error&&<p className="native-alert" role="alert">{error}</p>}
    </section>
  </div>;
}

// In Settings: notes not read yet (after choosing later, or the last year), with a way to read them.
export function BackfillStatus({plan,onDone}){
  const [pending,setPending]=useState(false);
  if(!plan||!plan.unread||!['later','recent'].includes(plan.decision))return null;
  return <div className="backfill-status">
    <p>{t('まだAIで読み込んでいない、これまでのメモ: {n}件',{n:plan.unread.toLocaleString()})}{plan.decision==='later'?'':` · ${t('最近1年だけ読み込みました')}`}</p>
    <button type="button" className="secondary" disabled={pending} onClick={async()=>{setPending(true);try{onDone(await api.backfillDecide(''))}finally{setPending(false)}}}>{t('読み込む…')}</button>
  </div>;
}
