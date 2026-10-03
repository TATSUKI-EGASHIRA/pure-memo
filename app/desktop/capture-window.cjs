// The quick-capture panel (⌘⇧N) and the save HUD (⌥⌘⇧N). Both are NSPanel-type windows, so the
// app you were in stays frontmost while you type, and you are back in it as soon as they close.
const {BrowserWindow,screen}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const capture=require('./capture.cjs');

const PANEL_WIDTH=640,HUD_SIZE={width:420,height:64};

function createCaptureController({store,dev,devUrl,preload,getModel,onSaved}){
  let panel=null,hud=null,hudTimer=null,offeredScreenshot=null,lastContext=null;
  const pasteboard=capture.watchPasteboard();
  const page=hash=>dev?`${devUrl}/capture.html${hash}`:`file://${path.join(__dirname,'../dist/capture.html')}${hash}`;
  const base={type:'panel',frame:false,transparent:true,resizable:false,show:false,alwaysOnTop:true,skipTaskbar:true,fullscreenable:false,hasShadow:false,backgroundColor:'#00000000',
    webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true}};
  const guard=window=>{window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
    window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});window.setAlwaysOnTop(true,'floating')};
  function ensurePanel(){
    if(panel&&!panel.isDestroyed())return panel;
    panel=new BrowserWindow({...base,width:PANEL_WIDTH,height:260});guard(panel);
    panel.on('blur',()=>{if(panel?.isVisible())panel.webContents.send('pure:capture-dismiss')});
    panel.loadURL(page(''));
    return panel;
  }
  function ensureHud(){
    if(hud&&!hud.isDestroyed())return hud;
    hud=new BrowserWindow({...base,...HUD_SIZE});guard(hud);hud.loadURL(page('#hud'));
    return hud;
  }
  const ready=window=>window.webContents.isLoading()?new Promise(resolve=>window.webContents.once('did-finish-load',resolve)):Promise.resolve();
  function place(window,{width,height},top){
    const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window.setBounds({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+area.height*top),width,height});
  }

  // Everything the panel offers is gathered before it appears; the contents of the clipboard are
  // read only when it changed in the last 30 seconds and was not marked concealed.
  async function gather(prefill){
    const recent=pasteboard.recent();
    const [context,screenshot]=await Promise.all([prefill?Promise.resolve(null):capture.readContext({excluded:store.captureExcluded()}),capture.recentScreenshot()]);
    lastContext=context;
    const described=capture.describe(context);
    // A pure:// link brings its own text and source; nothing is read from the frontmost app.
    if(prefill){described.selection=prefill.excerpt||'';described.source=prefill.sourceUrl?{app:'',url:prefill.sourceUrl,title:prefill.sourceTitle}:null;described.trusted=true;}
    let copied=null;
    if(recent&&context?.selectionVia!=='copy'){
      const contents=await capture.readPasteboard();
      const text=recent.hasText&&contents?.text?contents.text:'';
      copied={text:text.trim()&&text.trim()!==described.selection.trim()?text:'',image:recent.hasImage&&contents?.pngBase64?{dataBase64:contents.pngBase64,mediaType:'image/png',fileName:'Clipboard.png'}:null};
      if(!copied.text&&!copied.image)copied=null;
    }
    offeredScreenshot=screenshot?.path||null;
    const url=described.source?.url||'';
    const previous=store.recentCaptureFor(url);
    const append=capture.canAppend(previous,url)?{minutes:Math.max(1,Math.round((Date.now()-Date.parse(previous.date))/60000)),title:previous.sourceTitle||url}:null;
    return {...described,copied,screenshot:screenshot?{name:screenshot.name}:null,append,prefill:prefill?{text:prefill.text||''}:null};
  }

  async function open(prefill){
    const window=ensurePanel();
    if(window.isVisible()&&!prefill){window.webContents.send('pure:capture-dismiss');return}
    const payload=await gather(prefill);
    await ready(window);
    window.webContents.send('pure:capture-context',payload);
    place(window,{width:PANEL_WIDTH,height:window.getBounds().height},.22);
    window.show();window.focus();
  }

  function saveInput(input,{append}={}){
    const payload={text:String(input.text||''),excerpt:String(input.excerpt||''),sourceUrl:String(input.sourceUrl||''),sourceTitle:String(input.sourceTitle||''),sourceApp:String(input.sourceApp||''),
      aiExcluded:input.aiExcluded===true,attachments:Array.isArray(input.attachments)?input.attachments.slice(0,4):[]};
    const previous=append?store.recentCaptureFor(payload.sourceUrl):null;
    const merged=capture.canAppend(previous,payload.sourceUrl)?capture.mergeCapture(previous,payload):null;
    const saved=store.saveNote({...(merged||payload),attachments:payload.attachments,aiExcluded:merged?undefined:payload.aiExcluded,originKind:'human',sourceKind:'unspecified',model:getModel()});
    onSaved();
    return {id:saved.id,appended:!!merged};
  }

  function showHud(message){
    const window=ensureHud();
    ready(window).then(()=>{
      window.webContents.send('pure:capture-hud',message);
      place(window,HUD_SIZE,.8);window.showInactive();
      clearTimeout(hudTimer);hudTimer=setTimeout(()=>window.hide(),2600);
    });
  }

  // ⌥⌘⇧N: save the selection with its source, no panel. Never appends, so undo is a plain trash.
  async function instantSave(){
    const context=await capture.readContext({excluded:store.captureExcluded()});
    const described=capture.describe(context);
    if(!described.available)return showHud({kind:'error',key:'選択テキストの取得にはネイティブ補助が必要です'});
    if(described.blocked)return showHud({kind:'error',key:described.blocked==='secure'?'パスワード入力中のため取り込みませんでした':'このアプリからは取り込みません'});
    if(!described.trusted)return showHud({kind:'access',key:'選択テキストを取り込むにはアクセシビリティの許可が必要です'});
    if(!described.selection.trim())return showHud({kind:'error',key:'選択しているテキストがありません'});
    const result=saveInput({excerpt:described.selection,sourceUrl:described.source?.url,sourceTitle:described.source?.title,sourceApp:described.source?.app});
    showHud({kind:'saved',key:'保存しました',detail:described.source?.title||described.source?.app||'',excerpt:described.selection.slice(0,80),undoId:result.id});
  }

  function wire(api){
    api('pure:capture-save',input=>{const result=saveInput(input,{append:input?.append===true});panel?.hide();return result});
    api('pure:capture-hide',()=>{panel?.hide();return true});
    api('pure:capture-resize',height=>{if(panel&&Number.isFinite(height)){const bounds=panel.getBounds();panel.setBounds({...bounds,height:Math.max(160,Math.min(720,Math.round(height)))})}return true});
    api('pure:capture-access',()=>capture.accessStatus());
    api('pure:capture-request-access',()=>capture.requestAccess());
    // Only the screenshot just offered can be read; the panel cannot ask for arbitrary paths.
    api('pure:capture-screenshot',()=>{
      if(!offeredScreenshot)throw new Error('No screenshot to attach.');
      const bytes=fs.readFileSync(offeredScreenshot);
      if(bytes.length>8*1024*1024)throw new Error('Use a PNG, JPEG, GIF or WebP image up to 8 MB.');
      const ext=path.extname(offeredScreenshot).toLowerCase();
      return {dataBase64:bytes.toString('base64'),mediaType:ext==='.png'?'image/png':'image/jpeg',fileName:path.basename(offeredScreenshot)};
    });
    api('pure:capture-undo',id=>{store.trashNote(id);onSaved();hud?.hide();return true});
    api('pure:capture-excluded',value=>value===undefined?store.captureExcluded():store.captureExcluded(value));
  }

  return {open,instantSave,wire,dispose(){pasteboard.stop();panel?.destroy();hud?.destroy()}};
}

module.exports={createCaptureController};
