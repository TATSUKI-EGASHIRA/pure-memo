import React from 'react';
import {ArrowRightIcon,CheckIcon,DesktopIcon,DownloadIcon,FileTextIcon,LayersIcon,LightningBoltIcon,Link2Icon,ReloadIcon,ReaderIcon,UploadIcon} from '@radix-ui/react-icons';
import {SettingSwitch} from './SettingsView.jsx';

export default function settingsSections({account,models,model,onModel,onLogin,onRefreshAccount,reduced,systemReduced,onReduced,autoClassify,onAutoClassify,classificationStatus,onRetryClassification,autoDigest,onAutoDigest,digestStatus,onRetryDigests,askDigest,onAskDigest,onBackup,onRestore,restoring,onImport,onCategory,processing,backups}){
  const connected=!!account?.account;
  const status=(value,retry)=>value.pending+value.running+value.failed>0&&<div className="settings-job-status">{value.pending+value.running>0&&<span>{value.pending+value.running}件処理中</span>}{value.failed>0&&<button className="text-button" onClick={retry}><ReloadIcon/>{value.failed}件を再試行</button>}</div>;
  const jump=(category,label)=><button className="text-button" onClick={()=>onCategory(category)}>{label}<ArrowRightIcon/></button>;
  return [
    {id:'appearance',category:'general',title:'表示',rows:[
      {id:'motion',Icon:DesktopIcon,title:'動きを減らす',details:'装飾アニメーションを抑えます。macOSの「視差効果を減らす」設定も反映します。',extra:systemReduced&&<p>macOSの設定が有効</p>,control:<SettingSwitch label="pureの動きを減らす" checked={reduced} onChange={onReduced}/>},
    ]},
    {id:'overview',category:'general',title:'保存・接続',rows:[
      {id:'storage',Icon:DesktopIcon,title:'このMacに保存',control:jump('data','バックアップ')},
      {id:'connection-overview',Icon:Link2Icon,title:'Codex',description:connected?'接続済み':'未接続',control:jump('connection','接続設定')},
    ]},
    {id:'codex',category:'connection',title:'Codex',rows:[
      {id:'account',Icon:Link2Icon,title:'接続',description:connected?'接続済み':'未接続',control:<div className="settings-account-actions">{connected?<span className="connection-status"><CheckIcon/>接続済み</span>:<button className="primary" onClick={onLogin}>ログイン</button>}<button className="text-button" aria-label="接続状態を更新" title="接続状態を更新" onClick={onRefreshAccount}><ReloadIcon/>更新</button></div>},
      {id:'model',Icon:LightningBoltIcon,title:'モデル',keywords:'使用するモデル 分類 分析 質問 Ask',control:<select value={model} onChange={e=>onModel(e.target.value)} aria-label="使用するモデル" disabled={!models.length}>{!models.length&&<option value={model}>利用できるモデルがありません</option>}{models.map(m=><option key={m.model} value={m.model}>{m.displayName||m.model}</option>)}</select>},
    ],note:jump('privacy','送信する情報')},
    {id:'automation',category:'ai',title:'自動処理',rows:[
      {id:'classification',Icon:FileTextIcon,title:'メモを自動分類',description:'保存・編集した原文をCodexへ送信',details:'文章メモ1件と作成済みカテゴリの名前を送信します。合うカテゴリがなければ未分類に残します。AI解析の対象外メモ、画像だけのメモ、AIの下書き、サンプルは送りません。',extra:status(classificationStatus,onRetryClassification),control:<SettingSwitch label="保存後の自動分類" checked={autoClassify} onChange={onAutoClassify}/>},
      {id:'digest',Icon:LayersIcon,title:'まとめを自動更新',description:'カテゴリの原文をCodexへ送信',details:'メモや分類が変わると、カテゴリの原文を最大30件と関連する評価・訂正を送信してまとめを更新します。メモの保存はAIの完了を待ちません。',extra:status(digestStatus,onRetryDigests),control:<SettingSwitch label="カテゴリ分析の自動更新" checked={autoDigest} disabled={!model} onChange={onAutoDigest}/>},
    ]},
    {id:'ask-search',category:'ai',title:'質問',rows:[
      {id:'ask-digest',Icon:ReaderIcon,title:'まとめを検索に使う',keywords:'Ask Collection',details:'有効なまとめをこのMacで原文検索の手掛かりに使います。回答の根拠は元のメモです。まとめを原文の代わりに送信することはありません。',control:<SettingSwitch label="Askの検索にまとめを利用" checked={askDigest} onChange={onAskDigest}/>},
    ]},
    {id:'processing',category:'ai',title:'処理状況',keywords:'AI 分類 分析 待機 失敗 停止 再試行',content:processing},
    {id:'backup',category:'data',title:'バックアップ',rows:[
      {id:'export',Icon:DownloadIcon,title:'書き出し',description:'メモ・画像・分析結果',control:<button className="text-button" onClick={onBackup}><DownloadIcon/>保存</button>},
      {id:'restore',Icon:ReloadIcon,title:'復元',details:'完全バックアップから復元します。復元前に現在のデータのコピーを作ります。',control:<button className="text-button" onClick={onRestore} disabled={restoring}><ReloadIcon/>{restoring?'復元中…':'ファイルを選択'}</button>},
      {id:'import',Icon:UploadIcon,title:'ブラウザ版から取り込み',control:<button className="text-button" onClick={onImport}><UploadIcon/>ファイルを選択</button>},
    ]},
    {id:'managed-backups',category:'data',title:'自動バックアップ',keywords:'アプリ内 取り込み 復元 完全削除 ファイル 確認 削除',content:backups},
    {id:'data-scope',category:'privacy',title:'Codexへ送信',description:'AI解析の対象外メモは送信しません。',rows:[
      {id:'classification-scope',title:'自動分類',description:'原文1件・作成済みカテゴリ名'},
      {id:'digest-scope',title:'まとめ',description:'原文 最大30件・関連する評価と訂正'},
      {id:'suggestion-scope',title:'カテゴリ名の候補',description:'未分類の原文 最大30件・カテゴリ名'},
      {id:'ask-scope',title:'質問',description:'質問・関連する原文 最大30件・評価と訂正'},
      {id:'memory-scope',title:'つながり',description:'原文 最大72件（各1,800文字）・確認と訂正'},
      {id:'article-scope',title:'記事プレビュー',description:'保存した公開URLへアクセス',details:'タイトルなどを取得します。取得した記事を本人の感想としてAIへ送ることはありません。AI解析の対象外設定とは別の処理です。'},
    ],note:<><p>必要に応じてID・日時・出典区分・元URLも送信します。</p><p>送信済みの情報は、pureから削除できません。</p></>},
  ];
}
