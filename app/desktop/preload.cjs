const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name,arg)=>ipcRenderer.invoke(`pure:${name}`,arg);
contextBridge.exposeInMainWorld('pureDesktop',{
  load:()=>invoke('load'),saveNote:arg=>invoke('save-note',arg),retryArticle:id=>invoke('retry-article',id),openArticle:id=>invoke('open-article',id),readAttachment:id=>invoke('read-attachment',id),removeAttachment:id=>invoke('remove-attachment',id),trashNote:id=>invoke('trash-note',id),restoreNote:id=>invoke('restore-note',id),purgeNote:id=>invoke('purge-note',id),renameCategory:arg=>invoke('rename-category',arg),createCategory:arg=>invoke('create-category',arg),assignNote:arg=>invoke('assign-note',arg),unassignNote:arg=>invoke('unassign-note',arg),archiveCategory:id=>invoke('archive-category',id),mergeCategory:arg=>invoke('merge-category',arg),splitCategory:arg=>invoke('split-category',arg),restoreCategory:id=>invoke('restore-category',id),suggestCategory:arg=>invoke('suggest-category',arg),
  saveDraft:text=>invoke('draft',text),categoryNotes:id=>invoke('category-notes',id),graph:()=>invoke('graph'),latest:id=>invoke('latest',id),
  rate:arg=>invoke('rate',arg),questions:()=>invoke('questions'),account:()=>invoke('account'),models:()=>invoke('models'),
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
