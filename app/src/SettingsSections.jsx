import React from 'react';
import {ArrowRightIcon,CheckIcon,DesktopIcon,DownloadIcon,FileTextIcon,LayersIcon,LightningBoltIcon,Link2Icon,ReloadIcon,ReaderIcon,UploadIcon,GlobeIcon,Pencil2Icon,LockClosedIcon,EyeNoneIcon} from '@radix-ui/react-icons';
import {SettingSwitch} from './SettingsView.jsx';
import {LOCALES} from './i18n.js';
import {t} from './i18n.js';

// Codex advertises the levels per model; known ones get a short Japanese name, unknown ones show as sent.
const EFFORT_NAMES={none:'なし',minimal:'最小',low:'低',medium:'標準',high:'高',xhigh:'最高'};
export const effortLabel=value=>value?(EFFORT_NAMES[value]?`${t(EFFORT_NAMES[value])} · ${value}`:value):'';

export default function settingsSections({capture={},onRequestCaptureAccess,onCaptureExcluded,locale,onLocale,account,models,model,onModel,aiSettings={provider:'codex',lightModel:'',providers:[]},onAiSettings=()=>{},newModels=[],modelsLoading,onRefreshModels,reasoningEffort,onEffort,onLogin,onRefreshAccount,reduced,systemReduced,onReduced,autoClassify,onAutoClassify,classificationStatus,onRetryClassification,autoDigest,onAutoDigest,digestStatus,onRetryDigests,askDigest,onAskDigest,onBackup,onRestore,restoring,onImport,onCategory,processing,backups}){
  const connected=!!account?.account;
  const providerLabel=aiSettings.provider==='claude'?'Claude Code':'Codex';
  const current=models.find(m=>m.model===model),supported=!reasoningEffort||!!current?.efforts.some(option=>option.effort===reasoningEffort);
  const status=(value,retry)=>value.pending+value.running+value.failed>0&&<div className="settings-job-status">{value.pending+value.running>0&&<span>{t('{n}件処理中',{n:value.pending+value.running})}</span>}{value.failed>0&&<button className="text-button" onClick={retry}><ReloadIcon/>{t('{n}件を再試行',{n:value.failed})}</button>}</div>;
  const jump=(category,label)=><button className="secondary" onClick={()=>onCategory(category)}>{label}<ArrowRightIcon/></button>;
  return [
    {id:'appearance',category:'general',title:t('表示'),rows:[
      {id:'language',Icon:GlobeIcon,title:t('言語'),keywords:'language 言語 English 日本語',description:t('メモの本文とAIの回答は翻訳しません。'),control:<select value={locale} onChange={e=>onLocale(e.target.value)} aria-label={t('言語')}>{LOCALES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select>},
      {id:'motion',Icon:DesktopIcon,title:t('動きを減らす'),details:t('装飾アニメーションを抑えます。macOSの「視差効果を減らす」設定も反映します。'),extra:systemReduced&&<p>{t('macOSの設定が有効')}</p>,control:<SettingSwitch label={t('pureの動きを減らす')} checked={reduced} onChange={onReduced}/>},
    ]},
    {id:'capture',category:'general',title:t('取り込み'),rows:[
      {id:'quick-capture',Icon:Pencil2Icon,title:t('クイック入力'),keywords:'shortcut ショートカット ⌘⇧N 選択 引用 Raycast',description:t('⌘⇧N でどのアプリの上にも入力欄を出します。選択中のテキストは出典付きの引用として入ります。'),
        details:t('⌥⌘⇧N は入力欄を出さずに、選択中のテキストを出典付きですぐ保存します。Raycastやショートカット.appからは pure://new?text=…&quote=…&url=… で入力欄を開けます（リンクだけでは保存されません）。')},
      {id:'capture-access',Icon:LockClosedIcon,title:t('選択テキストの取り込み'),keywords:'accessibility アクセシビリティ 権限 許可',description:!capture.available?t('この環境では使えません'):capture.trusted?t('許可済み'):t('アクセシビリティの許可が必要です'),status:capture.available&&capture.trusted?'connected':'disconnected',
        control:capture.available&&!capture.trusted?<button className="secondary" onClick={onRequestCaptureAccess}>{t('許可する')}</button>:null},
      {id:'capture-excluded',Icon:EyeNoneIcon,title:t('取り込まないアプリ'),keywords:'exclude 除外 パスワード',description:t('パスワード管理アプリとパスワード入力中は常に取り込みません。アプリ名をカンマで区切って追加できます。'),
        control:<input key={(capture.excluded||[]).join(',')} defaultValue={(capture.excluded||[]).join(', ')} placeholder="Slack, Messages" aria-label={t('取り込まないアプリ')} onBlur={e=>onCaptureExcluded(e.target.value.split(/[,、]/).map(v=>v.trim()).filter(Boolean))} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>},
    ]},
    {id:'overview',category:'general',title:t('保存・接続'),rows:[
      {id:'storage',Icon:DesktopIcon,title:t('このMacに保存'),control:jump('data',t('バックアップ'))},
      {id:'connection-overview',Icon:Link2Icon,title:providerLabel,description:connected?t('接続済み'):t('未接続'),status:connected?'connected':'disconnected',control:jump('connection',t('接続設定'))},
    ]},
    {id:'codex',category:'connection',title:providerLabel,rows:[
      {id:'provider',Icon:Link2Icon,title:t('AIの接続先'),keywords:'Codex Claude Code provider 接続先',description:t('メモの分類・まとめ・質問などを処理するAI。どちらもこのMacにインストールしたCLIを、あなたのアカウントで使います。'),
        control:<select value={aiSettings.provider} onChange={e=>onAiSettings({provider:e.target.value})} aria-label={t('AIの接続先')}>{(aiSettings.providers.length?aiSettings.providers:[{id:'codex',label:'Codex'}]).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>},
      {id:'account',Icon:Link2Icon,title:t('接続'),description:connected?t('接続済み'):t('未接続'),status:connected?'connected':'disconnected',control:<div className="settings-account-actions">{connected?<span className="connection-status"><CheckIcon/>{t('接続済み')}</span>:<button className="primary" onClick={onLogin}>{t('ログイン')}</button>}<button className="text-button" aria-label={t('接続状態を更新')} title={t('接続状態を更新')} onClick={onRefreshAccount}><ReloadIcon/>{t('更新')}</button></div>},
      {id:'model',Icon:LightningBoltIcon,title:t('モデル'),keywords:t('使用するモデル 分類 分析 質問 Ask 新しいモデル'),description:current?.description||undefined,
        extra:<div className="settings-model-tools"><button className="secondary" onClick={onRefreshModels} disabled={modelsLoading}><ReloadIcon/>{modelsLoading?t('確認中…'):t('モデル一覧を更新')}</button>{newModels.length>0&&<span className="settings-new-models">{t('新着')} · {newModels.map(id=>models.find(m=>m.model===id)?.displayName||id).join('、')}</span>}</div>,
        control:<select value={model} onChange={e=>onModel(e.target.value)} aria-label={t('使用するモデル')} disabled={!models.length}>{!models.length&&<option value={model}>{t('利用できるモデルがありません')}</option>}{models.map(m=><option key={m.model} value={m.model}>{m.displayName||m.model}{m.isDefault?t('（既定）'):''}{newModels.includes(m.model)?t(' · 新着'):''}</option>)}</select>},
      {id:'effort',Icon:LayersIcon,title:t('推論の強さ'),keywords:t('reasoning effort high low medium 推論 考える深さ'),description:t('高いほど時間をかけて考えます。分類・まとめ・質問・つながりのすべてに使います。'),
        details:current?.efforts.length?current.efforts.map(option=>`${effortLabel(option.effort)}: ${option.description||'—'}`).join('\n'):undefined,
        control:<select value={supported?reasoningEffort:''} onChange={e=>onEffort(e.target.value)} aria-label={t('推論の強さ')} disabled={!current?.efforts.length}><option value="">{current?.defaultEffort?t('自動（{n}）',{n:effortLabel(current.defaultEffort)}):t('自動')}</option>{current?.efforts.map(option=><option key={option.effort} value={option.effort}>{effortLabel(option.effort)}</option>)}</select>},
      {id:'light-model',Icon:LightningBoltIcon,title:t('軽い処理のモデル'),keywords:t('軽い処理 分類 検証 翻訳 速い モデル'),description:t('保存時の分類と読み取り、回答の検証、見出しの翻訳に使います。「選んだモデル（推論 low）」なら同じモデルを軽く使います。'),
        control:<select value={aiSettings.lightModel} onChange={e=>onAiSettings({lightModel:e.target.value})} aria-label={t('軽い処理のモデル')} disabled={!models.length}><option value="">{t('選んだモデル（推論 low）')}</option>{models.filter(m=>m.model!==model).map(m=><option key={m.model} value={m.model}>{m.displayName}</option>)}</select>},
    ],note:jump('privacy',t('送信する情報'))},
    {id:'automation',category:'ai',title:t('自動処理'),rows:[
      {id:'classification',Icon:FileTextIcon,title:t('メモを自動分類'),description:t('保存・編集した原文をCodexへ送信'),details:t('保存したメモ（数件ずつ）と作成済みカテゴリの名前を送り、カテゴリ分けと、メモから分かること（好き・したい・したことなど）の読み取りを行います。読み取った内容は根拠の文と一緒にこのMacに保存し、質問やニュースの関心探しに使います。合うカテゴリがなければ未分類に残します。AI解析の対象外メモ、画像だけのメモ、AIの下書き、サンプルは送りません。'),extra:status(classificationStatus,onRetryClassification),control:<SettingSwitch label={t('保存後の自動分類')} checked={autoClassify} onChange={onAutoClassify}/>},
      {id:'digest',Icon:LayersIcon,title:t('まとめを自動更新'),description:t('カテゴリの原文をCodexへ送信'),details:t('メモや分類が変わると、カテゴリの原文を最大30件と関連する評価・訂正を送信してまとめを更新します。メモの保存はAIの完了を待ちません。'),extra:status(digestStatus,onRetryDigests),control:<SettingSwitch label={t('カテゴリ分析の自動更新')} checked={autoDigest} disabled={!model} onChange={onAutoDigest}/>},
    ]},
    {id:'ask-search',category:'ai',title:t('質問'),rows:[
      {id:'ask-digest',Icon:ReaderIcon,title:t('まとめを検索に使う'),keywords:'Ask Collection',details:t('有効なまとめをこのMacで原文検索の手掛かりに使います。回答の根拠は元のメモです。まとめを原文の代わりに送信することはありません。'),control:<SettingSwitch label={t('Askの検索にまとめを利用')} checked={askDigest} onChange={onAskDigest}/>},
    ]},
    {id:'processing',category:'ai',title:t('処理状況'),keywords:t('AI 分類 分析 待機 失敗 停止 再試行'),content:processing},
    {id:'backup',category:'data',title:t('バックアップ'),rows:[
      {id:'export',Icon:DownloadIcon,title:t('書き出し'),description:t('メモ・画像・分析結果'),control:<button className="text-button" onClick={onBackup}><DownloadIcon/>{t('保存')}</button>},
      {id:'restore',Icon:ReloadIcon,title:t('復元'),details:t('完全バックアップから復元します。復元前に現在のデータのコピーを作ります。'),control:<button className="text-button" onClick={onRestore} disabled={restoring}><ReloadIcon/>{restoring?t('復元中…'):t('ファイルを選択')}</button>},
      {id:'import',Icon:UploadIcon,title:t('ブラウザ版から取り込み'),control:<button className="text-button" onClick={onImport}><UploadIcon/>{t('ファイルを選択')}</button>},
    ]},
    {id:'managed-backups',category:'data',title:t('自動バックアップ'),keywords:t('アプリ内 取り込み 復元 完全削除 ファイル 確認 削除'),content:backups},
    {id:'data-scope',category:'privacy',title:t('Codexへ送信'),description:t('AI解析の対象外メモは送信しません。'),rows:[
      {id:'classification-scope',title:t('自動分類'),description:t('原文（数件ずつ）・作成済みカテゴリ名')},
      {id:'digest-scope',title:t('まとめ'),description:t('原文 最大30件・関連する評価と訂正')},
      {id:'suggestion-scope',title:t('カテゴリ名の候補'),description:t('未分類の原文 最大30件・カテゴリ名')},
      {id:'ask-scope',title:t('質問'),description:t('質問・関連する原文 最大30件・評価と訂正')},
      {id:'memory-scope',title:t('つながり'),description:t('原文 最大72件（各1,800文字）・確認と訂正')},
      {id:'article-scope',title:t('リンク先の本文'),description:t('保存した公開URLへアクセスし、本文を読み取ります'),details:t('タイトル・説明・本文（最大2万文字）を取得します。本文はメモと一緒にCodexへ送り、外部の資料として扱います。本人の感想としては扱いません。AI解析の対象外にしたメモの本文は送りません。')},
    ],note:<><p>{t('必要に応じてID・日時・出典区分・元URLも送信します。')}</p><p>{t('送信済みの情報は、pureから削除できません。')}</p></>},
  ];
}
