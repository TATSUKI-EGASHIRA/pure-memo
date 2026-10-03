import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {CheckIcon} from '@radix-ui/react-icons';
import {t,getLocale} from './i18n.js';

// What a wait is doing right now, as reported by the main process (desktop/progress.cjs): the real
// steps, what is known about each (counts, characters), and how long each took. No percentages.
let tasks=[];
const listeners=new Set();
let subscribed=false;
function connect(){
  if(subscribed||!window.pureDesktop?.onProgress)return;
  subscribed=true;
  const set=next=>{tasks=Array.isArray(next)?next:[];listeners.forEach(listener=>listener())};
  window.pureDesktop.onProgress(set);
  window.pureDesktop.progressList?.().then(set,()=>{});
}
function subscribe(listener){connect();listeners.add(listener);return()=>listeners.delete(listener)}
const snapshot=()=>tasks;
export const useProgressTasks=()=>useSyncExternalStore(subscribe,snapshot);
export function useProgressTask(kind,ref){
  const all=useProgressTasks();
  return all.find(task=>task.kind===kind&&(ref===undefined||task.ref===ref))||null;
}

// Ticks once a second while something is running, so elapsed times stay current.
function useNow(active){
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);
  return now;
}

const number=value=>Number(value||0).toLocaleString(getLocale()==='en'?'en-US':'ja-JP');
function seconds(ms){
  const s=Math.max(0,ms)/1000;
  if(s<10)return t('{s}秒',{s:s.toFixed(1)});
  if(s<60)return t('{s}秒',{s:Math.floor(s)});
  return t('{m}分{s}秒',{m:Math.floor(s/60),s:Math.floor(s%60)});
}

export const TASK_TITLES={analyze:'まとめを作成中',ask:'回答を作成中',suggest:'候補を作成中',memory:'関連を探しています',classify:'分類中',backfill:'メモを読み込み中',digest:'まとめを更新中',article:'リンク先を読み込み中',news:'ニュースを集めています',profile:'プロフィールを更新中',index:'検索の準備中'};
const STEP_LABELS={search:'メモを検索',gather:'原文を集める',connect:'Codexに接続',send:'送信',think:'考えている',write:'書いている',check:'根拠を照合',verify:'根拠を検証',save:'保存',fetch:'ページを取得',interests:'メモから関心を探す',feeds:'ニュースを取得',web:'Webを検索',links:'リンクを確認',filter:'関心との関係を確認',translate:'翻訳',embed:'このMacで作成'};
export const stepLabel=id=>t(STEP_LABELS[id]||id);

// One line per known fact; facts that were never reported are not shown.
function stepDetail(step,task){
  const f=step.facts||{};
  const parts=[];
  switch(step.id){
    case 'search':
      if(f.embedTotal&&(f.embedDone??0)<f.embedTotal)parts.push(t('新しいメモの検索用データを作成 {done} / {total}件',{done:number(f.embedDone),total:number(f.embedTotal)}));
      if(f.found!=null)parts.push(t('{searched}件から{found}件を選びました',{searched:number(f.searched),found:number(f.found)}),f.semantic?t('意味と語句で検索'):t('語句で検索'));
      else if(f.searched!=null)parts.push(t('{n}件のメモから探しています',{n:number(f.searched)}));
      if(f.viaDigest)parts.push(t('まとめ経由 {n}件',{n:f.viaDigest}));
      break;
    case 'embed':
      if(f.total)parts.push(t('{done} / {total}件',{done:number(f.done??0),total:number(f.total)}));
      break;
    case 'gather':
      if(f.topics)parts.push(t('{n}件のトピック',{n:f.topics}));
      if(f.notes!=null)parts.push(t('原文 {n}件',{n:number(f.notes)}));
      if(f.articles)parts.push(t('リンク先の本文 {n}件',{n:f.articles}));
      if(f.feedback)parts.push(t('評価と訂正 {n}件',{n:f.feedback}));
      break;
    case 'send':
      if(f.chars)parts.push(t('約{n}文字',{n:number(f.chars)}));
      if(f.model)parts.push(f.effort?`${f.model} · ${f.effort}`:f.model);
      break;
    case 'think':
      if(f.phase==='waiting')parts.push(t('応答を待っています'));
      if(f.phase==='reasoning')parts.push(t('推論しています'));
      break;
    case 'write':
      if(task.written)parts.push(t('{n}文字',{n:number(task.written)}));
      break;
    case 'check':
      if(f.suggestions!=null)parts.push(t('候補 {n}件',{n:f.suggestions}));
      if(f.evidence!=null)parts.push(t('根拠の原文 {n}件',{n:f.evidence}));
      if(f.claims)parts.push(t('主張 {n}件',{n:f.claims}));
      break;
    case 'interests':
      if(f.reused)parts.push(t('メモが変わっていないので前回の結果を使います'));
      else if(f.notes)parts.push(t('メモ {n}件を読んでいます',{n:f.notes}));
      if(f.found!=null&&!f.reused)parts.push(t('{n}個見つかりました',{n:f.found}));
      break;
    case 'feeds':
      if(f.topics)parts.push(t('{n}語',{n:f.topics}));
      if(f.found!=null)parts.push(t('{n}件見つかりました',{n:number(f.found)}));
      break;
    case 'links':
      if(f.candidates!=null)parts.push(t('候補 {n}件',{n:f.candidates}));
      if(f.kept!=null)parts.push(t('{n}件を確認しました',{n:f.kept}));
      break;
    case 'filter':
      if(f.items!=null)parts.push(t('{n}件',{n:f.items}));
      if(f.dropped)parts.push(t('{n}件を除外',{n:f.dropped}));
      break;
    case 'verify':
      if(f.checked)parts.push(t('{n}項目を確認',{n:f.checked}));
      if(f.removed)parts.push(t('{n}項目を除外',{n:f.removed}));
      break;
    case 'translate':
      if(f.titles)parts.push(t('見出し {n}件',{n:f.titles}));
      break;
    case 'save':
      if(f.added!=null)parts.push(t('{n}件を追加',{n:f.added}));
      if(f.categories!=null)parts.push(f.categories?t('{n}件のカテゴリへ',{n:f.categories}):t('当てはまるカテゴリなし'));
      break;
    case 'fetch':
      if(f.host)parts.push(f.host);
      break;
  }
  return parts.join(' · ');
}

// Reasoning summaries come as markdown-ish text; only the newest part is shown, without the markup.
const thoughtText=text=>String(text||'').replace(/\*\*/g,'').trim().split(/\n{2,}/).pop().slice(-240);

export {seconds as elapsedText};
export function currentLine(task,now=Date.now()){
  const step=task.steps.find(item=>item.id===task.current);
  if(!step)return t(TASK_TITLES[task.kind]||'処理中');
  const detail=stepDetail(step,task);
  return [stepLabel(step.id),detail,seconds(now-(step.startedAt||task.startedAt))].filter(Boolean).join(' · ');
}

// The full view for waits the user started (まとめ, 質問, 候補, 関連). `fallback` is shown until the
// first report arrives, so the wait is never blank. As steps are added it keeps itself in view, unless
// the reader has scrolled it away.
export function ProgressPanel({task,fallback,className=''}){
  const now=useNow(!!task),root=useRef(null),shown=useRef(false);
  const step=task?.current||'';
  useEffect(()=>{
    const el=root.current;if(!el)return;
    const box=el.getBoundingClientRect();
    if(shown.current&&(box.top>=window.innerHeight||box.bottom<=0))return;
    shown.current=true;
    el.scrollIntoView({block:'nearest',behavior:document.documentElement.dataset.reduced==='true'?'auto':'smooth'});
  },[step]);
  if(!task)return <div ref={root} className={`progress-panel is-starting ${className}`} role="status"><div className="progress-head"><span className="progress-pulse" aria-hidden="true"/><strong>{fallback}</strong></div></div>;
  const currentIndex=task.steps.findIndex(step=>step.id===task.current);
  const thought=thoughtText(task.thought);
  return <div ref={root} className={`progress-panel ${className}`} role="status" aria-live="polite">
    <div className="progress-head"><span className="progress-pulse" aria-hidden="true"/><strong>{t(TASK_TITLES[task.kind]||'処理中')}</strong>{task.label&&<span className="progress-label">{task.label}</span>}<time>{seconds(now-task.startedAt)}</time></div>
    <ol className="progress-steps">{task.steps.map((step,index)=>{
      const state=index<currentIndex?'done':index===currentIndex?'current':'pending';
      const detail=state==='pending'?'':stepDetail(step,task);
      const took=state==='done'&&step.startedAt&&step.endedAt?step.endedAt-step.startedAt:null;
      return <li key={step.id} className={`is-${state}`} aria-current={state==='current'?'step':undefined}>
        <span className="progress-mark" aria-hidden="true">{state==='done'?<CheckIcon/>:<i/>}</span>
        <span className="progress-step-label">{stepLabel(step.id)}</span>
        {detail&&<span className="progress-step-detail">{detail}</span>}
        {state==='current'?<time>{seconds(now-(step.startedAt||task.startedAt))}</time>:took!=null&&took>=100?<time>{seconds(took)}</time>:null}
      </li>;
    })}</ol>
    {thought&&task.current==='think'&&<p className="progress-thought"><span>{t('Codexの考え')}</span>{thought}</p>}
  </div>;
}

// Background work as one line each (分類 / まとめの更新 / リンク先の読み込み).
export function BackgroundProgress({tasks:list,fallback}){
  const now=useNow(list.length>0);
  if(!list.length)return fallback?<div className="progress-inline" role="status"><span className="progress-pulse" aria-hidden="true"/><span>{fallback}</span></div>:null;
  return <div className="progress-inline-list" role="status" aria-live="polite">{list.map(task=><div className="progress-inline" key={task.id}>
    <span className="progress-pulse" aria-hidden="true"/>
    <strong>{t(TASK_TITLES[task.kind]||'処理中')}</strong>
    {task.label&&<span className="progress-label">{task.label}</span>}
    <span className="progress-inline-step">{currentLine(task,now)}</span>
  </div>)}</div>;
}
