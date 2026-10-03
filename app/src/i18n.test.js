import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import EN from './i18n-en.js';
import {t,setLocale} from './i18n.js';

const dir=new URL('.',import.meta.url);
const sources=readdirSync(dir).filter(name=>/\.(jsx|js)$/.test(name)&&!/test|i18n/.test(name)).map(name=>readFileSync(new URL(name,dir),'utf8'));

test('every UI string has an English entry with the same placeholders',()=>{
  const keys=new Set();
  for(const source of sources){
    for(const match of source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g))keys.add(match[1].replace(/\\'/g,"'"));
  }
  const missing=[...keys].filter(key=>!Object.hasOwn(EN,key)&&key.replace(/\{\w+\}/g,'').trim()&&/[぀-ヿ一-鿿]/.test(key));
  assert.deepEqual(missing,[]);
  const names=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');
  const mismatched=Object.entries(EN).filter(([ja,en])=>names(ja)!==names(en)).map(([ja])=>ja);
  assert.deepEqual(mismatched,[]);
});

test('label tables shown through t() are translated too',()=>{
  const files=['DesktopApp.jsx','OrbitView.jsx','GraphView.jsx','SettingsView.jsx','SettingsSections.jsx','AskView.jsx','OutputParts.jsx','ProcessingQueue.jsx','ProgressPanel.jsx'];
  const missing=[];
  for(const name of files){
    const source=readFileSync(new URL(name,dir),'utf8');
    for(const line of source.split('\n').filter(l=>/^(export )?const \w+=(Object\.freeze\()?[\[{]/.test(l)||/^\s+\{id:'\w+',label:/.test(l))){
      for(const m of line.matchAll(/'([^']*[぀-ヿ一-鿿][^']*)'/g))if(!Object.hasOwn(EN,m[1]))missing.push(`${name}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing,[]);
});

test('t() keeps Japanese, switches to English and fills placeholders',()=>{
  setLocale('ja');assert.equal(t('{n}件 · 新しいメモ',{n:'04'}),'04件 · 新しいメモ');
  setLocale('en');assert.equal(t('{n}件 · 新しいメモ',{n:'04'}),'04 notes · new note');
  assert.equal(t('まだ訳のない文'),'まだ訳のない文');
  setLocale('ja');
});
