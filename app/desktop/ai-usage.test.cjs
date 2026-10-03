const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {AiUsage,codexLimits}=require('./ai-usage.cjs');
const {readLimits}=require('./claude-code.cjs');

function fresh(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-usage-test-'));return {dir,store:new Store(path.join(dir,'pure.sqlite'))};}

test('each account’s 5-hour and weekly windows are read as Codex and Claude Code report them',()=>{
  assert.deepEqual(codexLimits({rateLimitsByLimitId:{codex:{primary:{usedPercent:12.4,windowDurationMins:300,resetsAt:100},secondary:{usedPercent:59,windowDurationMins:10080,resetsAt:200},planType:'plus',rateLimitReachedType:null}}}).windows,
    [{id:'five_hour',usedPercent:12,resetsAt:100},{id:'seven_day',usedPercent:59,resetsAt:200}]);
  const claude=readLimits({status:'allowed',unifiedWindows:{five_hour:{utilization:0.08,resetsAt:300},seven_day:{utilization:0.485,resetsAt:400}}});
  assert.deepEqual(claude.windows,[{id:'five_hour',usedPercent:8,resetsAt:300},{id:'seven_day',usedPercent:49,resetsAt:400}]);
  assert.equal(claude.limited,false);
  assert.equal(readLimits({status:'rejected',unifiedWindows:{}}).limited,true);
});

test('usage shows both accounts and what pure. itself used, by purpose, today and over a week',async()=>{
  const {dir,store}=fresh();
  try{
    const DAY=86400000,now=Date.now();
    store.logAiCall({provider:'codex',purpose:'memory-backfill',ms:50000,usage:{input:7000,output:1300,reasoning:200},status:'ok'});
    store.logAiCall({provider:'claude',purpose:'classify-retry',ms:3000,usage:{input:3000,output:200},status:'error'});
    store.logAiCall({provider:'codex',purpose:'classify',ms:4000,usage:{input:6000,output:400},status:'ok'});
    store.db.prepare("UPDATE ai_calls SET at=? WHERE purpose='classify'").run(new Date(now-3*DAY).toISOString());
    let asked=0;
    const codex={limits:async()=>{asked++;return {rateLimitsByLimitId:{codex:{primary:{usedPercent:20,resetsAt:1},secondary:{usedPercent:60,resetsAt:2},planType:'plus'}}};}};
    const claude={account:async()=>({account:{type:'claude-code'}})};
    const usage=new AiUsage(store,{codex,claude,provider:()=>'claude',now:()=>now});
    let state=await usage.read();
    assert.equal(state.provider,'claude');
    assert.deepEqual(state.providers.map(p=>[p.id,p.connected,p.windows.map(w=>w.usedPercent)]),[['codex',true,[20,60]],['claude',true,[]]],'Claude Code has not answered yet');
    claude.onRateLimit({windows:[{id:'five_hour',usedPercent:8,resetsAt:3}],limited:false,checkedAt:new Date(now).toISOString()});
    state=await usage.read();
    assert.deepEqual(state.providers[1].windows.map(w=>w.usedPercent),[8],'the last report from Claude Code is kept');
    assert.equal(asked,1,'Codex is asked again only after a minute, or when refreshed');
    await usage.read({refresh:true});assert.equal(asked,2);
    assert.deepEqual([state.today.calls,state.today.errors,state.today.input,state.today.output],[2,1,10000,1700]);
    assert.deepEqual(state.today.byPurpose.map(entry=>entry.purpose),['memory-backfill','classify'],'a retry counts as its task');
    assert.equal(state.week.calls,3);
    const offline=new AiUsage(store,{codex:{limits:async()=>{throw new Error('Codex was not found.')}},claude:{account:async()=>({account:null})}});
    assert.deepEqual((await offline.read()).providers.map(p=>p.connected),[false,false]);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
