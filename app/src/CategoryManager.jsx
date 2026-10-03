import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ArchiveIcon,ArrowRightIcon,BookmarkIcon,BorderSplitIcon,DotsHorizontalIcon,Pencil1Icon,PlusIcon,StackIcon} from '@radix-ui/react-icons';
import {PageHeading,InfoDetails,Drop,MonoLabel} from './UiPrimitives.jsx';
import {t} from './i18n.js';

const BUBBLE_LIMIT=8,BUBBLE_AREA={width:266,gap:10};

// Split, merge and archive live behind "…": visible on row hover or focus, and fully keyboard operable.
function RowMenu({category,canSplit,canMerge,onSplit,onMerge,onArchive}){
  const [open,setOpen]=useState(false);
  const button=useRef(null),menu=useRef(null);
  const items=()=>[...(menu.current?.querySelectorAll('[role=menuitem]:not(:disabled)')||[])];
  useEffect(()=>{
    if(!open)return;
    items()[0]?.focus();
    const away=event=>{if(!menu.current?.contains(event.target)&&!button.current?.contains(event.target))setOpen(false)};
    document.addEventListener('pointerdown',away);return()=>document.removeEventListener('pointerdown',away);
  },[open]);
  function close(){setOpen(false);button.current?.focus()}
  function key(event){
    const list=items(),index=list.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
    else if(event.key==='ArrowDown'){event.preventDefault();list[(index+1)%list.length]?.focus()}
    else if(event.key==='ArrowUp'){event.preventDefault();list[(index-1+list.length)%list.length]?.focus()}
    else if(event.key==='Tab')setOpen(false);
  }
  // After an action the focus returns to "…" so keyboard users stay on the row.
  const run=fn=>()=>{setOpen(false);fn();requestAnimationFrame(()=>button.current?.focus())};
  return <div className={'manager-menu'+(open?' is-open':'')}>
    <button ref={button} type="button" className="icon-button" aria-haspopup="menu" aria-expanded={open} aria-label={t('{name}の操作',{name:category.name})} title={t('分割・統合・アーカイブ')} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(event.key==='ArrowDown'&&!open){event.preventDefault();setOpen(true)}}}><DotsHorizontalIcon/></button>
    {open&&<div ref={menu} className="manager-menu-list" role="menu" aria-label={t('{name}の操作',{name:category.name})} onKeyDown={key}>
      <button type="button" role="menuitem" disabled={!canSplit} onClick={run(onSplit)}><BorderSplitIcon/>{t('分割')}</button>
      <button type="button" role="menuitem" disabled={!canMerge} onClick={run(onMerge)}><StackIcon/>{t('統合')}</button>
      <button type="button" role="menuitem" onClick={run(onArchive)} aria-label={t('{name}をアーカイブ',{name:category.name})}><ArchiveIcon/>{t('アーカイブ')}</button>
    </div>}
  </div>;
}

// Area-true circles: r = 70 × √(count ÷ max) × s, packed first-fit from the top.
export function packBubbles(items,s){
  const max=Math.max(1,...items.map(item=>item.count)),placed=[];
  for(const item of [...items].sort((a,b)=>b.count-a.count).slice(0,BUBBLE_LIMIT)){
    const r=70*Math.sqrt(item.count/max)*s;
    let spot=null;
    for(let y=r;!spot&&y<2000;y+=4)for(let x=r;x<=BUBBLE_AREA.width-r;x+=4){
      if(placed.every(p=>Math.hypot(p.x-x,p.y-y)>=p.r+r+BUBBLE_AREA.gap)){spot={x,y};break}
    }
    placed.push({...item,r,...spot});
  }
  return placed;
}

export default function CategoryManager(props){
  const {categories,managedNotes,managedOther,expanded,onExpand,renameId,renameName,onRenameName,onStartRename,onCancelRename,onRename,splitSourceId,onToggleSplit,renderSplit,mergeSourceId,onToggleMerge,mergeTargetId,onMergeTarget,onMerge,onCancelMerge,onArchive,onRestore,onUnassign,onAssign,onCreate,onOpen,busy,merges,splits,archived}=props;
  const own=categories.filter(c=>!['all','other'].includes(c.id));
  const [frame,setFrame]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
  useEffect(()=>{const sync=()=>setFrame({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',sync);return()=>window.removeEventListener('resize',sync)},[]);
  const s=Math.min(frame.width/1440,frame.height/900);
  const bubbles=useMemo(()=>packBubbles(own.filter(c=>c.count>0),s),[own.map(c=>`${c.id}:${c.count}:${c.name}`).join('|'),s]);
  const showBubbles=frame.width>=1200&&bubbles.length>0;
  return <div className={'native-scroll categories-page'+(showBubbles?' has-bubbles':'')}>
    <PageHeading Icon={BookmarkIcon} title={t('カテゴリ')} meta={t('{ownCount}件',{ownCount:own.length})}/>
    <div className="category-manager">
      <div className="category-manager-head"><h2>{t('一覧')}</h2><button className="primary" onClick={onCreate}><PlusIcon/>{t('カテゴリを作成')}</button></div>
      <div className="manager-list">{own.map(c=><article className="manager-category" key={c.id}>
        <div className="manager-row">
          <button className="manager-name" aria-expanded={expanded===c.id} onClick={()=>onExpand(expanded===c.id?null:c.id)}><Drop/><span>{c.name}</span><MonoLabel>{t('{n}件',{n:c.count})}</MonoLabel></button>
          <div className="manager-actions">
            <button type="button" className="icon-button" onClick={()=>onOpen(c.id)} aria-label={t('{name}のまとめを開く',{name:c.name})} title={t('開く')}><ArrowRightIcon/></button>
            <button type="button" className="icon-button" onClick={()=>onStartRename(c)} aria-label={t('{name}の名前を変更',{name:c.name})} title={t('名前を変更')}><Pencil1Icon/></button>
            <RowMenu category={c} canSplit={c.count>=2} canMerge={own.length>=2} onSplit={()=>onToggleSplit(c)} onMerge={()=>onToggleMerge(c)} onArchive={()=>onArchive(c.id)}/>
          </div>
        </div>
        {mergeSourceId===c.id&&<form className="native-merge" onSubmit={event=>onMerge(event,c.id)}><span>{t('統合先')}</span><select value={mergeTargetId} onChange={event=>onMergeTarget(event.target.value)} aria-label={`Merge ${c.name} into`} required><option value="">{t('カテゴリを選択…')}</option>{own.filter(item=>item.id!==c.id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary" disabled={busy||!mergeTargetId}>{t('カテゴリを統合')}</button><button type="button" className="text-button" onClick={onCancelMerge}>{t('キャンセル')}</button><InfoDetails label={t('統合について')}><p>{t('統合先から外したメモは戻しません。まとめは更新待ちになります。')}</p></InfoDetails></form>}
        {renameId===c.id&&<form className="native-rename" onSubmit={onRename}><input value={renameName} onChange={e=>onRenameName(e.target.value)} maxLength={60} aria-label="Category name"/><button className="primary">{t('保存')}</button><button type="button" className="text-button" onClick={onCancelRename}>{t('キャンセル')}</button></form>}
        {splitSourceId===c.id&&renderSplit(c)}
        {expanded===c.id&&<div className="manager-notes">{managedNotes.length?managedNotes.map(n=><div key={n.id}><p>{n.text}</p><button className="secondary" onClick={()=>onUnassign(n.id,c.id)}>{t('カテゴリから外す')}</button></div>):<p className="manager-empty">{t('このカテゴリにはメモがありません。')}</p>}<button className="text-button" onClick={()=>onOpen(c.id)}>{t('まとめを開く')} <ArrowRightIcon/></button></div>}
      </article>)}{own.length===0&&<p className="manager-empty">{t('カテゴリはまだありません')}</p>}</div>
      <section className="manager-other"><div className="category-manager-head"><h2>{t('未分類')} <MonoLabel>{t('{n}件',{n:managedOther.length})}</MonoLabel></h2><button className="text-button" onClick={onCreate}><PlusIcon/>{t('未分類から作成')}</button></div>
        <div className="other-list">{managedOther.map(n=><div className="other-row" key={n.id}><p>{n.text}</p><select defaultValue="" aria-label="Move to category" onChange={e=>onAssign(n.id,e.target.value)}><option value="">{t('移動先を選択…')}</option>{own.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>)}{!managedOther.length&&<p className="manager-empty">{t('未分類のメモはありません')}</p>}</div>
      </section>
      {merges.length>0&&<section className="manager-archive"><MonoLabel>{t('統合の履歴')}</MonoLabel>{merges.map(merge=><div key={merge.id}><span>{merge.sourceName} → {merge.targetName}</span><small>{merge.movedCount} moved{merge.skippedCount?` · ${merge.skippedCount} excluded`:''}</small></div>)}</section>}
      {splits.length>0&&<section className="manager-archive"><MonoLabel>{t('分割の履歴')}</MonoLabel>{splits.map(split=><div key={split.id}><span>{split.sourceName} → {split.targetName}</span><small>{split.movedCount} moved</small></div>)}</section>}
      {archived.length>0&&<section className="manager-archive"><MonoLabel>{t('アーカイブ済み')}</MonoLabel>{archived.map(c=><div key={c.id}><span>{c.name}</span><button className="secondary" onClick={()=>onRestore(c.id)}>{t('復元')}</button></div>)}</section>}
    </div>
    {showBubbles&&<aside className="category-bubbles" aria-label={t('メモの割合 · 円の面積')}>
      <MonoLabel as="h2">{t('メモの割合 · 円の面積')}</MonoLabel>
      <div className="category-bubble-field" style={{height:Math.max(...bubbles.map(b=>b.y+b.r))+8}}>
        {bubbles.map(b=><button key={b.id} type="button" className={'category-bubble'+(b.r<44?' is-small':'')} style={{left:b.x-b.r,top:b.y-b.r,width:b.r*2,height:b.r*2}} onClick={()=>onOpen(b.id)} aria-label={t('{name} {count}件のまとめを開く',{name:b.name,count:b.count})}><span aria-hidden="true">{b.name}</span><MonoLabel aria-hidden="true">{b.count}</MonoLabel></button>)}
      </div>
    </aside>}
  </div>;
}
