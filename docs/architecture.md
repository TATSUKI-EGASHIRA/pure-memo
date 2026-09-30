# アーキテクチャ

## 保存と解析の流れ

```text
React UI → preloadの限定IPC → Electron main → SQLiteへ原文を保存
                                              ↓
                                   分類・Digestの待機ジョブ
                                              ↓
                                   Codex App Server → 結果検証
                                              ↓
                                  原文版が一致する場合だけ採用

Ask → ローカル候補検索 → 対象の原文 → Codex → 主張・根拠を保存
```

メモの保存はAI処理の完了を待ちません。分類先はユーザーが作った既存カテゴリに限り、不明なものはOtherに残ります。カテゴリ候補は提案として表示し、作成はユーザーが行います。

CollectionsのDigestは原文の要約・主張・反例・時期を保持します。Next Stepsはその解析結果の提案を表示します。Askでは質問に関係する原文を検索し、任意で現在のDigestの根拠を候補選びに加えます。Askへ送る証拠は原文であり、過去のAI文章を本人の事実として再利用しません。

## 実装の入口

| ファイル | 責務 |
| --- | --- |
| `app/src/DesktopApp.jsx` | Mac版の画面と操作 |
| `app/desktop/main.cjs` / `preload.cjs` | ウィンドウ、IPC、操作の接続 |
| `app/desktop/store.cjs` | SQLite、版、分類、解析、評価、バックアップ |
| `app/desktop/classifier.cjs` / `digest-worker.cjs` | 非同期分類とカテゴリ解析 |
| `app/desktop/job-policy.cjs` | 失敗と再試行の規則 |
| `app/desktop/analysis-executor.cjs` | 送信前・返却後の入力整合性、対象外設定と中断 |
| `app/desktop/codex.cjs` | CLI App ServerのJSON-RPC接続 |
| `app/desktop/analysis.cjs` | 実際の解析プロンプトと結果検証 |
| `app/desktop/retrieval.cjs` / `app/native/embedding.swift` | ローカル候補検索と埋め込み |
| `app/desktop/article-fetch.cjs` / `article-worker.cjs` | 公開URLのプレビュー取得 |
| `app/desktop/backup-audit.cjs` | 管理バックアップの監査と選択削除 |

`app/prompts/` は設計参考資料です。実行時のプロンプト変更では `analysis.cjs`・`classifier.cjs`・カテゴリ候補の生成箇所も確認してください。

## データの分離

- **原文**：notes、note_revisions、attachments、出典区分と元URL。
- **所属**：categories、assignments、手動除外、カテゴリ改変の履歴。
- **AI出力**：runs、outputs、claims、evidence、解析に使った全原文版。
- **評価**：feedback、訂正コメント、参照元runとの依存関係。
- **処理状態**：分類・Digestジョブ、検索用キャッシュ、下書きと設定。

Good／Badは回答への評価です。モデルの再学習は行わず、後のプロンプトで評価と訂正を参照します。AIが生成した下書きは原文の証拠から除きます。

編集・削除・カテゴリ変更後は古い入力版に依存する解析を無効にします。処理の停止・再試行ではトークンを変え、遅れて届いた結果による上書きを防ぎます。メモをAI解析対象外にすると、そのメモと関連する評価に依存する解析もAI入力から除きます。

## GraphとUI

Mac版のGraphは現在のメモとカテゴリ所属を表示します。AIが見つけた意味的な関連を表すものではありません。最新160件を対象とし、対象外設定のメモもローカル表示には残ります。

UIはReact、SVG、Canvas、CSSを使用します。入力はRaycastのようなクイック入力、蓄積したメモと提案はカードで表示します。動きを減らす設定と非表示時のアニメーション停止を維持します。

## 現在の限界

Codex接続の利用条件、実AIの回答品質、対象Macでの操作・アクセシビリティ、署名・公証・配布は追加検証が必要です。Claude、クラウド同期、第三者プラグインの実行基盤は未実装です。
