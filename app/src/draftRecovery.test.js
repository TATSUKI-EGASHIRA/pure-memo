import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecoveryDraft,selectDraft} from './draftRecovery.js';

test('an interrupted edit recovers the newer text and its note identity',()=>{
  const database={draft:'古い下書き',draftOriginKind:'human',draftSourceKind:'unspecified',draftEditingId:'n1',draftUpdatedAt:100};
  const recovery=JSON.stringify({text:'最後に入力した文字',originKind:'human',sourceKind:'thought',editingId:'n1',updatedAt:101});
  assert.deepEqual(selectDraft(database,recovery),{text:'最後に入力した文字',originKind:'human',sourceKind:'thought',editingId:'n1',updatedAt:101,recovered:true,aiExcluded:false});
  assert.equal(selectDraft({...database,draftUpdatedAt:102},recovery).text,'古い下書き');
  assert.equal(selectDraft({...database,draft:'',draftUpdatedAt:102},recovery).text,'');
});

test('a recovered draft keeps its AI exclusion before the first save',()=>{
  const database={draft:'古い下書き',draftUpdatedAt:20,draftAiExcluded:true};
  assert.equal(selectDraft(database,null).aiExcluded,true);
  const recovery=JSON.stringify({text:'まだ公開しない思いつき',updatedAt:21,originKind:'human',sourceKind:'thought',editingId:'',aiExcluded:true});
  assert.equal(selectDraft(database,recovery).aiExcluded,true);
  assert.equal(parseRecoveryDraft(JSON.stringify({...JSON.parse(recovery),aiExcluded:'false'})),null);
});

test('invalid or empty emergency records cannot replace a saved draft',()=>{
  const database={draft:'保存済み',draftUpdatedAt:20};
  assert.equal(parseRecoveryDraft('{broken'),null);
  assert.equal(parseRecoveryDraft(JSON.stringify({text:'',updatedAt:30,originKind:'human',sourceKind:'thought',editingId:''})),null);
  assert.equal(selectDraft(database,'{broken').text,'保存済み');
});
