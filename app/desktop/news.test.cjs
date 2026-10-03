const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {CodexClient}=require('./codex.cjs');
const {NewsWorker,parseGoogleNews,parseHackerNews,googleNewsUrl}=require('./news.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-news-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}
const NOW=Date.parse('2026-10-02T03:00:00Z');
const rss=`<rss><channel><item><title>ハナレグミ、一夜限りのライブ - 音楽ナタリー</title><link>https://news.google.com/rss/articles/a1</link><pubDate>Wed, 30 Sep 2026 08:00:00 GMT</pubDate><source url="https://natalie.mu">音楽ナタリー</source></item>
<item><title>Steel Ball Run episode 2 &amp; the ending - Anime News</title><link>https://news.google.com/rss/articles/b2</link><pubDate>Tue, 29 Sep 2026 02:30:00 GMT</pubDate><source url="https://ann.example">Anime News</source></item>
<item><title>no date</title><link>https://news.google.com/rss/articles/c3</link></item></channel></rss>`;

test('feeds are read with their own dates, and headlines must name the main word',()=>{
  const items=parseGoogleNews(rss,'ハナレグミ');
  assert.equal(items.length,2,'items without a date are dropped');
  assert.deepEqual([items[0].title,items[0].source,items[0].publishedAt],['ハナレグミ、一夜限りのライブ','音楽ナタリー','2026-09-30T08:00:00.000Z']);
  assert.equal(items[1].title,'Steel Ball Run episode 2 & the ending');
  const {mentions,dedupe}=require('./news.cjs');
  assert.equal(dedupe([{url:'https://a/1',title:'＜画像2 / 20＞SBRのグッズが登場'},{url:'https://a/2',title:'＜画像10 / 20＞SBRのグッズが登場'}]).length,1);
  assert.equal(dedupe([{url:'https://a/3',title:'般若が語るSBRの魅力 (OCEANS)'},{url:'https://a/4',title:'般若が語るSBRの魅力（OCEANS）'}]).length,1,'the same headline in other brackets');
  const gallery=parseGoogleNews(`<rss><channel><item><title>画像2 / 12＞『プラダを着た悪魔2』キャストが来日 - ウォーカープラス</title><link>https://n/1</link><pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate><source url="https://w">ウォーカープラス</source></item>`+
    `<item><title>ハナレグミ（撮影：横山マサト） - ナタリー</title><link>https://n/2</link><pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate><source url="https://n">ナタリー</source></item></channel></rss>`,'プラダを着た悪魔');
  assert.deepEqual(gallery.map(item=>item.title),['『プラダを着た悪魔2』キャストが来日'],'a gallery number is not part of the title; a photo caption is not news');
  assert.equal(mentions('TurboNotes: Local-First Markdown notes','local-first'),true);
  assert.equal(mentions('Meet local first responders','local-first'),false);
  assert.match(googleNewsUrl('local-first','en'),/q=%22local-first%22%20when%3A3d&hl=en-US/);
  assert.match(googleNewsUrl('SUITS ドラマ','ja'),/q=SUITS%20%E3%83%89%E3%83%A9%E3%83%9E%20when/);
  assert.equal(mentions('『SUITS／スーツ』新シーズン配信','SUITS ドラマ'),true);
  assert.equal(mentions('秋ドラマ特集','SUITS ドラマ'),false);
  assert.equal(mentions('ジョジョ「スティール・ボール・ラン」2話','ジョジョの奇妙な冒険 スティールボールラン'),false);
  assert.equal(mentions('スティール・ボール・ラン 2話','スティールボールラン ジョジョ'),true);
  const hn=parseHackerNews({hits:[{objectID:'1',title:'Local-first notes',url:'',points:9,created_at:'2026-10-01T20:38:06Z'},{objectID:'2',title:'quiet',points:1}]},'local-first');
  assert.deepEqual(hn.map(item=>[item.url,item.discussion]),[['https://news.ycombinator.com/item?id=1','https://news.ycombinator.com/item?id=1']]);
});

test('a collection sends only the words, never notes, and keeps only links that exist',async()=>{
  const {dir,store}=fresh();
  try{
    store.saveNote({text:'秘密のメモ: ハナレグミが好き'});
    const requests=[];const prompts=[];const configs=[];
    const fetchText=async(url)=>{
      requests.push(url);
      if(url.startsWith('https://news.google.com/'))return {text:rss,url};
      if(url.startsWith('https://hn.algolia.com/'))return {text:JSON.stringify({hits:[]}),url};
      if(url.startsWith('https://www.reddit.com/oembed?url=')){
        if(decodeURIComponent(url).includes('/comments/real/'))return {text:JSON.stringify({title:'Steel ball run anime'}),url};
        throw new Error('Article returned HTTP 404.');
      }
      if(url==='https://blog.example/post')return {text:'<html><head><title>Behind the strings</title><meta property="article:published_time" content="2026-09-30T10:00:00Z"></head></html>',url};
      if(url==='https://guarded.example/x')return {text:'<html><head><title>Just a moment...</title></head></html>',url};
      throw new Error('unexpected '+url);
    };
    const ai={generate:async({prompt,schema,threadConfig})=>{
      prompts.push(prompt);configs.push(threadConfig);
      if(schema.properties.items)return {items:[
        {topic:'ハナレグミ',url:'https://www.reddit.com/r/x/comments/real/thread/',title:'SBR',titleLocalized:'SBRアニメ',source:'r/x',publishedAt:'2026-09-28',kind:'discussion',summary:'感想スレッド。'},
        {topic:'ハナレグミ',url:'https://www.reddit.com/r/x/comments/fake/thread/',title:'made up',titleLocalized:'',source:'',publishedAt:'',kind:'discussion',summary:''},
        {topic:'ハナレグミ',url:'https://blog.example/post',title:'x',titleLocalized:'弦の裏側',source:'Blog',publishedAt:'',kind:'blog',summary:'ライブの記録。'},
        {topic:'ハナレグミ',url:'https://guarded.example/x',title:'y',titleLocalized:'',source:'',publishedAt:'',kind:'blog',summary:''},
        {topic:'not chosen',url:'https://blog.example/other',title:'z',titleLocalized:'',source:'',publishedAt:'',kind:'blog',summary:''}]};
      if(schema.properties.verdicts)return {verdicts:[]};
      const ja={'Steel Ball Run episode 2 & the ending':'スティール・ボール・ラン第2話とエンディング','Behind the strings':'弦の裏側'};
      return {titles:JSON.parse(prompt.slice(prompt.indexOf('\n[')+1)).filter(item=>ja[item.title]).map(item=>({id:item.id,title:ja[item.title]}))};
    }};
    const worker=new NewsWorker(store,{ai,model:()=>'m',locale:()=>'ja',fetchText,now:()=>NOW});
    await assert.rejects(worker.run(),/見つからず/);
    assert.equal(requests.length,0,'nothing is fetched without words');
    store.setNewsSettings({enabled:true,topics:[{query:'ハナレグミ'},{query:'  ハナレグミ '},{query:''},{query:'Steel Ball Run'}]});
    assert.deepEqual(store.newsSettings().topics.map(topic=>topic.query),['ハナレグミ','Steel Ball Run']);
    const result=await worker.run();
    assert.equal(result.failures.length,0);
    assert.ok(prompts.every(prompt=>!prompt.includes('秘密のメモ')),'notes never reach the news prompts');
    const counts=Object.fromEntries(store.newsSettings().lastTopics.map(entry=>[entry.topic,entry.added]));
    assert.deepEqual(Object.keys(counts),['ハナレグミ','Steel Ball Run'],'every word searched is remembered with how much it brought');
    assert.equal(counts['ハナレグミ'],store.newsItems().filter(item=>item.topic==='ハナレグミ').length);
    assert.deepEqual(configs,[{web_search:'live'},undefined,undefined],'web search is on only for the search turn');
    const items=store.newsItems();
    const urls=items.map(item=>item.url);
    assert.ok(urls.includes('https://www.reddit.com/r/x/comments/real/thread/'));
    assert.ok(!urls.some(url=>url.includes('/fake/')),'a post Reddit does not know is dropped');
    assert.ok(!urls.includes('https://guarded.example/x'),'a bot check proves nothing');
    assert.ok(!urls.includes('https://blog.example/other'),'only chosen topics');
    const blog=items.find(item=>item.url==='https://blog.example/post');
    assert.deepEqual([blog.title,blog.titleLocalized,blog.publishedAt],['Behind the strings','弦の裏側','2026-09-30T10:00:00.000Z'],'title and date come from the page; the title is translated like any other');
    const reddit=items.find(item=>item.url.includes('/real/'));
    assert.equal(reddit.title,'Steel ball run anime');
    const english=items.find(item=>item.url.endsWith('/b2'));
    assert.equal(english.titleLocalized,'スティール・ボール・ラン第2話とエンディング','foreign headlines are translated');
    assert.equal(items.find(item=>item.url.endsWith('/a1')).titleLocalized,'','headlines already in the UI language are left alone');
    assert.equal(store.newsUrl('https://evil.example/'),null);
    assert.equal(worker.due(),false,'daily collection is off');
    store.setNewsSettings({enabled:true});
    assert.equal(worker.due(),false,'and once on, it already ran today');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('items that only mention an interest, or share its name, are left out; a failed check keeps them',async()=>{
  const run=async generate=>{
    const {dir,store}=fresh();
    try{
      store.setNewsSettings({topics:[{query:'インターステラー'}]});
      const titles=['『インターステラー』IMAX再上映が決定','ハミルトン、映画『インターステラー』よろしく時を超える名品','インターステラー彗星が接近'];
      const feed=`<rss><channel>${titles.map((title,i)=>`<item><title>${title}</title><link>https://n/${i}</link><pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
      const fetchText=async url=>({text:url.startsWith('https://news.google.com/')?feed:JSON.stringify({hits:[]}),url});
      let prompt='';
      const ai={generate:async options=>{if(options.purpose==='news-filter'){prompt=options.prompt;return generate();}return {items:[],titles:[]};}};
      const worker=new NewsWorker(store,{ai,model:()=>'m',fetchText,now:()=>NOW});
      const result=await worker.run();
      prompt='';await worker.run();
      return {titles:store.newsItems().map(item=>item.title).sort(),prompt,first:result,failures:result.failures};
    }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
  };
  const checked=await run(async()=>({verdicts:[{index:0,relevance:'on-topic'},{index:1,relevance:'tangential'},{index:2,relevance:'same-name'}]}));
  assert.deepEqual(checked.titles,['『インターステラー』IMAX再上映が決定']);
  assert.deepEqual(checked.first.dropped.map(item=>item.title),['ハミルトン、映画『インターステラー』よろしく時を超える名品','インターステラー彗星が接近']);
  assert.equal(checked.prompt,'','what was left out is not checked again the next day');
  const failed=await run(async()=>{throw new Error('offline')});
  assert.equal(failed.titles.length,3,'nothing is lost when the check fails');
  assert.match(failed.failures.join(),/offline/);
});

test('a Japanese interest is also searched in English news under its English name, which must appear whole',async()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'インターステラーをまた見た'});
    const revisionId=store.listNotes()[0].revisionId;
    store.saveNewsInterests([{query:'インターステラー',label:'インターステラー',english:'Interstellar',kind:'work',why:'',evidence:[{revisionId,noteId:note.id,quote:'インターステラーをまた見た'}]}],{model:'m'});
    const feed=titles=>`<rss><channel>${titles.map((title,i)=>`<item><title>${title}</title><link>https://n/${encodeURIComponent(title)}</link><pubDate>Thu, 01 Oct 2026 0${i}:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const sent=[];let webPrompt='';
    const fetchText=async url=>{
      sent.push(decodeURIComponent(url));
      if(url.includes('hl=en-US'))return {text:feed(['Interstellar returns to IMAX for one week','Interstellarity: a new indie game']),url};
      if(url.startsWith('https://news.google.com/'))return {text:feed(['『インターステラー』IMAX再上映']),url};
      return {text:JSON.stringify({hits:[{objectID:'9',title:'Interstellar at 12: the physics',url:'https://hn/9',points:40,created_at:'2026-10-01T00:00:00Z'}]}),url};
    };
    const ai={generate:async options=>{if(options.purpose==='news-search')webPrompt=options.prompt;return {items:[],verdicts:[],titles:[]};}};
    await new NewsWorker(store,{ai,model:()=>'m',fetchText,now:()=>NOW}).run();
    assert.ok(sent.some(url=>url.includes('q="Interstellar" when:3d&hl=en-US')),'English news is searched with the English name as one phrase');
    assert.ok(sent.some(url=>url.includes('hn.algolia.com')&&url.includes('query=Interstellar&')),'and so is Hacker News');
    assert.match(webPrompt,/"インターステラー":"Interstellar"/);
    const items=store.newsItems();
    assert.deepEqual(items.map(item=>item.title).sort(),['Interstellar at 12: the physics','Interstellar returns to IMAX for one week','『インターステラー』IMAX再上映']);
    assert.ok(items.every(item=>item.topic==='インターステラー'),'English items sit under the word the user sees');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('related words are widened from the interests, kept apart, and leave with their interest or when taken out',async()=>{
  const {validateRelated,relatedPrompt}=require('./interests.cjs');
  const interests=[{query:'インターステラー',label:'インターステラー',why:'何度も見ている'},{query:'ハナレグミ',label:'ハナレグミ',why:'よく聴く'}];
  const answer={related:[
    {from:'インターステラー',query:'クリストファー・ノーラン',english:'Christopher Nolan',label:'ノーラン',kind:'person',why:'インターステラーの監督'},
    {from:'インターステラー',query:'オデュッセイア 映画',english:'The Odyssey',label:'オデュッセイア',kind:'work',why:'ノーラン監督の新作'},
    {from:'インターステラー',query:'ハンス・ジマー',english:'',label:'ハンス・ジマー',kind:'person',why:'音楽担当'},
    {from:'ハナレグミ',query:'インターステラー',english:'',label:'x',kind:'work',why:'already an interest'},
    {from:'知らない関心',query:'何か',english:'',label:'何か',kind:'topic',why:'no source'},
    {from:'ハナレグミ',query:'SUPER BUTTER DOG',english:'',label:'SUPER BUTTER DOG',kind:'artist',why:'永積崇が在籍したバンド'},
    {from:'ハナレグミ',query:'原田郁子',english:'Ikuko Harada',label:'原田郁子',kind:'artist',why:''}]};
  const related=validateRelated(answer,interests,{taken:['local-first']});
  assert.deepEqual(related.map(item=>[item.from,item.query,item.english]),[['インターステラー','クリストファー・ノーラン','Christopher Nolan'],['インターステラー','オデュッセイア 映画',''],['ハナレグミ','SUPER BUTTER DOG','']],
    'two per interest at most, from a real interest, not an interest itself, with a reason; a word with context gets no English name');
  assert.match(relatedPrompt(interests,{blocked:['星野源']}),/外した言葉（\["星野源"\]）/);
  assert.doesNotMatch(relatedPrompt(interests),/quote|revisionId/,'no notes are sent, only labels and reasons');
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'インターステラーをまた見た'});
    const revisionId=store.listNotes()[0].revisionId;
    store.saveNewsInterests([{...interests[0],english:'Interstellar',kind:'work',evidence:[{revisionId,noteId:note.id,quote:'インターステラーをまた見た'}]}],{model:'m',related});
    assert.deepEqual(store.newsInterests().related.map(item=>[item.query,item.fromLabel]),[['クリストファー・ノーラン','インターステラー'],['オデュッセイア 映画','インターステラー']],'a related word whose interest is gone is not used');
    store.setNewsSettings({topics:[{query:'local-first'}]});
    assert.deepEqual(store.newsWords(1,1),['local-first','クリストファー・ノーラン'],'own words first; related words have their own room');
    store.setNewsSettings({blocked:['クリストファー・ノーラン']});
    assert.deepEqual(store.newsInterests().related.map(item=>item.query),['オデュッセイア 映画']);
    store.setAiExcluded({id:note.id,excluded:true});
    assert.deepEqual(store.newsInterests().related,[],'they leave with the interest they came from');
    assert.doesNotMatch(store.db.prepare("SELECT value FROM app_state WHERE key='news_interests'").get().value,/ノーラン/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('finding interests also widens them; if widening fails the interests are still kept',async()=>{
  const {findInterests}=require('./ai-tasks.cjs');
  for(const fails of [false,true]){
    const {dir,store}=fresh();
    try{
      store.saveNote({text:'インターステラーをまた見た'});
      const revisionId=store.listNotes()[0].revisionId;
      const purposes=[];
      const ai={generate:async({purpose,prompt})=>{purposes.push(purpose);
        if(purpose==='interests')return {interests:[{named:'インターステラー',query:'インターステラー',english:'Interstellar',label:'インターステラー',kind:'work',why:'また見た',evidence:[{revisionId,quote:'インターステラーをまた見た'}]}]};
        if(fails)throw new Error('offline');
        assert.doesNotMatch(prompt,/また見た。|revisionId/);
        return {related:[{from:'インターステラー',query:'クリストファー・ノーラン',english:'Christopher Nolan',label:'ノーラン',kind:'person',why:'監督'}]};}};
      const result=await findInterests({store,ai,model:'m',force:true});
      assert.deepEqual(purposes,['interests','interests-related']);
      assert.equal(result.found,1);
      assert.deepEqual(store.newsInterests().related.map(item=>item.query),fails?[]:['クリストファー・ノーラン']);
    }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('an interest is searched in one spelling',()=>{
  const {validateInterests}=require('./interests.cjs');
  const items=[{id:'n',revisionId:'r',text:'SUITS見てる。AC/DCも'}];
  const evidence=[{revisionId:'r',quote:'SUITS見てる'}];
  assert.deepEqual(validateInterests({interests:['SUITS/スーツ ドラマ','AC/DC'].map(query=>({query,label:query,kind:'work',why:'',evidence}))},items).map(item=>item.query),['SUITS ドラマ','AC/DC']);
  const named=validateInterests({interests:[{query:'インターステラー',english:'Interstellar'},{query:'坂本慎太郎',english:'坂本'},{query:'AC/DC',english:'AC/DC'},{query:'SUITS ドラマ',english:'Suits'}].map(item=>({...item,label:item.query,kind:'work',why:'',evidence}))},items);
  assert.deepEqual(named.map(item=>[item.query,item.english]),[['インターステラー','Interstellar'],['坂本慎太郎',''],['AC/DC',''],['SUITS ドラマ','']],'an English name is kept only in Latin letters, only for a Japanese word, and not for a word that needed context');
});

test('a thread can turn on a Codex setting just for itself',async()=>{
  const client=new CodexClient();const calls=[];
  client.start=async()=>{};
  client.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'t'}};if(method==='turn/start')return {turn:{id:'u',status:'completed',items:[{type:'agentMessage',text:'{}'}]}};return {};};
  try{
    await client.generate({model:'m',prompt:'p',threadConfig:{web_search:'live'}});
    await client.generate({model:'m',prompt:'p'});
    const threads=calls.filter(call=>call.method==='thread/start');
    assert.deepEqual(threads[0].params.config,{web_search:'live'});
    assert.equal('config' in threads[1].params,false);
  }finally{client.stop();}
});

test('interests come from the notes with quotes that are really there, and leave with their notes',()=>{
  const {validateInterests,interestPrompt,selectInterestNotes}=require('./interests.cjs');
  const {dir,store}=fresh();
  try{
    const suits=store.saveNote({text:'海外ドラマ「スーツ」５週ぐらいしてる'});
    const jojo=store.saveNote({text:'ジョジョの７部見始めた。結構面白い'});
    const items=selectInterestNotes(store.searchableNotes());
    const prompt=interestPrompt(items,{chosen:['ハナレグミ'],locale:'en'});
    assert.match(prompt,/スーツ/);assert.match(prompt,/英語で1文/);assert.match(prompt,/\["ハナレグミ"\]/);
    const result={interests:[
      {query:'SUITS ドラマ',label:'SUITS',kind:'work',why:'繰り返し見ている。',evidence:[{revisionId:suits.revisionId||store.listNotes().find(n=>n.id===suits.id).revisionId,quote:'海外ドラマ「スーツ」'}]},
      {query:'ジョジョ 7部',label:'ジョジョ',kind:'work',why:'',evidence:[{revisionId:store.listNotes().find(n=>n.id===jojo.id).revisionId,quote:'第7部が最高'}]},
      {query:'ハナレグミ',label:'ハナレグミ',kind:'artist',why:'',evidence:[{revisionId:store.listNotes().find(n=>n.id===suits.id).revisionId,quote:'スーツ'}]}]};
    const interests=validateInterests(result,items,{chosen:['ハナレグミ']});
    assert.deepEqual(interests.map(item=>item.query),['SUITS ドラマ'],'an invented quote and an already chosen word are dropped');
    store.saveNewsInterests(interests,{model:'m'});
    assert.equal(store.newsInterests().items.length,1);
    store.setNewsSettings({topics:[{query:'SUITS ドラマ'}]});
    assert.equal(store.newsInterests().items.length,0,'added words leave the list');
    store.setNewsSettings({topics:[]});
    store.setAiExcluded({id:suits.id,excluded:true});
    assert.equal(store.newsInterests().items.length,0,'notes closed to AI are not shown as evidence');
    assert.doesNotMatch(store.db.prepare("SELECT value FROM app_state WHERE key='news_interests'").get().value,/スーツ/,'and their quotes are removed');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('one collection finds interests in the notes first, and words taken out are not sent again',async()=>{
  const {dir,store}=fresh();
  try{
    const note=store.saveNote({text:'坂本慎太郎の新譜、ギターの音が乾いてて良い'});
    const revisionId=store.listNotes()[0].revisionId;
    let finds=0;const sent=[];
    const findInterests=async()=>{
      const fingerprint=store.interestFingerprint(),saved=store.newsInterests();
      if(saved.at&&saved.fingerprint===fingerprint)return {reused:true,found:saved.items.length};
      finds++;
      store.saveNewsInterests([{query:'坂本慎太郎',label:'坂本慎太郎',kind:'artist',why:'新譜を良いと書いている。',evidence:[{revisionId,noteId:note.id,quote:'坂本慎太郎の新譜'}]},
        {query:'ギター',label:'ギター',kind:'topic',why:'',evidence:[{revisionId,noteId:note.id,quote:'ギターの音'}]}],{fingerprint});
      return {notes:1,found:2};
    };
    const fetchText=async url=>{sent.push(decodeURIComponent(url));return url.includes('algolia')?{text:'{"hits":[]}',url}:{text:'<rss></rss>',url}};
    const worker=new NewsWorker(store,{model:()=>'m',fetchText,findInterests,now:()=>NOW});
    await worker.run();
    assert.equal(finds,1);
    assert.ok(sent.some(url=>url.includes('q=坂本慎太郎 when')),'words found in the notes are used');
    assert.ok(sent.every(url=>!url.includes('乾いてて')),'the note itself is not');
    store.setNewsSettings({blocked:['ギター'],topics:[{query:'local-first'}]});
    assert.deepEqual(store.newsWords(),['local-first','坂本慎太郎']);
    sent.length=0;await worker.run();
    assert.equal(finds,1,'unchanged notes reuse the last interests');
    assert.ok(!sent.some(url=>url.includes('q=ギター ')||url.includes('query=ギター&')),'a word taken out is not sent');
    store.saveNote({text:'インターステラーをまた見た'});
    await worker.run();
    assert.equal(finds,2,'new notes are read again');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
