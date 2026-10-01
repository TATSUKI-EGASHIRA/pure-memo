import React,{useEffect,useRef} from 'react';
import {PageHeading,InfoDetails} from './UiPrimitives.jsx';
import {ArrowLeftIcon,Cross2Icon,DownloadIcon,GearIcon,LightningBoltIcon,Link2Icon,LockClosedIcon,MagnifyingGlassIcon} from '@radix-ui/react-icons';

export const settingsCategories=[
  {id:'general',label:'一般',section:'アプリ',Icon:GearIcon,description:'画面の表示と、保存・接続の状態。'},
  {id:'connection',label:'接続',section:'アプリ',Icon:Link2Icon,description:'Codexとの接続と、使用するモデル。'},
  {id:'ai',label:'AI',section:'メモ',Icon:LightningBoltIcon,description:'分類、分析、検索と、バックグラウンド処理。'},
  {id:'data',label:'バックアップ',section:'データ',Icon:DownloadIcon,description:'メモの書き出し、復元、取り込み。'},
  {id:'privacy',label:'プライバシー',section:'データ',Icon:LockClosedIcon,description:'外部へ送られる情報と、その範囲。'},
];

export function SettingsSidebar({category,onSelect,onBack}){
  return <>
    <nav className="settings-navigation" aria-label="設定のカテゴリ">
      {settingsCategories.map(({id,label,section,Icon},index)=><React.Fragment key={id}>
        {settingsCategories[index-1]?.section!==section&&<h2 className="settings-nav-heading">{section}</h2>}
        <button className={'nav-item '+(category===id?'active':'')} aria-current={category===id?'page':undefined} aria-label={label} title={label} onClick={()=>onSelect(id)}><Icon/><span>{label}</span></button>
      </React.Fragment>)}
    </nav>
    <div className="sidebar-foot"><button className="nav-item settings-back" onClick={onBack} aria-label="メモに戻る" title="メモに戻る"><ArrowLeftIcon/><span>メモに戻る</span></button></div>
  </>;
}

export function SettingsSearch({value,onChange}){
  return <div className="settings-search" role="search">
    <MagnifyingGlassIcon aria-hidden="true"/>
    <input type="search" value={value} onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onChange('')}}} placeholder="設定を検索" aria-label="設定を検索"/>
    {value&&<button className="icon-button" onClick={()=>onChange('')} aria-label="設定の検索をクリア"><Cross2Icon/></button>}
  </div>;
}

export function SettingSwitch({label,checked,disabled,onChange}){
  return <button className={'toggle '+(checked?'on':'')} role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}><i/></button>;
}

const normalize=value=>value.normalize('NFKC').toLocaleLowerCase().trim();
export default function SettingsView({category,query,groups}){
  const scroll=useRef(null);
  useEffect(()=>{scroll.current?.scrollTo(0,0)},[category,query]);
  const terms=normalize(query).split(/\s+/).filter(Boolean);
  const searching=terms.length>0;
  const active=settingsCategories.find(item=>item.id===category);
  const shown=groups.flatMap(group=>{
    if(!searching)return group.category===category?[group]:[];
    const label=settingsCategories.find(item=>item.id===group.category).label;
    const groupText=[label,group.title,group.description,group.keywords].filter(Boolean).join(' ');
    if(group.content)return terms.every(term=>normalize(groupText).includes(term))?[group]:[];
    const rows=group.rows.filter(row=>terms.every(term=>normalize(`${groupText} ${row.title} ${row.description||''} ${row.details||''} ${row.keywords||''}`).includes(term)));
    return rows.length?[{...group,rows}]:[];
  });
  return <div className="native-scroll settings-scroll" ref={scroll}>
    <div className="settings-content">
      <PageHeading Icon={searching?MagnifyingGlassIcon:active.Icon} title={searching?'検索結果':active.label} meta={searching?`「${query.trim()}」`:null}/>
      <div aria-live="polite" className="sr-only">{searching?`${shown.length}グループが見つかりました。`:''}</div>
      {shown.map(group=><section className="settings-group" key={group.id} aria-labelledby={`settings-group-${group.id}`}>
        <div className="settings-group-heading">{searching&&<span className="settings-result-category">{settingsCategories.find(item=>item.id===group.category).label}</span>}<h2 id={`settings-group-${group.id}`}>{group.title}</h2>{group.description&&<p>{group.description}</p>}</div>
        {group.content?<div className="settings-custom-panel">{group.content}</div>:<div className="settings-row-group">{group.rows.map(row=><div className={'settings-row'+(!row.control?' settings-info-row':'')} key={row.id}>
          <div className="settings-row-copy"><div className="settings-row-label">{row.Icon&&<row.Icon aria-hidden="true"/>}<h3>{row.title}</h3></div>{row.description&&<p>{row.description}</p>}{row.details&&<InfoDetails><p>{row.details}</p></InfoDetails>}{row.extra&&<div className="settings-row-extra">{row.extra}</div>}</div>
          {row.control&&<div className="settings-row-control">{row.control}</div>}
        </div>)}</div>}
        {group.note&&<div className="settings-group-note">{group.note}</div>}
      </section>)}
      {!shown.length&&<div className="settings-no-results"><MagnifyingGlassIcon/><h2>一致する設定がありません</h2></div>}
    </div>
  </div>;
}
