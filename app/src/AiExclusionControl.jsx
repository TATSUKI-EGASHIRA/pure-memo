import React from 'react';
import {InfoDetails} from './UiPrimitives.jsx';
import {LockClosedIcon} from '@radix-ui/react-icons';

export default function AiExclusionControl({note,pending,onChange}){
  if(note.isDemo||note.originKind==='generated')return null;
  return <section className="note-ai-policy" aria-labelledby="note-ai-policy-heading">
    <div><span id="note-ai-policy-heading"><LockClosedIcon/>AI解析の対象外</span><button className={'toggle '+(note.aiExcluded?'on':'')} role="switch" aria-label="このメモをAI解析の対象外にする" aria-checked={!!note.aiExcluded} disabled={pending} onClick={()=>onChange(note)}><i/></button></div>
    <InfoDetails label="対象外にすると"><p>{note.aiExcluded?'自動分類・まとめ・Ask・つながりの分析・カテゴリ名候補には送りません。保存・閲覧・通常検索は使えます。':'オンにすると、このメモを使ったAI結果は更新待ちになり、今後のAIの情報源から外れます。'}</p>
    <small>参照関係を追えない古いAI結果も更新待ちになる場合があります。送信済みの情報は取り消せません。URLの記事プレビュー取得はこの設定の対象外です。</small></InfoDetails>
  </section>;
}
