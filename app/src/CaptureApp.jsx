import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowUpIcon,CheckIcon,Cross2Icon,ImageIcon,Link2Icon,LockClosedIcon,CopyIcon,ReloadIcon} from '@radix-ui/react-icons';
import {t,setLocale} from './i18n.js';
import {LogoMark,Switch} from './UiPrimitives.jsx';
import {shouldSaveCapture} from './captureKeyboard.js';
import './fonts.css';
import './capture.css';

const api=window.pureDesktop;
const syncLocale=()=>{try{setLocale(localStorage.getItem('pure.locale')||'ja')}catch{}};
const reducedMotion=()=>{try{return localStorage.getItem('pure.motion')==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return false}};
const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};

// The panel opened by ⌘⇧N over any app: what you selected (quoted, with its source) and your own words.
function CapturePanel(){
  const [context,setContext]=useState(null),[excerpt,setExcerpt]=useState(''),[source,setSource]=useState(null),[text,setText]=useState('');
  const [attachments,setAttachments]=useState([]),[append,setAppend]=useState(false),[aiExcluded,setAiExcluded]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[access,setAccess]=useState(null),[phase,setPhase]=useState('in'),[,setTick]=useState(0);
  const input=useRef(null),root=useRef(null),composing=useRef(false);
  useEffect(()=>api.onCaptureContext(payload=>{
    syncLocale();setTick(n=>n+1);
    setContext(payload);setError('');setPhase('in');
    if(payload.selection)setExcerpt(payload.selection);
    if(payload.selection||payload.source)setSource(payload.source);
    if(payload.prefill?.text)setText(old=>old||payload.prefill.text);
    setAppend(!!payload.append);setAccess({available:payload.available,trusted:payload.trusted});
    requestAnimationFrame(()=>{input.current?.focus();const end=input.current?.value.length||0;input.current?.setSelectionRange(end,end)});
  }),[]);
  useEffect(()=>api.onCaptureDismiss(()=>dismiss()),[]);
  // The window follows the panel's height.
  useLayoutEffect(()=>{const el=root.current;if(!el)return;const observer=new ResizeObserver(()=>api.captureResize(Math.ceil(el.getBoundingClientRect().height)+24));observer.observe(el);return()=>observer.disconnect()},[]);
  function dismiss(){
    if(reducedMotion()){api.captureHide();return}
    setPhase('out');setTimeout(()=>{api.captureHide();setPhase('in')},120);
  }
  function reset(){setText('');setExcerpt('');setSource(null);setAttachments([]);setAiExcluded(false);setAppend(false)}
  const canSave=!busy&&(!!text.trim()||!!excerpt.trim()||attachments.length>0);
  async function save(){
    if(!canSave)return;
    setBusy(true);setError('');
    try{
      await api.captureSave({text,excerpt,sourceUrl:source?.url||'',sourceTitle:source?.title||'',sourceApp:source?.app||'',attachments:attachments.map(({dataBase64,mediaType,fileName})=>({dataBase64,mediaType,fileName})),append:append&&!!context?.append,aiExcluded});
      reset();
    }catch(cause){setError(String(cause.message||cause).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/,''))}
    finally{setBusy(false)}
  }
  async function attachScreenshot(){
    try{const file=await api.captureScreenshot();setAttachments(old=>[...old,{...file,preview:`data:${file.mediaType};base64,${file.dataBase64}`}].slice(0,4))}
    catch(cause){setError(String(cause.message||cause).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/,''))}
  }
  async function allow(){setAccess(await api.requestCaptureAccess())}
  const copied=context?.copied,shot=context?.screenshot;
  const offers=[
    !excerpt&&copied?.text&&{key:'text',Icon:CopyIcon,label:t('直前のコピーを引用にする'),run:()=>setExcerpt(copied.text)},
    copied?.image&&!attachments.some(a=>a.fileName==='Clipboard.png')&&{key:'image',Icon:ImageIcon,label:t('コピーした画像を添付'),run:()=>setAttachments(old=>[...old,{...copied.image,preview:`data:image/png;base64,${copied.image.dataBase64}`}].slice(0,4))},
    shot&&!attachments.some(a=>a.fileName===shot.name)&&{key:'shot',Icon:ImageIcon,label:t('スクリーンショットを添付'),run:attachScreenshot},
  ].filter(Boolean);
  const notice=context?.blocked==='secure'?t('パスワード入力中のため取り込みませんでした'):context?.blocked==='excluded'?t('このアプリからは取り込みません'):null;
  return <div className={`capture-root is-${phase}`} ref={root} role="dialog" aria-label={t('クイック入力')} onKeyDown={event=>{if(event.key==='Escape'&&!composing.current){event.preventDefault();dismiss()}}}>
    <header className="capture-head">
      <span className="capture-brand" aria-hidden="true"><LogoMark/></span>
      {source?<span className="capture-source" title={source.url||source.title}>
        <Link2Icon aria-hidden="true"/><span>{[source.app,source.title||host(source.url)].filter(Boolean).join(' · ')}</span>
        <button type="button" onClick={()=>setSource(null)} aria-label={t('出典を外す')}><Cross2Icon/></button>
      </span>:<span className="capture-source is-empty">{t('出典なし')}</span>}
      <kbd className="capture-esc" aria-hidden="true">esc</kbd>
    </header>
    {excerpt&&<figure className="capture-excerpt">
      <figcaption><span>{t('引用')}</span><button type="button" onClick={()=>setExcerpt('')} aria-label={t('引用を外す')}><Cross2Icon/></button></figcaption>
      <blockquote>{excerpt}</blockquote>
    </figure>}
    <textarea ref={input} className="capture-input" rows={excerpt?2:3} value={text} disabled={busy} aria-label={excerpt?t('ひとこと'):t('メモの内容')}
      placeholder={excerpt?t('ひとこと（なぜ残す？ 空でも保存できます）'):t('メモを書く…')} onChange={event=>setText(event.target.value)}
      onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>setTimeout(()=>{composing.current=false},0)}
      onKeyDown={event=>{if(!composing.current&&shouldSaveCapture(event)){event.preventDefault();save()}}}
      onPaste={event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
        if(!files.length)return;event.preventDefault();for(const file of files.slice(0,4)){const reader=new FileReader();reader.onload=()=>setAttachments(old=>[...old,{mediaType:file.type,fileName:file.name||'Pasted image',dataBase64:String(reader.result).split(',')[1],preview:String(reader.result)}].slice(0,4));reader.readAsDataURL(file)}}}/>
    {attachments.length>0&&<div className="capture-attachments">{attachments.map((item,index)=><figure key={index}><img src={item.preview} alt={item.fileName}/><button type="button" onClick={()=>setAttachments(old=>old.filter((_,i)=>i!==index))} aria-label={t('{name}を外す',{name:item.fileName})}><Cross2Icon/></button></figure>)}</div>}
    {offers.length>0&&<div className="capture-offers">{offers.map(({key,Icon,label,run})=><button key={key} type="button" className="capture-offer" onClick={run}><Icon aria-hidden="true"/>{label}</button>)}</div>}
    {notice&&<p className="capture-hint"><LockClosedIcon aria-hidden="true"/>{notice}</p>}
    {access&&access.available&&!access.trusted&&!notice&&<p className="capture-hint"><span>{t('選択テキストを入れるには、アクセシビリティの許可が必要です')}</span><button type="button" className="capture-link" onClick={allow}>{t('許可する')}</button></p>}
    {error&&<p className="capture-error" role="alert">{t(error)}</p>}
    <footer className="capture-foot">
      {context?.append&&<label className="capture-append"><Switch label={t('このページのメモに追記')} checked={append} onChange={()=>setAppend(!append)}/><span>{t('{minutes}分前のメモに追記',{minutes:context.append.minutes})}</span></label>}
      <label className="capture-ai"><input type="checkbox" checked={aiExcluded} onChange={event=>setAiExcluded(event.target.checked)} disabled={append&&!!context?.append}/><LockClosedIcon aria-hidden="true"/><span>{t('AI解析の対象外')}</span></label>
      <kbd className="capture-kbd" aria-hidden="true">⌘↵</kbd>
      <button type="button" className="capture-save" onClick={save} disabled={!canSave} aria-label={t('メモを保存')}>{busy?<ReloadIcon/>:<ArrowUpIcon/>}</button>
    </footer>
  </div>;
}

// The HUD after ⌥⌘⇧N: confirms the save (with undo) or says why nothing was saved.
function CaptureHud(){
  const [message,setMessage]=useState(null),[undone,setUndone]=useState(false);
  useEffect(()=>api.onCaptureHud(next=>{syncLocale();setUndone(false);setMessage(next)}),[]);
  if(!message)return null;
  return <div className={`capture-hud is-${message.kind}`} role="status">
    {message.kind==='saved'?<CheckIcon aria-hidden="true"/>:<LockClosedIcon aria-hidden="true"/>}
    <span className="capture-hud-text"><strong>{undone?t('取り消しました'):t(message.key)}</strong>{message.detail&&!undone&&<small>{message.detail}</small>}</span>
    {message.undoId&&!undone&&<button type="button" onClick={()=>{api.captureUndo(message.undoId);setUndone(true)}}>{t('取り消す')}</button>}
    {message.kind==='access'&&<button type="button" onClick={()=>api.requestCaptureAccess()}>{t('許可する')}</button>}
  </div>;
}

document.documentElement.dataset.reduced=String(reducedMotion());
createRoot(document.getElementById('root')).render(location.hash==='#hud'?<CaptureHud/>:<CapturePanel/>);
