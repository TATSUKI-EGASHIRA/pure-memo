const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../desktop/store.cjs');
const {CodexClient,askSchema}=require('../desktop/codex.cjs');
const {retrieve}=require('../desktop/retrieval.cjs');
const {promptFor,validateResult}=require('../desktop/analysis.cjs');

const live=process.argv.includes('--live');
const model=process.env.PURE_EVAL_MODEL||'gpt-6-luna';
const output=path.join(__dirname,'results',live?'answer-quality-report.json':'answer-quality-prepared.json');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pure-answer-quality-'));
const store=new Store(path.join(directory,'pure.sqlite'));
// Evals use a throwaway Codex folder, so a personal Codex setup cannot change the results.
const ai=live?new CodexClient({codexHome:path.join(directory,'codex')}):null;

const sources={
  jazzOld:store.saveNote({text:'去年はジャズが苦手だった。複雑な音で疲れた。',sourceKind:'thought'}),
  jazzNew:store.saveNote({text:'最近は小さな店でジャズを聴いて、好きになってきた。',sourceKind:'thought'}),
  jazzArticle:store.saveNote({text:'保存した記事の筆者は「ジャズは退屈」と書いていた。これは私の意見ではない。',sourceKind:'reference'}),
  horrorOld:store.saveNote({text:'以前はホラー映画が怖くて避けていた。',sourceKind:'thought'}),
  horrorNew:store.saveNote({text:'最近観たホラー映画は意外と楽しめた。',sourceKind:'thought'}),
  filmWish:store.saveNote({text:'映画「月の庭」は予告編だけ見た。本編はまだ観ていない。',sourceKind:'thought'}),
  piano:store.saveNote({text:'作業中は歌詞のないピアノを流すと落ち着く。',sourceKind:'thought'}),
  lyrics:store.saveNote({text:'休日は歌詞のある曲を口ずさむのが好き。',sourceKind:'thought'})
};
for(let index=0;index<30;index++)store.saveNote({text:`料理メモ${index}。野菜を切ってスープを作った。`,sourceKind:'thought'});

const cases=[
  {id:'negation-and-change',question:'ジャズは今も苦手？',required:['jazzOld','jazzNew'],focus:'昔と最近を分け、現在も苦手とは言わない'},
  {id:'external-voice',question:'ジャズを退屈と言ったのは本人？',required:['jazzArticle','jazzNew'],focus:'記事の筆者を本人の意見にしない'},
  {id:'two-changes',question:'ジャズとホラー映画への印象は以前と最近でどう変わった？',required:['jazzOld','jazzNew','horrorOld','horrorNew'],focus:'二つの対象の時期を取り違えない'},
  {id:'unseen-film',question:'「月の庭」を観た感想は？',required:['filmWish'],focus:'予告だけで本編は未鑑賞と答える'},
  {id:'unknown-runtime',question:'「月の庭」の上映時間は何分？',required:['filmWish'],focus:'上映時間を作らず根拠不足と答える'},
  {id:'context-not-always',question:'音楽はいつも歌詞のないものを選ぶ？',required:['piano','lyrics'],focus:'作業中と休日を区別し、いつもとは一般化しない'}
];

async function runQuestion(item){
  const ranked=await retrieve(store,item.question,{embedder:async()=>{throw new Error('Use the same text fallback for every case.')}});
  const selected=ranked.map(({score,method,categoryNames,...note})=>note);
  const required=item.required.map(key=>sources[key].revisionId);
  const record={id:item.id,question:item.question,focus:item.focus,requiredSources:required,
    retrievedRequired:required.filter(id=>selected.some(note=>note.revisionId===id)),
    inputs:selected.map(note=>({revisionId:note.revisionId,text:note.text,sourceKind:note.sourceKind})),
    answer:null,humanReview:{supported:null,attributionCorrect:null,timeCorrect:null,abstentionCorrect:null,notes:''}};
  if(live){
    const feedback=store.feedbackForAsk(item.question);
    record.feedback=feedback;
    const result=validateResult(await ai.generate({model,prompt:promptFor('ask',selected,feedback,item.question),schema:askSchema}),selected,'ask');
    record.answer=result;
    record.checks={allRequiredRetrieved:record.retrievedRequired.length===required.length,
      sourceIdsValid:result.evidenceRevisionIds.every(id=>selected.some(note=>note.revisionId===id)),
      insufficientWhenUnknown:item.id==='unknown-runtime'?result.status==='insufficient':null};
    const saved=store.saveAnalysis({purpose:'ask',categoryId:'all',model,items:selected,result,question:item.question,retrieval:ranked});
    record.outputId=saved.id;
  }
  return record;
}

async function main(){
  const report={createdAt:new Date().toISOString(),synthetic:true,model:live?model:null,
    method:'Product retrieval and Ask prompt; text fallback; six fixed cases plus one repeated case after Bad correction',
    liveStatus:live?'running':'not-run',cases:[],correction:null};
  try{
    for(const item of cases)report.cases.push(await runQuestion(item));
    if(live){
      const first=report.cases.find(item=>item.id==='context-not-always');
      const comment='作業中に歌詞のないピアノを聴くが、休日には歌詞のある曲も好き。いつも同じ選び方ではない。';
      store.rate(first.outputId,'bad','incorrect',comment);
      const after=await runQuestion(cases.find(item=>item.id==='context-not-always'));
      report.correction={before:first.answer,comment,feedbackIncluded:after.feedback.some(row=>row.comment===comment),after:after.answer,
        humanReview:{beforeCorrect:null,afterCorrect:null,improved:null,notes:''}};
      report.liveStatus='completed';
    }
  }catch(error){report.liveStatus='failed';report.liveError=error.message;process.exitCode=1;}
  finally{
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,liveStatus:report.liveStatus,completedCases:report.cases.length,
      correctionFeedbackIncluded:report.correction?.feedbackIncluded??null,liveError:report.liveError||null},null,2));
  }
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{ai?.stop();store.close();fs.rmSync(directory,{recursive:true,force:true})});
