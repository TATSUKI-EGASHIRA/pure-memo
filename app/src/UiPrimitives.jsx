import React,{createContext,useContext,useLayoutEffect,useRef,useState} from 'react';
import {ChevronDownIcon,InfoCircledIcon} from '@radix-ui/react-icons';
import {holeCenter} from './hole.js';
import {t} from './i18n.js';

// Workspace-wide tools (search, new memo) that every page heading shows on its right.
export const HeadingTools=createContext(null);

export function PageHeading({Icon,title,meta,actions,className='',kicker}){
  const tools=useContext(HeadingTools);
  return <header className={`page-heading ${className}`}>
    <div className="page-heading-title">{kicker}<div className="page-heading-line"><Icon aria-hidden="true"/><h1>{title}</h1>{meta!=null&&<span className="page-heading-meta">{meta}</span>}</div></div>
    {(actions||tools)&&<div className="page-heading-actions">{actions}{tools}</div>}
  </header>;
}

// Send-scope notes read "ⓘ label ⌄" and open to the existing explanation.
export function InfoDetails({label=t('詳細'),Icon=InfoCircledIcon,children,className=''}){
  return <details className={`ui-details ${className}`}>
    <summary><Icon aria-hidden="true"/><span>{label}</span><ChevronDownIcon className="details-chevron" aria-hidden="true"/></summary>
    <div className="ui-details-content">{children}</div>
  </details>;
}

// The existing pure lockup (mark + wordmark from the boot animation), reused as is.
export function LogoMark({className='mark'}){
  return <svg className={className} viewBox="0 0 90 60" fill="none" aria-hidden="true"><path fill="currentColor" d="M3 46C19 40 30 29 44 35C36 39 40 44 50 46C62 50 72 43 87 45C62 48 60 58 38 51C24 46 19 43 3 46Z"/><path d="M43 39C58 29 53 9 62 5M48 43C59 36 64 31 69 22" stroke="currentColor" strokeWidth="1.5"/><ellipse cx="63" cy="5" rx="3" ry="5" transform="rotate(35 63 5)" fill="currentColor"/><ellipse cx="70" cy="21" rx="2.6" ry="4" transform="rotate(35 70 21)" fill="currentColor"/></svg>;
}
export function Logo({className=''}){
  return <span className={`ui-logo ${className}`} role="img" aria-label="pure."><LogoMark/><span aria-hidden="true">pure.</span></span>;
}

export const MonoLabel=({as:Tag='span',className='',...props})=><Tag className={`ui-mono ${className}`} {...props}/>;
export const Drop=({size,className='',style})=><span className={`ui-drop ${className}`} aria-hidden="true" style={size?{...style,'--drop':`${size}px`}:style}/>;
// Two rings, 1.7 s apart. Only for something selected or waiting.
export const Ripple=({className=''})=><span className={`ui-ripple ${className}`} aria-hidden="true"><i/><i/></span>;

// Fine 5° ticks and bold 30° ticks around a disc; turns once every 240 s.
export function Dial({r,className='',style}){
  const size=r*2+32,c=size/2,length=2*Math.PI*r;
  return <svg className={`ui-dial ${className}`} style={style} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
    <g className="ui-dial-turn"><circle cx={c} cy={c} r={r} strokeWidth="8" strokeDasharray={`1 ${length/72-1}`} opacity=".5"/><circle cx={c} cy={c} r={r} strokeWidth="14" strokeDasharray={`1.6 ${length/12-1.6}`}/></g>
  </svg>;
}

export function Disc({size,className='',style,children,...props}){
  return <div className={`ui-disc ${className}`} style={{...style,'--disc':`${size}px`}} {...props}>{children}</div>;
}

// 52 × 30, with the state also written out.
export function Switch({label,checked,disabled,onChange}){
  return <span className="ui-switch-wrap"><span className="ui-switch-state" aria-hidden="true">{checked?t('オン'):t('オフ')}</span><button type="button" className={'ui-switch'+(checked?' is-on':'')} role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}><i/></button></span>;
}

// The hole centre (see hole.js) in the element's own coordinates.
export function useStage(){
  const ref=useRef(null),[stage,setStage]=useState(()=>({...holeCenter(window.innerWidth,window.innerHeight),left:0,top:0,width:window.innerWidth,height:window.innerHeight}));
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const sync=()=>{
      const box=el.getBoundingClientRect(),hole=holeCenter(window.innerWidth,window.innerHeight);
      const scroller=el.closest('.native-scroll');const offset=scroller?scroller.scrollTop:0;
      const next={s:hole.s,x:hole.x-box.left,y:hole.y-box.top-offset,left:box.left,top:box.top+offset,width:window.innerWidth,height:window.innerHeight};
      setStage(old=>Math.abs(old.x-next.x)<.5&&Math.abs(old.y-next.y)<.5&&old.s===next.s?old:next);
    };
    sync();const observer=new ResizeObserver(sync);observer.observe(el);window.addEventListener('resize',sync);
    return()=>{observer.disconnect();window.removeEventListener('resize',sync)};
  },[]);
  return [ref,stage];
}

// A block that lays its children out around the hole centre; children receive {x, y, s}.
export function CenterStage({className='',children,...props}){
  const [ref,stage]=useStage();
  return <div ref={ref} className={`stage ${className}`} style={{'--s':stage.s}} {...props}>{children(stage)}</div>;
}
