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

## DMGの作成

```sh
cd app
npm run dist:mac
```

`app/release/pure-<version>-arm64.dmg` ができます（Apple Silicon用）。中のアプリは `pure.app`（表示名 pure.）で、データは通常の起動と同じ `~/Library/Application Support/pure./` に保存します。

Developer ID がまだないため、`build/adhoc-sign.cjs` でアドホック署名しています。公証はしていません。そのため次の制約があります。
- 別のMacでダウンロードしたDMGは、Gatekeeperに止められます。「システム設定 › プライバシーとセキュリティ › このまま開く」で開けます。自分のMacでビルドしたものはそのまま開けます。
- アクセシビリティの許可は署名に結びつくため、ビルドし直すたびに許可が外れます。「システム設定 › プライバシーとセキュリティ › アクセシビリティ」で pure を削除してから、もう一度許可してください。開発起動（Electron）と `pure.app` の許可は別々です。

一般配布の前に、Developer ID での署名、Hardened Runtime、公証に切り替えてください。

## AIと検索

AIを使う場合はCodex CLIを別途インストールし、設定画面でログイン・モデル選択を行います。アプリはCLIのApp Serverに接続します。アプリ自体にAPIキーを埋め込む必要はありません。認証の保存はCLI側で管理されます。

AIの接続先は設定で Codex と Claude Code から選べます（`ai-router.cjs`）。Claude Code は `claude -p` をツールなし・ユーザー設定とMCPなし・会話保存なしで呼び、Claude Code 側のログインを使います。

pureはCodexをpure専用のフォルダ（`<userData>/codex`）で動かします。個人のCodex設定（`~/.codex` の `AGENTS.md`・フック・MCPサーバー・`config.toml`）は読まず、フック・アプリ・プラグイン・ブラウザ/コンピュータ操作・シェル・サブエージェント・メモリーなどのエージェント機能も無効にし（`codex.cjs` の `DISABLED_FEATURES`）、Codexのコーディング用の前提指示を pure 専用のもの（`BASE_INSTRUCTIONS`）に置き換えます。サインイン情報は、pure側にまだなければ `~/.codex/auth.json` を一度だけ写します（なければ設定画面からログイン）。Web検索は全体で無効にし、ニュースの収集スレッドだけで有効にします。

AIを呼ぶたびに、処理の種類・プロンプトの版・モデル・推論の強さ・時間・トークン数・成否を `ai_calls` に記録します（プロンプトや回答の本文は記録しません）。プロンプトの版は、プロンプトを作る関数・スキーマ・検証の中身から自動で決まります（`prompt-version.cjs`）。検証に落ちた回答は理由を添えて1回だけ答え直してもらいます（`ai-tasks.cjs` の `generateValid`）。

ローカルの文脈埋め込みはSwiftとNaturalLanguageを使用します。macOS以外、またはSwiftコンパイラがない場合は文字検索へ切り替わります。Swiftが見つかってもコンパイルに失敗した場合はビルドが失敗します。Mac向け製品としての対象OSと配布方法は検証中です。

## 検証

```sh
cd app
npm run test:desktop
npm run build
npm run eval:answer-quality:prepare
npm run eval -- --judge          # 製品のAI品質（実AI）
```

### 使い続けたときの再現（`npm run eval:simulate`）

実際に何週間も使わなくても、使い続けたときの費用と品質を確かめるための試験です。`eval/synthetic-life.cjs` が架空の人の1年分のメモ（音楽・映画・運動の始めとやめ・仕事・食事・リンク・日々の雑事、決まった日に仕込んだ事実とその変更、メモに紛れた指示）を毎回同じ内容で作ります。`eval/simulate-use.cjs` は、そのうち過去の分を導入時のメモとして読み込み（記憶の読み込み・プロフィール・まとめ）、残りの日を1日ずつ書いて、アプリと同じ裏の処理（分類・プロフィール・まとめの更新・指定日のニュース）を動かします。最後に、仕込んだ事実への質問、プロフィール（やめたことは過去、続けていることは今）、新しいメモの分類を採点し、導入時と1日あたりの呼び出し回数・トークン・時間、1か月分の見込み、アカウントの使用率（5時間・週）の変化を表示します。

- `--provider claude`、`--days 7`、`--per-day 6`、`--history 365`、`--news-days 7,14` で条件を変えられます。
- 何日分もの処理を短時間で行うため、5時間の使用率は実際の利用より大きく動きます。1日あたりの数字と週の使用率で判断してください。

### 製品のAI評価（`npm run eval`）

アプリと同じコード（`desktop/ai-tasks.cjs`・`classifier.cjs`）を、架空の利用者のメモ（`eval/product-personas.cjs`）で実AIに通して採点します。プロンプト・検証・モデル・推論の強さを変えたら必ず回し、`eval/product-baseline.json`（基準）と比べてください。

- 対象: 記憶の層（本人の好みを本人のものとして取れるか、引用を外部扱いにできるか、プロンプト注入を本人の好みにしないか）、分類とリンクの読み取り、まとめ、質問、ニュース用の関心。まとめと質問では、検証で取り除いた項目の数も出します。
- 決まった採点: 形式の検証、カテゴリの正解、リンクの種類・作者・作品名・指示、言及すべき語と出てはいけない語（私的な事柄、プロンプト注入の罠、架空の名前）、根拠に正しいメモを引いているか、答えるべきでない質問で `insufficient` にできるか。
- `--judge`: 主張ごとに、引用したメモ（日付を含む）だけで言えるかを判定役のAIが supported / partial / unsupported で判定し、根拠の割合を出します。判定役は同じモデルだと甘くなりがちなので、使えるときは `--judge-model` で別のモデルを指定してください。
- 処理ごとの平均時間・トークン数・プロンプトの版も表示します。結果は `app/eval/results/product-*.json`（失敗時はAIの生の回答を含む）。
- `--only classify,ask`、`--repeat 3`（ぶれを見る）、`--model`、`--effort`、`--save-baseline`（基準を更新）。
- プロフィール: 30日以上前のメモで作ってから新しいメモで更新したものを、続いている関心・過去になった関心（ボルダリング）で採点し、記録から作り直したものとの一致率（agreement）と、各行が元のメモで言えるか（`--judge`）を出します。
- `--provider claude`: Claude Code で評価（判定役は常に Codex）。`--light-model gpt-6-luna` などで軽い処理のモデルを指定。まとめは同じメモで2回作り、主張が言い回しごと残る割合（stability）も出します。
- `--long`: 1年分の日常メモ150件を混ぜ、関心のメモを200日以上前に置く長期利用の想定。`--no-memory` と比べると、記憶の層が古い関心を拾えているかが分かります（時間がかかります）。
- 一時的なCodexフォルダとデータベースを使い、アプリのデータには触れません。

通常のテストは一時ディレクトリと架空メモを使います。回答品質のprepareはAI回答を生成せず、入力候補と監査項目を準備します。

| コマンド | 内容 |
| --- | --- |
| `npm run eval` | 製品のAI品質（分類・リンク・まとめ・質問・関心）を実AIで採点し、基準と比較 |
| `npm run eval:simulate` | 架空の1年分のメモで、導入から毎日の利用（既定14日）を再現し、費用・利用枠・品質を測る |
| `npm run eval:simulate -- --perf 5000` | AIを使わず、5000件での保存・一覧・検索の速さを測る |
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
