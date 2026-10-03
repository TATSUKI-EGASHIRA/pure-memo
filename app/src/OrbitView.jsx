import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpIcon,PlusIcon,MagnifyingGlassIcon,TrashIcon,MixerHorizontalIcon,LightningBoltIcon} from '@radix-ui/react-icons';
import AiUsageMeter from './AiUsageMeter.jsx';
import {bodyLineLimit,layoutOrbit,memoMetrics,memoStamp,memoTag,memoText,noteNodeIds,FONTS,OUTER_RING,TICK_RINGS,NOTICE_OFFSET,CHROME} from './orbitLayout.js';
import {isComposing,shouldSaveCapture} from './captureKeyboard.js';
import {Logo} from './UiPrimitives.jsx';
import './orbit-view.css';
import {t} from './i18n.js';

const NAV=[['Notes','メモ'],['Collections','まとめ'],['Graph','つながり'],['Next Steps','提案'],['Ask','メモに質問'],['News','ニュース'],['Categories','カテゴリ']];
const pad=value=>String(value).padStart(2,'0');
const STATUS=t('このMacに保存');

let canvas=null;
function measureText(text,font){
  canvas??=document.createElement('canvas').getContext('2d');
  canvas.font=font;
  return canvas.measureText(text).width;
}

// Orbit: rings around a centre with one satellite. List: dated rows.
const OrbitIcon=()=><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.3"/><circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.6 1.6"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/><circle cx="15.1" cy="4.9" r="1.9" fill="currentColor"/></svg>;
const ListIcon=()=><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="4" cy="5.5" r="1.3" fill="currentColor"/><circle cx="4" cy="10" r="1.3" fill="currentColor"/><circle cx="4" cy="14.5" r="1.3" fill="currentColor"/><path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>;
const VIEWS=[['orbit','軌道で表示',OrbitIcon],['list','リストで表示',ListIcon]];
export function ViewSwitch({view,onChange,className='',inert}){
  return <div className={`orbit-views ${className}`} data-view={view} role="group" aria-label={t('メモの表示')} inert={inert}>
    <span className="orbit-views-knob" aria-hidden="true"/>
    {VIEWS.map(([id,label,Icon])=><button key={id} type="button" aria-pressed={view===id} aria-label={t(label)} title={t(label)} onClick={()=>onChange(id)}><Icon/></button>)}
  </div>;
}

// Lines fade out at their old position and fade in at the new one (0.4 s), so a
// finished classification visibly moves the link from 分類待ち to its category.
function useFadingLinks(links){
  const [leaving,setLeaving]=useState([]);
  const previous=useRef(links),timers=useRef([]);
  const keys=links.map(link=>link.key).join('|');
  useEffect(()=>{
    const current=new Set(links.map(link=>link.key));
    const gone=previous.current.filter(link=>!current.has(link.key));
    previous.current=links;
    if(!gone.length)return;
    setLeaving(old=>[...old.filter(link=>!current.has(link.key)),...gone]);
    timers.current.push(setTimeout(()=>setLeaving(old=>old.filter(link=>!gone.includes(link))),400));
  },[keys]);
  useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
  return leaving;
}

export default function OrbitView({activity=null,locale,notes,categories,draft,onDraftChange,onSave,canSave,busy,editing,inputRef,showAutoClassify,onAutoClassifyOff,onAttach,onPaste,freshId,active,
  onNavigate,onSearch,onNew,onList,onOpenNote,onCategories}){
  const root=useRef(null),composing=useRef(false),refocus=useRef(false);
  const [size,setSize]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
  const [fontsReady,setFontsReady]=useState(false);
  const [focus,setFocus]=useState(null),[category,setCategory]=useState(null),[resizing,setResizing]=useState(false);
  useLayoutEffect(()=>{
    const el=root.current;let timer=0,last=null;
    // While the window is resized the satellites follow at once instead of easing.
    const sync=()=>{
      const {width,height}=el.getBoundingClientRect();
      if(last&&last.width===width&&last.height===height)return;
      if(last){setResizing(true);clearTimeout(timer);timer=setTimeout(()=>setResizing(false),200)}
      last={width,height};setSize(last);
    };
    sync();const observer=new ResizeObserver(sync);observer.observe(el);return()=>{observer.disconnect();clearTimeout(timer)};
  },[]);
  useEffect(()=>{
    let current=true;
    Promise.all([document.fonts.load('600 24px "Shippori Mincho B1"'),...['400','500','600'].map(weight=>document.fonts.load(`${weight} 14px "IBM Plex Sans JP"`)),...['400','500'].map(weight=>document.fonts.load(`${weight} 14px "DM Mono"`))])
      .catch(()=>{}).then(()=>{if(current)setFontsReady(true)});
    return()=>{current=false};
  },[]);
  const statusWidth=useMemo(()=>Math.ceil(measureText(STATUS,`500 12px ${FONTS.body}`))+28,[fontsReady]);
  const layout=useMemo(()=>layoutOrbit({...size,notes,categories,measure:measureText,statusWidth}),[size,notes,categories,fontsReady,statusWidth,locale]);
  const {frame,memos,older,nodes,more,links}=layout,s=frame.s;
  const leaving=useFadingLinks(links);

  // Memo and category selection are exclusive; a memo that left the orbit is released.
  useEffect(()=>{if(focus&&!memos.some(memo=>memo.note.id===focus))setFocus(null)},[memos,focus]);
  useEffect(()=>{if(category&&!nodes.some(node=>node.id===category))setCategory(null)},[nodes,category]);
  const selecting=!!(focus||category);
  function clearSelection(){setFocus(null);setCategory(null)}
  useEffect(()=>{
    if(!active||!selecting)return;
    function key(event){if(event.key==='Escape'&&!isComposing(event))clearSelection()}
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[active,selecting]);
  useEffect(()=>{if(!busy&&refocus.current){refocus.current=false;inputRef.current?.focus()}},[busy]);

  function submit(event){
    event?.preventDefault();
    if(!canSave||busy||!draft.trim())return;
    refocus.current=true;onSave();
  }
  const lit=memo=>focus?memo.note.id===focus:category?noteNodeIds(memo.note).includes(category):true;
  const linkLit=link=>focus?link.noteId===focus:category?link.categoryId===category:true;
  const strong=link=>focus?link.noteId===focus:category?link.categoryId===category:false;
  const chars=[...draft].length;
  const inputLabel=editing?t('{chars}字 · ⌘↵で保存（編集中）',{chars:chars}):draft.trim()?t('{chars}字 · ⌘↵で軌道へ',{chars:chars}):t('{n}件 · 新しいメモ',{n:pad(notes.length)});

  return <section ref={root} className={'orbit-view'+(selecting?' is-selecting':'')+(resizing?' is-resizing':'')} aria-label={t('メモ')} style={{'--s':s,'--cx':`${frame.cx}px`,'--cy':`${frame.cy}px`}}>
    <div className="orbit-drag" aria-hidden="true"/>
    <svg className="orbit-decor" width={frame.width} height={frame.height} aria-hidden="true" focusable="false">
      {memos.map(memo=><circle key={`ring-${memo.index}`} className={'orbit-ring'+(focus===memo.note.id?' is-focus':'')} cx={frame.cx} cy={frame.cy} r={memo.r}/>)}
      <circle className="orbit-outer" cx={frame.cx} cy={frame.cy} r={OUTER_RING*s}/>
      <g className="orbit-ticks orbit-ticks-inner">
        <circle cx={frame.cx} cy={frame.cy} r={TICK_RINGS.inner*s} strokeWidth={8*s} strokeDasharray={`${1*s} ${8.63*s}`} opacity=".5"/>
        <circle cx={frame.cx} cy={frame.cy} r={TICK_RINGS.inner*s} strokeWidth={16*s} strokeDasharray={`${1.6*s} ${94.74*s}`}/>
      </g>
      <g className="orbit-ticks orbit-ticks-outer">
        <circle cx={frame.cx} cy={frame.cy} r={TICK_RINGS.outer*s} strokeWidth="1" strokeDasharray={[40,14,4,14].map(v=>v*s).join(' ')} opacity=".35"/>
      </g>
      <g className="orbit-links">
        {leaving.map(link=><line key={`out-${link.key}`} className="orbit-link is-leaving" x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}/>)}
        {links.map(link=><line key={link.key} className={'orbit-link'+(strong(link)?' is-solid':'')+(linkLit(link)?'':' is-dim')} x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}/>)}
      </g>
    </svg>

    <Logo className="orbit-brand"/>
    <nav className="orbit-nav" aria-label={t('ページ')}><ol>
      {NAV.map(([page,label],index)=><li key={page}><button type="button" aria-current={page==='Notes'?'page':undefined} onClick={()=>onNavigate(page)}><span className="orbit-nav-number">{pad(index+1)}</span><i aria-hidden="true"/><span>{t(label)}</span></button></li>)}
    </ol></nav>

    {showAutoClassify&&<p className="orbit-notice orbit-pill" style={{top:frame.cy-NOTICE_OFFSET*s}}><LightningBoltIcon aria-hidden="true"/><span>{t('自動分類 · 原文をCodexへ送信')}</span><button type="button" onClick={onAutoClassifyOff}>{t('オフにする')}</button></p>}
    <form className="orbit-input" onSubmit={submit} aria-label={editing?t('メモを編集'):t('新しいメモ')}>
      <span className="orbit-input-label" aria-hidden="true">{inputLabel}</span>
      <textarea ref={inputRef} rows={1} value={draft} disabled={busy} aria-label={t('メモの内容')} placeholder={t('メモを書く…')}
        onChange={event=>onDraftChange(event.target.value)} onPaste={onPaste}
        onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{setTimeout(()=>{composing.current=false},0)}}
        onKeyDown={event=>{if(!composing.current&&shouldSaveCapture(event))submit(event)}}/>
      <div className="orbit-input-actions">
        <button type="button" className="orbit-attach" onClick={onAttach} aria-label={t('画像や出典を追加')} title={t('画像や出典を追加')}><PlusIcon aria-hidden="true"/></button>
        <button type="submit" className="orbit-send" disabled={!canSave||busy||!draft.trim()} aria-label={t('メモを保存')}><ArrowUpIcon aria-hidden="true"/></button>
        <kbd aria-hidden="true">⌘↵</kbd>
      </div>
    </form>

    <ol className="orbit-memos" aria-label={t('新しいメモ')}>
      {memos.map(memo=>{
        const note=memo.note,focused=focus===note.id,stamp=memoStamp(note.date),text=memoText(note);
        const m=memoMetrics(frame,memo.slot,focused),base=memoMetrics(frame,memo.slot,true);
        const shift=memo.top-(memo.y-base.metaLine-base.metaGap-base.bodyLine/2);
        const top=memo.y-m.metaLine-m.metaGap-m.bodyLine/2+shift;
        const tagLabel=memoTag(note,categories);
        const toggle=()=>{setCategory(null);setFocus(focused?null:note.id)};
        return <li key={note.id} className={'orbit-memo'+(lit(memo)?'':' is-dim')+(focused?' is-focus':'')+(freshId===note.id?' is-fresh':'')}>
          <span className={`orbit-leader is-${memo.side}`} aria-hidden="true" style={{left:memo.side==='left'?memo.x-m.leaderFrom-m.leaderLength:memo.x+m.leaderFrom,top:memo.y,width:m.leaderLength}}/>
          <button type="button" className="orbit-satellite" aria-pressed={focused} aria-label={`${text.slice(0,80)}（${stamp.date} ${stamp.time}）`} onClick={toggle} style={{transform:`rotate(${memo.slot.turn}deg) translateX(${memo.r}px) rotate(${-memo.slot.turn}deg)`}}><span className="orbit-dot"/></button>
          <div key={memo.index} className={`orbit-label is-${memo.side}`} onClick={toggle} style={{left:memo.side==='left'?memo.edge-memo.maxWidth:memo.edge,top,width:memo.maxWidth,'--body':`${m.body}px`,'--meta':`${m.meta}px`,'--lines':bodyLineLimit(memo.maxWidth)}}>
            <span className="orbit-meta orbit-pill" aria-hidden="true"><span>{stamp.date} · {stamp.time}</span><span className="orbit-tag">{tagLabel}</span></span>
            <span className="orbit-body" aria-hidden="true">{text}</span>
            {focused&&<button type="button" className="orbit-open" onClick={event=>{event.stopPropagation();onOpenNote(note.id)}}>{t('メモを開く →')}</button>}
          </div>
        </li>;
      })}
    </ol>
    {older&&<button type="button" className="orbit-older" style={{left:older.x,top:older.y}} onClick={()=>onList(true)}><span className="orbit-pill"><i aria-hidden="true"/><i aria-hidden="true"/><span>{t('+{olderCount} 以前のメモ',{olderCount:older.count})}</span></span></button>}

    <ul className="orbit-categories" aria-label={t('カテゴリ')}>
      {nodes.map(node=>{
        const pressed=category===node.id;
        return <li key={node.id}><button type="button" className={`orbit-node is-${node.side} is-${node.kind}`+(category&&!pressed?' is-dim':'')} aria-pressed={pressed} aria-label={t('{name} {count}件',{name:node.name,count:node.count})}
          onClick={()=>{setFocus(null);setCategory(pressed?null:node.id)}} style={{left:node.box.left,top:node.box.top,width:node.box.right-node.box.left}}>
          <span className="orbit-node-dot" aria-hidden="true"/><span className="orbit-node-label orbit-pill" aria-hidden="true"><b>{node.name}</b><small>{node.count}</small></span>
        </button></li>;
      })}
      {more&&<li><button type="button" className={`orbit-node is-${more.side} is-more`} onClick={onCategories} aria-label={t('ほかのカテゴリ {itemsCount}件を管理',{itemsCount:more.items.length})} style={{left:more.box.left,top:more.box.top,width:more.box.right-more.box.left}}>
        <span className="orbit-node-label orbit-pill" aria-hidden="true"><b>{more.name}</b></span>
      </button></li>}
    </ul>


    <div className="orbit-top">
      <span className="orbit-status" style={{width:statusWidth}}><i aria-hidden="true"/>{STATUS}</span>
      <button type="button" className="orbit-search" onClick={onSearch} aria-label={t('メモを検索')} title={t('メモを検索 · ⌘K')}><MagnifyingGlassIcon aria-hidden="true"/><span>{t('メモを検索')}</span><kbd aria-hidden="true">⌘K</kbd></button>
      <button type="button" className="orbit-new" onClick={onNew} aria-label={t('新しいメモ')} title={t('新しいメモ · ⌘⇧N')}><PlusIcon aria-hidden="true"/></button>
    </div>
    <div className="orbit-corner">
      <button type="button" onClick={()=>onNavigate('Trash')} aria-label={t('ごみ箱')} title={t('ごみ箱')}><TrashIcon aria-hidden="true"/></button>
      <button type="button" onClick={()=>onNavigate('Settings')} aria-label={t('設定')} title={t('設定')}><MixerHorizontalIcon aria-hidden="true"/></button>
      {activity}
      <AiUsageMeter compact/>
    </div>
    <div className="orbit-legend" style={{width:CHROME.legend.width}}>
      {selecting&&<button type="button" className="orbit-clear" onClick={clearSelection}>{t('選択を解除')}</button>}
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false"><circle cx="14" cy="14" r="13" strokeDasharray="2 2.6"/><circle cx="14" cy="14" r="7.5"/><circle cx="14" cy="14" r="2.5" className="is-filled"/></svg>
      <p>{t('内側ほど新しい')}<br/>{t('点線はカテゴリ')}</p>
    </div>
  </section>;
}
