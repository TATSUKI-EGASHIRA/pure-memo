const test=require('node:test');
const assert=require('node:assert/strict');
const {validateResult,promptFor}=require('./analysis.cjs');

test('Ask requires traceable claims and keeps quotations distinct',()=>{
  const notes=[{revisionId:'a',text:'記事の筆者は退屈と書いた。',date:'2026-09-01'}];
  const result={status:'ready',text:'記事の筆者の意見です。',pattern:'',action:'',evidenceRevisionIds:['a'],categories:[],claims:[{text:'退屈と書いたのは記事の筆者。',kind:'record',speaker:'external',period:'',evidenceRevisionIds:['a']}]};
  assert.equal(validateResult(result,notes,'ask'),result);
  assert.throws(()=>validateResult({...result,claims:[{...result.claims[0],evidenceRevisionIds:['invented']}]},notes,'ask'),/unsupported answer claims/);
  assert.throws(()=>validateResult({...result,claims:[]},notes,'ask'),/invalid answer claims/);
  assert.match(promptFor('ask',notes,[],'誰の意見？'),/record.*inference/);
});

test('an insufficient Ask answer contains no factual claims',()=>{
  const notes=[{revisionId:'a',text:'ピアノを聴いた。',date:'2026-09-01'}];
  const result={status:'insufficient',text:'値段はメモから分かりません。',pattern:'',action:'',evidenceRevisionIds:[],categories:[],claims:[]};
  assert.equal(validateResult(result,notes,'ask'),result);
  assert.throws(()=>validateResult({...result,claims:[{text:'値段は千円。',kind:'record',speaker:'self',period:'',evidenceRevisionIds:['a']}]},notes,'ask'),/invalid answer claims/);
});

test('external sources cannot alone support a claim about the user',()=>{
  const notes=[{revisionId:'article',text:'記事ではジャズが最高とある。',sourceKind:'reference',sourceUrl:'https://example.com/jazz',date:'2026-09-01'}];
  const result={status:'ready',text:'記事がジャズを薦めています。',pattern:'',action:'',evidenceRevisionIds:['article'],categories:[],claims:[{text:'記事がジャズを薦めている。',kind:'record',speaker:'external',period:'',evidenceRevisionIds:['article']}]};
  assert.equal(validateResult(result,notes,'ask'),result);
  assert.throws(()=>validateResult({...result,claims:[{...result.claims[0],speaker:'self'}]},notes,'ask'),/unsupported answer claims/);
  assert.match(promptFor('ask',notes,[],'私の好みは？'),/"sourceKind":"reference"/);
  assert.match(promptFor('ask',notes,[],'私の好みは？'),/"sourceUrl":"https:\/\/example.com\/jazz"/);
});
