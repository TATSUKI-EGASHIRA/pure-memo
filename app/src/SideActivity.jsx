import React,{useEffect,useState} from 'react';
import {UpdateIcon} from '@radix-ui/react-icons';
import {t} from './i18n.js';
import {TASK_TITLES,currentLine,elapsedText,useProgressTasks} from './ProgressPanel.jsx';

const SHOWN=3;
// Work with a known size shows how far it is (1,792 / 5,000); the rest shows how long it has run.
const progressOf=task=>{const facts=task.steps.find(step=>step.id===task.current)?.facts;return facts?.total?`${Number(facts.done||0).toLocaleString()} / ${Number(facts.total).toLocaleString()}`:''};
const clock=at=>new Date(at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});

// What pure. is doing right now, at the bottom of the sidebar: each running task with its step and
// time, and what is waiting (notes to read, digests and when they are due). Opens the processing list.
export default function SideActivity({jobs=[],onOpen,compact=false}){
  const tasks=useProgressTasks();
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!tasks.length)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[tasks.length>0]);
  const waiting=jobs.filter(job=>job.state==='pending'&&job.enabled);
  const notes=waiting.filter(job=>job.kind==='classification').length;
  const digests=waiting.filter(job=>job.kind==='digest');
  const scheduled=digests.filter(job=>!job.attempts&&job.retryAfter>now).map(job=>job.retryAfter).sort((a,b)=>a-b)[0];
  const failed=jobs.filter(job=>job.state==='failed').length;
  if(!tasks.length&&!notes&&!digests.length&&!failed)return null;
  const queue=[notes?t('メモ {n}件',{n:notes}):'',digests.length?(scheduled&&digests.every(job=>!job.attempts&&job.retryAfter>now)?t('まとめ {n}件（{time}ごろ）',{n:digests.length,time:clock(scheduled)}):t('まとめ {n}件',{n:digests.length})):''].filter(Boolean).join(' · ');
  const lines=tasks.map(task=>`${t(TASK_TITLES[task.kind]||'処理中')}${task.label?` · ${task.label}`:''} — ${currentLine(task,now)}`);
  const summary=[...lines,queue?`${t('待ち')}: ${queue}`:'',failed?t('失敗 {n}件',{n:failed}):''].filter(Boolean).join('\n');
  if(compact)return <button type="button" className={'side-activity-compact'+(tasks.length?' is-busy':'')} onClick={onOpen} aria-label={`${t('処理状況')}: ${summary}`} title={summary}>
    <UpdateIcon aria-hidden="true"/>{tasks.length>0&&<b>{tasks.length}</b>}
  </button>;
  return <button type="button" className={'side-activity'+(tasks.length?' is-busy':'')} onClick={onOpen} title={t('処理状況を開く')} aria-label={`${t('処理状況')}: ${summary}`}>
    <span className="side-activity-head"><UpdateIcon aria-hidden="true"/><b>{tasks.length?t('処理中 {n}',{n:tasks.length}):t('待機中')}</b></span>
    {tasks.slice(0,SHOWN).map(task=><span key={task.id} className="side-activity-task" title={currentLine(task,now)}>
      <span className="side-activity-title">{t(TASK_TITLES[task.kind]||'処理中')}{task.label&&<em>{/^\d+$/.test(task.label)?t('{n}件',{n:task.label}):task.label}</em>}</span>
      <time>{progressOf(task)||elapsedText(now-task.startedAt)}</time>
    </span>)}
    {tasks.length>SHOWN&&<small className="side-activity-more">{t('ほか {n}件',{n:tasks.length-SHOWN})}</small>}
    {queue&&<small className="side-activity-queue">{t('待ち')}: {queue}</small>}
    {failed>0&&<small className="side-activity-failed">{t('失敗 {n}件',{n:failed})}</small>}
  </button>;
}
