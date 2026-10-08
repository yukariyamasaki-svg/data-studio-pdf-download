---
name: 月次レポート配信チェックリスト
about: GitHub Actions→GAS①→GAS②の月次レポートPDF配信フローを一つずつ確認する
title: "月次レポート配信チェックリスト - YYYY-MM"
labels: ["monthly-checklist"]
---

<!--
使い方: タイトルの YYYY-MM を今月の年月に書き換えてIssueを作成し、
各ステップを実施したら一つずつチェックを入れていく。
全て完了したらこのIssueをCloseする。
-->

## 1. GitHub Actions（PDF生成・Driveアップロード）
- [ ] 第三営業日の自動実行（または`workflow_dispatch`での手動実行）が完了している
- [ ] 実行結果を確認した（Slack通知／[Actionsのログ](https://github.com/yukariyamasaki-svg/data-studio-pdf-download/actions)／[ステータスCanvas](https://smartnews.slack.com/docs/T02B9QAPR/F0C7F543EBV)の「GitHub Actions」セクション）
- [ ] 失敗した媒体があれば個別に対応した（[README トラブルシューティング](../../README.md#トラブルシューティング)参照）
- [ ] Driveフォルダに重複ファイルが無いことを確認した（同日に手動実行とcronを両方走らせた場合に発生しやすい）

## 2. GAS①（リネーム・Box転送・Gmail下書き）
- [ ] 「名前変更モード」が完走し、Driveのファイルが正式名（`<年月>_スマニュー＋月次レポート_<媒体名>御中.pdf`）にリネームされていることを確認した
- [ ] 「Box転送仕分けモード」が完走し、Box側の媒体フォルダに転送されていることを確認した
- [ ] Airtable送付先への権限延長・Gmail下書き作成が行われたことを確認した
- [ ] [ステータスCanvas](https://smartnews.slack.com/docs/T02B9QAPR/F0C7F543EBV)の「GAS①」セクションが更新されている

## 3. GAS②（ダブルチェック）
- [ ] [突合スプレッドシート](https://docs.google.com/spreadsheets/d/1MWD6q1-QM39rZUB_Ds6eTTJODpY__Fxx8RihgonRvx4/edit?gid=0#gid=0)に今月分の結果が記録されていることを確認した
- [ ] 「❌不一致」「⚠️OCR失敗」の行があれば内容を確認し対応した
- [ ] [ステータスCanvas](https://smartnews.slack.com/docs/T02B9QAPR/F0C7F543EBV)の「GAS②」セクションが更新されている

## 4. 完了
- [ ] 問題なければこのIssueをCloseする
- [ ] 気になった点があれば[status.md](../../status.md)のバックログに追記した
