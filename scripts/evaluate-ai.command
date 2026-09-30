#!/bin/zsh
cd -- "$(dirname -- "$0")/../app" || exit 1
npm run eval:answer-quality
result=$?
echo
if [ "$result" -eq 0 ]; then
  echo "評価レポートを app/eval/results/answer-quality-report.json に保存しました。"
else
  echo "評価は完了しませんでした。失敗理由は app/eval/results/answer-quality-report.json に記録されています。"
fi
echo "Enterキーで閉じます。"
read
exit "$result"
