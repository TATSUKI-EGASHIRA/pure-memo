const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../desktop/store.cjs');
const {retrieve}=require('../desktop/retrieval.cjs');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-ask-eval-'));
const store=new Store(path.join(dir,'pure.sqlite'));
const sources={
  musicRain:'雨の日には静かなピアノを聴きたい。',
  musicWork:'作業中は歌詞のない曲をかけると集中できる。',
  jazzNo:'ジャズは好きではない。',
  quote:'読んだ記事に「仕事を辞めたい」と書いてあった。これは筆者の意見で、私はそう思っていない。',
  horrorThen:'以前はホラー映画が苦手だった。',
  horrorNow:'最近はホラー映画を楽しめるようになった。',
  craft:'ろくろで器を作る時間に夢中になった。'
};
const ids=Object.fromEntries(Object.entries(sources).map(([key,text])=>[key,store.saveNote({text}).id]));
for(let i=0;i<70;i++)store.saveNote({text:`今日の料理メモ${i}。野菜を切ってスープを作った。`});
const cases=[
  {question:'最近、どんな音楽が気になっている？',must:['musicRain','musicWork']},
  {question:'ジャズは好き？',must:['jazzNo']},
  {question:'仕事を辞めたいと考えている？',must:['quote']},
  {question:'ホラー映画の好みは変わった？',must:['horrorThen','horrorNow']},
  {question:'陶芸のような趣味に興味がある？',must:['craft']}
];

(async()=>{
  let found=0,total=0;
  for(const item of cases){
    const result=await retrieve(store,item.question);
    const ranks=Object.fromEntries(item.must.map(key=>[key,result.findIndex(note=>note.id===ids[key])+1]));
    found+=Object.values(ranks).filter(Boolean).length;total+=item.must.length;
    console.log(JSON.stringify({question:item.question,ranks,top:result.slice(0,5).map(note=>({text:note.text,score:Number(note.score.toFixed(3))}))}));
  }
  console.log(`Recall@30: ${found}/${total}`);
  if(found!==total)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
