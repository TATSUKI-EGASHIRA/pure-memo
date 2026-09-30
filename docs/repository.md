# 公開するもの・除外するもの

## 公開するもの

`app/` のソース、テスト、架空の評価入力、package.json・lockfile、公開用の `docs/`、`scripts/`、README、CONTRIBUTING、MIT LICENSEを公開します。アプリ内のSVG・CSS・Canvasによるロゴや演出もソースに含みます。

依存ライブラリ本体は配布せず、`npm ci` で復元します。MITは本プロジェクトのコードに適用し、依存ライブラリのライセンスはそれぞれに従います。

## Gitから除外するもの

| 対象 | 理由 |
| --- | --- |
| `app/.dev-data/` 全体 | SQLiteだけでなくCookie、ブラウザ保存領域、キャッシュ、セッション状態を含む |
| SQLite／DBファイル、WAL／SHM、`backups/` | メモ、画像、解析、評価、削除前のデータを含む可能性がある |
| `.env*`、認証JSON、秘密鍵 | ローカルの認証・接続設定。値を入れていない `.env.example` のみ例外 |
| `.codex/`、`.claude/`、`.agents/`、`.aws/`、`.ssh/` | 個人のエージェント設定・接続設定・認証情報 |
| `node_modules/` | 再取得できる依存ライブラリ |
| `dist/`、`coverage/`、`app/native/embedding-helper` | ビルドで再生成できる成果物と実行バイナリ |
| `app/eval/results/`、旧配置の評価JSON | 実行結果。実AI出力やローカル環境情報を含む可能性がある |
| `docs/internal/` | 旧仕様書、PLAN、HANDOFF、研究・作業履歴、個人パスを含む過去資料 |
| `docs/internal/design/` | 初期の参考・生成コンセプト画像と制作プロンプト。アプリ動作には不要 |
| `.DS_Store`、エディタ設定、ログ | 個人環境の情報と生成物 |
| `.app`、`.dmg`、`.zip`、`local/` | ローカル配布物・作業用の退避先。配布は別のリリース工程で扱う |

除外したファイルは端末内に残します。公開用スクリーンショットを追加する場合は、架空メモだけを表示し、出典と利用権を確認したものを別途用意します。

## 整理後の入口

旧 `prototype/` は `app/`、旧ルートの起動コマンドは `scripts/open.command` と `scripts/evaluate-ai.command` へ移しました。内部仕様・進行表は `docs/internal/` に保管し、公開の入口をルートREADMEとこのdocsにまとめています。

## コミット前の確認

リポジトリのルートで実行してください。

```sh
node scripts/check-public-files.mjs
git status --short
git diff --cached --stat
```

チェックはGit管理中のファイルと、ignoreされていない新規ファイルを対象にします。既に追跡されている非公開ファイルも検出します。既知の認証文字列・秘密鍵・個人パスを点検しますが、任意の個人情報や著作権問題を自動で判定するものではありません。

`.gitignore` は既に公開したGit履歴を消しません。過去に秘密情報を公開していた場合は、鍵の失効と履歴の対処が別途必要です。
