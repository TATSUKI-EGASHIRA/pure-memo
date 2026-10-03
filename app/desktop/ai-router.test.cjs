const test=require('node:test');
const assert=require('node:assert/strict');
const {AiRouter,isLight}=require('./ai-router.cjs');

const fake=(name,known)=>({calls:[],accepts:model=>known.includes(model),defaultModel:()=>known[0],async generate(options){this.calls.push(options);this.onCall?.({purpose:options.purpose,status:'ok'});return {name};}});

test('light work runs on the light model with low effort; the rest on the chosen model and effort',async()=>{
  const codex=fake('codex',['gpt-big','gpt-small']),claude=fake('claude',['sonnet','haiku']);
  let provider='codex',light='gpt-small';const logged=[];
  const router=new AiRouter({providers:{codex,claude},provider:()=>provider,lightModel:()=>light,reasoningEffort:()=>'high',onCall:call=>logged.push(call)});
  await router.generate({purpose:'classify',model:'gpt-big'});
  await router.generate({purpose:'ask',model:'gpt-big'});
  await router.generate({purpose:'verify-ask',model:'gpt-big',effort:'low'});
  assert.deepEqual(codex.calls.map(c=>[c.model,c.effort]),[['gpt-small','low'],['gpt-big','high'],['gpt-small','low']]);
  assert.deepEqual(logged.map(c=>c.provider),['codex','codex','codex']);
  // Switching provider: a job's Codex model and a Codex light model fall back to Claude's own.
  provider='claude';
  await router.generate({purpose:'classify',model:'gpt-big'});
  await router.generate({purpose:'collection',model:'gpt-big'});
  light='haiku';await router.generate({purpose:'classify',model:'sonnet'});
  assert.deepEqual(claude.calls.map(c=>c.model),['sonnet','sonnet','haiku']);
  assert.equal(logged.at(-1).provider,'claude');
  assert.equal(isLight('collection-retry'),false);assert.equal(isLight('classify-retry'),true);
});
