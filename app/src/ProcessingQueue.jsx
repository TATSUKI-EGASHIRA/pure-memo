import React,{useEffect,useState} from 'react';
import {CheckIcon,FileTextIcon,LayersIcon,PauseIcon,ReloadIcon} from '@radix-ui/react-icons';
import './processing-queue.css';
import {InfoDetails} from './UiPrimitives.jsx';
import {t} from './i18n.js';
import {currentLine,useProgressTasks} from './ProgressPanel.jsx';

function stateLabel(job,now){
  if(job.state==='cancelled')return t('停止済み');
  if(job.state==='failed')return t('失敗');
  if(job.state==='running')return t('処理中');
  if(!job.enabled)return t('設定がオフのため待機');
  // A digest waiting for its notes to settle has not been tried yet: it shows when it is due.
  if(job.retryAfter>now&&!job.attempts)return t('{time}ごろ更新',{time:new Date(job.retryAfter).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})});
  if(job.retryAfter>now)return t('再試行まで{n}秒',{n:Math.ceil((job.retryAfter-now)/1000)});
  return t('待機中');
}
const filters=[['all','すべて'],['active','待機・処理中'],['failed','失敗'],['cancelled','停止']];
const matches=(job,filter)=>filter==='all'||(filter==='active'?['pending','running'].includes(job.state):job.state===filter);

export default function ProcessingQueue({jobs,onRefresh,onUpdate,headingId}){
  const [filter,setFilter]=useState('all'),[limit,setLimit]=useState(12),[pending,setPending]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now());
  const tasks=useProgressTasks();
  const taskFor=job=>job.state==='running'?tasks.find(task=>(job.kind==='classification'?['classify','backfill'].includes(task.kind):task.kind==='digest')&&task.ref===job.id):null;
  const hasRetry=jobs.some(job=>job.state==='pending'&&job.enabled&&job.attempts&&job.retryAfter>Date.now())||jobs.some(job=>taskFor(job));
  useEffect(()=>{
    setNow(Date.now());
    if(!hasRetry)return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[hasRetry,jobs]);
  const shown=jobs.filter(job=>matches(job,filter));
  async function perform(job,action){
    const key=job?`${job.kind}:${job.id}`:'refresh';
    setPending(key);setError('');setMessage('');
    try{
      const changed=job?await onUpdate({kind:job.kind,id:job.id,token:job.token,action}):true;
      await onRefresh();
      setMessage(job?(changed?(action==='cancel'?t('処理を停止しました。'):t('再試行を受け付けました。')):t('処理状況が変わりました。最新の一覧を表示しています。')):t('一覧を更新しました。'));
    }catch(cause){setError(cause.message)}finally{setPending('')}
  }
  const description=t('保存後の自動分類とカテゴリ分析の進み具合を確認できます。通信切断やタイムアウトなどは15秒後、60秒後に再試行し、初回を含め最大3回まで試します。');
  return <section className="processing-queue" aria-labelledby={headingId||'processing-heading'}>
    <div className="processing-head">{!headingId&&<div><span className="eyebrow">AI / BACKGROUND</span><h3 id="processing-heading">{t('処理状況')}</h3></div>}<button className="text-button" disabled={!!pending} onClick={()=>perform()}><ReloadIcon/>{t('一覧を更新')}</button></div>

    <div className="processing-filters" aria-label={t('処理状況で絞り込む')}>{filters.map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>{setFilter(value);setLimit(12)}}>{t(label)}<span>{jobs.filter(job=>matches(job,value)).length}</span></button>)}</div>
    {error&&<p className="processing-error" role="alert">{error}</p>}
    <div className="processing-message" role="status">{message&&<><CheckIcon/>{message}</>}</div>
    {shown.length?<div className="processing-grid">{shown.slice(0,limit).map(job=>{
      const Icon=job.kind==='classification'?FileTextIcon:LayersIcon;
      const key=`${job.kind}:${job.id}`;
      const canCancel=['pending','running'].includes(job.state);
      const task=taskFor(job);
      return <article className={`processing-card is-${job.state}`} key={key}>
        <div className="processing-card-head"><span><Icon/>{job.kind==='classification'?t('メモの分類'):t('カテゴリ分析')}</span><span className="processing-state"><i aria-hidden="true"/>{stateLabel(job,now)}</span></div>
        <h4>{job.title||t('文章のないメモ')}</h4>
        {task&&<p className="processing-step" role="status">{currentLine(task,now)}</p>}
        <div className="processing-meta"><span>{t('試行 {n} / 3',{n:job.attempts})}</span><span title={job.model}>{job.model}</span></div>
        {job.error&&<details className="processing-detail"><summary>{t('失敗の詳細')}</summary><p>{job.error}</p></details>}
        <div className="processing-card-foot"><small>{!job.enabled&&job.state!=='cancelled'?t('自動処理をオンにすると続行できます。'):job.state==='cancelled'?t('この処理は自動で再開しません。'):job.state==='failed'?t('原因を確認して再試行してください。'):t('元のメモは保存済みです。')}</small><button className="text-button" disabled={!!pending||(!canCancel&&!job.enabled)} onClick={()=>perform(job,canCancel?'cancel':'retry')} aria-label={t('{n}の処理を{n2}',{n:job.title||t('メモ'),n2:canCancel?t('停止'):t('再試行')})}>{canCancel?<PauseIcon/>:<ReloadIcon/>}{pending===key?t('更新中…'):canCancel?t('停止'):t('再試行')}</button></div>
      </article>;
    })}</div>:<div className="processing-empty"><CheckIcon/><strong>{jobs.length?t('この状態の処理はありません。'):t('現在、待機中の処理はありません。')}</strong></div>}
    {shown.length>limit&&<button className="text-button processing-more" onClick={()=>setLimit(value=>value+12)}>{t('さらに表示（残り{n}件）',{n:shown.length-limit})}</button>}
    <InfoDetails label={t('再試行・停止について')}><p>{description}</p><p>{t('停止すると結果は保存せず、実行中のAIに中断を要求します。送信済みの情報や利用量は取り消せません。メモの編集などで内容が変わると、新しい処理が作られます。')}</p></InfoDetails>
  </section>;
}
