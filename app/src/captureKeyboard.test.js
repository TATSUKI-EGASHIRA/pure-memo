import test from 'node:test';
import assert from 'node:assert/strict';
import {globalKeyAction,shouldSaveCapture} from './captureKeyboard.js';

test('capture shortcuts stay inside the open dialog',()=>{
  assert.equal(globalKeyAction({key:'k',metaKey:true},true),'keep-capture');
  assert.equal(globalKeyAction({key:'N',metaKey:true,shiftKey:true},true),'focus-capture');
  assert.equal(globalKeyAction({key:'k',metaKey:true},false),'focus-search');
  assert.equal(globalKeyAction({key:'N',metaKey:true,shiftKey:true},false),'open-capture');
  assert.equal(globalKeyAction({key:'Escape'},true),'close');
});

test('Japanese conversion never triggers capture shortcuts or save',()=>{
  for(const marker of [{isComposing:true},{nativeEvent:{isComposing:true}},{keyCode:229}]){
    assert.equal(globalKeyAction({key:'Escape',...marker},true),null);
    assert.equal(globalKeyAction({key:'N',metaKey:true,shiftKey:true,...marker},false),null);
    assert.equal(shouldSaveCapture({key:'Enter',metaKey:true,...marker}),false);
  }
  assert.equal(shouldSaveCapture({key:'Enter',metaKey:true}),true);
});
