const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name,arg)=>ipcRenderer.invoke(`pure:${name}`,arg);
contextBridge.exposeInMainWorld('pureDesktop',{
  load:()=>invoke('load'),saveNote:arg=>invoke('save-note',arg),retryArticle:id=>invoke('retry-article',id),articleText:id=>invoke('article-text',id),openArticle:id=>invoke('open-article',id),readAttachment:id=>invoke('read-attachment',id),removeAttachment:id=>invoke('remove-attachment',id),trashNote:id=>invoke('trash-note',id),restoreNote:id=>invoke('restore-note',id),purgeNote:id=>invoke('purge-note',id),renameCategory:arg=>invoke('rename-category',arg),createCategory:arg=>invoke('create-category',arg),assignNote:arg=>invoke('assign-note',arg),unassignNote:arg=>invoke('unassign-note',arg),archiveCategory:id=>invoke('archive-category',id),mergeCategory:arg=>invoke('merge-category',arg),splitCategory:arg=>invoke('split-category',arg),restoreCategory:id=>invoke('restore-category',id),suggestCategory:arg=>invoke('suggest-category',arg),
  saveDraft:text=>invoke('draft',text),categoryNotes:id=>invoke('category-notes',id),graph:()=>invoke('graph'),memoryMap:()=>invoke('memory-map'),analyzeMemory:arg=>invoke('analyze-memory',arg),reviewMemoryTheme:arg=>invoke('review-memory-theme',arg),latest:id=>invoke('latest',id),
  rate:arg=>invoke('rate',arg),questions:()=>invoke('questions'),account:()=>invoke('account'),aiSettings:arg=>invoke('ai-settings',arg),models:()=>invoke('models'),setReasoningEffort:value=>invoke('set-reasoning-effort',value),setLocale:value=>invoke('set-locale',value),syncModel:value=>invoke('sync-model',value),
  captureAccess:()=>invoke('capture-access'),requestCaptureAccess:()=>invoke('capture-request-access'),captureExcluded:value=>invoke('capture-excluded',value),
  captureSave:arg=>invoke('capture-save',arg),captureHide:()=>invoke('capture-hide'),captureResize:height=>invoke('capture-resize',height),captureScreenshot:()=>invoke('capture-screenshot'),captureUndo:id=>invoke('capture-undo',id),
  onCaptureContext:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('pure:capture-context',listener);return()=>ipcRenderer.removeListener('pure:capture-context',listener)},
  onCaptureDismiss:callback=>{const listener=()=>callback();ipcRenderer.on('pure:capture-dismiss',listener);return()=>ipcRenderer.removeListener('pure:capture-dismiss',listener)},
  onCaptureHud:callback=>{const listener=(_,message)=>callback(message);ipcRenderer.on('pure:capture-hud',listener);return()=>ipcRenderer.removeListener('pure:capture-hud',listener)},
  progressList:()=>invoke('progress-list'),
  news:()=>invoke('news'),newsSettings:arg=>invoke('news-settings',arg),refreshNews:()=>invoke('news-refresh'),openNews:url=>invoke('open-news',url),
  aiUsage:arg=>invoke('ai-usage',arg),backfillDecide:value=>invoke('backfill-decide',value),
  onAiUsageChanged:callback=>{const listener=()=>callback();ipcRenderer.on('pure:ai-usage-changed',listener);return()=>ipcRenderer.removeListener('pure:ai-usage-changed',listener)},
  onNewsChanged:callback=>{const listener=()=>callback();ipcRenderer.on('pure:news-changed',listener);return()=>ipcRenderer.removeListener('pure:news-changed',listener)},
  onProgress:callback=>{const listener=(_,tasks)=>callback(tasks);ipcRenderer.on('pure:progress',listener);return()=>ipcRenderer.removeListener('pure:progress',listener)},
  onNotesChanged:callback=>{const listener=()=>callback();ipcRenderer.on('pure:notes-changed',listener);return()=>ipcRenderer.removeListener('pure:notes-changed',listener)},
  login:()=>invoke('login'),analyze:arg=>invoke('analyze',arg),ask:arg=>invoke('ask',arg),backup:()=>invoke('backup'),managedBackups:()=>invoke('managed-backups'),deleteManagedBackup:name=>invoke('delete-managed-backup',name),restore:()=>invoke('restore'),importNotes:()=>invoke('import'),
  setAiExcluded:arg=>invoke('set-ai-excluded',arg),
  updateProcessingJob:arg=>invoke('update-processing-job',arg),
  setAutoClassify:enabled=>invoke('set-auto-classify',enabled),retryClassification:()=>invoke('retry-classification'),
  setAutoDigest:arg=>invoke('set-auto-digest',arg),setDigestModel:model=>invoke('set-digest-model',model),retryDigests:()=>invoke('retry-digests'),setAskDigest:enabled=>invoke('set-ask-digest',enabled),
  onCapture:callback=>{const listener=()=>callback();ipcRenderer.on('pure:open-capture',listener);return()=>ipcRenderer.removeListener('pure:open-capture',listener)},
  onClassificationChange:callback=>{const listener=()=>callback();ipcRenderer.on('pure:classification-changed',listener);return()=>ipcRenderer.removeListener('pure:classification-changed',listener)},
  onDigestChange:callback=>{const listener=()=>callback();ipcRenderer.on('pure:digest-changed',listener);return()=>ipcRenderer.removeListener('pure:digest-changed',listener)},
  onArticleChange:callback=>{const listener=()=>callback();ipcRenderer.on('pure:article-changed',listener);return()=>ipcRenderer.removeListener('pure:article-changed',listener)}
});
