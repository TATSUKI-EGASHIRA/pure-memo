import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {GlobeIcon,FileTextIcon,LayersIcon,QuestionMarkCircledIcon,GearIcon,PlusIcon,Cross2Icon,ArrowRightIcon,CheckIcon,DownloadIcon,MagnifyingGlassIcon,LightningBoltIcon,ClockIcon,Pencil1Icon,TrashIcon,ReloadIcon,Link2Icon,BookmarkIcon,ImageIcon,Share1Icon,LockClosedIcon,ArrowLeftIcon,ArrowUpIcon,MixerHorizontalIcon,ArchiveIcon,BorderSplitIcon,StackIcon} from '@radix-ui/react-icons';
import GraphView from './GraphView.jsx';
import PlasmaBackground from './PlasmaBackground.jsx';
import {PageHeading,InfoDetails,HeadingTools,Logo,LogoMark,Drop,Ripple,Disc,CenterStage} from './UiPrimitives.jsx';
import ProcessingQueue from './ProcessingQueue.jsx';
import {ProgressPanel,BackgroundProgress,useProgressTasks} from './ProgressPanel.jsx';
import SettingsView,{SettingsSidebar,SettingsSearch,settingsCategories} from './SettingsView.jsx';
import settingsSections from './SettingsSections.jsx';
import AiExclusionControl from './AiExclusionControl.jsx';
import AiUsageMeter from './AiUsageMeter.jsx';
import SideActivity from './SideActivity.jsx';
import BackfillPrompt,{BackfillStatus} from './BackfillPrompt.jsx';
import {SourceLinks,Rating,sourceLabels} from './OutputParts.jsx';
import NextStepsView from './NextStepsView.jsx';
import AskView from './AskView.jsx';
import NewsView from './NewsView.jsx';
import CategoryManager from './CategoryManager.jsx';
import OrbitView,{ViewSwitch} from './OrbitView.jsx';
import {noteNodeIds,PENDING_ID} from './orbitLayout.js';
import BootAnimation from './BootAnimation.jsx';
import {DRAFT_RECOVERY_KEY,selectDraft} from './draftRecovery.js';
import {globalKeyAction,shouldSaveCapture} from './captureKeyboard.js';
import './style.css';
import './desktop.css';
import './motion.css';
import './ux-refinements.css';
import './card-system.css';
import './workspace.css';
import './stagger-cards.css';
import './settings-layout.css';
import './reading-surfaces.css';
import './intuitive-ui.css';
import './fonts.css';
import './pure-ui.css';
import {t,dayAndMonth,dateLocale,getLocale,setLocale,errorText} from './i18n.js';
const api=window.pureDesktop;
const categoryLabel=category=>category?.id==='all'?t('すべてのメモ'):category?.id==='other'?t('未分類'):category?.name;
const pageLabels={Notes:'メモ',Collections:'まとめ',Graph:'つながり',Categories:'カテゴリ','Create Category':'新規カテゴリ','Next Steps':'提案',Ask:'メモに質問',News:'ニュース',Trash:'ごみ箱',Settings:'設定'};
const navigation=[[FileTextIcon,'Notes'],[LayersIcon,'Collections'],[Share1Icon,'Graph'],[LightningBoltIcon,'Next Steps'],[QuestionMarkCircledIcon,'Ask'],[GlobeIcon,'News']];
function SidebarIcon(){return <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="3" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M7 3v12" stroke="currentColor" strokeWidth="1.3"/></svg>}

let lastDraftStamp=0;
function nextDraftStamp(){lastDraftStamp=Math.max(Date.now(),lastDraftStamp+1);return lastDraftStamp;}
function rememberDraft(value){try{if(value.text)localStorage.setItem(DRAFT_RECOVERY_KEY,JSON.stringify(value));else localStorage.removeItem(DRAFT_RECOVERY_KEY)}catch{}}
const Mark=()=><LogoMark/>;
function SplitCategoryForm({source,busy,onSplit,onCancel}){
  const [notes,setNotes]=useState([]),[name,setName]=useState(''),[selected,setSelected]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;setLoading(true);setError('');api.categoryNotes(source.id).then(rows=>{if(active){setNotes(rows);setLoading(false)}}).catch(cause=>{if(active){setError(cause.message);setLoading(false)}});return()=>{active=false}},[source.id]);
  return <form className="native-split" onSubmit={event=>{event.preventDefault();onSplit(source.id,name,selected)}}>
    <span className="eyebrow">{t('{name}を分割',{name:source.name})}</span>
    <label htmlFor={`split-name-${source.id}`}>{t('新しいカテゴリ名')}</label>
    <input id={`split-name-${source.id}`} value={name} onChange={event=>setName(event.target.value)} maxLength={60} placeholder={t('カテゴリ名')} required/>
    <span className="eyebrow">{t('移すメモ · {n}件',{n:selected.length})}</span>
    {loading?<p>{t('読み込み中…')}</p>:error?<p role="alert">{errorText(error)}</p>:<div className="split-note-list">{notes.map(note=><label key={note.id}><input type="checkbox" checked={selected.includes(note.id)} onChange={event=>setSelected(old=>event.target.checked?[...old,note.id]:old.filter(id=>id!==note.id))}/><span>{note.text||t('画像のメモ')}</span></label>)}</div>}
    <InfoDetails label={t('移動について')}><p>{t('選んだメモを新しいカテゴリへ移します。現在の版は元のカテゴリへ自動で戻さず、ほかのカテゴリへの所属は残します。')}</p></InfoDetails>
    <div className="split-actions"><button className="primary" disabled={busy||loading||!!error||!name.trim()||!selected.length||selected.length>=notes.length}><LayersIcon/>{t('{n}件を移動',{n:selected.length})}</button><button type="button" className="text-button" onClick={onCancel}>{t('キャンセル')}</button></div>
  </form>;
}
function trapCaptureFocus(event){
  if(event.key!=='Tab')return;
  const items=[...event.currentTarget.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),a[href]')].filter(item=>item.getClientRects().length);
  if(!items.length)return;
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function SavedImage({attachment}){
  const [src,setSrc]=useState('');
  useEffect(()=>{let current=true;api.readAttachment(attachment.id).then(data=>{if(current)setSrc(`data:${data.mediaType};base64,${data.dataBase64}`)}).catch(()=>{});return()=>{current=false}},[attachment.id]);
  return src?<img src={src} alt={attachment.fileName||'Attached image'}/>:<span className="image-loading">Loading image…</span>;
}
// "昨日 · 9月30日 水": a relative word only for today and yesterday.
function dayLabel(value){
  const date=new Date(value),today=new Date();today.setHours(0,0,0,0);
  const day=new Date(date);day.setHours(0,0,0,0);
  const offset=Math.round((today-day)/86400000);
  const label=dayAndMonth(date);
  return offset===0?t('今日 · {label}',{label}):offset===1?t('昨日 · {label}',{label}):label;
}
function noteTag(note,categories){
  const id=noteNodeIds(note)[0],name=categories.find(category=>category.id===id)?.name;
  return name||(id===PENDING_ID?t('分類待ち'):'');
}
// What AI read from a linked page (desktop/classifier.cjs): what it is and what the note says to do.
const LINK_KINDS={music:'音楽',video:'動画',podcast:'ポッドキャスト',article:'記事',product:'商品',place:'場所',other:'リンク'};
const LINK_INTENTS={listen:'後で聞く',watch:'後で見る',read:'後で読む',buy:'後で買う',visit:'行きたい'};
const linkName=note=>[note.linkCreator,note.linkTitle].filter(Boolean).join(' — ');
const LIST_STEP=200;
function NoteRow({note,categories,selected,saved,index=0,onSelect}){
  const images=note.attachments?.length||0;
  const kind=note.isDemo?t('サンプル'):note.originKind==='generated'?t('提案の下書き'):note.sourceKind&&note.sourceKind!=='unspecified'?t(sourceLabels[note.sourceKind]):'';
  const meta=[kind,note.linkKind&&linkName(note)?`${t(LINK_KINDS[note.linkKind]||'リンク')} · ${linkName(note)}`:note.articleStatus==='ready'&&note.articleTitle?t('{n} · {articleTitle}',{n:note.articleSiteName||t('記事'),articleTitle:note.articleTitle}):'',images?t('画像 {images}枚',{images:images}):'',note.aiExcluded?t('AI対象外'):''].filter(Boolean);
  return <button data-note-id={note.id} className={'note-line'+(selected?' selected':'')+(saved?' just-saved':'')} onClick={()=>onSelect(note.id)} aria-pressed={selected}>
    <Drop/>
    <time dateTime={note.date}>{new Date(note.date).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</time>
    <span className="note-line-body"><span className="note-line-text">{note.text||note.excerpt||t('画像のメモ')}</span>{(meta.length>0||LINK_INTENTS[note.linkIntent])&&<small>{note.aiExcluded&&<LockClosedIcon aria-hidden="true"/>}{LINK_INTENTS[note.linkIntent]&&<span className="link-intent">{t(LINK_INTENTS[note.linkIntent])}</span>}{meta.join(' · ')}</small>}</span>
    <span className="note-line-tag">{noteTag(note,categories)}</span>
  </button>;
}
// What the link says: title and description, plus the page text pure. read for AI (shown on demand).
function ArticlePreview({note,onOpen,onRetry}){
  const [body,setBody]=useState(null);
  useEffect(()=>{setBody(null)},[note.id,note.articleFetchedAt]);
  if(!note.sourceUrl)return null;
  const ready=note.articleStatus==='ready',chars=note.articleChars||0;
  const loadBody=event=>{if(event.currentTarget.open&&!body)api.articleText(note.id).then(result=>setBody(result?.text||'')).catch(()=>setBody(''))};
  return <section className="inspector-article" aria-label={t('記事プレビュー')}>
    <span className="eyebrow">{t('参考記事')}</span>
    {ready&&note.linkKind&&<div className="link-reading">
      <span className="link-reading-kind">{t(LINK_KINDS[note.linkKind]||'リンク')}{LINK_INTENTS[note.linkIntent]&&<span className="link-intent">{t(LINK_INTENTS[note.linkIntent])}</span>}</span>
      {(note.linkTitle||note.linkCreator)&&<h3>{note.linkTitle||note.linkCreator}</h3>}{note.linkTitle&&note.linkCreator&&<p className="link-reading-creator">{note.linkCreator}</p>}
      {note.linkSummary&&<p>{note.linkSummary}</p>}
      <small>{t('AIがリンク先から読み取りました')}</small>
    </div>}
    {ready?<>{note.linkKind?<p className="link-reading-source">{note.articleTitle}</p>:<h3>{note.articleTitle||note.articleSiteName||t('記事')}</h3>}{note.articleDescription&&!note.linkSummary&&<p>{note.articleDescription}</p>}<small>{note.articleSiteName}</small>
      <p className="article-read-state">{chars>0?t('本文 {n}文字を読み取りました。AIは外部の資料として参照します。',{n:chars.toLocaleString()}):t('本文は読み取れませんでした（JavaScriptで表示するページなど）。タイトルと説明だけをAIに渡します。')}</p>
      {chars>0&&<details className="ui-details article-body" onToggle={loadBody}><summary><span>{t('読み取った本文')}</span></summary><div className="ui-details-content">{body===null?<p>{t('読み込み中…')}</p>:<p>{body.slice(0,1600)}{body.length>1600?'…':''}</p>}</div></details>}</>
      :<p>{note.articleStatus==='failed'?t('プレビューを取得できませんでした'):note.articleStatus==='pending'||note.articleStatus==='running'?t('記事を読み込み中…'):t('リンクを保存済み')}</p>}
    <div><button type="button" className="secondary" onClick={()=>onOpen(note.id)}><Link2Icon/>{t('記事を開く')}</button>{note.articleStatus==='failed'&&<button type="button" className="text-button" onClick={()=>onRetry(note.id)}><ReloadIcon/>{t('再取得')}</button>}</div>
  </section>;
}

function ManagedBackups({items,loading,error,onRefresh,onDelete,headingId}){
  return <section className="managed-backups" aria-labelledby={headingId}><div className="managed-backups-head"><div>{!headingId&&<h3>{t('アプリ内バックアップ')}</h3>}<InfoDetails label={t('対象ファイル')}><p>{t('取り込みや復元の前にpureが作成したファイルです。手動で保存したバックアップは含まれません。')}</p><p>{t('別の場所に保存・コピーしたファイルはここから確認・削除できません。')}</p></InfoDetails></div><button className="text-button" onClick={onRefresh} disabled={loading}><ReloadIcon/>{t('再確認')}</button></div>
    {loading?<p role="status">{t('バックアップを確認中…')}</p>:error?<p role="alert">{errorText(error)}</p>:items.length?<div className="managed-backup-list">{items.map(item=><div className="managed-backup-row" key={item.name}><div><strong>{item.name}</strong><small>{new Date(item.modifiedAt).toLocaleDateString(dateLocale(),{year:'numeric',month:'long',day:'numeric'})} · {Math.ceil(item.size/1024)} KB</small><span className={item.status==='contains-deleted'?'managed-backup-warning':''}>{item.status==='contains-deleted'?t('完全削除したメモが{deletedCount}件残っています',{deletedCount:item.deletedCount}):item.status==='unreadable'?t('ファイルを確認できませんでした'):t('削除済みメモなし')}</span></div><button className="text-button" onClick={()=>onDelete(item.name)}><TrashIcon/>{t('ファイルを削除')}</button></div>)}</div>:<p>{t('アプリ内バックアップはありません。')}</p>}

  </section>;
}
function App(){
  const [ready,setReady]=useState(false),[page,setPageState]=useState('Notes'),[notes,setNotes]=useState([]),[trashNotes,setTrashNotes]=useState([]),[categories,setCategories]=useState([]),[archivedCategories,setArchivedCategories]=useState([]),[categoryMerges,setCategoryMerges]=useState([]),[categorySplits,setCategorySplits]=useState([]),[splitSourceId,setSplitSourceId]=useState(null),[mergeSourceId,setMergeSourceId]=useState(null),[mergeTargetId,setMergeTargetId]=useState(''),[managedOther,setManagedOther]=useState([]),[managedNotes,setManagedNotes]=useState([]),[expandedCategory,setExpandedCategory]=useState(null),[manageRenameId,setManageRenameId]=useState(null),[manageName,setManageName]=useState(''),[nextSteps,setNextSteps]=useState([]),[category,setCategory]=useState('all'),[categoryData,setCategoryData]=useState({id:null,members:[],report:{},loading:true,error:''}),[questions,setQuestions]=useState([]),[selected,setSelected]=useState(null),[modal,setModal]=useState(null),[draft,setDraft]=useState(''),[draftOriginKind,setDraftOriginKind]=useState('human'),[draftSourceKind,setDraftSourceKind]=useState('unspecified'),[editing,setEditing]=useState(null),[query,setQuery]=useState(''),[askText,setAskText]=useState(''),[account,setAccount]=useState(null),[models,setModels]=useState([]),[model,setModel]=useState(localStorage.getItem('pure.desktop.model')||''),[autoClassify,setAutoClassify]=useState(true),[classificationStatus,setClassificationStatus]=useState({pending:0,running:0,failed:0}),[autoDigest,setAutoDigest]=useState(false),[digestStatus,setDigestStatus]=useState({pending:0,running:0,failed:0}),[askDigest,setAskDigest]=useState(false),[busy,setBusy]=useState(false),[restoring,setRestoring]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reduced,setReduced]=useState(localStorage.getItem('pure.motion')==='true'),[systemReduced,setSystemReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches),[bootVisible,setBootVisible]=useState(true),[savePulse,setSavePulse]=useState(null),[aiActivity,setAiActivity]=useState(''),[newCategoryName,setNewCategoryName]=useState(''),[selectedOther,setSelectedOther]=useState([]),[otherNotes,setOtherNotes]=useState([]),[suggestions,setSuggestions]=useState([]),[pendingImages,setPendingImages]=useState([]);
  const input=useRef(null),imageInput=useRef(null),origin=useRef(null),draftLoaded=useRef(false),categoryRequest=useRef(0),categoryRef=useRef(category);
  const [draftAiExcluded,setDraftAiExcluded]=useState(false),[aiExclusionPending,setAiExclusionPending]=useState(null);
  const [processingJobs,setProcessingJobs]=useState([]);
  const [backfill,setBackfill]=useState(null);
  // UI language: memo text and AI output stay as written.
  const [locale,setLocaleState]=useState(getLocale());
  function changeLocale(next){setLocaleState(setLocale(next));api.setLocale?.(next).catch(()=>{})}
  useEffect(()=>{api.setLocale?.(getLocale()).catch(()=>{})},[]);
  const [reasoningEffort,setReasoningEffort]=useState(''),[modelsLoading,setModelsLoading]=useState(false),[newModels,setNewModels]=useState([]);
  const modelsFetchedAt=useRef(0),modelRef=useRef(model);modelRef.current=model;
  const [aiSettings,setAiSettings]=useState({provider:'codex',lightModel:'',providers:[]}),aiSettingsRef=useRef({provider:'codex'});
  const [notesView,setNotesViewState]=useState(()=>localStorage.getItem('pure.notes.view')==='list'?'list':'orbit'),[orbitFreshId,setOrbitFreshId]=useState(null);
  const orbitInput=useRef(null);
  useEffect(()=>{localStorage.setItem('pure.notes.view',notesView)},[notesView]);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>localStorage.getItem('pure.sidebar.collapsed')==='true');
  const [settingsCategory,setSettingsCategory]=useState('general'),[settingsQuery,setSettingsQuery]=useState('');
  function selectSettingsCategory(id){setSettingsCategory(id);setSettingsQuery('')}
  // The processing list in Settings, opened from what the sidebar shows is running.
  function openProcessing(){setPage('Settings');setSelected(null);selectSettingsCategory('ai');afterScreenChange(()=>document.getElementById('settings-group-processing')?.scrollIntoView({block:'start'}))}
  useEffect(()=>{if(page!=='Settings')setSettingsQuery('')},[page]);
  useEffect(()=>{localStorage.setItem('pure.sidebar.collapsed',String(sidebarCollapsed))},[sidebarCollapsed]);
  const [graphState,setGraphState]=useState({data:null,loading:true,error:''});
  const [managedBackups,setManagedBackups]=useState([]),[backupAuditLoading,setBackupAuditLoading]=useState(false),[backupAuditError,setBackupAuditError]=useState('');
  const graphRequest=useRef(0);
  categoryRef.current=category;
  const effectiveReduced=reduced||systemReduced;
  const orbitActive=page==='Notes'&&notesView==='orbit';
  // Screen changes run as view transitions: pages fade up into place, 軌道 ⇄ リスト slides sideways.
  const pageRef=useRef(page),viewRef=useRef(notesView),lastTransition=useRef(null);
  pageRef.current=page;viewRef.current=notesView;
  function transition(kind,update){
    const root=document.documentElement;
    if(root.dataset.reduced==='true'||!document.startViewTransition){update();return}
    root.dataset.transition=kind;
    const run=document.startViewTransition(()=>flushSync(update));
    lastTransition.current=run;
    run.finished.finally(()=>{if(lastTransition.current===run)delete root.dataset.transition});
  }
  function setPage(next){
    if(next===pageRef.current){setPageState(next);return}
    const orbitBefore=pageRef.current==='Notes'&&viewRef.current==='orbit',orbitAfter=next==='Notes'&&viewRef.current==='orbit';
    transition(orbitBefore!==orbitAfter?'page-wide':'page',()=>setPageState(next));
  }
  function setNotesView(next){
    if(next===viewRef.current||pageRef.current!=='Notes'){setNotesViewState(next);return}
    transition(next==='list'?'slide-left':'slide-right',()=>setNotesViewState(next));
  }
  // Runs once the screen change (if any) has been applied to the DOM.
  const afterScreenChange=fn=>(lastTransition.current?.updateCallbackDone||Promise.resolve()).catch(()=>{}).then(()=>requestAnimationFrame(fn));
  const sourceNoteCount=notes.filter(note=>!note.isDemo&&note.originKind==='human'&&!note.aiExcluded&&note.text?.trim()).length;
  const captureSendsToCodex=!draftAiExcluded&&!notes.find(n=>n.id===editing)?.aiExcluded&&autoClassify&&!!model&&draftOriginKind==='human';
  const backgroundActivity=classificationStatus.running>0?t('分類中…'):digestStatus.running>0?t('まとめを更新中…'):'';
  const progressTasks=useProgressTasks();
  const progressOf=kind=>progressTasks.find(task=>task.kind===kind)||null;
  const backgroundTasks=progressTasks.filter(task=>['classify','backfill','digest','article','profile','index'].includes(task.kind));
  const categoryLoading=categoryData.id!==category||categoryData.loading;
  const members=categoryData.id===category?categoryData.members:[],report=categoryData.id===category?categoryData.report:{},categoryError=categoryData.id===category?categoryData.error:'';
  const analyzableMembers=members.filter(member=>!member.aiExcluded&&member.text?.trim());
  const note=notes.find(n=>n.id===selected),shown=notes.filter(n=>`${n.text}\n${n.excerpt||''}\n${n.sourceTitle||''}`.toLowerCase().includes(query.toLowerCase()));
  // The list shows the newest notes first and adds more as it is scrolled, so thousands of notes do
  // not all sit on the page at once. A note opened from elsewhere is always within what is shown.
  const [listLimit,setListLimit]=useState(LIST_STEP),listEnd=useRef(null);
  useEffect(()=>{setListLimit(LIST_STEP)},[query]);
  useEffect(()=>{if(!selected)return;const index=shown.findIndex(n=>n.id===selected);if(index>=listLimit)setListLimit(index+LIST_STEP)},[selected,shown.length]);
  useEffect(()=>{const end=listEnd.current;if(!end||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))setListLimit(limit=>limit+LIST_STEP)},{rootMargin:'800px 0px'});
    observer.observe(end);return()=>observer.disconnect()},[listLimit,shown.length>listLimit,page,notesView]);
  async function refresh(){const data=await api.load();setNotes(data.notes);setBackfill(data.backfill||null);setTrashNotes(data.trash);setCategories(data.categories);setArchivedCategories(data.archivedCategories);setCategoryMerges(data.categoryMerges||[]);setCategorySplits(data.categorySplits||[]);setNextSteps(data.nextSteps);setQuestions(data.questions);setAutoClassify(data.autoClassify);setClassificationStatus(data.classificationStatus);setAutoDigest(data.autoDigest);setDigestStatus(data.digestStatus);setAskDigest(data.askDigest);setReasoningEffort(data.reasoningEffort||'');setProcessingJobs(data.processingJobs||[]);if(draftLoaded.current)setEditing(current=>current&&!data.notes.some(note=>note.id===current)?null:current);if(!draftLoaded.current){const chosen=selectDraft(data,localStorage.getItem(DRAFT_RECOVERY_KEY));lastDraftStamp=Math.max(lastDraftStamp,chosen.updatedAt,Number(data.draftUpdatedAt)||0);setDraft(chosen.text);setDraftOriginKind(chosen.originKind);setDraftSourceKind(chosen.sourceKind);setDraftAiExcluded(chosen.aiExcluded||!!data.notes.find(n=>n.id===chosen.editingId)?.aiExcluded);const recoveredEdit=chosen.editingId&&data.notes.some(note=>note.id===chosen.editingId)?chosen.editingId:null;setEditing(recoveredEdit);if(chosen.text&&(chosen.recovered||recoveredEdit)){setBootVisible(false);setModal('capture');setTimeout(()=>input.current?.focus(),40);if(chosen.recovered)setNotice('Recovered your unfinished draft')}draftLoaded.current=true;}setReady(true)}
  async function refreshCategory(id){if(id!==categoryRef.current)return;const request=++categoryRequest.current;setCategoryData(old=>({...old,loading:true}));try{const [nextMembers,nextReport]=await Promise.all([api.categoryNotes(id),id==='other'?Promise.resolve({}):api.latest(id)]);if(request===categoryRequest.current&&id===categoryRef.current)setCategoryData({id,members:nextMembers,report:nextReport,loading:false,error:''})}catch(error){if(request===categoryRequest.current&&id===categoryRef.current)setCategoryData({id,members:[],report:{},loading:false,error:error.message});throw error}}
  async function refreshManagement(){const [other,detail]=await Promise.all([api.categoryNotes('other'),expandedCategory?api.categoryNotes(expandedCategory):Promise.resolve([])]);setManagedOther(other);setManagedNotes(detail)}
  async function refreshGraph(){const request=++graphRequest.current;setGraphState(old=>({...old,loading:true,error:''}));try{const data=await api.memoryMap();if(request===graphRequest.current)setGraphState({data,loading:false,error:''})}catch(error){if(request===graphRequest.current)setGraphState(old=>({...old,loading:false,error:error.message}))}}
  useEffect(()=>{refresh().catch(e=>setError(e.message));api.aiSettings().then(saved=>{setAiSettings(saved);aiSettingsRef.current=saved}).catch(()=>{}).finally(()=>{api.account().then(setAccount).catch(()=>{});refreshModels({quiet:true}).catch(()=>{});});},[]);
  // The catalog is re-read when 設定 opens and when the window comes back (at most every 10 minutes),
  // so a newly released model shows up without an app update.
  useEffect(()=>{if(page==='Settings')refreshModels().catch(()=>{})},[page]);
  const [captureSettings,setCaptureSettings]=useState({available:false,trusted:false,excluded:[]});
  async function refreshCaptureSettings(){const [access,excluded]=await Promise.all([api.captureAccess?.()||{},api.captureExcluded?.()||[]]);setCaptureSettings({...access,excluded})}
  useEffect(()=>{if(page==='Settings')refreshCaptureSettings().catch(()=>{})},[page]);
  useEffect(()=>{const back=()=>{if(Date.now()-modelsFetchedAt.current>600000)refreshModels().catch(()=>{})};window.addEventListener('focus',back);return()=>window.removeEventListener('focus',back)},[]);
  useEffect(()=>{if(ready)refreshCategory(category).catch(e=>setError(e.message))},[category,notes,ready]);
  useEffect(()=>{if(ready&&page==='Categories')refreshManagement().catch(e=>setError(e.message))},[page,expandedCategory,notes,categories,ready]);
  useEffect(()=>{if(ready&&page==='Graph')refreshGraph()},[page,notes,categories,ready]);
  useEffect(()=>{if(ready&&page==='Settings')refreshManagedBackups()},[page,ready]);
  useEffect(()=>api.onClassificationChange(()=>refresh().catch(e=>setError(e.message))),[]);
  useEffect(()=>api.onDigestChange(()=>refresh().catch(e=>setError(e.message))),[]);
  useEffect(()=>api.onArticleChange(()=>refresh().catch(e=>setError(e.message))),[]);
  // Notes saved from the capture panel (another window) refresh this one.
  useEffect(()=>api.onNotesChanged?.(()=>refresh().catch(e=>setError(e.message))),[]);
  useEffect(()=>{api.syncModel?.(model).catch(()=>{})},[model]);
  useEffect(()=>{document.querySelector('.native-scroll')?.scrollTo(0,0)},[page]);
  useEffect(()=>{if(!ready||restoring||busy)return;const snapshot={text:draft,originKind:draftOriginKind,sourceKind:draftSourceKind,aiExcluded:draftAiExcluded,editingId:editing||'',updatedAt:nextDraftStamp()};rememberDraft(snapshot);const timer=setTimeout(()=>api.saveDraft(snapshot).catch(e=>setError(e.message)),200);return()=>clearTimeout(timer)},[draft,draftOriginKind,draftSourceKind,draftAiExcluded,editing,ready,restoring,busy]);
  useEffect(()=>{document.documentElement.dataset.reduced=String(effectiveReduced);localStorage.setItem('pure.motion',String(reduced))},[reduced,effectiveReduced]);
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setSystemReduced(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
  useEffect(()=>{const sync=()=>{document.documentElement.dataset.windowActive=String(!document.hidden&&document.hasFocus())};document.addEventListener('visibilitychange',sync);window.addEventListener('focus',sync);window.addEventListener('blur',sync);sync();return()=>{document.removeEventListener('visibilitychange',sync);window.removeEventListener('focus',sync);window.removeEventListener('blur',sync)}},[]);
  useEffect(()=>{if(model)localStorage.setItem('pure.desktop.model',model)},[model]);
  useEffect(()=>{if(!savePulse)return;const timer=setTimeout(()=>setSavePulse(null),1100);return()=>clearTimeout(timer)},[savePulse]);
  useEffect(()=>{const off=api.onCapture(()=>openCapture());return off},[draft]);
  useEffect(()=>{function key(e){const action=globalKeyAction(e,modal==='capture');if(!action)return;if(action!=='clear-selection')e.preventDefault();if(action==='open-capture')openCapture();else if(action==='focus-capture')input.current?.focus();else if(action==='focus-search'){if(page==='Settings')document.querySelector('.settings-search input')?.focus();else{setPage('Notes');setNotesView('list');setTimeout(()=>document.querySelector('.native-search')?.focus(),30)}}else if(action==='close')close();else if(action==='clear-selection')setSelected(null)}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[draft,modal,page]);
  function changeDraft(text){rememberDraft({text,originKind:draftOriginKind,sourceKind:draftSourceKind,aiExcluded:draftAiExcluded,editingId:editing||'',updatedAt:nextDraftStamp()});setDraft(text)}
  function showNotes(view,target='.notes-view-switch [aria-pressed=true]'){setPage('Notes');setNotesView(view);setSelected(null);setError('');afterScreenChange(()=>{const item=typeof target==='function'?target():document.querySelector(target);item?.scrollIntoView?.({block:'center'});item?.focus()})}
  function openFromOrbit(id){setSelected(id);setNotesView('list');afterScreenChange(()=>{const card=[...document.querySelectorAll('[data-note-id]')].find(row=>row.dataset.noteId===id);card?.scrollIntoView({block:'center'});card?.focus()})}
  function openCapture(source){setBootVisible(false);origin.current=document.activeElement;if(source!=='generated'&&!draft.trim()){setDraftOriginKind('human');setDraftSourceKind('unspecified');setDraftAiExcluded(false);}setEditing(null);setError('');setModal('capture');setTimeout(()=>input.current?.focus(),40)}
  function expandCapture(){setBootVisible(false);origin.current=document.activeElement;setError('');setModal('capture');setTimeout(()=>input.current?.focus(),40)}
  function edit(n){origin.current=document.activeElement;setPendingImages([]);setDraft(n.text);setDraftOriginKind(n.originKind);setDraftSourceKind(n.sourceKind||'unspecified');setDraftAiExcluded(!!n.aiExcluded);setEditing(n.id);setModal('capture');setTimeout(()=>input.current?.focus(),40)}
  function close(focusSavedId){setModal(null);setError('');requestAnimationFrame(()=>{const saved=typeof focusSavedId==='string'?[...document.querySelectorAll('[data-note-id]')].find(row=>row.dataset.noteId===focusSavedId):null;(saved||origin.current)?.focus()})}
  function startAction(action){setPendingImages([]);setDraft(action.text||'');setDraftOriginKind('generated');setDraftSourceKind('unspecified');setDraftAiExcluded(false);setEditing(null);openCapture('generated')}
  async function openCreateCategory(){try{const ns=await api.categoryNotes('other');setOtherNotes(ns);setSelectedOther([]);setNewCategoryName('');setSuggestions([]);setSelected(null);setPage('Create Category')}catch(e){setError(e.message)}}
  async function createCategory(e){e.preventDefault();if(!newCategoryName.trim()||busy)return;setBusy(true);setError('');try{const created=await api.createCategory({name:newCategoryName,noteIds:selectedOther});await refresh();setCategory(created.id);setExpandedCategory(created.id);setPage('Categories');setNotice('Category created')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function assignOther(noteId,categoryId){if(!categoryId)return;try{await api.assignNote({noteId,categoryId});await refresh();await refreshCategory('other');setManagedOther(await api.categoryNotes('other'));setNotice('Moved to category')}catch(e){setError(e.message)}}
  async function renameManaged(e){e.preventDefault();try{await api.renameCategory({id:manageRenameId,name:manageName});setManageRenameId(null);await refresh();setNotice('Category renamed')}catch(error){setError(error.message)}}
  async function unassignManaged(noteId,categoryId){try{await api.unassignNote({noteId,categoryId});await refresh();await refreshManagement();setNotice('Removed from category')}catch(error){setError(error.message)}}
  async function archiveManaged(id){if(!window.confirm('Archive this category? Its notes will appear in Other unless they have another category. You can restore it here.'))return;try{await api.archiveCategory(id);if(expandedCategory===id)setExpandedCategory(null);if(category===id)setCategory('all');await refresh();setNotice('Category archived')}catch(error){setError(error.message)}}
  async function mergeManaged(event,sourceId){event.preventDefault();if(!mergeTargetId||busy)return;const source=categories.find(c=>c.id===sourceId),target=categories.find(c=>c.id===mergeTargetId);if(!source||!target||!window.confirm(`Merge ${source.name} into ${target.name}? ${source.count} notes are in ${source.name}. Notes you removed from ${target.name} stay excluded. The old category and its history remain in the database.`))return;setBusy(true);setError('');try{const result=await api.mergeCategory({sourceId,targetId:mergeTargetId});setMergeSourceId(null);setMergeTargetId('');setExpandedCategory(result.targetId||target.id);if(category===sourceId)setCategory(target.id);await refresh();setNotice(`Merged into ${target.name} · ${result.movedCount} moved${result.skippedCount?` · ${result.skippedCount} excluded`:''}`)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function splitManaged(sourceId,name,noteIds){if(busy)return;setBusy(true);setError('');try{const result=await api.splitCategory({sourceId,name,noteIds});setSplitSourceId(null);setExpandedCategory(result.targetId);await refresh();setNotice(`${result.movedCount} notes moved to ${result.targetName}`)}catch(error){setError(error.message)}finally{setBusy(false)}}
  async function restoreManaged(id){try{await api.restoreCategory(id);await refresh();setNotice('Category restored')}catch(error){setError(error.message)}}
  async function suggestCategories(){setBusy(true);setAiActivity(t('候補を作成中…'));setError('');try{setSuggestions(await api.suggestCategory({model}))}catch(e){setError(e.message)}finally{setBusy(false);setAiActivity('')}}
  async function save(){if((!draft.trim()&&!pendingImages.length&&!notes.find(n=>n.id===editing)?.attachments?.length)||busy)return;setBusy(true);setError('');try{const saved=await api.saveNote({id:editing,text:draft,originKind:draftOriginKind,sourceKind:draftSourceKind,aiExcluded:draftAiExcluded,draftClearedAt:nextDraftStamp(),model,attachments:pendingImages.map(({mediaType,fileName,dataBase64})=>({mediaType,fileName,dataBase64}))});setPendingImages([]);setDraft('');setDraftOriginKind('human');setDraftSourceKind('unspecified');setDraftAiExcluded(false);rememberDraft({text:''});await api.saveDraft({text:'',originKind:'human',sourceKind:'unspecified',editingId:'',updatedAt:nextDraftStamp()});const created=!editing;setEditing(null);await refresh();setSavePulse({id:saved.id,at:Date.now()});if(created)setOrbitFreshId(saved.id);setSelected(saved.id);setPage('Notes');setQuery('');close(saved.id);setNotice(t('メモを保存しました'))}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function addImages(files){const selected=Array.from(files).filter(file=>file.type.startsWith('image/'));if(!selected.length)return;const existing=notes.find(n=>n.id===editing)?.attachments?.length||0;if(existing+pendingImages.length+selected.length>4){setError('Attach up to four images.');return}try{const next=await Promise.all(selected.map(file=>new Promise((resolve,reject)=>{if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)||file.size>8*1024*1024){reject(new Error('Use a PNG, JPEG, GIF or WebP image up to 8 MB.'));return}const reader=new FileReader();reader.onload=()=>resolve({mediaType:file.type,fileName:file.name||'Pasted image',dataBase64:String(reader.result).split(',')[1],preview:String(reader.result)});reader.onerror=()=>reject(new Error('Could not read image.'));reader.readAsDataURL(file)})));setPendingImages(old=>[...old,...next]);setError('')}catch(e){setError(e.message)}}
  function pasteImage(event){const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();addImages(files)}}
  async function removeSavedImage(id){if(!window.confirm('Remove this image from the note?'))return;try{await api.removeAttachment(id);await refresh();setNotice('Image removed')}catch(e){setError(e.message)}}
  async function toggleNoteAiExcluded(n){
    setAiExclusionPending(n.id);setError('');
    try{
      await api.setAiExcluded({id:n.id,excluded:!n.aiExcluded,model,expectedAccessVersion:n.aiAccessVersion});
      await refresh();
      setNotice(n.aiExcluded?t('このメモをAI解析の対象に戻しました'):t('このメモをAI解析の対象外にしました'));
    }catch(cause){setError(cause.message)}finally{setAiExclusionPending(null)}
  }
  async function toggleAutoClassify(){try{setAutoClassify(await api.setAutoClassify(!autoClassify));await refresh()}catch(e){setError(e.message)}}
  async function retryClassification(){try{setClassificationStatus(await api.retryClassification());await refresh();setNotice(t('分類を再試行します'))}catch(e){setError(e.message)}}
  async function toggleAutoDigest(){try{setAutoDigest(await api.setAutoDigest({enabled:!autoDigest,model}));await refresh()}catch(e){setError(e.message)}}
  async function changeModel(next,list=models){
    setModel(next);
    // An effort the new model does not offer falls back to that model's default.
    const entry=list.find(m=>m.model===next);
    if(reasoningEffort&&entry&&!entry.efforts.some(option=>option.effort===reasoningEffort))changeEffort('');
    if(autoDigest)try{await api.setDigestModel(next)}catch(e){setError(e.message)}
  }
  // Each provider remembers its own model; switching brings back the one used there last.
  async function changeAiSettings(next){
    try{
      const previous=aiSettingsRef.current.provider;
      const saved=await api.aiSettings(next);setAiSettings(saved);aiSettingsRef.current=saved;
      if(next.provider&&next.provider!==previous){
        try{localStorage.setItem(`pure.model.${previous}`,modelRef.current)}catch{}
        let restored='';try{restored=localStorage.getItem(`pure.model.${next.provider}`)||''}catch{}
        modelRef.current=restored;setModel(restored);setModels([]);
        if(saved.lightModel)await api.aiSettings({lightModel:''}).then(setAiSettings);
        setAccount(await api.account().catch(()=>null));
        await refreshModels({quiet:true});
      }
    }catch(e){setError(e.message)}
  }
  async function changeEffort(next){try{setReasoningEffort(await api.setReasoningEffort(next))}catch(e){setError(e.message)}}
  async function refreshModels({quiet=false}={}){
    setModelsLoading(true);
    try{
      const list=await api.models();modelsFetchedAt.current=Date.now();setModels(list);
      const seenKey=`pure.models.seen.${aiSettingsRef.current.provider}`;
      let seen=null;try{seen=JSON.parse(localStorage.getItem(seenKey)||localStorage.getItem('pure.models.seen')||'null')}catch{}
      const added=Array.isArray(seen)?list.filter(m=>!seen.includes(m.model)):[];
      try{localStorage.setItem(seenKey,JSON.stringify(list.map(m=>m.model)))}catch{}
      if(added.length)setNewModels(old=>[...new Set([...old,...added.map(m=>m.model)])]);
      const current=modelRef.current,fallback=list.find(m=>m.isDefault)?.model||list[0]?.model||'';
      if(!current)setModel(fallback);
      else if(list.length&&!list.some(m=>m.model===current)){await changeModel(fallback,list);setNotice(t('選んでいたモデル（{current}）が使えなくなったため、{fallback} に切り替えました',{current:current,fallback:list.find(m=>m.model===fallback)?.displayName||fallback}))}
      if(!quiet&&added.length)setNotice(t('新しいモデルを追加しました: {n}',{n:added.map(m=>m.displayName).join('、')}));
      return list;
    }finally{setModelsLoading(false)}
  }
  async function retryDigests(){try{setDigestStatus(await api.retryDigests());await refresh();setNotice(t('分析を再試行します'))}catch(e){setError(e.message)}}
  async function toggleAskDigest(){try{setAskDigest(await api.setAskDigest(!askDigest))}catch(e){setError(e.message)}}
  async function trash(n){if(!window.confirm('Move this note to the trash?'))return;try{await api.trashNote(n.id);setSelected(null);await refresh();setNotice('Moved to trash')}catch(e){setError(e.message)}}
  async function restoreTrashed(n){try{await api.restoreNote(n.id);await refresh();setNotice('Note restored')}catch(e){setError(e.message)}}
  async function purgeTrashed(n){if(!window.confirm(t('このMacからメモを完全に削除しますか？ AIの分析結果、Askの履歴、評価もすべて削除します。既存のバックアップファイルは残りますが、このMacでは削除したメモを戻す古いバックアップの復元を拒否します。削除後は設定でアプリ内バックアップを確認してください。この操作は取り消せません。')))return;try{await api.purgeNote(n.id);await refresh();setNotice(t('このMacのメモを完全削除しました。設定で古いバックアップを確認してください。'))}catch(e){setError(e.message)}}
  async function analyze(){setBusy(true);setAiActivity(t('メモを分析中…'));setError('');try{const result=await api.analyze({categoryId:category,model});setCategories(result.categories);await refreshCategory(category);setNextSteps((await api.load()).nextSteps);setNotice(t('まとめを更新しました'))}catch(e){setError(e.message)}finally{setBusy(false);setAiActivity('')}}
  async function ask(){if(!askText.trim()||busy)return;setBusy(true);setAiActivity(t('関連するメモを検索中…'));setError('');try{await api.ask({question:askText,model});setAskText('');setQuestions(await api.questions())}catch(e){setError(e.message)}finally{setBusy(false);setAiActivity('')}}
  async function rate(output,rating,reason,comment){try{await api.rate({outputId:output.id,rating,reason,comment});if(page==='Ask')setQuestions(await api.questions());else if(page==='Next Steps')setNextSteps((await api.load()).nextSteps);else await refreshCategory(category)}catch(e){setError(e.message)}}
  async function login(){setError('');try{await api.login();setNotice(t('ブラウザでログインを完了したら、接続状態を更新してください'))}catch(e){setError(e.message)}}
  async function restoreBackup(){if(restoring||!window.confirm(t('バックアップを復元しますか？先に現在のデータのコピーを作成します。このMacで完全削除したメモが復活するバックアップは拒否されます。')))return;setRestoring(true);setError('');try{const result=await api.restore();if(result){rememberDraft({text:''});draftLoaded.current=false;await refresh();setSelected(null);setCategory('all');setExpandedCategory(null);setPage('Notes');setNotice(t('バックアップを復元しました'))}}catch(e){setError(e.message)}finally{setRestoring(false)}}
  async function importNotes(){try{const result=await api.importNotes();if(result){await refresh();await refreshManagedBackups();setNotice(t('{count}件のメモを取り込みました。取り込み前のバックアップも保存しています',{count:result.count}))}}catch(e){setError(e.message)}}
  async function refreshManagedBackups(){setBackupAuditLoading(true);setBackupAuditError('');try{setManagedBackups(await api.managedBackups())}catch(e){setBackupAuditError(e.message)}finally{setBackupAuditLoading(false)}}
  async function removeManagedBackup(name){if(!window.confirm(t('{name} をこのMacから削除しますか？pureから元に戻すことはできません。',{name:name})))return;try{await api.deleteManagedBackup(name);await refreshManagedBackups();setNotice(t('アプリ内バックアップを削除しました'))}catch(e){setBackupAuditError(e.message)}}
  async function openArticle(id){try{await api.openArticle(id)}catch(e){setError(e.message)}}
  async function retryArticle(id){try{if(await api.retryArticle(id)){await refresh();setNotice('Article preview queued again')}}catch(e){setError(e.message)}}
  if(!ready)return <div className="native-loading"><Mark/><span>p u r e .</span>{error&&<p>{errorText(error)}</p>}</div>;
  return <div className={'app native-app'+(sidebarCollapsed?' sidebar-collapsed':'')+(page==='Settings'?' settings-workspace':'')+(orbitActive?' orbit-mode':'')} data-page={page}>
  <PlasmaBackground reduced={effectiveReduced} page={page}/>
  {bootVisible&&!effectiveReduced&&<BootAnimation onComplete={()=>setBootVisible(false)}/>}
  <header className="workspace-titlebar" inert={modal==='capture'} aria-hidden={modal==='capture'}>
    <div className="titlebar-sidebar"><button className="icon-button sidebar-toggle" onClick={()=>setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed?t('サイドバーを開く'):t('サイドバーを閉じる')} aria-expanded={!sidebarCollapsed}><SidebarIcon/></button></div>
  </header>
  <div className="workspace-body">
  <aside className="sidebar" inert={modal==='capture'} aria-hidden={modal==='capture'}>
    <Logo className="sidebar-brand"/>
    {page==='Settings'?<SettingsSidebar category={settingsQuery.trim()?null:settingsCategory} onSelect={selectSettingsCategory} onBack={()=>{setPage('Notes');setSelected(null);setError('')}}/>:<>
    <nav className="side-nav" aria-label={t('ページ')}>{navigation.map(([Icon,name],index)=><button key={name} className="side-nav-item" aria-current={page===name?'page':undefined} aria-label={t(pageLabels[name])} title={t(pageLabels[name])} onClick={()=>{setPage(name);setSelected(null);setError('')}}><span className="side-nav-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><Icon className="side-nav-icon" aria-hidden="true"/><span className="side-nav-rule" aria-hidden="true"/><span className="side-nav-label">{t(pageLabels[name])}</span></button>)}</nav>
    <section className="side-categories" aria-label={t('カテゴリ')}><div className="side-section-heading"><span>{t('カテゴリ')}</span><button className="side-add" onClick={openCreateCategory} aria-label={t('カテゴリを作成')} title={t('カテゴリを作成')}><PlusIcon/></button></div>
      <div className="side-category-list">{categories.filter(c=>!['all','other'].includes(c.id)).map(c=><button key={c.id} className="side-category" aria-current={page==='Collections'&&category===c.id?'page':undefined} title={c.name} aria-label={t('{name} {count}件',{name:c.name,count:c.count})} onClick={()=>{setCategory(c.id);setPage('Collections');setSelected(null)}}><Drop size={7}/><span>{c.name}</span><small>{c.count}</small></button>)}</div>
      <button className="side-nav-item" aria-current={['Categories','Create Category'].includes(page)?'page':undefined} aria-label={t('カテゴリを管理')} title={t('カテゴリを管理')} onClick={()=>{setPage('Categories');setSelected(null)}}><span className="side-nav-number" aria-hidden="true">{String(navigation.length+1).padStart(2,'0')}</span><BookmarkIcon className="side-nav-icon" aria-hidden="true"/><span className="side-nav-rule" aria-hidden="true"/><span className="side-nav-label">{t('カテゴリを管理')}</span></button>
    </section>
    <div className="side-dock"><button className="side-dock-item" aria-current={page==='Trash'?'page':undefined} aria-label={t('ごみ箱')} title={t('ごみ箱')} onClick={()=>{setPage('Trash');setSelected(null)}}><TrashIcon aria-hidden="true"/><span>{t('ごみ箱')}</span></button><button className="side-dock-item" aria-current={page==='Settings'?'page':undefined} aria-label={t('設定')} title={t('設定')} onClick={()=>{setPage('Settings');setSelected(null)}}><MixerHorizontalIcon aria-hidden="true"/><span>{t('設定')}</span></button><p className="side-storage"><i aria-hidden="true"/><span>{t('このMacに保存')}</span></p><SideActivity jobs={processingJobs} onOpen={openProcessing}/><AiUsageMeter/></div></>}
  </aside>
  <HeadingTools.Provider value={page==='Settings'?<SettingsSearch value={settingsQuery} onChange={setSettingsQuery}/>:<div className="heading-tools">
    {page==='Notes'?<label className="tool-search"><MagnifyingGlassIcon aria-hidden="true"/><input className="native-search" aria-label={t('メモを検索')} placeholder={t('検索')} value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘K</kbd></label>
      :<button className="tool-search" onClick={()=>showNotes('list','.native-search')} aria-label={t('メモを検索')} title={t('メモを検索 · ⌘K')}><MagnifyingGlassIcon aria-hidden="true"/><span>{t('検索')}</span><kbd>⌘K</kbd></button>}
    <button className="tool-new" onClick={openCapture} aria-label={t('新しいメモ')} title={t('新しいメモ · ⌘⇧N')}><PlusIcon aria-hidden="true"/></button>
  </div>}>
  <main className="main" inert={modal==='capture'} aria-hidden={modal==='capture'}>
  {orbitActive&&<OrbitView activity={<SideActivity compact jobs={processingJobs} onOpen={openProcessing}/>} locale={locale} notes={notes} categories={categories} draft={draft} onDraftChange={changeDraft} inputRef={orbitInput} busy={busy} editing={editing}
    canSave={!busy&&(!!draft.trim()||pendingImages.length>0||!!notes.find(n=>n.id===editing)?.attachments?.length)} onSave={()=>{origin.current=orbitInput.current;save()}}
    showAutoClassify={captureSendsToCodex} onAutoClassifyOff={toggleAutoClassify} onAttach={expandCapture} onPaste={event=>{if(Array.from(event.clipboardData?.items||[]).some(item=>item.kind==='file'&&item.type.startsWith('image/'))){expandCapture();pasteImage(event)}}}
    freshId={orbitFreshId} active={modal!=='capture'} onNavigate={name=>{setPage(name);setSelected(null);setError('')}} onSearch={()=>showNotes('list','.native-search')} onNew={openCapture} onList={more=>showNotes('list',more?()=>document.querySelectorAll('[data-note-id]')[4]:undefined)} onOpenNote={openFromOrbit} onCategories={()=>{setPage('Categories');setSelected(null)}}/>}
  {page==='Notes'&&notesView==='list'&&<div className={'native-scroll notes-workspace '+(notes.length||query?'has-notes':'is-empty')}>
    <PageHeading Icon={Pencil1Icon} title={editing?t('編集'):t('メモ')} meta={t('{notesCount}件',{notesCount:notes.length})}/>
    <section className="note-compose-section" aria-label={t('新しいメモ')}>
      <form className="workspace-compose" onSubmit={event=>{event.preventDefault();save()}}>
        <div className="compose-context"><LockClosedIcon aria-hidden="true"/><span>{t('このMacに保存')}</span></div>
        <textarea aria-label={t('メモの内容')} value={draft} disabled={busy} onChange={event=>changeDraft(event.target.value)} onPaste={event=>{if(Array.from(event.clipboardData?.items||[]).some(item=>item.kind==='file'&&item.type.startsWith('image/'))){expandCapture();pasteImage(event)}}} placeholder={t('メモを書く…')} onKeyDown={event=>{if(shouldSaveCapture(event)){event.preventDefault();save()}}}/>
        {pendingImages.length>0&&<div className="capture-images">{pendingImages.map((item,index)=><div key={index}><img src={item.preview} alt={item.fileName}/><button type="button" onClick={()=>setPendingImages(old=>old.filter((_,i)=>i!==index))} aria-label={`Remove ${item.fileName}`}><Cross2Icon/></button></div>)}</div>}
        {draftAiExcluded&&<p className="compose-excluded"><LockClosedIcon/>{t('AI解析の対象外')}</p>}
        <div className="compose-toolbar"><button type="button" className="icon-button" onClick={expandCapture} aria-label={t('画像や出典を追加')} title={t('画像や出典を追加')}><PlusIcon/></button>
          {captureSendsToCodex&&<div className="compose-ai-notice"><LightningBoltIcon aria-hidden="true"/><span>{t('自動分類 · 原文をCodexへ送信')}</span><button type="button" onClick={toggleAutoClassify}>{t('オフにする')}</button></div>}
          <span className="compose-shortcut">⌘↵</span><button type="submit" className="compose-save" aria-label={t('メモを保存')} disabled={busy||(!draft.trim()&&!pendingImages.length&&!notes.find(n=>n.id===editing)?.attachments?.length)}>{busy?<ReloadIcon/>:<ArrowUpIcon/>}</button></div>
      </form>
    </section>
    <section className="notes-library" aria-label={t('保存したメモ {notesCount}件',{notesCount:notes.length})}>
      {(backgroundTasks.length>0||backgroundActivity)&&<BackgroundProgress tasks={backgroundTasks} fallback={backgroundActivity}/>}
      {shown.length?<div className="timeline">{shown.slice(0,listLimit).map((n,i)=><React.Fragment key={n.id}>{(i===0||new Date(shown[i-1].date).toLocaleDateString()!==new Date(n.date).toLocaleDateString())&&<h3 className="date-label">{dayLabel(n.date)}</h3>}<NoteRow note={n} categories={categories} selected={selected===n.id} saved={savePulse?.id===n.id} index={i} onSelect={setSelected}/></React.Fragment>)}
        {shown.length>listLimit&&<div ref={listEnd} className="timeline-more"><button type="button" className="text-button" onClick={()=>setListLimit(limit=>limit+LIST_STEP)}>{t('さらに表示（残り{n}件）',{n:shown.length-listLimit})}</button></div>}</div>:<div className="native-empty"><h3>{query?t('該当するメモなし'):t('メモはまだありません')}</h3></div>}
    </section>
  </div>}
  {page==='Graph'&&<div className="memory-scroll"><GraphView locale={locale} categories={categories} data={graphState.data} loading={graphState.loading} error={graphState.error} reduced={effectiveReduced} selectedNoteId={selected} onNote={setSelected} onAddNote={openCapture} onRetry={refreshGraph} answerHistory={questions} onEditNote={edit} renderNoteExtras={note=><><div className="memory-note-images">{note.attachments?.map(a=><figure key={a.id}><SavedImage attachment={a}/><figcaption>{a.fileName}</figcaption></figure>)}</div><AiExclusionControl note={note} pending={aiExclusionPending===note.id} onChange={toggleNoteAiExcluded}/></>} canAnalyze={!!model&&!!account?.account} onSettings={()=>{selectSettingsCategory('connection');setSelected(null);setPage('Settings')}} onAnalyze={async()=>{const data=await api.analyzeMemory({model});setGraphState({data,loading:false,error:''});return data}} onReview={async arg=>{const data=await api.reviewMemoryTheme(arg);setGraphState({data,loading:false,error:''});return data}} onAsk={async question=>{const output=await api.ask({question,model});setQuestions(await api.questions());return output}}/></div>}
  {page==='Trash'&&<div className="native-scroll"><PageHeading Icon={TrashIcon} title={t('ごみ箱')} meta={t('{trashNotesCount}件',{trashNotesCount:trashNotes.length})} actions={<InfoDetails label={t('ごみ箱について')}><p>{t('検索とAI分析の対象外です。完全に削除するまでは復元できます。')}</p></InfoDetails>}/>{trashNotes.length?<div className="trash-list">{trashNotes.map(n=><article className="trash-row" key={n.id}><Drop/><time dateTime={n.deletedAt}>{new Date(n.deletedAt).toLocaleDateString(dateLocale(),{month:'short',day:'numeric'})}</time><div className="note-line-body"><p>{n.text||t('画像のメモ')}</p>{n.attachments?.length>0&&<small className="trash-image-count"><ImageIcon/>{t('画像 {images}枚',{images:n.attachments.length})}</small>}</div><div className="trash-actions"><button className="secondary" onClick={()=>restoreTrashed(n)}><ReloadIcon/>{t('復元')}</button><button className="secondary" onClick={()=>purgeTrashed(n)}><TrashIcon/>{t('完全に削除')}</button></div></article>)}</div>
    :<CenterStage className="trash-stage">{stage=><div className="stage-center trash-empty" style={{left:stage.x,top:stage.y}}><Disc size={240*stage.s} className="trash-empty-disc"><span className="ring" aria-hidden="true"/><Ripple className="is-slow"/><div className="trash-empty-copy"><TrashIcon aria-hidden="true"/><h3>{t('ごみ箱は空です')}</h3></div></Disc></div>}</CenterStage>}</div>}
  {page==='Collections'&&<div className="native-scroll">
    <PageHeading Icon={LayersIcon} title={t('まとめ')}/>
    <div className="native-tabs">{categories.map(c=><button key={c.id} className={category===c.id?'active':''} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{categoryLabel(c)}<small>{c.id==='all'?notes.filter(n=>!n.isDemo&&n.originKind==='human').length:c.count}</small></button>)}</div>
    {categoryLoading?<div className="native-report native-report-loading" role="status"><span className="eyebrow">{t('まとめを読み込み中…')}</span><i/><i/><i/></div>:categoryError?<div className="native-report analysis-empty" role="alert"><h3>{t('まとめを読み込めませんでした')}</h3><p>{categoryError}</p><button className="secondary" onClick={()=>refreshCategory(category).catch(e=>setError(e.message))}>{t('再試行')}</button></div>:category==='other'?<div className="native-report"><div className="native-report-head"><div><h3>{t('未分類')} <small>{t('{n}件',{n:members.length})}</small></h3></div><button className="primary" onClick={()=>setPage('Categories')}><BookmarkIcon/>{t('カテゴリを管理')}</button></div><div className="other-list">{members.map(n=><div className="other-row" key={n.id}><p>{n.text}</p></div>)}{!members.length&&<div className="analysis-empty"><LayersIcon/><h3>{t('未分類のメモはありません')}</h3></div>}</div></div>
    :<div className="native-report" key={category}><div className="native-report-head"><div><span className="eyebrow">{categoryLabel(categories.find(c=>c.id===category))}</span><p>{t('対象のメモ · {n}件',{n:analyzableMembers.length})}</p>{category!=='all'&&<button className="text-button" onClick={()=>{setExpandedCategory(category);setPage('Categories')}}><BookmarkIcon/>{t('カテゴリを管理')}</button>}</div><button className="primary" disabled={busy||!model||analyzableMembers.length<2} onClick={analyze}><LightningBoltIcon/>{busy?t('分析中…'):report.state?.status==='needs-refresh'?t('まとめを更新'):report.summary?t('まとめを更新'):t('まとめを作成')}</button></div>
      {aiActivity&&page==='Collections'&&<ProgressPanel task={progressOf('analyze')} fallback={aiActivity}/>}
      {!account?.account&&<button className="inline-connect" onClick={()=>{selectSettingsCategory('connection');setPage('Settings')}}><Link2Icon/>{t('Codexに接続')}<ArrowRightIcon/></button>}<InfoDetails label={t('原文 最大30件をCodexへ送信')}><p>{t('分析時に対象の原文を最大30件と、関連する評価・訂正を選択したモデルへ送ります。自動分類がオンのときは保存した原文を送信し、作成済みカテゴリへ振り分けます。')}</p></InfoDetails>
      {report.summary?<><section className="native-section"><span>{t('要約')}</span><p>{report.summary.text}</p>{report.summary.analysis_status==='insufficient'&&<span className="native-stale">{t('根拠となるメモが不足しています')}</span>}<SourceLinks output={report.summary} onOpen={setSelected}/><Rating output={report.summary} onRate={rate}/></section>{report.pattern&&<section className="native-section"><span>{t('傾向')} <small>{t('AIによる解釈')}</small></span><p>{report.pattern.text}</p><Rating output={report.pattern} onRate={rate}/></section>}{report.summary.claims?.length>0&&<InfoDetails className="claims-disclosure" label={t('根拠 · {claimsCount}',{claimsCount:report.summary.claims.length})} Icon={Link2Icon}><div className="digest-claims">{report.summary.claims.map(claim=><div className="digest-claim" key={claim.id}><div className="digest-claim-meta">{claim.kind} / {claim.speaker}{claim.period?` / ${claim.period}`:''}</div><p>{claim.text}</p><div className="digest-claim-sources">{claim.sources.map(source=><button key={`${source.revisionId}-${source.relation}`} onClick={()=>setSelected(source.noteId)}><Link2Icon/>{source.relation==='counter'?'COUNTER':'SOURCE'} · {t(sourceLabels[source.sourceKind]||'メモ')} · {source.text.slice(0,70)}{source.text.length>70?'…':''}</button>)}</div></div>)}</div></InfoDetails>}{report.action&&<div className="next-step-pointer"><LightningBoltIcon/><button onClick={()=>setPage('Next Steps')}>{t('提案を開く')} <ArrowRightIcon/></button></div>}</>
      :<div className="report-empty"><span className="report-mark" aria-hidden="true"><span className="ring"/><span className="ring is-dashed"/><span className="ring is-inner"/>{report.state?.status==='needs-refresh'&&<Ripple/>}<Drop size={10}/></span><h3>{report.state?.status==='needs-refresh'?t('まとめの更新待ち'):analyzableMembers.length<2?t('メモをあと少し'):t('まとめはまだありません')}</h3><p>{report.state?.status==='needs-refresh'?t('元のメモが変わりました。'):analyzableMembers.length<2?t('作成まであと{analyzableMembersCount}件',{analyzableMembersCount:2-analyzableMembers.length}):null}</p>{analyzableMembers.length<2&&<div className="empty-actions"><button className="primary" onClick={openCapture}><PlusIcon/>{t('メモを追加')}</button>{category!=='all'&&<button className="text-button" onClick={()=>{setExpandedCategory(category);setPage('Categories')}}>{t('このカテゴリを管理')} <ArrowRightIcon/></button>}</div>}</div>}
    </div>}
  </div>}
  {page==='Next Steps'&&<NextStepsView steps={nextSteps} notes={notes} sourceNoteCount={sourceNoteCount} onRate={rate} onStart={startAction} onOpenNote={setSelected} onAddNote={openCapture} onCollections={()=>setPage('Collections')}/>}
  {page==='Categories'&&<CategoryManager categories={categories} managedNotes={managedNotes} managedOther={managedOther} expanded={expandedCategory} onExpand={setExpandedCategory}
    renameId={manageRenameId} renameName={manageName} onRenameName={setManageName} onStartRename={c=>{setManageRenameId(c.id);setManageName(c.name);setExpandedCategory(c.id)}} onCancelRename={()=>setManageRenameId(null)} onRename={renameManaged}
    splitSourceId={splitSourceId} onToggleSplit={c=>{setSplitSourceId(splitSourceId===c.id?null:c.id);setMergeSourceId(null);setManageRenameId(null);setExpandedCategory(c.id)}} renderSplit={c=><SplitCategoryForm source={c} busy={busy} onSplit={splitManaged} onCancel={()=>setSplitSourceId(null)}/>}
    mergeSourceId={mergeSourceId} onToggleMerge={c=>{setMergeSourceId(mergeSourceId===c.id?null:c.id);setMergeTargetId('');setExpandedCategory(null)}} mergeTargetId={mergeTargetId} onMergeTarget={setMergeTargetId} onMerge={mergeManaged} onCancelMerge={()=>setMergeSourceId(null)}
    onArchive={archiveManaged} onRestore={restoreManaged} onUnassign={unassignManaged} onAssign={assignOther} onCreate={openCreateCategory} onOpen={id=>{setCategory(id);setPage('Collections')}} busy={busy} merges={categoryMerges} splits={categorySplits} archived={archivedCategories}/>}
  {page==='Create Category'&&<div className="native-scroll"><PageHeading Icon={PlusIcon} title={t('新規カテゴリ')}/><div className="category-builder"><button className="text-button" onClick={()=>setPage('Categories')}><ArrowLeftIcon/>{t('カテゴリ')}</button><div className="builder-head"><h3>{t('名前の候補')}</h3><button className="secondary" disabled={busy||!model||otherNotes.filter(n=>!n.aiExcluded&&n.text?.trim()).length<2} onClick={suggestCategories}><LightningBoltIcon/>{busy?t('作成中…'):t('候補を出す')}</button></div>{aiActivity&&page==='Create Category'&&<ProgressPanel task={progressOf('suggest')} fallback={aiActivity}/>}
      {suggestions.length>0&&<div className="suggestion-list">{suggestions.map((item,i)=><button key={i} onClick={()=>{setNewCategoryName(item.name);setSelectedOther(item.noteIds)}}><strong>{item.name}</strong><span>{item.reason}</span><small>{t('{n}件',{n:item.noteIds.length})}</small></button>)}</div>}<InfoDetails label={t('候補作成 · 原文 最大30件をCodexへ送信')}><p>{t('未分類のメモから候補を出します。候補を選んでも、作成するまでは保存しません。カテゴリ名は自由に入力できます。')}</p></InfoDetails><form onSubmit={createCategory}><label className="eyebrow" htmlFor="new-category-name">{t('カテゴリ名')}</label><input id="new-category-name" value={newCategoryName} onChange={e=>setNewCategoryName(e.target.value)} maxLength={60} placeholder={t('音楽、映画、仕事など')}/><span className="eyebrow">{t('含めるメモ · {n}件選択中',{n:selectedOther.length})}</span><div className="builder-notes">{otherNotes.map(n=><label key={n.id}><input type="checkbox" checked={selectedOther.includes(n.id)} onChange={e=>setSelectedOther(old=>e.target.checked?[...old,n.id]:old.filter(id=>id!==n.id))}/><span>{n.text}</span></label>)}</div><button className="primary" disabled={busy||!newCategoryName.trim()}><PlusIcon/>{t('カテゴリを作成')}</button></form></div></div>}
  {page==='News'&&<NewsView model={model} onOpenNote={setSelected}/>}
  {page==='Ask'&&<AskView askText={askText} onAskText={setAskText} onAsk={ask} busy={busy} canAsk={!busy&&!!model&&!!askText.trim()&&sourceNoteCount>0} sourceNoteCount={sourceNoteCount} questions={questions} connected={!!account?.account} onConnect={()=>{selectSettingsCategory('connection');setPage('Settings')}} onAddNote={openCapture} activity={aiActivity&&page==='Ask'&&<ProgressPanel task={progressOf('ask')} fallback={aiActivity}/>} onRate={rate} onOpenNote={setSelected}/>}
  {page==='Settings'&&<SettingsView category={settingsCategory} query={settingsQuery} groups={settingsSections({
    capture:captureSettings,onRequestCaptureAccess:()=>api.requestCaptureAccess().then(()=>refreshCaptureSettings()).catch(e=>setError(e.message)),onCaptureExcluded:list=>api.captureExcluded(list).then(excluded=>setCaptureSettings(old=>({...old,excluded}))).catch(e=>setError(e.message)),
    locale,onLocale:changeLocale,account,models,model,onModel:changeModel,aiSettings,onAiSettings:changeAiSettings,newModels,modelsLoading,onRefreshModels:()=>refreshModels().catch(e=>setError(e.message)),reasoningEffort,onEffort:changeEffort,onLogin:login,onRefreshAccount:()=>api.account().then(setAccount).catch(e=>setError(e.message)),
    reduced,systemReduced,onReduced:()=>setReduced(!reduced),autoClassify,onAutoClassify:toggleAutoClassify,classificationStatus,onRetryClassification:retryClassification,
    autoDigest,onAutoDigest:toggleAutoDigest,digestStatus,onRetryDigests:retryDigests,askDigest,onAskDigest:toggleAskDigest,
    onBackup:()=>api.backup().then(file=>{if(file)setNotice(t('バックアップを保存しました'))}).catch(e=>setError(e.message)),onRestore:restoreBackup,restoring,onImport:importNotes,onCategory:selectSettingsCategory,
    processing:<><BackfillStatus plan={backfill} onDone={plan=>{setBackfill(plan);refresh().catch(()=>{})}}/><ProcessingQueue headingId="settings-group-processing" jobs={processingJobs} onRefresh={refresh} onUpdate={api.updateProcessingJob}/></>,
    backups:<ManagedBackups headingId="settings-group-managed-backups" items={managedBackups} loading={backupAuditLoading} error={backupAuditError} onRefresh={refreshManagedBackups} onDelete={removeManagedBackup}/>,
  })}/>}
  {error&&<div className="native-alert" role="alert">{errorText(error)}<button onClick={()=>setError('')} aria-label={t('エラーを閉じる')}><Cross2Icon/></button></div>}{notice&&<div className="toast" role="status"><CheckIcon/>{notice}<button onClick={()=>setNotice('')} aria-label={t('通知を閉じる')}><Cross2Icon/></button></div>}
  </main>
  </HeadingTools.Provider>
  {page==='Notes'&&<ViewSwitch className="notes-view-switch" view={notesView} onChange={view=>showNotes(view)} inert={modal==='capture'}/>}
  {note&&page!=='Graph'&&!orbitActive&&<aside className="inspector" inert={modal==='capture'} aria-hidden={modal==='capture'}><header><span><FileTextIcon/>{t('メモ')}</span><button className="icon-button" onClick={()=>setSelected(null)} aria-label="Close note"><Cross2Icon/></button></header><div className="inspector-scroll"><div className="note-date"><ClockIcon/>{new Date(note.date).toLocaleString(dateLocale(),{dateStyle:'medium',timeStyle:'short'})}</div>{note.text&&<p className="original">{note.text}</p>}{note.excerpt&&<blockquote className="original-excerpt"><small>{t('引用')}{note.sourceApp?` · ${note.sourceApp}`:''}</small>{note.excerpt}</blockquote>}{note.sourceTitle&&<p className="original-source">{note.sourceTitle}</p>}<div className="source-context"><span>{note.originKind==='generated'?t('提案の下書き'):t(sourceLabels[note.sourceKind]||'メモ')}</span>{note.sourceUrl&&<span className="source-url">{note.sourceUrl}</span>}</div><ArticlePreview note={note} onOpen={openArticle} onRetry={retryArticle}/>{note.attachments?.length>0&&<div className="saved-images">{note.attachments.map(attachment=><div className="saved-image" key={attachment.id}><SavedImage attachment={attachment}/><span>{attachment.fileName}</span><button onClick={()=>removeSavedImage(attachment.id)} aria-label={`Remove ${attachment.fileName}`}><Cross2Icon/></button></div>)}</div>}<AiExclusionControl note={note} pending={aiExclusionPending===note.id} onChange={toggleNoteAiExcluded}/><InfoDetails label={t('出典の扱い')}><p className="insight">{note.isDemo?t('サンプルのためAI分析の対象外です。'):note.originKind==='generated'?t('提案から作成した下書きです。好みを判断する根拠には使いません。'):note.sourceKind==='reference'?t('参考資料として保存します。本人の意見としては扱いません。'):note.sourceKind==='quote'?t('引用として保存します。本人の意見としては扱いません。'):note.sourceKind==='thought'?t('自分の考えとして保存します。原文をAIが書き換えることはありません。'):t('出典は未設定です。編集から指定できます。')}</p><small className="native-revision">{note.revisionId}</small></InfoDetails></div><footer className="inspector-footer"><button className="primary" onClick={()=>edit(note)}><Pencil1Icon/>{t('メモを編集')}</button><button className="text-button" onClick={()=>trash(note)}><TrashIcon/>{t('ごみ箱に移動')}</button></footer></aside>}
  </div>
  {modal==='capture'&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className="dialog capture native-capture" role="dialog" aria-modal="true" aria-label="Quick capture" onKeyDown={trapCaptureFocus}><header><div className="dialog-brand"><Mark/><span>pure.</span><i/>{editing?t('メモを編集'):t('新しいメモ')}</div><button className="escape" onClick={close}>esc</button></header><textarea ref={input} value={draft} disabled={busy} onChange={e=>{const text=e.target.value;rememberDraft({text,originKind:draftOriginKind,sourceKind:draftSourceKind,aiExcluded:draftAiExcluded,editingId:editing||'',updatedAt:nextDraftStamp()});setDraft(text)}} onPaste={pasteImage} placeholder={t('メモを書く…')} onKeyDown={e=>{if(shouldSaveCapture(e)){e.preventDefault();save()}}}/><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={e=>{addImages(e.target.files);e.target.value=''}}/><div className="capture-source"><span>{t('出典')}</span>{Object.entries(sourceLabels).map(([kind,label])=><button key={kind} type="button" className={(draftSourceKind==='unspecified'&&/^https?:\/\/[^\s]+$/i.test(draft.trim())?'reference':draftSourceKind)===kind?'active':''} aria-pressed={(draftSourceKind==='unspecified'&&/^https?:\/\/[^\s]+$/i.test(draft.trim())?'reference':draftSourceKind)===kind} onClick={()=>{rememberDraft({text:draft,originKind:draftOriginKind,sourceKind:kind,aiExcluded:draftAiExcluded,editingId:editing||'',updatedAt:nextDraftStamp()});setDraftSourceKind(kind)}}>{label}</button>)}</div>{!editing&&draftOriginKind==='human'&&<label className="capture-ai-policy"><input type="checkbox" checked={draftAiExcluded} disabled={busy} onChange={event=>{const excluded=event.target.checked;rememberDraft({text:draft,originKind:draftOriginKind,sourceKind:draftSourceKind,aiExcluded:excluded,editingId:'',updatedAt:nextDraftStamp()});setDraftAiExcluded(excluded)}}/><LockClosedIcon/><span>{t('AI解析の対象外にする')}</span></label>}{editing&&draftAiExcluded&&<p className="capture-excluded-note"><LockClosedIcon/>{t('このメモはAI解析の対象外です。編集後も設定を保ちます。')}</p>}{captureSendsToCodex&&<div className="capture-ai-notice" role="note"><LightningBoltIcon/><p><strong>{t('自動分類')}</strong> {t('· 原文をCodexへ送信')}</p><button type="button" onClick={toggleAutoClassify}>{t('オフにする')}</button></div>}<div className="capture-images">{pendingImages.map((item,index)=><div key={index}><img src={item.preview} alt={item.fileName}/><button onClick={()=>setPendingImages(old=>old.filter((_,i)=>i!==index))} aria-label={`Remove ${item.fileName}`}><Cross2Icon/></button></div>)}</div>{error&&<p className="error" role="alert">{errorText(error)}</p>}<footer><span className="capture-hint"><kbd>⌘ ↵</kbd></span><button className="attach-button" onClick={()=>imageInput.current?.click()}><ImageIcon/>{t('画像を追加')}</button><button className="primary" onClick={save} disabled={busy||(!draft.trim()&&!pendingImages.length&&!notes.find(n=>n.id===editing)?.attachments?.length)}>{busy?t('保存中…'):t('保存')} <kbd>⌘ ↵</kbd></button></footer></section></div>}
  {ready&&modal!=='capture'&&<BackfillPrompt plan={backfill} onDone={plan=>{setBackfill(plan);refresh().catch(()=>{})}}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
