export function isComposing(event){
  return !!(event.isComposing||event.nativeEvent?.isComposing||event.keyCode===229||event.nativeEvent?.keyCode===229);
}

export function globalKeyAction(event,captureOpen){
  if(isComposing(event))return null;
  if(event.key==='Escape')return captureOpen?'close':'clear-selection';
  if(!(event.metaKey||event.ctrlKey))return null;
  if(event.shiftKey&&event.key.toLowerCase()==='n')return captureOpen?'focus-capture':'open-capture';
  if(event.key.toLowerCase()==='k')return captureOpen?'keep-capture':'focus-search';
  return null;
}

export function shouldSaveCapture(event){
  return !isComposing(event)&&(event.metaKey||event.ctrlKey)&&event.key==='Enter';
}
