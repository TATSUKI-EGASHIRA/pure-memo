const test=require('node:test');
const assert=require('node:assert/strict');
const {CodexClient}=require('./codex.cjs');

test('cancelling an AI turn interrupts only its thread and removes late notifications',async()=>{
  const client=new CodexClient();
  const calls=[];let sequence=0;
  client.start=async()=>{};
  client.request=async(method,params)=>{
    calls.push({method,params});
    if(method==='thread/start')return {thread:{id:`thread-${++sequence}`}};
    if(method==='turn/start')return {turn:{id:`turn-${params.threadId}`,status:'inProgress'}};
    return {};
  };
  try{
    const controller=new AbortController();
    const cancelled=client.generate({model:'test',prompt:'one',signal:controller.signal});
    const rejected=assert.rejects(cancelled,{name:'AbortError'});
    const other=client.generate({model:'test',prompt:'two'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.turns.size,2);
    controller.abort();await rejected;
    assert.equal(client.turns.size,1);
    const interruption=calls.find(call=>call.method==='turn/interrupt');
    assert.deepEqual(interruption.params,{threadId:'thread-1',turnId:'turn-thread-1'});
    client.onLine(JSON.stringify({method:'turn/completed',params:{turn:{id:'turn-thread-1',status:'interrupted'}}}));
    assert.equal(client.early.size,0);
    client.onLine(JSON.stringify({method:'item/completed',params:{turnId:'turn-thread-2',item:{type:'agentMessage',text:'{"ok":true}'}}}));
    client.onLine(JSON.stringify({method:'turn/completed',params:{turn:{id:'turn-thread-2',status:'completed'}}}));
    assert.deepEqual(await other,{ok:true});
    assert.equal(client.turns.size,0);
  }finally{client.stop();}
});

test('cancellation while turn startup is pending interrupts after the turn ID arrives',async()=>{
  const client=new CodexClient();let release,started;const interrupts=[];
  const startup=new Promise(resolve=>started=resolve);
  client.start=async()=>{};
  client.request=async(method,params)=>{
    if(method==='thread/start')return {thread:{id:'thread'}};
    if(method==='turn/start'){started();return new Promise(resolve=>release=()=>resolve({turn:{id:'turn',status:'inProgress'}}));}
    if(method==='turn/interrupt')interrupts.push(params);
    return {};
  };
  try{
    const controller=new AbortController();
    const generation=client.generate({model:'test',prompt:'one',signal:controller.signal});
    const rejection=assert.rejects(generation,{name:'AbortError'});
    await startup;controller.abort();release();await rejection;
    assert.deepEqual(interrupts,[{threadId:'thread',turnId:'turn'}]);
    assert.equal(client.turns.size,0);
  }finally{client.stop();}
});
