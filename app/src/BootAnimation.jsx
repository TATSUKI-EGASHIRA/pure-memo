import React,{useEffect} from 'react';
import './boot-animation.css';

export const BOOT_DURATION_MS=980;

// Animation: fine liquid traces gather around the pure mark | first ready screen | 980 ms.
// Reduced-motion fallback: the component is not mounted; the app appears immediately.
export default function BootAnimation({onComplete}){
  useEffect(()=>{const timer=setTimeout(onComplete,BOOT_DURATION_MS);return()=>clearTimeout(timer)},[]);
  return <div className="boot-sequence" aria-hidden="true">
    <svg className="boot-trails" viewBox="0 0 1200 500" fill="none" preserveAspectRatio="xMidYMid meet">
      <path className="boot-trail boot-trail-a" pathLength="1" d="M-60 336 C160 330 295 302 409 282 S507 252 581 253"/>
      <path className="boot-trail boot-trail-b" pathLength="1" d="M-30 384 C173 350 274 362 395 312 S500 257 581 253"/>
      <path className="boot-trail boot-trail-c" pathLength="1" d="M1280 350 C1040 323 857 273 738 265 S657 250 581 253"/>
      <path className="boot-trail boot-trail-d" pathLength="1" d="M702 -25 C698 90 670 169 619 213 S594 247 581 253"/>
      <path className="boot-trail boot-trail-e" pathLength="1" d="M470 -20 C488 93 520 154 553 209 S570 241 581 253"/>
      {[92,150,233,319,401,480,718,801,907,1006,1117].map((x,i)=><circle key={x} className="boot-particle" cx={x} cy={i%2?312-i*5:295+i*4} r={i%3===0?1.3:.7}/>)}
    </svg>
    <div className="boot-lockup"><svg viewBox="0 0 90 60" fill="none"><path fill="currentColor" d="M3 46C19 40 30 29 44 35C36 39 40 44 50 46C62 50 72 43 87 45C62 48 60 58 38 51C24 46 19 43 3 46Z"/><path d="M43 39C58 29 53 9 62 5M48 43C59 36 64 31 69 22" stroke="currentColor" strokeWidth="1.5"/><ellipse cx="63" cy="5" rx="3" ry="5" transform="rotate(35 63 5)" fill="currentColor"/><ellipse cx="70" cy="21" rx="2.6" ry="4" transform="rotate(35 70 21)" fill="currentColor"/></svg><span>pure.</span></div>
  </div>;
}
