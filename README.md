# data-studio-pdf-download

Looker Studio（旧Data Studio）の媒体（publisher）別レポートページをPlaywrightでPDF化し、Google Driveの指定フォルダへアップロードするスクリプトです。GitHub Actionsで毎月自動実行されます（手動実行も可能）。

アップロード後、Box転送・通知メール送信は既存のGoogle Apps Script（GAS）側で手動で行います（このリポジトリの範囲外）。

## 実行方法

このスクリプトは基本的に**GitHub Actions上で実行**します。手元のPCにNode.jsやGoogle認証情報をセットアップする必要はありません。

### 1. 手動でワークフローを実行する（テストしたいとき）

ターミナルで以下を実行します（[GitHub CLI](https://cli.github.com/) が必要、`gh auth login`で事前にログインしておいてください）。

```bash
cd ~/Project/data-studio-pdf-download
gh workflow run schedule.yml --ref main
```

- `--ref main` の部分は、実行したいブランチ名に変更できます（例: 動作確認用ブランチで試すとき）。
- 実行後、すぐには結果が出ません。数分〜数十分（71媒体分を1つずつ処理するため）かかります。

Webブラウザから実行することもできます。

1. [Actionsタブ](https://github.com/yukariyamasaki-svg/data-studio-pdf-download/actions/workflows/schedule.yml) を開く。
2. 右側の「Run workflow」ボタンをクリック。
3. 実行したいブランチを選んで「Run workflow」。

### 2. 定期実行（何もしなくても自動で動く）

毎月3日 00:00 UTC（日本時間 09:00）に自動実行されます。設定は [`.github/workflows/schedule.yml`](.github/workflows/schedule.yml) を参照してください。

## 実行結果の確認方法

1. [Actionsタブ](https://github.com/yukariyamasaki-svg/data-studio-pdf-download/actions) を開き、一番上（最新）の実行をクリック。
2. 実行中は黄色い丸、成功は緑のチェック、失敗は赤い×で表示されます。
3. 「download」ジョブをクリックすると、各ステップのログが見られます。「Run download script」のログに、媒体ごとの成功/失敗（`Uploaded to Drive: ...` や `Failed for ...`）が出力されています。
4. ページ下部の「Artifacts」欄から、生成されたPDFファイル一式（`data-studio-pdfs`）や、失敗時のデバッグ用スクリーンショット/HTML（`data-studio-debug`）をダウンロードして確認できます。

### 成功しているかどうかの見た目の目安

- ログの最後の方に `Failed for ...` という行が**一つもない**ら全媒体成功です。
- 一部の媒体だけ `Failed for 媒体名: ...` と出ていたら、その媒体だけ失敗しています（他は成功しています）。ワークフロー自体は失敗表示（赤い×）になりますが、実際にどこまで成功したかはログで確認してください。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| 特定の媒体だけ `Row not found in publisher list` で失敗 | Looker Studio上の実際の表記と`script.js`の`publishers`配列の表記が一致していない可能性。`data-studio-debug` artifactの該当媒体の`.debug.png`/`.debug.html`を確認する。 |
| 全媒体が最初から失敗する | Google Drive認証（`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`のGitHub Secrets）が失効している可能性。`get-refresh-token.js`（`npm run get-refresh-token`）でrefresh tokenを再取得し、GitHub Secretsを更新する。 |
| ワークフローが途中で急に全滅する | Looker Studio側のUI変更、またはブラウザの内部状態異常の可能性。まずは再実行してみる。 |

より詳しい経緯・過去の不具合対応の記録は [`status.md`](status.md) を参照してください。

## 関連プロジェクト

- 社内の[jp-mb-scripts](https://github.com/smartnews/jp-mb-scripts)リポジトリにある`monthly-report-download`は、同じ「Looker Studioレポートのダウンロード」を目的とした**別の・個人PCで手動実行するスクリプト**です（対象媒体数や運用方法が異なる、このリポジトリとは別物）。
