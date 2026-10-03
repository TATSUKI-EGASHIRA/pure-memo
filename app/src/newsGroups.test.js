import test from 'node:test';
import assert from 'node:assert/strict';
import {topicGroups} from './newsGroups.js';

test('news is grouped by the word it was collected for, newest group first, and a word with nothing new is kept',()=>{
  const items=[{topic:'SUITS ドラマ',title:'a',publishedAt:'2026-09-30T08:00:00Z'},{topic:'ハナレグミ',title:'b',publishedAt:'2026-10-01T08:00:00Z'},
    {topic:'SUITS ドラマ',title:'c',publishedAt:'2026-10-01T09:00:00Z'},{topic:'消えた言葉',title:'d',publishedAt:'',fetchedAt:'2026-09-20T00:00:00Z'}];
  const groups=topicGroups(items,{settings:{lastTopics:[{topic:'坂本慎太郎',added:0},{topic:'ハナレグミ',added:1},{topic:'SUITS ドラマ',added:2}]},interests:{items:[{query:'SUITS ドラマ',label:'SUITS'}]}});
  assert.deepEqual(groups.map(group=>[group.label,group.items.map(item=>item.title),group.added]),
    [['SUITS',['c','a'],2],['ハナレグミ',['b'],1],['消えた言葉',['d'],null],['坂本慎太郎',[],0]]);
});

test('words widened by AI come after the interests from the notes and name where they came from',()=>{
  const items=[{topic:'ノーラン新作',title:'new',publishedAt:'2026-10-02T08:00:00Z'},{topic:'インターステラー',title:'old',publishedAt:'2026-09-30T08:00:00Z'}];
  const groups=topicGroups(items,{settings:{lastTopics:[]},interests:{items:[{query:'インターステラー',label:'インターステラー'}],related:[{query:'ノーラン新作',label:'ノーランの新作',fromLabel:'インターステラー'}]}});
  assert.deepEqual(groups.map(group=>[group.label,group.from]),[['インターステラー',''],['ノーランの新作','インターステラー']]);
});
