const {app,BrowserWindow,ipcMain,globalShortcut,dialog,shell} = require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {Store}=require('./store.cjs');
const {CodexClient}=require('./codex.cjs');
const {ClaudeCodeClient}=require('./claude-code.cjs');
const {AiRouter}=require('./ai-router.cjs');
const {AnalysisExecutor}=require('./analysis-executor.cjs');
const {Classifier}=require('./classifier.cjs');
const {DigestWorker}=require('./digest-worker.cjs');
const {ArticleWorker}=require('./article-worker.cjs');
const {listManagedBackups,deleteManagedBackup}=require('./backup-audit.cjs');
const {createCaptureController}=require('./capture-window.cjs');
const {parseCaptureUrl}=require('./capture.cjs');
const {Progress}=require('./progress.cjs');
const {NewsWorker}=require('./news.cjs');
const {AiUsage}=require('./ai-usage.cjs');
const {EmbeddingWarmer}=require('./retrieval.cjs');
const {ProfileWorker}=require('./profile.cjs');
const aiTasks=require('./ai-tasks.cjs');
let win,store,analysisAi,classifier,digestWorker,articleWorker,newsWorker,profileWorker,captureController;
// The model chosen in the renderer, so captures saved from the panel are classified too.
let currentModel='';
const pendingCaptureUrls=[];
const codex=new CodexClient(),claude=new ClaudeCodeClient();
// Every AI call goes through the router: the provider chosen in Settings, light work on the light model.
let ai,aiUsage,embeddingWarmer;
// Tells the window that an AI call finished, at most every few seconds, so the usage shown follows.
// Reading older notes into memory: how many there are, and a rough time at the AI connected now
// (from earlier reads when there are some; batches of 20, three at a time).
function backfillPlan(){
  const plan=store.memoryBackfillPlan(),provider=store.aiSettings().provider;
  const past=store.aiCalls(400).filter(call=>call.purpose==='memory-backfill'&&call.status==='ok'&&call.provider===provider);
  // The middle of at least five earlier reads; until then, what a batch usually takes.
  const times=past.map(call=>call.ms).sort((a,b)=>a-b);
  const perCall=times.length>=5?times[Math.floor(times.length/2)]:provider==='claude'?15000:70000;
  const estimate=count=>{const calls=Math.ceil(count/20);return {calls,minutes:calls?Math.max(1,Math.round(Math.ceil(calls/3)*perCall/60000)):0};};
  return {...plan,provider,all:estimate(plan.unread),lastYear:estimate(plan.recent)};
}
let usageTimer=null;
const usageChanged=()=>{if(usageTimer)return;usageTimer=setTimeout(()=>{usageTimer=null;if(win&&!win.isDestroyed())win.webContents.send('pure:ai-usage-changed')},3000);usageTimer.unref?.();};
// Step-by-step status of every wait, sent to the main window as it changes.
const progress=new Progress(tasks=>{if(win&&!win.isDestroyed())win.webContents.send('pure:progress',tasks)});
const dev=!!process.env.PURE_DEV_URL;
app.setName('pure.');
if(process.env.PURE_DEV_DATA_DIR){const dir=path.resolve(process.env.PURE_DEV_DATA_DIR);fs.mkdirSync(dir,{recursive:true});app.setPath('userData',dir);}
// One pure. per data folder: two copies (say the DMG app and a dev build) writing the same notes
// lose each other's edits. A second launch brings the first window forward instead.
const primary=app.requestSingleInstanceLock();
if(!primary)app.quit();
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});

// Native dialogs follow the UI language chosen in the renderer.
let uiLocale='ja';
const L=(ja,en)=>uiLocale==='en'?en:ja;
function api(channel,fn){ipcMain.handle(channel,async(_,arg)=>fn(arg));}
function wire(){
  api('pure:load',()=>({notes:store.listNotes(),trash:store.listTrash(),categories:store.categoryOverview(),archivedCategories:store.archivedCategories(),categoryMerges:store.categoryMerges(),categorySplits:store.categorySplits(),nextSteps:store.nextSteps(),draft:store.draft(),draftOriginKind:store.draftOrigin(),draftSourceKind:store.draftSource(),draftEditingId:store.draftEditing(),draftUpdatedAt:store.draftUpdatedAt(),draftAiExcluded:store.draftAiExcluded(),questions:store.questions(),reasoningEffort:store.reasoningEffort(),autoClassify:store.autoClassifyEnabled(),classificationStatus:store.classificationStatus(),backfill:backfillPlan(),autoDigest:store.autoDigestEnabled(),digestStatus:store.digestStatus(),askDigest:store.askDigestEnabled(),processingJobs:store.processingJobs()}));
  api('pure:save-note',arg=>{const saved=store.saveNote(arg);classifier.schedule();digestWorker.schedule();articleWorker.schedule();embeddingWarmer.schedule();return saved;});
  api('pure:article-text',id=>store.articleText(id));
  api('pure:retry-article',id=>{const queued=store.retryArticlePreview(id);if(queued)articleWorker.schedule();return queued;});
  api('pure:open-article',async id=>{const url=store.articleUrl(id);if(!url)throw new Error('Article URL not found.');const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error('Unsupported article URL.');await shell.openExternal(parsed.href);return true;});
  api('pure:read-attachment',id=>store.readAttachment(id));
  api('pure:remove-attachment',id=>store.removeAttachment(id));
  api('pure:set-ai-excluded',arg=>{
    const changed=store.setAiExcluded(arg);
    if(changed){analysisAi.cancelInvalid();classifier.schedule();digestWorker.schedule();}
    return changed;
  });
  api('pure:set-auto-classify',enabled=>{const value=store.autoClassifyEnabled(enabled===true);if(value){store.queueMemoryBackfill(currentModel);classifier.start();}else classifier.stop();return value;});
  api('pure:retry-classification',()=>{store.retryClassifications();classifier.schedule();return store.classificationStatus();});
  api('pure:set-auto-digest',arg=>{const enabled=store.autoDigestEnabled(arg?.enabled===true,arg?.model);if(enabled)digestWorker.start();else digestWorker.stop();return enabled;});
  api('pure:set-digest-model',arg=>store.setDigestModel(arg));
  api('pure:retry-digests',()=>{store.retryDigests();digestWorker.schedule();return store.digestStatus();});
  api('pure:set-ask-digest',arg=>store.askDigestEnabled(arg===true));
  api('pure:update-processing-job',arg=>{
    const changed=store.updateProcessingJob(arg);
    const worker=arg.kind==='classification'?classifier:digestWorker;
    if(changed&&arg.action==='cancel')worker.cancel(arg.id,arg.token);
    if(changed&&arg.action==='retry')worker.schedule();
    return changed;
  });
  api('pure:trash-note',arg=>{store.trashNote(arg);digestWorker.schedule();return true});
  api('pure:restore-note',arg=>{const restored=store.restoreNote(arg);digestWorker.schedule();return restored;});
  api('pure:purge-note',arg=>{const removed=store.purgeNote(arg);digestWorker.schedule();return removed;});
  api('pure:draft',arg=>store.saveDraftSnapshot(arg));
  api('pure:category-notes',arg=>store.notesFor(arg));
  api('pure:graph',()=>store.graphData());
  api('pure:memory-map',()=>store.memoryMapData());
  api('pure:review-memory-theme',arg=>store.reviewMemoryTheme(arg));
  api('pure:progress-list',()=>progress.list());
  api('pure:news',()=>({settings:store.newsSettings(),interests:store.newsInterests(),items:store.newsItems(),running:!!newsWorker.running,provider:store.aiSettings().provider}));
  api('pure:news-settings',arg=>{const settings=store.setNewsSettings(arg||{});if(newsWorker.due())newsWorker.run().catch(()=>{});return settings;});
  api('pure:news-refresh',()=>newsWorker.run());
  api('pure:open-news',async url=>{const known=store.newsUrl(url);if(!known||!/^https:\/\//.test(known))throw new Error('Unknown link.');await shell.openExternal(known);return true;});
  api('pure:analyze-memory',({model})=>progress.run('memory',{},task=>aiTasks.analyzeMemory({store,ai:analysisAi,model,task})));
  api('pure:rename-category',arg=>{const result=store.renameCategory(arg.id,arg.name);digestWorker.schedule();return result;});
  api('pure:create-category',arg=>{const result=store.createCategory(arg.name,arg.noteIds);digestWorker.schedule();return result;});
  api('pure:assign-note',arg=>{const result=store.assignNote(arg.noteId,arg.categoryId);digestWorker.schedule();return result;});
  api('pure:unassign-note',arg=>{const result=store.unassignNote(arg.noteId,arg.categoryId);digestWorker.schedule();return result;});
  api('pure:archive-category',arg=>{const result=store.archiveCategory(arg);digestWorker.schedule();return result;});
  api('pure:merge-category',arg=>{const result=store.mergeCategory(arg?.sourceId,arg?.targetId);classifier.schedule();digestWorker.schedule();return result;});
  api('pure:split-category',arg=>{const result=store.splitCategory(arg?.sourceId,arg?.name,arg?.noteIds);classifier.schedule();digestWorker.schedule();return result;});
  api('pure:restore-category',arg=>{const result=store.restoreCategory(arg);digestWorker.schedule();return result;});
  api('pure:latest',arg=>({state:store.insightState(arg),summary:store.latestOutput('summary',arg),pattern:store.latestOutput('pattern',arg),action:store.latestOutput('action',arg)}));
  api('pure:rate',arg=>{
    const output=store.rate(arg.outputId,arg.rating,arg.reason,arg.comment);
    if(store.autoDigestEnabled()&&arg.rating==='bad'&&output.category_id!=='all'&&['summary','pattern','action'].includes(output.kind)){
      store.invalidateInsight(output.category_id);store.queueStaleDigests();digestWorker.schedule();
    }
    return output;
  });
  api('pure:questions',()=>store.questions());
  api('pure:account',()=>ai.account());
  api('pure:models',()=>ai.models());
  api('pure:backfill-decide',value=>{store.backfillDecision(value);if(store.queueMemoryBackfill(currentModel))classifier.schedule();return backfillPlan();});
  api('pure:ai-usage',arg=>aiUsage.read({refresh:!!arg?.refresh}));
  api('pure:ai-settings',value=>{if(value)store.aiSettings(value);return {...store.aiSettings(),providers:[{id:'codex',label:'Codex'},{id:'claude',label:'Claude Code'}]};});
  api('pure:set-reasoning-effort',value=>store.reasoningEffort(value));
  api('pure:set-locale',value=>{uiLocale=store.uiLocale(value);return uiLocale;});
  // Notes saved before the memory layer (or while processing was off) are read in once a model is known.
  api('pure:sync-model',value=>{currentModel=typeof value==='string'?value.slice(0,200):'';if(store.queueMemoryBackfill(currentModel))classifier.schedule();return true;});
  api('pure:login',async()=>{
    const result=await ai.login();
    if(result.authUrl){const url=new URL(result.authUrl);if(url.protocol!=='https:')throw new Error('Unexpected login URL.');await shell.openExternal(result.authUrl);}
    return result;
  });
  api('pure:analyze',({categoryId,model})=>progress.run('analyze',{ref:categoryId},async task=>{
    const {output}=await aiTasks.analyzeCollection({store,ai:analysisAi,model,categoryId,task});
    store.queueStaleDigests();
    digestWorker.schedule();
    return {output,categories:store.categories()};
  }));
  api('pure:suggest-category',({model})=>progress.run('suggest',{},task=>aiTasks.suggestCategories({store,ai:analysisAi,model,task})));
  api('pure:ask',({question,model})=>progress.run('ask',{},async task=>(await aiTasks.ask({store,ai:analysisAi,model,question,task})).output));
  api('pure:backup',async()=>{
    const selected=await dialog.showSaveDialog(win,{title:L('pureの完全バックアップを保存','Save a full pure. backup'),buttonLabel:L('保存','Save'),defaultPath:'pure-backup.sqlite',filters:[{name:L('pureのバックアップ','pure. backup'),extensions:['sqlite']}]});
    if(selected.canceled||!selected.filePath)return null;
    return store.backupTo(selected.filePath);
  });
  api('pure:managed-backups',()=>listManagedBackups(path.join(app.getPath('userData'),'backups'),store.purgedNoteIds()));
  api('pure:delete-managed-backup',name=>deleteManagedBackup(path.join(app.getPath('userData'),'backups'),name));
  api('pure:import',async()=>{
    const selected=await dialog.showOpenDialog(win,{title:L('ブラウザ版のメモを取り込む','Import notes from the browser version'),buttonLabel:L('取り込む','Import'),properties:['openFile'],filters:[{name:L('書き出したメモ（JSON）','Exported notes (JSON)'),extensions:['json']}]});
    if(selected.canceled||!selected.filePaths[0])return null;
    const rows=JSON.parse(fs.readFileSync(selected.filePaths[0],'utf8'));
    const backupPath=path.join(app.getPath('userData'),'backups',`before-import-${Date.now()}.sqlite`);
    fs.mkdirSync(path.dirname(backupPath),{recursive:true});
    await store.backupTo(backupPath);
    const count=store.importLegacy(rows);embeddingWarmer.schedule(5000);
    return {count,backupPath};
  });
  api('pure:restore',async()=>{
    const selected=await dialog.showOpenDialog(win,{title:L('pureのバックアップを復元','Restore a pure. backup'),buttonLabel:L('復元','Restore'),properties:['openFile'],filters:[{name:L('pureのバックアップ','pure. backup'),extensions:['sqlite']}]});
    if(selected.canceled||!selected.filePaths[0])return null;
    const rollback=path.join(app.getPath('userData'),'backups',`before-restore-${Date.now()}.sqlite`);
    analysisAi.cancelAll();classifier.stop();digestWorker.stop();articleWorker.stop();newsWorker.stop();profileWorker.stop();embeddingWarmer.stop();await Promise.all([classifier.idle(),digestWorker.idle(),articleWorker.idle(),newsWorker.running?.catch(()=>{}),profileWorker.running?.catch(()=>{}),embeddingWarmer.running?.catch(()=>{})]);
    try{await store.restoreFrom(selected.filePaths[0],rollback)}finally{classifier.start();digestWorker.start();articleWorker.start();newsWorker.start();embeddingWarmer.start();embeddingWarmer.schedule(5000)}
    return {rollback};
  });
}
function createWindow(){
  win=new BrowserWindow({width:1440,height:900,minWidth:1100,minHeight:700,title:'pure.',backgroundColor:'#101c2a',titleBarStyle:'hiddenInset',trafficLightPosition:{x:16,y:16},webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(dev?`${process.env.PURE_DEV_URL}/`:'file://'))event.preventDefault()});
  if(dev)win.loadURL(`${process.env.PURE_DEV_URL}/desktop.html`);else win.loadFile(path.join(__dirname,'../dist/desktop.html'));
}
// pure://new?text=…&quote=…&url=…&title=… from Raycast, Shortcuts or a bookmarklet opens the panel
// pre-filled. A link can never save on its own; the user confirms with ⌘↵.
function openCaptureUrl(url){const prefill=parseCaptureUrl(url);if(prefill)captureController?.open(prefill)}
app.on('open-url',(event,url)=>{event.preventDefault();if(captureController)openCaptureUrl(url);else pendingCaptureUrls.push(url)});
if(dev&&process.argv[1])app.setAsDefaultProtocolClient('pure',process.execPath,[path.resolve(process.argv[1])]);else app.setAsDefaultProtocolClient('pure');
app.whenReady().then(()=>{
  if(!primary)return;
  store=new Store(path.join(app.getPath('userData'),'pure.sqlite'));
  codex.codexHome=path.join(app.getPath('userData'),'codex');
  codex.reasoningEffort=()=>store.reasoningEffort();
  ai=new AiRouter({providers:{codex,claude},provider:()=>store.aiSettings().provider,lightModel:()=>store.aiSettings().lightModel,
    reasoningEffort:()=>store.reasoningEffort(),onCall:call=>{try{store.logAiCall(call)}catch{}usageChanged();}});
  aiUsage=new AiUsage(store,{codex,claude,provider:()=>store.aiSettings().provider});
  uiLocale=store.uiLocale();
  analysisAi=new AnalysisExecutor(store,ai);
  // The profile follows the memory layer: a quiet moment after notes were read, what changed is rewritten.
  profileWorker=new ProfileWorker(store,analysisAi,{model:()=>currentModel,locale:()=>store.uiLocale(),progress,enabled:()=>store.autoClassifyEnabled()});
  classifier=new Classifier(store,analysisAi,()=>{if(win&&!win.isDestroyed())win.webContents.send('pure:classification-changed');digestWorker?.schedule();profileWorker?.schedule()},progress);
  digestWorker=new DigestWorker(store,analysisAi,classifier,()=>{if(win&&!win.isDestroyed())win.webContents.send('pure:digest-changed')},progress);
  // When a link has been read, sorting that was waiting for it can go ahead.
  // Interests are found in the notes like any other analysis (through the AI exclusion guard), and
  // only again when the notes changed. News prompts themselves hold only the resulting words.
  const findInterests=({model,task})=>aiTasks.findInterests({store,ai:analysisAi,model,task});
  newsWorker=new NewsWorker(store,{ai,model:()=>currentModel,locale:()=>store.uiLocale(),findInterests,progress,aiName:()=>store.aiSettings().provider==='claude'?'Claude Code':'Codex',onChange:()=>{if(win&&!win.isDestroyed())win.webContents.send('pure:news-changed')}});
  articleWorker=new ArticleWorker(store,undefined,()=>{classifier?.schedule();if(win&&!win.isDestroyed())win.webContents.send('pure:article-changed')},progress);
  wire();createWindow();
  classifier.start();digestWorker.start();articleWorker.start();newsWorker.start();profileWorker.schedule(60000);
  embeddingWarmer=new EmbeddingWarmer(store,{progress});embeddingWarmer.schedule(45000);
  captureController=createCaptureController({store,dev,devUrl:process.env.PURE_DEV_URL,preload:path.join(__dirname,'preload.cjs'),getModel:()=>currentModel,
    onSaved:()=>{classifier.schedule();digestWorker.schedule();articleWorker.schedule();if(win&&!win.isDestroyed())win.webContents.send('pure:notes-changed')}});
  captureController.wire(api);
  // ⌘⇧N: the capture panel over whatever app is in front. ⌥⌘⇧N: save the selection without a panel.
  globalShortcut.register('CommandOrControl+Shift+N',()=>captureController.open());
  globalShortcut.register('CommandOrControl+Alt+Shift+N',()=>captureController.instantSave());
  for(const url of pendingCaptureUrls.splice(0))openCaptureUrl(url);
  // The hidden capture panel keeps the app (and its shortcuts) alive after the main window closes.
  app.on('activate',()=>{if(!win||win.isDestroyed())createWindow();else win.show()});
});
app.on('will-quit',()=>{globalShortcut.unregisterAll();captureController?.dispose();newsWorker?.stop();profileWorker?.stop();embeddingWarmer?.stop();classifier?.stop();digestWorker?.stop();articleWorker?.stop();ai?.stop();store?.close()});
