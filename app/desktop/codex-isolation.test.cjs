const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CodexClient,DISABLED_FEATURES,BASE_INSTRUCTIONS}=require('./codex.cjs');

test("pure.'s Codex folder takes the sign-in once and nothing else from the personal one",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-codex-test-'));
  try{
    const personal=path.join(dir,'personal'),own=path.join(dir,'own');
    fs.mkdirSync(personal);
    for(const [name,body] of [['auth.json','{"token":"a"}'],['AGENTS.md','# my rules'],['hooks.json','{}'],['config.toml','[mcp_servers.x]']])fs.writeFileSync(path.join(personal,name),body);
    const client=new CodexClient({codexHome:own,sourceHome:personal});
    client.prepareHome();
    assert.deepEqual(fs.readdirSync(own),['auth.json']);
    assert.equal(fs.statSync(path.join(own,'auth.json')).mode&0o777,0o600);
    fs.writeFileSync(path.join(own,'auth.json'),'{"token":"signed in here"}');
    client.prepareHome();
    assert.equal(fs.readFileSync(path.join(own,'auth.json'),'utf8'),'{"token":"signed in here"}','an existing sign-in is never replaced');
    client.stop();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('every thread runs as an analysis engine, with agent features off',async()=>{
  for(const feature of ['hooks','apps','plugins','shell_tool','computer_use','browser_use','multi_agent','memories'])assert.ok(DISABLED_FEATURES.includes(feature),feature);
  const client=new CodexClient();const calls=[];
  client.start=async()=>{};
  client.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'t'}};if(method==='turn/start')return {turn:{id:'u',status:'completed',items:[{type:'agentMessage',text:'{}'}]}};return {};};
  try{
    await client.generate({model:'m',prompt:'p'});
    assert.equal(calls.find(call=>call.method==='thread/start').params.baseInstructions,BASE_INSTRUCTIONS);
    assert.match(BASE_INSTRUCTIONS,/never use tools/);
    // News search is told to search (and gets no notes); with the analysis instructions it never did.
    await client.generate({model:'m',prompt:'p',threadConfig:{web_search:'live'}});
    const search=calls.filter(call=>call.method==='thread/start')[1].params;
    assert.deepEqual(search.config,{web_search:'live'});
    assert.match(search.baseInstructions,/Use web search/);
  }finally{client.stop();}
});

test('an answer that fails validation is asked for once more, with the reason',async()=>{
  const {generateValid}=require('./ai-tasks.cjs');
  const prompts=[];let answers=[{ok:false},{ok:true}];
  const ai={generate:async options=>{prompts.push(options);return answers.shift();}};
  const validate=raw=>{if(!raw.ok)throw new Error('AI response is incomplete.');return raw;};
  const {result,retried}=await generateValid(ai,{prompt:'P',purpose:'collection'},validate);
  assert.deepEqual(result,{ok:true});assert.equal(retried,true);
  assert.equal(prompts[1].purpose,'collection-retry');
  assert.match(prompts[1].prompt,/^P\n\n前回の回答は「AI response is incomplete\.」/);
  answers=[{ok:false},{ok:false}];
  await assert.rejects(generateValid(ai,{prompt:'P',purpose:'ask'},validate),/incomplete/,'only one retry');
  assert.equal(prompts.length,4);
});
