const test=require('node:test');
const assert=require('node:assert/strict');
const {CodexClient}=require('./codex.cjs');
const {Progress,material,quiet}=require('./progress.cjs');

test('a Codex turn reports connect, send, the reasoning summary and the written length',async()=>{
  const client=new CodexClient();
  const calls=[],events=[];
  client.start=async()=>{};
  client.request=async(method,params)=>{
    calls.push({method,params});
    if(method==='thread/start')return {thread:{id:'thread'}};
    if(method==='turn/start')return {turn:{id:'turn',status:'inProgress'}};
    return {};
  };
  try{
    const turn=client.generate({model:'m',prompt:'12345',onProgress:event=>events.push(event)});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.find(call=>call.method==='turn/start').params.summary,'concise');
    const line=(method,params)=>client.onLine(JSON.stringify({method,params:{threadId:'thread',turnId:'turn',...params}}));
    line('turn/started',{turn:{id:'turn'}});
    line('item/started',{item:{type:'reasoning',id:'r',summary:[]}});
    line('item/reasoning/summaryTextDelta',{delta:'**Grouping** the notes',itemId:'r',summaryIndex:0});
    line('item/reasoning/summaryPartAdded',{itemId:'r',summaryIndex:1});
    line('item/reasoning/summaryTextDelta',{delta:'Checking dates',itemId:'r',summaryIndex:1});
    line('item/agentMessage/delta',{delta:'{"ok":',itemId:'a'});
    line('item/agentMessage/delta',{delta:'true}',itemId:'a'});
    line('item/completed',{item:{type:'agentMessage',text:'{"ok":true}'}});
    client.onLine(JSON.stringify({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}}));
    assert.deepEqual(await turn,{ok:true});
    assert.deepEqual(events.map(event=>event.stage),['connect','send','think','think','think','think','write','write']);
    assert.equal(events[2].phase,'waiting');assert.equal(events[3].phase,'reasoning');
    assert.equal(events[1].chars,5);
    assert.equal(events[4].thought,'**Grouping** the notes');
    assert.equal(events[5].thought,'Checking dates');
    assert.equal(events.at(-1).written,11);
    assert.equal(client.watchers.size,0);
  }finally{client.stop();}
});

test('a Codex that rejects the summary option still runs the turn',async()=>{
  const client=new CodexClient();const starts=[];
  client.start=async()=>{};
  client.request=async(method,params)=>{
    if(method==='thread/start')return {thread:{id:'thread'}};
    if(method==='turn/start'){starts.push(params);if(params.summary)throw new Error('unknown field `summary`');return {turn:{id:'turn',status:'completed',items:[{type:'agentMessage',text:'{"ok":1}'}]}};}
    return {};
  };
  try{
    assert.deepEqual(await client.generate({model:'m',prompt:'p',onProgress:()=>{}}),{ok:1});
    assert.equal(starts.length,2);
    assert.equal('summary' in starts[1],false);
  }finally{client.stop();}
});

test('progress moves through real steps, marks earlier ones done and disappears when finished',async()=>{
  const sent=[];
  const progress=new Progress(tasks=>sent.push(tasks));
  const result=await progress.run('analyze',{ref:'c1'},async task=>{
    task.step('gather',material([{article:{text:'body'}},{}]));
    let snapshot=progress.list()[0];
    assert.equal(snapshot.current,'gather');
    assert.deepEqual(snapshot.steps[0].facts,{notes:2,articles:1});
    task.ai({stage:'send',chars:900,model:'m',effort:'high'});
    task.ai({stage:'think',thought:'Weighing'});
    snapshot=progress.list()[0];
    assert.equal(snapshot.current,'think');
    assert.ok(snapshot.steps[1].endedAt,'connect counts as done once sending started');
    assert.equal(snapshot.steps[2].facts.chars,900);
    assert.equal(snapshot.thought,'Weighing');
    return 'ok';
  });
  assert.equal(result,'ok');
  assert.deepEqual(progress.list(),[]);
  assert.deepEqual(sent.at(-1),[]);
  await assert.rejects(progress.run('ask',{},async()=>{throw new Error('boom')}),/boom/);
  assert.deepEqual(progress.list(),[]);
});

test('workers without a progress bus still run',async()=>{
  const task=quiet.begin('classify');
  assert.equal(task.step('save'),task);
  task.ai({stage:'think'});task.done();
});
