# pure.

感じたことを、思いついたままに残す。Macで使うローカル保存のAIメモアプリです。

タイトルや分類を保存の条件にせず、ユーザーが作ったカテゴリを使って、記録の振り返りと次の行動を支援します。現在は開発中のElectronアプリです。

## できること

- グローバルショートカット `⌘⇧N` からの入力、文章・URL・画像の保存。
- SQLiteによる保存、下書き復旧、文字列検索、ごみ箱、バックアップ・復元。
- ユーザーが作るカテゴリとOther。自動分類、統合・分割、アーカイブ。
- Collectionsのまとめ、Next Stepsの提案、原文を根拠にしたAskとGood／Bad。
- 現在のカテゴリ所属を表示するGraph。
- AIの処理一覧、停止・再試行、メモごとのAI解析対象外設定。
- 起動・カード・画面遷移のモーションと、動きを減らす設定。

メモはMacに保存します。AI機能を実行すると対象の原文などをCodexへ送ります。完全に端末内で推論するアプリではありません。送信内容と対象外設定は [データの扱い](docs/privacy.md) を参照してください。

## 起動

開発で確認した環境はmacOS、Node.js 24.6以上です。AI接続には別途Codex CLI、ローカルの文脈埋め込みのビルドにはSwiftコンパイラが必要です。

```sh
cd app
npm ci
npm run desktop
```

開発起動は `app/.dev-data/` にデータを保存します。通常の保存先を使う起動は、依存関係をインストールした後に次を実行してください。

```sh
cd app
npm run build
npm run desktop:built
```

Finderからは [scripts/open.command](scripts/open.command) をダブルクリックできます。最初に `npm ci` が必要です。

## 構成

```text
app/
  desktop/       Electron、SQLite、AI接続とテスト
  src/           React UI、Graph、モーション
  native/        Swiftの埋め込みヘルパーのソース
  prompts/       プロンプト設計の参考資料
  eval/          架空データの評価コード
docs/            公開用の開発・構成・データ説明
scripts/         起動、評価、公開対象の確認
```

旧ブラウザUIも `npm run dev` で見られます。サンプルと手書き分析を使った視覚試作で、Mac版の実AIとは別です。

## 開発と公開範囲

- [開発手順](docs/development.md)
- [アーキテクチャ](docs/architecture.md)
- [データの扱い](docs/privacy.md)
- [Gitに含めるもの・除外するもの](docs/repository.md)
- [コントリビュート](CONTRIBUTING.md)

署名・公証済みの配布アプリ、クラウド同期、Claude接続、第三者プラグインは未提供です。Codex App Serverとの接続は試作であり、一般利用の接続条件やAI出力品質の検証は継続中です。

## ライセンス

[MIT](LICENSE)。依存ライブラリはそれぞれのライセンスに従います。
