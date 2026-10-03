// Quick capture: reads the context around the shortcut (selection, source, recent clipboard and
// screenshots) through native/context-helper, and merges captures from the same page.
const {spawn,execFile}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');

const HELPER=path.join(__dirname,'..','native','context-helper').replace(`app.asar${path.sep}`,`app.asar.unpacked${path.sep}`);
const APPEND_WINDOW_MS=10*60*1000;
const RECENT_MS=30*1000;
// Password managers and keychains never give their selection.
const DEFAULT_EXCLUDED=['com.1password.1password','com.agilebits.onepassword7','com.bitwarden.desktop','com.apple.keychainaccess','com.apple.Passwords','com.lastpass.LastPass','com.dashlane.dashlanephonefinal'];

const helperAvailable=()=>fs.existsSync(HELPER);
function runHelper(args,timeout=1800){
  return new Promise(resolve=>{
    if(!helperAvailable()){resolve(null);return}
    execFile(HELPER,args,{timeout,encoding:'utf8',maxBuffer:2*1024*1024},(error,stdout)=>{
      if(error){resolve(null);return}
      try{resolve(JSON.parse(stdout.trim().split('\n').pop()))}catch{resolve(null)}
    });
  });
}

const readPasteboard=()=>runHelper(['read-pasteboard'],1500);
const readContext=({excluded=[],copy=true}={})=>runHelper(['capture','--exclude',[...DEFAULT_EXCLUDED,...excluded].join(','),...(copy?[]:['--no-copy'])]);
const accessStatus=()=>runHelper(['status'],1000).then(result=>({available:helperAvailable(),trusted:!!result?.trusted}));
const requestAccess=()=>runHelper(['prompt'],4000).then(result=>({available:helperAvailable(),trusted:!!result?.trusted}));

// Remembers when the pasteboard last changed (no contents are read here).
function watchPasteboard(){
  const state={at:0,concealed:false,hasImage:false,hasText:false,child:null,stopped:false};
  const start=()=>{
    if(state.stopped||!helperAvailable())return;
    const child=spawn(HELPER,['watch-pasteboard'],{stdio:['ignore','pipe','ignore']});
    state.child=child;let buffer='';
    child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      try{const change=JSON.parse(line);Object.assign(state,{at:Date.now(),concealed:!!change.concealed,hasImage:!!change.hasImage,hasText:!!change.hasText})}catch{}}});
    child.on('exit',()=>{state.child=null;if(!state.stopped)setTimeout(start,5000)});
  };
  start();
  return {recent:(now=Date.now())=>state.at&&now-state.at<=RECENT_MS&&!state.concealed?{at:state.at,hasImage:state.hasImage,hasText:state.hasText}:null,
    stop(){state.stopped=true;state.child?.kill()}};
}

// Screenshots taken in the last two minutes, from Spotlight (the file is read only when attached).
function recentScreenshot(now=Date.now()){
  return new Promise(resolve=>{
    execFile('/usr/bin/mdfind',['kMDItemIsScreenCapture == 1 && kMDItemFSCreationDate >= $time.now(-120)'],{timeout:900,encoding:'utf8'},(error,stdout)=>{
      if(error){resolve(null);return}
      const files=stdout.split('\n').filter(file=>/\.(png|jpe?g|heic)$/i.test(file));
      resolve(files.length?{path:files[files.length-1],name:path.basename(files[files.length-1])}:null);
    });
  });
}

// What the panel shows: the excerpt and its source, both removable before saving.
function describe(context){
  if(!context)return {available:helperAvailable(),trusted:false,selection:'',source:null,blocked:null};
  const blocked=context.secureInput?'secure':context.excluded?'excluded':null;
  return {available:true,trusted:!!context.trusted,blocked,selection:context.selection||'',selectionVia:context.selectionVia||null,
    source:context.app?{app:context.app.name,bundleId:context.app.bundleId,url:context.url||'',title:context.pageTitle||context.windowTitle||''}:null};
}

const join=(a,b)=>[a,b].map(value=>(value||'').trim()).filter(Boolean).join('\n\n');
// Captures from the same page within ten minutes go into one note: excerpts and words are appended.
function mergeCapture(previous,next){
  const previousExcerpt=previous.excerpt||(previous.sourceKind==='quote'?previous.text:'');
  const previousWords=previous.excerpt||previous.sourceKind!=='quote'?previous.text:'';
  return {id:previous.id,text:join(previousWords,next.text),excerpt:join(previousExcerpt,next.excerpt),sourceUrl:previous.sourceUrl||next.sourceUrl,
    sourceTitle:previous.sourceTitle||next.sourceTitle,sourceApp:previous.sourceApp||next.sourceApp,sourceKind:'unspecified'};
}
const canAppend=(previous,url,now=Date.now())=>!!(previous&&url&&previous.sourceUrl===url&&now-Date.parse(previous.date)<=APPEND_WINDOW_MS);

// pure://new?text=…&url=…&title=… opens the panel pre-filled; it never saves on its own.
function parseCaptureUrl(raw){
  try{
    const url=new URL(raw);
    if(url.protocol!=='pure:'||!['new','capture'].includes(url.hostname||url.pathname.replace(/^\/+/,'')))return null;
    const get=name=>(url.searchParams.get(name)||'').slice(0,20000);
    return {text:get('text'),excerpt:get('quote'),sourceUrl:/^https?:\/\//i.test(get('url'))?get('url'):'',sourceTitle:get('title').slice(0,300)};
  }catch{return null}
}

module.exports={readContext,readPasteboard,accessStatus,requestAccess,watchPasteboard,recentScreenshot,describe,mergeCapture,canAppend,parseCaptureUrl,DEFAULT_EXCLUDED,APPEND_WINDOW_MS,helperAvailable};
