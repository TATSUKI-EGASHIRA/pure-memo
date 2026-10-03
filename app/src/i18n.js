// UI language. Japanese is the source text: t('…') returns it as is, or its English entry.
// Memo text and AI output are never translated.
import EN from './i18n-en.js';

export const LOCALES=Object.freeze([{id:'ja',label:'日本語'},{id:'en',label:'English'}]);
const KEY='pure.locale';
let current=(()=>{try{const saved=localStorage.getItem(KEY);return saved==='en'?'en':'ja'}catch{return 'ja'}})();

export const getLocale=()=>current;
export function setLocale(next){
  current=next==='en'?'en':'ja';
  try{localStorage.setItem(KEY,current)}catch{}
  if(typeof document!=='undefined')document.documentElement.lang=current;
  return current;
}
if(typeof document!=='undefined')document.documentElement.lang=current;

// t('{n}件', {n: 3}) → "3件" / "3 notes"
export function t(text,vars){
  const template=current==='en'&&Object.hasOwn(EN,text)?EN[text]:text;
  return vars?template.replace(/\{(\w+)\}/g,(match,name)=>name in vars?String(vars[name]):match):template;
}

export const dateLocale=()=>current==='en'?'en-US':'ja-JP';
const WEEKDAYS={ja:['日','月','火','水','木','金','土'],en:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']};
export const weekday=date=>WEEKDAYS[current][date.getDay()];
// "9月30日 水" / "Wed, Sep 30"
export function dayAndMonth(date){
  return current==='en'?`${weekday(date)}, ${date.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:`${date.getMonth()+1}月${date.getDate()}日 ${weekday(date)}`;
}

// Errors arrive as "Error invoking remote method 'pure:x': Error: …"; show only the message, translated.
export function errorText(message){
  const text=String(message||'').replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/,'');
  return t(text);
}
