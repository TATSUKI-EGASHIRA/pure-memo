import React,{useEffect,useState} from 'react';
import {CheckIcon,FileTextIcon,LayersIcon,PauseIcon,ReloadIcon} from '@radix-ui/react-icons';
import './processing-queue.css';

function stateLabel(job,now){
  if(job.state==='cancelled')return '停止済み';
  if(job.state==='failed')return '失敗';
  if(job.state==='running')return '処理中';
  if(!job.enabled)return '設定がオフのため待機';
  if(job.retryAfter>now)return `再試行まで${Math.ceil((job.retryAfter-now)/1000)}秒`;
  return '待機中';
}
const filters=[['all','すべて'],['active','待機・処理中'],['failed','失敗'],['cancelled','停止']];
const matches=(job,filter)=>filter==='all'||(filter==='active'?['pending','running'].includes(job.state):job.state===filter);

export default function ProcessingQueue({jobs,onRefresh,onUpdate}){
  const [filter,setFilter]=useState('all'),[limit,setLimit]=useState(12),[pending,setPending]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now());
  const hasRetry=jobs.some(job=>job.state==='pending'&&job.enabled&&job.retryAfter>Date.now());
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
      setMessage(job?(changed?(action==='cancel'?'処理を停止しました。':'再試行を受け付けました。'):'処理状況が変わりました。最新の一覧を表示しています。'):'一覧を更新しました。');
    }catch(cause){setError(cause.message)}finally{setPending('')}
  }
  return <section className="processing-queue" aria-labelledby="processing-heading">
    <div className="processing-head"><div><span className="eyebrow">AI / BACKGROUND</span><h3 id="processing-heading">AIの処理状況</h3></div><button className="text-button" disabled={!!pending} onClick={()=>perform()}><ReloadIcon/>一覧を更新</button></div>
    <p>保存後の自動分類とカテゴリ分析の進み具合を確認できます。通信切断やタイムアウトなどは15秒後、60秒後に再試行し、初回を含め最大3回まで試します。</p>
    <div className="processing-filters" aria-label="処理状況で絞り込む">{filters.map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>{setFilter(value);setLimit(12)}}>{label}<span>{jobs.filter(job=>matches(job,value)).length}</span></button>)}</div>
    {error&&<p className="processing-error" role="alert">{error}</p>}
    <div className="processing-message" role="status">{message&&<><CheckIcon/>{message}</>}</div>
    {shown.length?<div className="processing-grid">{shown.slice(0,limit).map(job=>{
      const Icon=job.kind==='classification'?FileTextIcon:LayersIcon;
      const key=`${job.kind}:${job.id}`;
      const canCancel=['pending','running'].includes(job.state);
      return <article className={`processing-card is-${job.state}`} key={key}>
        <div className="processing-card-head"><span><Icon/>{job.kind==='classification'?'メモの分類':'カテゴリ分析'}</span><span className="processing-state"><i aria-hidden="true"/>{stateLabel(job,now)}</span></div>
        <h4>{job.title||'文章のないメモ'}</h4>
        <div className="processing-meta"><span>試行 {job.attempts} / 3</span><span title={job.model}>{job.model}</span></div>
        {job.error&&<details className="processing-detail"><summary>失敗の詳細</summary><p>{job.error}</p></details>}
        <div className="processing-card-foot"><small>{!job.enabled&&job.state!=='cancelled'?'自動処理をオンにすると続行できます。':job.state==='cancelled'?'この処理は自動で再開しません。':job.state==='failed'?'原因を確認して再試行してください。':'元のメモは保存済みです。'}</small><button className="text-button" disabled={!!pending||(!canCancel&&!job.enabled)} onClick={()=>perform(job,canCancel?'cancel':'retry')} aria-label={`${job.title||'メモ'}の処理を${canCancel?'停止':'再試行'}`}>{canCancel?<PauseIcon/>:<ReloadIcon/>}{pending===key?'更新中…':canCancel?'停止':'再試行'}</button></div>
      </article>;
    })}</div>:<div className="processing-empty"><CheckIcon/><strong>{jobs.length?'この状態の処理はありません。':'現在、待機中の処理はありません。'}</strong><span>メモの保存・検索はいつでも使えます。</span></div>}
    {shown.length>limit&&<button className="text-button processing-more" onClick={()=>setLimit(value=>value+12)}>さらに表示（残り{shown.length-limit}件）</button>}
    <p className="processing-note">停止すると結果は保存せず、実行中のAIに中断を要求します。送信済みの情報や利用量は取り消せません。メモの編集などで内容が変わると、新しい処理が作られます。</p>
  </section>;
}
