# 開発手順

## 初回セットアップ

macOSとNode.js 24.6以上を使用します。依存関係の版はlockfileで固定しています。

```sh
cd app
npm ci
npm run desktop
```

開発起動ではViteとElectronを起動し、保存先を `app/.dev-data/` に分けます。このフォルダにはメモだけでなくElectronのCookie・キャッシュ・ブラウザ保存領域も入ります。Gitには含めません。

通常の保存先はElectronの `userData` 配下の `pure.sqlite` です。macOSでは通常 `~/Library/Application Support/pure./` になります。起動方法は次のとおりです。

```sh
cd app
npm run build
npm run desktop:built
```

`desktop:built` はUIを再ビルドして起動します。Swiftの埋め込みヘルパーは `build` または `build:embedding` で別途ビルドします。Finder用の入口は [open.command](../scripts/open.command) です。

## AIと検索

AIを使う場合はCodex CLIを別途インストールし、設定画面でログイン・モデル選択を行います。アプリはCLIのApp Serverに接続します。アプリ自体にAPIキーを埋め込む必要はありません。認証の保存はCLI側で管理されます。

ローカルの文脈埋め込みはSwiftとNaturalLanguageを使用します。macOS以外、またはSwiftコンパイラがない場合は文字検索へ切り替わります。Swiftが見つかってもコンパイルに失敗した場合はビルドが失敗します。Mac向け製品としての対象OSと配布方法は検証中です。

## 検証

```sh
cd app
npm run test:desktop
npm run build
npm run eval:answer-quality:prepare
```

通常のテストは一時ディレクトリと架空メモを使います。回答品質のprepareはAI回答を生成せず、入力候補と監査項目を準備します。

| コマンド | 内容 |
| --- | --- |
| `npm run eval:memory` | 架空データで検索方式を比較 |
| `npm run eval:memory-holdout` | 別の固定質問で検索を比較 |
| `npm run eval:longitudinal` | 時期・場面・出典を含む検索の評価 |
| `npm run eval:answer-quality` | 実AIの回答を生成し、監査用レポートを保存 |
| `npm run eval:memory-live` | 実AIのDigest・回答を評価 |
| `npm run test:sandbox` | 実AI接続のファイル読み取り制限を確認 |

実AIを使うコマンドには認証と通信が必要で、利用枠を消費する場合があります。JSONレポートの標準出力先は `app/eval/results/` です。評価コード・架空の入力は公開し、生成レポートは公開対象から外します。

Swiftのキャッシュ書き込みが制限される環境では、書き込み可能な一時ディレクトリを指定します。

```sh
CLANG_MODULE_CACHE_PATH=/tmp/pure-clang-cache SWIFT_MODULECACHE_PATH=/tmp/pure-swift-cache npm run build
```

リポジトリのルートでは `node scripts/check-public-files.mjs` で公開候補を点検できます。

## ブラウザ版の試作

`npm run dev` のトップページはサンプルを使った旧UI試作です。メモはブラウザに保存され、手書きの分析・サンプルGraphを表示します。実AIとSQLiteの検証にはMac版を使用してください。
