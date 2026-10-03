const {spawn}=require('node:child_process');
const path=require('node:path');

const helper=path.join(__dirname,'../native/embedding-helper').replace(`app.asar${path.sep}`,`app.asar.unpacked${path.sep}`);
const concepts=[
  ['音楽',['曲','歌','歌詞','ピアノ','ライブ','聴く','聴いた','サウンド']],
  ['映画',['作品','映画館','観た','観る','鑑賞','シネマ']],
  ['本',['読書','小説','読んだ','読む','書籍']],
  ['仕事',['作業','職場','働く','プロジェクト']],
  ['料理',['食事','レシピ','作る','食べる']]
];
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const coreQuestion=value=>normalize(value).replace(/最近|どんな|について|教えて|ください|気になっている|ありますか|ですか|でしょうか|知りたい|私の|僕の|メモから|記録から/g,'');
const grams=value=>{const set=new Set();for(let i=0;i<value.length-1;i++)set.add(value.slice(i,i+2));return set;};
const overlap=(wanted,actual)=>{if(!wanted.size)return 0;let matches=0;for(const value of wanted)if(actual.has(value))matches++;return matches/wanted.size;};
const cosine=(a,b)=>{if(!a||!b||a.length!==b.length)return 0;let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;};

function embed(texts){
  return new Promise((resolve,reject)=>{
    const process=spawn(helper,[],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{process.kill();reject(new Error('Local embedding timed out.'));},60000);
    process.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>25000000){process.kill();reject(new Error('Local embedding output is too large.'));}});
    process.stderr.on('data',chunk=>{stderr+=chunk.toString().slice(0,1000)});
    process.on('error',error=>{clearTimeout(timer);reject(error)});
    process.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error(stderr||'Local embedding failed.'));return;}try{const result=JSON.parse(stdout);if(!result.model||!Array.isArray(result.vectors)||result.vectors.length!==texts.length)throw new Error('Invalid local embedding result.');resolve(result)}catch(error){reject(error)}});
    process.stdin.end(JSON.stringify({texts}));
  });
}

function rank(question,notes,vectors,queryVector,limit=30){
  const core=coreQuestion(question),wanted=grams(core);
  const expanded=[...concepts.filter(([name,terms])=>core.includes(name)||terms.some(term=>core.includes(term))).flatMap(([name,terms])=>[name,...terms])];
  const termMatches=note=>expanded.length?expanded.filter(term=>normalize(note.text+' '+(note.excerpt||'')+' '+(note.article?`${note.article.title} ${String(note.article.text).slice(0,3000)}`:'')+' '+note.categoryNames).includes(normalize(term))).length/expanded.length:0;
  const scored=notes.map((note,index)=>{
    const lexical=overlap(wanted,grams(normalize(note.text+' '+(note.excerpt||'')+' '+(note.article?`${note.article.title} ${String(note.article.text).slice(0,3000)}`:'')+' '+note.categoryNames)));
    const concept=termMatches(note);
    const semantic=Math.max(0,Math.min(1,(cosine(queryVector,vectors.get(note.revisionId))-0.48)/0.36));
    const category=normalize(note.categoryNames).includes(core)&&core.length>=2?1:0;
    const score=0.52*semantic+0.28*lexical+0.16*concept+0.02*category+0.02/(1+index/30);
    return {...note,score,semantic,lexical,method:queryVector?'local-semantic+text':'local-text'};
  }).sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date));
  const selected=scored.slice(0,limit);
  return selected.map(({score,method,...note})=>({...note,score,method}));
}

function blendCandidates(rawRanked,digestRanked,limit){
  const sourceByRevision=new Map(rawRanked.map(note=>[note.revisionId,note]));
  const chosen=[],seen=new Set();
  const add=note=>{if(note&&!seen.has(note.revisionId)&&chosen.length<limit){chosen.push(note);seen.add(note.revisionId)}};
  for(const note of rawRanked.slice(0,Math.ceil(limit*0.6)))add(note);
  for(const digest of digestRanked){
    if(digest.score<0.06)continue;
    for(const revisionId of digest.sourceRevisionIds||[]){
      const source=sourceByRevision.get(revisionId);
      if(source)add({...source,score:Math.max(source.score,digest.score),method:digest.assist||'digest-assisted'});
    }
  }
  for(const note of rawRanked)add(note);
  return chosen;
}

// Local embeddings for the notes that do not have one yet (cached in the store, never sent anywhere).
async function fillEmbeddings(store,notes,{model,embedder=embed,onProgress=()=>{},stopped=()=>false}){
  const vectors=store.cachedEmbeddings(model);
  const missing=notes.filter(note=>!vectors.has(note.revisionId));
  if(missing.length)onProgress({embedTotal:missing.length,embedDone:0});
  for(let offset=0;offset<missing.length&&!stopped();offset+=128){
    const batch=missing.slice(offset,offset+128);
    const result=await embedder(batch.map(note=>note.excerpt?`${note.text}\n${note.excerpt}`:note.text));
    if(result.model!==model)throw new Error('Local embedding model changed.');
    const rows=batch.map((note,index)=>({revisionId:note.revisionId,aiAccessVersion:note.aiAccessVersion,vector:result.vectors[index]})).filter(row=>Array.isArray(row.vector));
    store.saveEmbeddings(model,rows);
    for(const row of rows)vectors.set(row.revisionId,row.vector);
    onProgress({embedDone:Math.min(missing.length,offset+batch.length)});
  }
  return vectors;
}

// Prepares embeddings in a quiet moment after notes change, so the first question after an import
// (or a long day of notes) does not wait for them. Local only; uses no AI account.
class EmbeddingWarmer{
  constructor(store,{embedder=embed,progress=null}={}){this.store=store;this.embedder=embedder;this.progress=progress;this.timer=null;this.running=null;this.stopped=false;}
  schedule(delay=30000){if(this.stopped)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.run().catch(()=>{});},delay);this.timer.unref?.();}
  stop(){this.stopped=true;clearTimeout(this.timer);this.timer=null;}
  start(){this.stopped=false;}
  run(){
    if(!this.running)this.running=(async()=>{
      const notes=this.store.searchableNotes();
      if(!notes.length)return 0;
      const probe=await this.embedder(['pure.']);
      const before=this.store.cachedEmbeddings(probe.model);
      if(notes.every(note=>before.has(note.revisionId)))return 0;
      // Shown among what pure. is doing, with how many notes are left.
      const task=this.progress?.begin('index');
      try{
        const vectors=await fillEmbeddings(this.store,notes,{model:probe.model,embedder:this.embedder,stopped:()=>this.stopped,
          onProgress:({embedTotal,embedDone})=>task?.step('embed',{...(embedTotal?{total:embedTotal}:{}),...(embedDone!=null?{done:embedDone}:{})})});
        return vectors.size-before.size;
      }finally{task?.done();}
    })().finally(()=>{this.running=null;});
    return this.running;
  }
}

// onProgress hears what the search is doing: how many notes it looks through, and how many of them
// still need a local embedding (the first search after many new notes spends its time there).
async function retrieve(store,question,{embedder=embed,limit=30,useDigest=false,onProgress=()=>{}}={}){
  const notes=store.searchableNotes();
  onProgress({searched:notes.length});
  if(!notes.length)return [];
  let queryVector=null,vectors=new Map();
  try{
    const query=await embedder([question]);
    queryVector=query.vectors[0];
    if(!queryVector)throw new Error('No question embedding.');
    vectors=await fillEmbeddings(store,notes,{model:query.model,embedder,onProgress});
  }catch{queryVector=null;vectors=new Map();}
  const current=notes.filter(note=>store.aiSnapshotCurrent([note]));
  // The memory layer (what notes say about the person, in plain sentences) and, when on, digest
  // claims point back to their notes, so a question can reach a note that words it differently.
  const facts=(store.memoryFacts?.()||[]).filter(fact=>fact.speaker==='self')
    .map(fact=>({revisionId:`fact:${fact.id}`,text:`${fact.subject} ${fact.statement}`,date:fact.date,categoryNames:'',sourceRevisionIds:[fact.revisionId],assist:'memory-assisted'}));
  const digestRows=useDigest?store.searchableDigestClaims():[];
  if(useDigest)onProgress({digestClaims:digestRows.length});
  const assists=[...digestRows,...facts];
  const rawRanked=rank(question,current,vectors,queryVector,assists.length?current.length:limit);
  if(!assists.length)return rawRanked;
  return blendCandidates(rawRanked,rank(question,assists,new Map(),null,assists.length),limit);
}

module.exports={retrieve,rank,embed,coreQuestion,blendCandidates,fillEmbeddings,EmbeddingWarmer};
