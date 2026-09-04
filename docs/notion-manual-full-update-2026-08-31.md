Git Hub保存場所
https://github.com/smartnews/jp-mb-scripts/tree/master/data-studio-pdf-download

## 1. 目的

Looker Studio（旧Google Data Studio）上にある媒体（publisher）別のレポートページを、Playwrightでブラウザ操作してPDF化し、Google Driveの指定フォルダへアップロードするスクリプト。

- 対象は現在68〜71媒体（月によって出現する媒体が変動するため増減あり）
- GitHub Actionsで**毎月第三営業日（土日・日本の祝日を除く3営業日目）の09:00 JSTごろに自動実行**
- アップロード後の「ファイル名変更・Box転送仕分け」「ダブルチェック（突合）」は、このリポジトリの範囲外で、既存のGoogle Apps Script（GAS）2本が担当し、これも時間主導トリガーで完全自動実行される

## 2. 全体フロー

> ⚠️ **実行順序の注意**：PDF生成（毎月第三営業日に自動実行）はLooker Studioダッシュボードが参照している「媒体別用」「記事カテゴリ」シートのデータをそのまま使う。そのため、**下記のスプレッドシート更新は毎月2日までに手動で実行しておく必要がある**（PDF生成の自動実行は必ず3日以降になるため、それより前に終わっていないと、古い/不完全なデータのままPDFが生成されてしまう）。
>

### スプレッドシートの更新（自動化スクリプト使用）

これまで手動で行っていたRedash CSVダウンロード→スプレッドシートへの手動反映は、`jp-mb-scripts/data-studio-pdf-download`内のスクリプト（`update-monthly-sheets.js`）で自動化されている。

**初回のみのセットアップ**

1. Google Cloud ConsoleでOAuthクライアントID（デスクトップアプリ）を作成し、`.env`に`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`を設定
2. `npm run get-sheets-token` でGoogle Sheets APIの認証を行う（ブラウザで一度ログイン、以降は認証不要）
3. `npm run login-redash` でRedash（`query.smartnews.net`、Okta SSO）の認証を行う（ブラウザで一度ログイン。セッションが切れたら再実行）

**毎月の実行方法**

> ⚠️ **対象月が完全に終わってから実行すること**（例: 8月分なら9月1日以降）。Redashクエリ43763は指定月の時点までのデータしか返さないため、月が終わる前に実行すると不完全なデータがシートに入る。
>

```bash
cd jp-mb-scripts/data-studio-pdf-download
TARGET_MONTH=2026-08 npm run update-sheets
```

- Redashから媒体別レポート（クエリ43763）・記事カテゴリレポート（クエリ30424、直近12ヶ月）を自動取得
- 「媒体別用」シート：最も古い月の行を削除し、対象月のデータを追加
- 「記事カテゴリ」シート：シート全体を直近12ヶ月分のデータで置き換え
- 実行前に変更内容（削除・追加行数）を表示し、`y`と答えるまで実際の書き込みは行わない確認プロンプトあり

**月末前に誤って実行してしまった場合（同月データの差し替え）**

対象月のデータが既にシートに存在する状態で、月が終わってから完全なデータに差し替えたい場合は`REFRESH_MONTH`を使う。

```bash
REFRESH_MONTH=2026-08 npm run update-sheets
```

**未実施検知アラート（Slack通知）**

「毎月2日までに実行」というルールが守られなかった場合を検知するため、対象スプレッドシートにGoogle Apps Script（`check-monthly-update-alert.gs`）を設定している。毎月第三営業日08:00 JST時点で「媒体別用」シートの最新月が前月になっていなければSlackに通知が飛ぶ（間に合っていれば何も起きない）。詳細はjp-mb-scriptsのREADME「未実施検知アラート」セクションを参照。

詳細はjp-mb-scripts/data-studio-pdf-downloadのREADMEを参照。

## 3. 実行方法

スプレッドシートの更新が完了したら、下記が動く。

```
[GitHub Actions: schedule.yml]
   ↓ Playwrightでchromium起動
[Looker Studioの各媒体レポートページ]
   ↓ publisherフィルターを1媒体ずつ適用
   ↓ 「共有」▼メニュー→「レポートをダウンロード」機能でPDF化
   ↓ googleapis経由でDriveへアップロード
[Google Drive 指定フォルダ]
   ↓ 時間主導トリガー（GAS側で自動実行、手動操作不要）
[GAS①: 自動実行_リネームとBox転送]  … ファイル名変更＋Boxへの転送仕分け
   ↓
[GAS②: startReconcile]           … Box転送結果のダブルチェック（突合スプレッドシート）
```

基本は**GitHub Actions上で実行**する運用。ローカルPCにNode.jsやGoogle認証情報をセットアップする必要はない。

### 手動実行（動作確認用）

```bash
cd ~/Project/data-studio-pdf-download
gh workflow run schedule.yml --ref main
```

- `ref` はテストしたいブランチ名に変更可
- 71媒体を1つずつ処理するため、完了まで数分〜数十分かかる

一部の媒体だけに絞って実行することもできる（`TEST_PUBLISHERS`環境変数 / `workflow_dispatch`の`test_publishers`入力）。後続のBox転送・ダブルチェックの動作確認を、全媒体を処理せずに素早く行える。

```bash
gh workflow run schedule.yml --ref main -f test_publishers="36Kr Japan"
```

Webブラウザからも、Actionsタブ→「Run workflow」→`test_publishers`欄に入力、で同様に実行できる。

### 定期実行

`.github/workflows/schedule.yml` は毎月1〜9日の00:00 UTC（09:00 JST）に毎日cronが走るが、`check-business-day.js`（`@holiday-jp/holiday_jp`で土日・日本の祝日を判定）が「今日が第三営業日か」を判定し、**そうである日だけ**実際のPDF生成が実行される（対象日以外は判定のみで即終了）。何もしなくても動く（前提としてスプレッドシート更新が済んでいること）。

## 4. 実行結果の確認方法

1. GitHub Actionsタブで最新の実行を開く（黄=実行中、緑チェック=成功、赤×=失敗）
2. 「download」ジョブ→「Run download script」ログで、媒体ごとの`Uploaded to Drive: ...`（成功）/`Failed for ...`（失敗）を確認
3. 「Artifacts」から生成PDF一式（`data-studio-pdfs`）、失敗時のデバッグ用スクリーンショット/HTML（`data-studio-debug`）をダウンロード可能

**注意**：一部媒体だけ失敗した場合、ワークフロー全体は赤×表示になるが、実際には他の媒体は成功している。ログの`Failed for ...`行で個別に判断する必要がある。

## 5. アップロード完了後の処理（このリポジトリの範囲外）

Google Driveへのアップロード後は、既存のGAS 2本が時間主導トリガーで**完全自動実行**（手動操作不要）：

- GAS①（名前変更/Box転送仕分け）: `自動実行_リネームとBox転送`
- GAS②（ダブルチェック）: `startReconcile`

うまく動いていない場合のみ、各スクリプトエディタから該当関数を手動実行して確認する。

## 6. トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| 特定媒体だけ `Row not found in publisher list` | Looker Studio上の実際の表記と`script.js`の`publishers`配列の表記が不一致。`data-studio-debug` artifactの`.debug.png`/`.debug.html`で確認 |
| 全媒体が最初から失敗 | Google Drive認証用GitHub Secrets（`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`）が失効。`npm run get-refresh-token`で再取得しSecretsを更新 |
| 途中から急に全滅 | Looker Studio側のUI変更、またはブラウザ内部状態の異常。まず再実行 |
| スプレッドシート更新スクリプトが `Redashのログインセッションが失効している可能性があります` | `jp-mb-scripts/data-studio-pdf-download`で`npm run login-redash`を再実行し、Okta SSOログインを最後まで（MFA含め）完了させる |

## 7. 開発経緯と既知の課題（重要な過去のバグ対応）

- **PDFにUIチェインが混入する不具合**：初期実装は`page.pdf()`でブラウザ画面をそのまま印刷しており、Looker StudioのバナーやツールバーがPDFに写り込み、レポート本体の表が欠けていた。Looker Studio純正の「レポートをダウンロード」メニュー機能（`downloadReportPdfViaMenu()`）に切り替えて解消。
- **SPA内部状態の破損による連鎖失敗**：同一ブラウザページオブジェクトで71回連続`page.goto()`すると、Angular SPAの内部状態が徐々に壊れ、ある媒体以降すべて失敗する現象があった。レポートURLへ移動する前に`page.goto('about:blank')`を挟んで完全リロードすることで解消。
- **publisher表記の不一致（Row not found）**：`publishers`配列に書かれた媒体名がLooker Studio実際の表記（全角/半角スペース、括弧、記号）と微妙に異なり、複数媒体でフィルターが見つからない問題が繰り返し発生した。`aria-label`や実際のDOM表記を調査用スクリプト（`list-publishers.js`, `debug-remaining-publishers.js`）で確認し、都度`publishers`配列を修正して解消してきた。表記は月によって増減するため、今後も同種の問題が再発しうる。
- **DRIVE_FOLDER_ID不一致によるサイレント障害**（2026-08-25発見）：`script.js`のアップロード先`DRIVE_FOLDER_ID`が、GAS①が実際に読む`GOOGLE_FOLDER_ID`と一致していなかった。GAS①のログは正常終了していたが、実際には対象フォルダに何も届いておらず、Box転送・ダブルチェックまで一度も到達していなかった。IDを一致させて修正済み。
- **スプレッドシート更新の自動化**（2026-08-31）：本セクション2記載の手動CSVインポート作業を`update-monthly-sheets.js`として自動化。RedashアクセスもOkta SSOブラウザセッション方式（`login-redash.js`）で実装し、対象月が完全に終わる前に実行すると不完全なデータになる点を踏まえて`REFRESH_MONTH`（同月データの差し替え）モードも用意した。
- **PDF生成を「毎月3日固定」から「毎月第三営業日」に変更**（2026-08-31）：スプレッドシート更新が「毎月2日までに手動実行」という運用ルールに落ち着いたことに合わせ、土日・祝日で日付がずれても更新後に確実に実行されるよう`check-business-day.js`による第三営業日判定に変更した。
- **スプレッドシート更新の未実施検知アラート**（2026-08-31）：上記ルールが守られなかった場合を検知するため、Google Apps Script（`check-monthly-update-alert.gs`）を追加し、毎月第三営業日08:00 JST時点で未更新ならSlackに通知するようにした。
- publisherフィルター適用が1回目失敗→リトライで成功、という不安定性が過去に見られたが、Download report方式への切り替え後は再現していない（要観察）。

## 8. 関連プロジェクトとの関係

- 社内の `jp-mb-scripts` リポジトリにある `monthly-report-download` は、同じ「Looker Studioレポートのダウンロード」目的だが、対象媒体数・運用方法が異なる**別の・個人PC手動実行スクリプト**。
- このPDF生成スクリプト自体のコードは `jp-mb-scripts` の `data-studio-pdf-download` フォルダにも同じものが置かれているが、`jp-mb-scripts` 側は手動実行スクリプト置き場という運用方針のため、GitHub Actionsによる自動実行は行わない。**月次自動実行（PDF生成）はこの個人リポジトリ（`yukariyamasaki-svg/data-studio-pdf-download`）側でのみ運用する。**
- **セクション2のスプレッドシート更新スクリプト（`update-monthly-sheets.js`）は`jp-mb-scripts`側にのみ存在**し、GitHub Actions化されていない**手動実行専用**。**毎月2日までに**誰かが手動で実行する必要がある（PDF生成の自動実行が毎月第三営業日＝必ず3日以降になるため、それより前に完了させておく）。守られなかった場合はGoogle Apps Script（`check-monthly-update-alert.gs`）がSlackに通知する。

## 9. ローカル実行について（参考）

ローカルで`npm start`するにはGoogle OAuth環境変数（`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`）が必要。基本的にはGitHub Actions手動実行を優先し、ローカル実行は行わない運用。

## 10. 参考リンク

- リポジトリ（本体）: https://github.com/yukariyamasaki-svg/data-studio-pdf-download
- リポジトリ（jp-mb-scripts内コピー、スプレッドシート更新スクリプトはこちらにのみ存在）: https://github.com/smartnews/jp-mb-scripts/tree/master/data-studio-pdf-download
- 詳細な経緯・過去の不具合対応ログ: status.md
- GAS①（名前変更/Box転送仕分け）: https://script.google.com/home/projects/1KNzq3wKy8DSOhFXCcPnjwf5krWc5dZR1LCGzRV8G4CSZnmftf8Uc7-vI/edit
- GAS②（ダブルチェック）: https://script.google.com/home/projects/1RbTEF52nZDsHUrH3P8CUxk_kQMriDd70d9ZDB9J9Qr7kqkxFJcTaatWp/edit?hl=ja
