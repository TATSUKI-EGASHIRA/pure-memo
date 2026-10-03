import React,{useEffect,useRef,useState} from 'react';
import {ReloadIcon,BarChartIcon} from '@radix-ui/react-icons';
import {t,dateLocale} from './i18n.js';

const api=window.pureDesktop;
const WINDOW_LABELS={five_hour:'5時間',seven_day:'週'};
const PURPOSE_LABELS={digest:'まとめの更新',classify:'分類','classify-link':'リンクの読み取り','memory-backfill':'記憶の読み込み',profile:'プロフィール',collection:'まとめ',ask:'質問',
  'verify-collection':'まとめの検証','verify-ask':'回答の検証',suggest:'カテゴリ候補',memory:'関連を探す',interests:'関心探し','interests-related':'関連の言葉',
  'news-search':'ニュースのWeb検索','news-filter':'ニュースの確認','news-translate':'見出しの翻訳'};
const percent=value=>`${value}%`;
const tokens=value=>value>=1000000?`${(value/1000000).toFixed(1)}M`:value>=1000?`${Math.round(value/1000)}k`:String(value);
function until(resetsAt){
  if(!resetsAt)return '';
  const minutes=Math.max(0,Math.round((resetsAt*1000-Date.now())/60000));
  if(minutes<1)return t('まもなくリセット');
  if(minutes<60)return t('{m}分後にリセット',{m:minutes});
  if(minutes<48*60)return t('{h}時間{m}分後にリセット',{h:Math.floor(minutes/60),m:minutes%60});
  return t('{d}日後にリセット',{d:Math.round(minutes/1440)});
}
function ago(at){
  const minutes=Math.max(0,Math.round((Date.now()-Date.parse(at))/60000));
  if(minutes<1)return t('たった今');
  if(minutes<60)return t('{m}分前',{m:minutes});
  if(minutes<48*60)return t('{h}時間前',{h:Math.round(minutes/60)});
  return new Date(at).toLocaleDateString(dateLocale(),{month:'numeric',day:'numeric'});
}
const Bar=({value})=><span className="ai-usage-bar" aria-hidden="true"><i style={{width:`${Math.min(100,value)}%`}} data-level={value>=90?'high':value>=70?'mid':'low'}/></span>;

// How much of the connected AI accounts is used, at the bottom of the sidebar. Opening it shows each
// window's reset and what pure. itself used, by purpose.
// `compact`: only an icon (the memo orbit's corner); the details are the same.
export default function AiUsageMeter({compact=false}){
  const [usage,setUsage]=useState(null),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[range,setRange]=useState('today');
  const box=useRef(null);
  const load=(refresh=false)=>{setLoading(true);return api?.aiUsage?.({refresh}).then(setUsage).catch(()=>{}).finally(()=>setLoading(false));};
  useEffect(()=>{
    if(!api?.aiUsage)return;
    load();
    const timer=setInterval(()=>load(),5*60*1000);
    const off=api.onAiUsageChanged?.(()=>load());
    return ()=>{clearInterval(timer);off?.()};
  },[]);
  useEffect(()=>{
    if(!open)return;
    load(true);
    const close=event=>{if(event.key==='Escape'||(event.type==='pointerdown'&&!box.current?.contains(event.target)))setOpen(false)};
    window.addEventListener('pointerdown',close);window.addEventListener('keydown',close);
    return ()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',close)};
  },[open]);
  if(!usage)return null;
  const shown=usage.providers.filter(provider=>provider.connected);
  const mine=usage[range];
  const highest=Math.max(0,...shown.flatMap(provider=>provider.windows.map(window=>window.usedPercent)));
  const summary=shown.map(provider=>`${provider.name} ${provider.windows.map(window=>`${t(WINDOW_LABELS[window.id]||window.id)} ${percent(window.usedPercent)}`).join(' · ')||t('未確認')}`).join(' / ');
  return <div className={'ai-usage'+(compact?' is-compact':'')} ref={box}>
    {compact?<button type="button" className="ai-usage-compact" aria-expanded={open} aria-label={`${t('AIの使用量')}: ${summary}`} title={`${t('AIの使用量')}\n${summary}`} onClick={()=>setOpen(!open)}
      data-level={highest>=90?'high':highest>=70?'mid':'low'}><BarChartIcon aria-hidden="true"/></button>
    :<button type="button" className="ai-usage-summary" aria-expanded={open} aria-label={t('AIの使用量')} title={t('AIの使用量')} onClick={()=>setOpen(!open)}>
      <BarChartIcon className="ai-usage-icon" aria-hidden="true"/>
      {/* One line per account: its name, the 5-hour and weekly use, and a bar for the higher of the two. */}
      <span className="ai-usage-rows">{shown.length?shown.map(provider=>{
        const most=Math.max(0,...provider.windows.map(window=>window.usedPercent));
        return <span key={provider.id} className="ai-usage-row" title={provider.windows.map(window=>`${t(WINDOW_LABELS[window.id]||window.id)} ${percent(window.usedPercent)}`).join(' · ')}>
          <span className="ai-usage-line"><b>{provider.name}</b>{provider.windows.length?<em>{provider.windows.map(window=>percent(window.usedPercent)).join(' · ')}</em>:<small className="ai-usage-unknown">{t('未確認')}</small>}</span>
          {provider.windows.length>0&&<Bar value={most}/>}
        </span>;
      }):<span className="ai-usage-row"><small className="ai-usage-unknown">{t('AI未接続')}</small></span>}</span>
    </button>}
    {open&&<div className="ai-usage-panel" role="dialog" aria-label={t('AIの使用量')}>
      <header><h3>{t('AIの使用量')}</h3><button type="button" className="ai-usage-refresh" onClick={()=>load(true)} disabled={loading} aria-label={t('更新')} title={t('更新')}><ReloadIcon/></button></header>
      {usage.providers.map(provider=><section key={provider.id} className="ai-usage-provider">
        <div className="ai-usage-provider-head"><strong>{provider.name}</strong>{provider.id===usage.provider&&<span className="ai-usage-current">{t('使用中')}</span>}{provider.plan&&<small>{provider.plan}</small>}</div>
        {!provider.connected?<p className="ai-usage-note">{t('接続されていません。')}</p>
          :provider.windows.length?<>{provider.windows.map(window=><div key={window.id} className="ai-usage-detail">
            <span>{t(WINDOW_LABELS[window.id]||window.id)}</span><Bar value={window.usedPercent}/><em>{percent(window.usedPercent)}</em><small>{until(window.resetsAt)}</small></div>)}
            {provider.limited&&<p className="ai-usage-note is-alert">{t('上限に達しています。リセットまでAIの処理は失敗します。')}</p>}
            {provider.id==='claude'&&provider.checkedAt&&<p className="ai-usage-note">{t('{when}の値（Claude Codeは処理したときだけ使用量を返します）',{when:ago(provider.checkedAt)})}</p>}</>
          :<p className="ai-usage-note">{provider.id==='claude'?t('まだ確認していません。Claude Codeで処理すると表示されます。'):t('使用量を読めませんでした。')}</p>}
      </section>)}
      <section className="ai-usage-mine">
        <div className="ai-usage-provider-head"><strong>{t('pure.が使った分')}</strong>
          <span className="ai-usage-range" role="group" aria-label={t('期間')}>{[['today','今日'],['week','7日間']].map(([id,label])=><button key={id} type="button" aria-pressed={range===id} onClick={()=>setRange(id)}>{t(label)}</button>)}</span></div>
        <p className="ai-usage-totals">{t('{calls}回 · 入力 {input} · 出力 {output} トークン',{calls:mine.calls,input:tokens(mine.input),output:tokens(mine.output)})}{mine.errors?` · ${t('失敗 {n}回',{n:mine.errors})}`:''}</p>
        {mine.byPurpose.length?<ul>{mine.byPurpose.map(entry=><li key={entry.purpose}><span>{t(PURPOSE_LABELS[entry.purpose]||entry.purpose)}</span><small>{t('{n}回',{n:entry.calls})}</small><small>{tokens(entry.input+entry.output)}</small></li>)}</ul>
          :<p className="ai-usage-note">{t('この期間にAIは使っていません。')}</p>}
        <p className="ai-usage-note">{t('アカウントの使用率には、他のアプリやターミナルで使った分も含まれます。pure.の数字はこのMacの記録です。')}</p>
      </section>
    </div>}
  </div>;
}
