import React,{useEffect,useState} from 'react';
import {GlobeIcon,ReloadIcon,PlusIcon,Cross2Icon,ChatBubbleIcon,LockClosedIcon} from '@radix-ui/react-icons';
import {PageHeading,InfoDetails,Switch,Drop} from './UiPrimitives.jsx';
import {ProgressPanel,useProgressTask} from './ProgressPanel.jsx';
import {t,getLocale,dateLocale,dayAndMonth,errorText} from './i18n.js';
import {topicGroups} from './newsGroups.js';

const api=window.pureDesktop;
const KIND_LABELS={news:'ニュース',discussion:'話題',official:'公式',blog:'ブログ',tech:'技術'};
const time=value=>new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const dayKey=value=>new Date(value).toDateString();
// Today's items show the time; older ones the date.
const shortWhen=value=>dayKey(value)===new Date().toDateString()?time(value):new Date(value).toLocaleDateString(dateLocale(),{month:'numeric',day:'numeric'});
const PER_TOPIC=5;
const readMode=()=>{try{return localStorage.getItem('pure.news.view')==='time'?'time':'topic'}catch{return 'topic'}};


// News for the words the user chose to send. The words are the only thing that leaves this Mac,
// so they are always on screen next to where they go.
export default function NewsView({model,onOpenNote}){
  const [state,setState]=useState(null),[draft,setDraft]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),[open,setOpen]=useState(null);
  const [mode,setModeState]=useState(readMode),[expanded,setExpanded]=useState(()=>new Set());
  const setMode=value=>{setModeState(value);try{localStorage.setItem('pure.news.view',value)}catch{}};
  const task=useProgressTask('news');
  const load=()=>api.news().then(setState).catch(cause=>setError(errorText(cause.message)));
  useEffect(()=>{load();return api.onNewsChanged(load)},[]);
  if(!state)return <div className="native-scroll news-page"><PageHeading Icon={GlobeIcon} title={t('ニュース')}/></div>;
  const {settings,interests}=state;
  const when=item=>Date.parse(item.publishedAt||item.fetchedAt)||0;
  const items=[...state.items].sort((a,b)=>when(b)-when(a));
  const running=state.running||!!task||pending;
  const canCollect=!!model||settings.topics.some(topic=>topic.enabled);
  async function save(next){setError('');try{const settingsNow=await api.newsSettings(next);setState(old=>({...old,settings:settingsNow}));load()}catch(cause){setError(errorText(cause.message))}}
  const setTopics=topics=>save({topics});
  function add(query){const value=query.trim();if(!value)return;setTopics([...settings.topics,{query:value,enabled:true}]);setDraft('')}
  // A word found in the notes is taken out for good (until put back); the user's own words are removed.
  const block=query=>{setOpen(null);save({blocked:[...settings.blocked,query]})};
  const unblock=query=>save({blocked:settings.blocked.filter(word=>word!==query)});
  async function refresh(){setPending(true);setError('');try{await api.refreshNews()}catch(cause){setError(errorText(cause.message))}finally{setPending(false);load()}}
  const locale=getLocale();
  const shownTitle=item=>item.titleLocalized&&item.locale===locale?item.titleLocalized:item.title;
  const meta=settings.lastRunAt?t('{when}に取得',{when:new Date(settings.lastRunAt).toLocaleString(dateLocale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}):undefined;
  const opened=interests.items.find(item=>item.query===open);
  const openedRelated=(interests.related||[]).find(item=>item.query===open);
  const lastRun=settings.lastRunAt?new Date(settings.lastRunAt).toLocaleString(dateLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  function renderItem(item,shownTime,withTopic){
    const date=item.publishedAt||item.fetchedAt,title=shownTitle(item);
    return <article className="news-item" key={item.url}>
      <Drop/>
      <time dateTime={date}>{shownTime}</time>
      <div className="news-item-body">
        <button type="button" className="news-item-title" onClick={()=>api.openNews(item.url)}>{title}</button>
        {title!==item.title&&<p className="news-item-original">{item.title}</p>}
        {item.summary&&item.locale===locale&&<p className="news-item-summary">{item.summary}</p>}
        <small><span className="news-kind">{t(KIND_LABELS[item.kind]||'ニュース')}</span>{[item.source,withTopic&&item.topic].filter(Boolean).join(' · ')}
          {item.discussion&&<button type="button" className="news-discussion" onClick={()=>api.openNews(item.discussion)}><ChatBubbleIcon/>{t('議論')}</button>}</small>
      </div>
    </article>;
  }
  // The words go to the web search of whichever AI is connected.
  const ai=state.provider==='claude'?'Claude Code':'Codex',search=state.provider==='claude'?t('Claude Code（AnthropicのWeb検索）'):t('Codex（OpenAIのWeb検索）');
  return <div className="native-scroll news-page">
    <PageHeading Icon={GlobeIcon} title={t('ニュース')} meta={meta} actions={<button className="primary" onClick={refresh} disabled={running||!canCollect} title={canCollect?undefined:t('設定でCodexに接続し、モデルを選んでください。')}><ReloadIcon/>{running?t('集めています…'):t('集める')}</button>}/>
    <section className="news-topics" aria-label={t('送る言葉')}>
      <div className="news-topics-head">
        <div><h3>{t('送る言葉')}</h3><p>{t('メモから見つけた関心、そこからAIが広げた関連の言葉、自分で足した言葉だけを、Googleニュース・Hacker News・{search}へ送ります。メモの本文は送りません。',{search})}</p></div>
        <label className="news-enable"><span>{t('毎日自動で集める')}</span><Switch label={t('毎日自動で集める')} checked={settings.enabled} onChange={()=>save({enabled:!settings.enabled})}/></label>
      </div>
      <div className="news-topic-list">
        {interests.items.map(item=><span key={item.query} className={'news-topic is-memo'+(open===item.query?' is-open':'')}>
          <button type="button" aria-expanded={open===item.query} onClick={()=>setOpen(open===item.query?null:item.query)} title={item.why}>{item.query}{item.english&&<span className="news-topic-english">{item.english}</span>}</button>
          <button type="button" className="news-topic-remove" aria-label={t('{name}を外す',{name:item.query})} onClick={()=>block(item.query)}><Cross2Icon/></button>
        </span>)}
        {(interests.related||[]).map(item=><span key={item.query} className={'news-topic is-related'+(open===item.query?' is-open':'')}>
          <button type="button" aria-expanded={open===item.query} onClick={()=>setOpen(open===item.query?null:item.query)} title={item.why}><span className="news-topic-kicker">{t('関連')}</span>{item.query}{item.english&&<span className="news-topic-english">{item.english}</span>}</button>
          <button type="button" className="news-topic-remove" aria-label={t('{name}を外す',{name:item.query})} onClick={()=>block(item.query)}><Cross2Icon/></button>
        </span>)}
        {settings.topics.map(topic=><span key={topic.id} className={'news-topic'+(topic.enabled?'':' is-off')}>
          <button type="button" aria-pressed={topic.enabled} onClick={()=>setTopics(settings.topics.map(item=>item.id===topic.id?{...item,enabled:!item.enabled}:item))} title={topic.enabled?t('送らないようにする'):t('送るようにする')}>{topic.query}</button>
          <button type="button" className="news-topic-remove" aria-label={t('{name}を外す',{name:topic.query})} onClick={()=>setTopics(settings.topics.filter(item=>item.id!==topic.id))}><Cross2Icon/></button>
        </span>)}
        <form className="news-topic-add" onSubmit={event=>{event.preventDefault();add(draft)}}>
          <input value={draft} onChange={event=>setDraft(event.target.value)} placeholder={t('言葉を追加')} aria-label={t('送る言葉を追加')} maxLength={60}/>
          <button type="submit" aria-label={t('追加')} disabled={!draft.trim()}><PlusIcon/></button>
        </form>
      </div>
      {opened&&<div className="news-why"><strong>{opened.label}</strong>{opened.why&&<p>{opened.why}</p>}
        <div className="news-why-evidence">{opened.evidence.map(e=><button type="button" key={e.revisionId} onClick={()=>onOpenNote?.(e.noteId)} title={t('原文を開く')}>「{e.quote}」</button>)}</div></div>}
      {openedRelated&&<div className="news-why"><strong>{openedRelated.label}</strong>{openedRelated.why&&<p>{openedRelated.why}</p>}
        <p className="news-why-source">{t('メモの関心「{name}」からAIが広げた言葉です。メモに書かれていることではありません。要らなければ外してください。次から似たものも出しません。',{name:openedRelated.fromLabel})}</p></div>}
      {!interests.items.length&&!settings.topics.length&&<p className="news-note">{t('「集める」を押すと、メモから関心を探して、その言葉でニュースを集めます。')}</p>}
      {settings.blocked.length>0&&<details className="ui-details news-blocked"><summary><span>{t('外した言葉 · {n}',{n:settings.blocked.length})}</span></summary>
        <div className="ui-details-content">{settings.blocked.map(word=><span key={word}>{word}<button type="button" className="text-button" onClick={()=>unblock(word)}>{t('戻す')}</button></span>)}</div></details>}
      <InfoDetails label={t('集め方について')}><p>{t('「集める」を押すと（オンなら毎日1回）、まずメモを{ai}で読んで具体的な関心を探し（メモが変わっていなければ前回の結果を使います）、その言葉と自分で足した言葉で、Googleニュースと Hacker News から公開日時つきの記事を、{ai} の Web 検索から Reddit のスレッドや公式発表を集めます。検索で見つかったリンクは、実際にページを開いて存在を確かめたものだけを残します。別の言語の見出しは表示言語に訳します（リンク先は原文のまま）。記事は14日で消えます。',{ai})}</p><p>{t('メモの関心から「それが好きなら気になりそう」な言葉もAIが最大4つ広げ、「関連」として一緒に集めます。メモに書かれていることではないので、理由と元の関心を表示し、記事も分けて並べます。外した言葉は次から似たものも出しません。')}</p></InfoDetails>
    </section>
    {running&&<ProgressPanel task={task} fallback={t('ニュースを集めています…')}/>}
    {error&&<p className="native-alert" role="alert">{error}</p>}
    {settings.failures?.length>0&&!running&&<p className="news-failures">{t('前回、一部の取得に失敗しました: {sources}',{sources:settings.failures.join(' / ')})}</p>}
    {items.length>0&&<div className="news-view-switch" role="group" aria-label={t('ニュースの並べ方')}>
      <button type="button" aria-pressed={mode==='topic'} onClick={()=>setMode('topic')}>{t('関心ごと')}</button>
      <button type="button" aria-pressed={mode==='time'} onClick={()=>setMode('time')}>{t('新しい順')}</button>
    </div>}
    {items.length&&mode==='topic'?<div className="news-groups">{topicGroups(items,{settings,interests}).filter(group=>group.items.length).map(group=>{
      const open=expanded.has(group.topic),shown=open?group.items:group.items.slice(0,PER_TOPIC);
      return <section key={group.topic} className="news-group" aria-label={group.label}>
        <header><h3>{group.label}{group.from&&<span className="news-group-from">{t('{name}が好きなら',{name:group.from})}</span>}</h3><small>{group.items.length?t('{n}件',{n:group.items.length}):''}</small></header>
        {group.added===0&&settings.lastRunAt&&<p className="news-group-quiet">{t('前回（{when}）は新着なし',{when:lastRun})}</p>}
        {shown.map(item=>renderItem(item,shortWhen(item.publishedAt||item.fetchedAt),false))}
        {group.items.length>PER_TOPIC&&<button type="button" className="text-button news-group-more" aria-expanded={open}
          onClick={()=>setExpanded(old=>{const next=new Set(old);if(open)next.delete(group.topic);else next.add(group.topic);return next})}>
          {open?t('閉じる'):t('さらに{n}件',{n:group.items.length-PER_TOPIC})}</button>}
      </section>;
    })}
      {(()=>{const quiet=topicGroups(items,{settings,interests}).filter(group=>!group.items.length);
        return quiet.length>0&&settings.lastRunAt&&<p className="news-quiet-words">{t('前回（{when}）は新着なし',{when:lastRun})}<span>{quiet.map(group=>group.label).join(' · ')}</span></p>;})()}
    </div>
    :items.length?<div className="news-list">{items.map((item,index)=>{
      const date=item.publishedAt||item.fetchedAt;
      return <React.Fragment key={item.url}>
        {(index===0||dayKey(items[index-1].publishedAt||items[index-1].fetchedAt)!==dayKey(date))&&<h3 className="date-label">{dayAndMonth(new Date(date))}</h3>}
        {renderItem(item,item.publishedAt?time(item.publishedAt):'--:--',true)}
      </React.Fragment>;
    })}</div>
    :<div className="news-empty"><LockClosedIcon aria-hidden="true"/><h3>{t('まだニュースはありません')}</h3><p>{canCollect?t('「集める」を押すと、メモから関心を探してニュースを集めます。'):t('設定でCodexに接続し、モデルを選んでください。')}</p></div>}
  </div>;
}
