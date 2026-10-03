// Judge for evals: is each claim supported by the notes it cites? One call per output, all claims at
// once. Strict on purpose: "partial" when the claim adds anything the notes do not say.
const {versionOf}=require('../desktop/prompt-version.cjs');

const judgeSchema={type:'object',additionalProperties:false,required:['verdicts'],properties:{verdicts:{type:'array',items:{type:'object',additionalProperties:false,
  required:['index','verdict','reason'],properties:{index:{type:'integer'},verdict:{type:'string',enum:['supported','partial','unsupported']},reason:{type:'string'}}}}}};

function judgePrompt(claims,notes){
  const byRevision=new Map(notes.map(note=>[note.revisionId,note]));
  const items=claims.map((claim,index)=>({index,claim:claim.text,kind:claim.kind,speaker:claim.speaker,
    citedNotes:(claim.evidenceRevisionIds||[]).map(id=>byRevision.get(id)).filter(Boolean).map(note=>({date:String(note.date||'').slice(0,10),body:note.text,...(note.excerpt?{excerpt:note.excerpt}:{}),...(note.article?{linkedPage:{title:note.article.title,text:String(note.article.text||'').slice(0,800)}}:{})}))}));
  return `あなたは厳格な評価者です。各主張(claim)が、引用されたメモ(citedNotes)だけで裏付けられるかを判定し、指定JSONだけを返してください。\n`+
    `- supported: メモに書かれていることだけで言える。言い換えはよいが、内容を足していない。\n`+
    `- partial: 大筋は合っているが、メモにない推測・誇張・一般化・時期などを足している。\n`+
    `- unsupported: メモからは言えない、または引用がない。\n`+
    `- excerpt や linkedPage は外部の資料で、本人の意見ではありません。本人の好みとして書かれた主張を外部資料だけで裏付けてはいけません。kind が inference の主張は、推測であることが明示されていれば推測として妥当かで判定します。\n`+
    `- date はそのメモを書いた日です。時期についての主張は date で確かめてください。\n`+
    `- reason は日本語で短く。\n`+
    `主張: ${JSON.stringify(items)}`;
}
const JUDGE_VERSION=versionOf('judge',judgePrompt,judgeSchema);

async function judgeClaims({client,model},claims,notes){
  if(!claims.length)return {total:0,supported:0,partial:0,unsupported:0,details:[]};
  const result=await client.generate({model,purpose:'judge',promptVersion:JUDGE_VERSION,prompt:judgePrompt(claims,notes),schema:judgeSchema});
  const verdicts=new Map((result?.verdicts||[]).map(item=>[item.index,item]));
  const details=claims.map((claim,index)=>({claim:claim.text,verdict:verdicts.get(index)?.verdict||'unsupported',reason:verdicts.get(index)?.reason||'no verdict'}));
  const count=verdict=>details.filter(item=>item.verdict===verdict).length;
  return {total:details.length,supported:count('supported'),partial:count('partial'),unsupported:count('unsupported'),details};
}

// News: is each collected item really about what the person is interested in (the same artist or
// work, not something with the same name), and does a translated title say what the original says?
const newsJudgeSchema={type:'object',additionalProperties:false,required:['verdicts'],properties:{verdicts:{type:'array',items:{type:'object',additionalProperties:false,
  required:['index','relevance','translation','reason'],properties:{index:{type:'integer'},relevance:{type:'string',enum:['on-topic','tangential','same-name','unclear']},
  translation:{type:'string',enum:['ok','wrong','none']},reason:{type:'string'}}}}}};
function newsJudgePrompt(items,interests){
  return `あなたは厳格な評価者です。メモアプリが本人の関心から集めたニュース(items)を1件ずつ判定し、指定JSONだけを返してください。\n`+
    `interests は本人の関心ごとと、そう言える理由です。各 item の topic がどの関心で集めたものかを示します。\n`+
    `- relevance: on-topic = その関心ごとそのもの（同じアーティスト・作品・人物・製品）が記事の主題か、主要な話題。tangential = 名前が出てくるだけで主題は別。same-name = 名前は同じだが別のもの（同名の別人・別作品・一般名詞の意味）。unclear = 題名と要約だけでは判断できない。\n`+
    `- translation: titleLocalized があれば、原題 title の意味を足さず欠かさず訳せているか（ok / wrong）。なければ none。\n`+
    `- reason は日本語で短く。\n`+
    `interests: ${JSON.stringify(interests)}\n`+
    `items: ${JSON.stringify(items.map((item,index)=>({index,topic:item.topic,title:item.title,...(item.titleLocalized?{titleLocalized:item.titleLocalized}:{}),source:item.source,...(item.summary?{summary:item.summary}:{})})))}`;
}
const NEWS_JUDGE_VERSION=versionOf('news-judge',newsJudgePrompt,newsJudgeSchema);
async function judgeNews({client,model},items,interests){
  const out=[];
  for(let index=0;index<items.length;index+=40){
    const batch=items.slice(index,index+40);
    const result=await client.generate({model,purpose:'judge-news',promptVersion:NEWS_JUDGE_VERSION,prompt:newsJudgePrompt(batch,interests),schema:newsJudgeSchema});
    const verdicts=new Map((result?.verdicts||[]).map(item=>[item.index,item]));
    out.push(...batch.map((item,i)=>({...item,relevance:verdicts.get(i)?.relevance||'unclear',translation:verdicts.get(i)?.translation||'none',reason:verdicts.get(i)?.reason||'no verdict'})));
  }
  return out;
}

// Related words: would someone who likes the interest plausibly want news about this, and is the
// stated relation true?
const relatedJudgeSchema={type:'object',additionalProperties:false,required:['verdicts'],properties:{verdicts:{type:'array',items:{type:'object',additionalProperties:false,
  required:['index','verdict','reason'],properties:{index:{type:'integer'},verdict:{type:'string',enum:['good','weak','wrong']},reason:{type:'string'}}}}}};
const relatedJudgePrompt=related=>`あなたは厳格な評価者です。ある人の関心ごと(from)から、AIが「これが好きならこれも気になりそう」と広げた言葉(query)と、その関係の説明(why)を判定し、指定JSONだけを返してください。\n`+
  `- good: 実在する具体的なもので、why の関係が事実として正しく、from が好きな人がニュースを見たいと思うのが自然。\n`+
  `- weak: 事実としては正しいが、関係が薄い・一般的すぎる・from の言い換えに近い。\n`+
  `- wrong: 存在しない、why の関係が事実と違う、または from とほぼ同じもの。\n- reason は日本語で短く。\n`+
  `related: ${JSON.stringify(related.map((item,index)=>({index,from:item.fromLabel||item.from,query:item.query,label:item.label,why:item.why})))}`;
const RELATED_JUDGE_VERSION=versionOf('related-judge',relatedJudgePrompt,relatedJudgeSchema);
async function judgeRelated({client,model},related){
  if(!related.length)return [];
  const result=await client.generate({model,purpose:'judge-related',promptVersion:RELATED_JUDGE_VERSION,prompt:relatedJudgePrompt(related),schema:relatedJudgeSchema});
  const verdicts=new Map((result?.verdicts||[]).map(item=>[item.index,item]));
  return related.map((item,index)=>({...item,verdict:verdicts.get(index)?.verdict||'wrong',reason:verdicts.get(index)?.reason||'no verdict'}));
}

module.exports={judgeClaims,judgePrompt,JUDGE_VERSION,judgeNews,NEWS_JUDGE_VERSION,judgeRelated};
