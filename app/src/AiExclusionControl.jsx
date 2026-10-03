import React from 'react';
import {InfoDetails,Switch} from './UiPrimitives.jsx';
import {LockClosedIcon} from '@radix-ui/react-icons';
import {t} from './i18n.js';

export default function AiExclusionControl({note,pending,onChange}){
  if(note.isDemo||note.originKind==='generated')return null;
  return <section className="note-ai-policy" aria-labelledby="note-ai-policy-heading">
    <div><span id="note-ai-policy-heading"><LockClosedIcon/>{t('AI解析の対象外')}</span><Switch label={t('このメモをAI解析の対象外にする')} checked={!!note.aiExcluded} disabled={pending} onChange={()=>onChange(note)}/></div>
    <InfoDetails label={t('対象外にすると')}><p>{note.aiExcluded?t('自動分類・まとめ・Ask・つながりの分析・カテゴリ名候補には送りません。保存・閲覧・通常検索は使えます。'):t('オンにすると、このメモを使ったAI結果は更新待ちになり、今後のAIの情報源から外れます。')}</p>
    <small>{t('参照関係を追えない古いAI結果も更新待ちになる場合があります。送信済みの情報は取り消せません。URLの記事プレビュー取得はこの設定の対象外です。')}</small></InfoDetails>
  </section>;
}
