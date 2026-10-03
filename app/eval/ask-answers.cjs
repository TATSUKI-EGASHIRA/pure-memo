const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../desktop/store.cjs');
const {CodexClient,askSchema}=require('../desktop/codex.cjs');
const {retrieve}=require('../desktop/retrieval.cjs');
const {promptFor,validateResult}=require('../desktop/analysis.cjs');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-ask-answer-eval-'));
const store=new Store(path.join(dir,'pure.sqlite'));
// Evals use a throwaway Codex folder, so a personal Codex setup cannot change the results.
const ai=new CodexClient({codexHome:fs.mkdtempSync(path.join(os.tmpdir(),'pure-eval-codex-'))});
const source={
  jazz:store.saveNote({text:'ジャズは好きではない。'}),
  quote:store.saveNote({text:'読んだ記事に「仕事を辞めたい」と書いてあった。これは筆者の意見で、私はそう思っていない。'}),
  old:store.saveNote({text:'以前はホラー映画が苦手だった。'}),
  current:store.saveNote({text:'最近はホラー映画を楽しめるようになった。'}),
  piano:store.saveNote({text:'作業中は歌詞のないピアノを聴くと落ち着く。'})
};
for(let index=0;index<40;index++)store.saveNote({text:`今日の料理メモ${index}。野菜を切ってスープを作った。`});

async function ask(question){
  const ranked=await retrieve(store,question);
  const notes=ranked.map(({score,method,categoryNames,...note})=>note);
  const result=validateResult(await ai.generate({model:'gpt-6-luna',prompt:promptFor('ask',notes,store.feedbackForAsk(question),question),schema:askSchema}),notes,'ask');
  const output=store.saveAnalysis({purpose:'ask',categoryId:'all',model:'gpt-6-luna',items:notes,result,question,retrieval:ranked});
  return {result,output};
}

(async()=>{
  const cases=[
    {name:'negation',question:'ジャズは好き？',must:[source.jazz.revisionId],check:text=>/好きではない|好んでいない|苦手|嫌い/.test(text)},
    {name:'quotation',question:'仕事を辞めたいと考えている？',must:[source.quote.revisionId],check:text=>/筆者|記事|本人の意見では|判断でき|そう思っていない/.test(text)},
    {name:'time',question:'ホラー映画の好みは変わった？',must:[source.old.revisionId,source.current.revisionId],check:text=>/以前|昔/.test(text)&&/最近|今/.test(text)}
  ];
  let passed=0;
  for(const item of cases){
    const {result}=await ask(item.question);
    const evidence=item.must.every(id=>result.evidenceRevisionIds.includes(id));
    const semantics=item.check(result.text+' '+result.pattern);
    if(evidence&&semantics)passed++;
    console.log(JSON.stringify({case:item.name,status:result.status,evidence,semantics,text:result.text,pattern:result.pattern}));
  }
  const correctionQuestion='音楽はいつも歌詞のないものを選ぶ？';
  const baseline=await ask(correctionQuestion);
  store.rate(baseline.output.id,'bad','incorrect','作業中に歌詞のないピアノを聴くと落ち着く、という限定された記録です。いつもそう選ぶとは言っていません。');
  const corrected=await ask(correctionQuestion);
  const correction=/作業中/.test(corrected.result.text+' '+corrected.result.pattern)&&/いつも|一般化|限られ|断定/.test(corrected.result.text+' '+corrected.result.pattern);
  if(correction)passed++;
  console.log(JSON.stringify({case:'correction',baseline:baseline.result.text,corrected:corrected.result.text,limitation:corrected.result.pattern,correction}));
  console.log(`Answer checks: ${passed}/4`);
  if(passed!==4)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{ai.stop();store.close();fs.rmSync(dir,{recursive:true,force:true})});
