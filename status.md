# Project Status

## 目的
Looker Studio（旧Data Studio）の媒体（publisher）別レポートページをPlaywrightでPDF化し、Google Driveにアップロードするスクリプト。GitHub Actions（`.github/workflows/schedule.yml`）で毎月第三営業日（土日・日本の祝日を除く）に自動実行、`workflow_dispatch`で手動実行も可能。

## 今後直したいこと（バックログ、2026-10-06追加）
- BOX転送時、表記ゆれを考慮する（GAS①のBox転送ロジック、本リポジトリの範囲外）。
  - [突合スプレッドシート](https://docs.google.com/spreadsheets/d/1MWD6q1-QM39rZUB_Ds6eTTJODpY__Fxx8RihgonRvx4/edit?gid=0#gid=0)の2026-10-06時点のログで実際に発生を確認：9月分72件中10件が「親フォルダ直下（一致するフォルダなし）」となり媒体別フォルダへの仕分けに失敗していた（NewsPicks Selection(インフォグラフィック用)、The Japan Times Alpha、ダイヤモンド・プレミアム(インフォグラフィック用)、週刊エコノミスト(フィード版)、現代ビジネスプレミアム(新フィード版)、総合情報誌「選択」、集英社オンライン(フィード版)/(金鍵記事CMS版)/(金鍵記事フィード版)、プレジデントオンラインアカデミー(インフォグラフィック用)）。括弧付きの派生表記がBox側フォルダ名とマッチしないパターン。ユーザーが当該10件をBox上で手動移動して対応済み（恒久対応はコード側の修正が必要と判明）。
  - **原因判明**：GAS①の`mainFlow`（[docs/gas1-mainflow-fix-2026-09-04.gs.js](docs/gas1-mainflow-fix-2026-09-04.gs.js)）の`cleanCompare`が「御」「中」「様」を1文字ずつしか除去せず、「ご共有用」「用」「社」等のフォルダ名によく付く接尾辞が正規化後も残るため、本来一致すべきフォルダ名と媒体名の完全一致判定（修正②）が失敗していた。また`splitFolderKeywords`が空白でもキーワードを分割していたため、"Japan Times Alpha"のような複数語の媒体名が"Japan"/"Times"/"Alpha"に分断され、1キーワードとして比較できなかった。
  - **対応（2026-10-06ドラフト済み・適用待ち）**：[docs/gas1-mainflow-fix-2026-10-06.gs.js](docs/gas1-mainflow-fix-2026-10-06.gs.js)に、①敬称・接尾辞の除去ロジックを`cleanCompare`に統合して全ティアで一貫適用、②`splitFolderKeywords`の分割対象から空白を除外、③修正②（キーワード単位の基本名比較）を完全一致だけでなく双方向部分一致も許容、の3点を反映。ライブのApps Scriptプロジェクト（`自動実行_リネームとBox転送`、本リポジトリの範囲外）への手動反映が必要。ユーザーがApps Scriptエディタから取得した現行の全文（ID等の機密値は除去）をもとに、`mainFlow`のみ上記修正を反映した全文を[docs/gas1-fullsource-2026-10-06.gs.js](docs/gas1-fullsource-2026-10-06.gs.js)として作成済み（他の関数は変更なし）。これをまるごとApps Scriptエディタに貼り付けて反映可能。
- Slackの通知を減らしたい（`notify-slack.js`／`schedule.yml`の「Notify Slack」ステップ）。
  - **対応済み（2026-10-06）**：①`schedule.yml`のNotify Slackステップの実行条件を本番のスケジュール実行（`github.event_name == 'schedule'`かつ第三営業日）のみに限定し、手動実行（`workflow_dispatch`）では通知しないようにした。②`notify-slack.js`で全媒体成功時はSlackに送信せずログ出力のみにし、失敗・部分失敗のときだけ通知するようにした。
- GAS②（ダブルチェック）が、PDFからのテキスト抽出に失敗した場合でも「✅一致」と表示してしまっている疑いがある（本リポジトリの範囲外）。
  - 同スプレッドシートの2026-10-06 9:28〜9:34のログで、9月分72件中約26件（約36%）が抽出テキスト列「抽出失敗」なのに結果列は全件「✅一致」。抽出失敗時に自動でOK扱いにしているとすると、本来検出すべき不一致を見逃すリスクがある。
  - **原因判明**：実行時に`OCR処理失敗 (File ID: 2508443759038): GoogleJsonResponseException: API call to drive.files.insert failed with error: User rate limit exceeded for OCR`というエラーが発生。Drive API（`files.insert`にOCR変換オプションを付けてPDFのテキストを抽出する方式）のユーザー単位レート制限に、72件を短時間（約6分）で連続処理したことで引っかかっていた。さらに`checkMatch`はファイル名一致／本文一致をORで判定しているため、OCRが失敗してもファイル名側の一致だけで「✅一致」になってしまい、ダブルチェックの本来の目的（本文確認）が実質スキップされていた。
  - **対応済み（2026-10-06）**：[docs/gas2-reconcile.gs.js](docs/gas2-reconcile.gs.js)に、①OCR呼び出し後に待機を入れ、レート制限エラー時は待機してリトライする処理、②`checkMatch`の戻り値を`{isMatch, matchedBy}`に変更しファイル名一致/本文一致を区別、③OCR失敗かつファイル名のみ一致の場合は`⚠️OCR失敗（ファイル名のみ一致）`という別ステータスで記録、の3点を反映。ライブのApps Scriptプロジェクト（GAS②）へ適用済みとユーザー確認済み。動作確認は次回本番実行待ち。
- 突合スプレッドシートに、ファイル名が`2026年XX月_スマニュー＋月次レポート_媒体名御中 (1).pdf`という未展開のテンプレート文字列のままの行があった（2026-10-05 15:04:19、8月分Worldcrunchにマッチ）。古い重複ファイルの残骸が紛れ込んだ可能性があり、原因未調査。
- GAS①のGmail下書き作成機能（[[project-gas1-airtable-box-permission-email]]参照）で、**同じ人に複数のメールが送られてしまう**。1人の担当者が複数媒体（例: Gengo様はNYT/WaPo/Fortune/Bloomberg/Economistの5媒体、宣伝会議様は宣伝会議/広報会議/販促会議/ブレーンの4媒体を担当）を兼任しているケースで、媒体単位・ファイル単位でドラフトを作成しているため、同一宛先に対して媒体数分の下書きが別々に生成されていると推測される。本来は宛先（担当者）単位で1件にまとめるべき。
  - **原因判明**：`mainFlow`（runMode==='upload'）が、ファイル（媒体）1件のBox転送が成功するたびに、その場で送付先リストへ`createNotificationDraft_`を呼んでいた。複数媒体を兼任する担当者は、担当媒体の数だけこの呼び出しが発生し、別々の下書きが作られていた。
  - **対応（2026-10-06ドラフト済み・適用待ち）**：[docs/gas1-fullsource-2026-10-06.gs.js](docs/gas1-fullsource-2026-10-06.gs.js)に修正⑤として反映。`mainFlow`に`notificationQueue_`（担当者emailごとに媒体名・リンクを集約するオブジェクト）を追加し、ファイルループ中は下書きを作らずここに積むだけにし、ループ終了後に担当者ごとに1回だけ新設の`createConsolidatedNotificationDraft_`を呼んで全媒体分のリンクをまとめた1件のメール下書きを作成するように変更。単一媒体向けの旧`createNotificationDraft_`はテスト関数`testBoxAccessAndDraftForOneMedia`用にそのまま残している。ライブのApps Scriptプロジェクトへの手動反映（全文貼り替え）が必要。
- レポートが終了した媒体への無駄なダウンロード試行を減らしたい（[script.js](script.js)の`allPublishers`）。
  - **対応済み（2026-10-06）**：ユーザーがAirtable「レポート送付先」ビューのcontactエクスポート（`contact-レポート送付先 (1).csv`、送付先担当者ごとの担当媒体一覧）を共有。この媒体一覧に送付先が存在しない8媒体（Bloomberg、Fortune、PHPオンライン（インフォグラフィック用）、シャドーイングバディ、日刊ゲンダイDIGITAL、PRESIDENT（インフォグラフィック用）、PRESIDENT（旧CMS入稿用）、プレジデントオンラインアカデミー（インフォグラフィック用））は送付先が見当たらずレポート配信が終了したと判断し、既存の無効化パターン（コメントアウト＋理由コメント）に合わせて`allPublishers`から無効化。逆にCSV側にのみ存在する媒体（ONE CAREER PLUS、コルク関連、新潮QUE、東洋経済オンライン、週刊エコノミスト等）は、Looker Studio側の正式表記が未確認（表記ゆれで追加しても失敗するリスクがある）なため、今回は追加せず見送った。

## 現在の状態（2026-10-05：Looker Studioが匿名アクセスにログインを要求するようになった問題を修正、71媒体全件成功）
- 第三営業日のcron自動実行が発火していなかったため`workflow_dispatch`で手動実行しようとしたところ、前提となる`jp-mb-scripts`側の`update-monthly-sheets.js`（Redash→スプレッドシート更新）が今月まだ実行されていないことが先に発覚。進行中のワークフロー実行をキャンセルし、`npm run login-redash`→`TARGET_MONTH=2026-09 npm run update-sheets`を実施してから再実行する、という順序で対応した（詳細は[jp-mb-scripts側status.md](../jp-mb-scripts/data-studio-pdf-download/status.md)参照）。
- 再実行した本番ワークフローは`conclusion: success`と表示されたが、実際にはログに**68/68（全件）が`Could not apply publisher filter`で失敗**していた。ワークフローの終了コードは媒体ごとの失敗では非ゼロにならないため、見た目の緑チェックだけでは失敗に気づけない（既知の仕様、[トラブルシューティング表](README.md#トラブルシューティング)にも記載あり）。
- 失敗したデバッグスクリーンショット（`.debug.png`）を確認したところ、レポート本体ではなく**Googleのログイン画面**（「Sign in to continue to Data Studio」）が表示されていた。`script.js`のPlaywrightブラウザコンテキストはDrive認証用のOAuth2クライアントとは完全に別物で、元々一切ログインセッションを持たない匿名コンテキストでレポートURLに直接アクセスする設計（レポートは「リンクを知っている全員が閲覧可」で共有されている前提）。
- ユーザーがLooker Studio側の共有設定（リンク公開/閲覧者権限）を確認・再設定し、シークレットウィンドウでは実際にログインなしでレポートが見えることを確認した。にもかかわらずGitHub Actions上では3回連続で同じログイン画面が再現（スクリーンショットがバイト単位で同一）。**2026-09-03の本番実行では同じ匿名アクセス方式で71媒体全件成功していた**ことから、ファイル単位の共有設定の問題ではなく、**Googleが匿名・ヘッドレス・データセンターIPからのLooker Studioアクセスに対する不正利用対策を2026-09以降に強化した**ことが原因と判断した。
- **対応**：匿名アクセスをやめ、`jp-mb-scripts/data-studio-pdf-download`の`login.js`と同じ方式（Playwrightで実際にGooginログインし`storageState`を保存、`newContext()`に読み込ませる）をこのリポジトリにも導入した。
  - 新規`login.js`（`npm run login`）でレポートを閲覧できるGoogleアカウントにログインし、`auth/google-session.json`を取得。
  - 素のまま保存すると`myaccount.google.com`訪問時に乗ってくる`smartnews.okta.com`のlocalStorage（約100KB）が混入し、base64化後約236KBとなり**GitHub Secretsの1件あたり48KBというサイズ上限を超過**してSecret登録に失敗した。`origins`（localStorage）を空にして`cookies`のみ残す（約12KB、base64後約16KB）ことで解決。
  - `.github/workflows/schedule.yml`に、Playwrightインストール後・ダウンロードスクリプト実行前に、Secret（`GOOGLE_SESSION_STATE_B64`）をbase64デコードして`auth/google-session.json`に復元する「Restore Google session」ステップを追加。`script.js`は`auth/google-session.json`が存在すればそれを`newContext({ storageState: ... })`に渡し、存在しなければ従来通り匿名コンテキストにフォールバックする。
  - ログイン済みセッションを使うと、Looker Studio側のUIが**ログインアカウントのロケール（日本語）でレンダリングされる**ことが新たな問題として発覚。PDFダウンロードに使っている「More options」ボタンの検出がaria-labelの英語テキスト直接指定だったため見つからなくなった。さらに、画面右上には似た見た目のボタンが2つあり紛らわしかった：ヘッダー右端の「...」（kebab）アイコン（`id="more-options-header-menu-button"`、日本語aria-labelは「レポートに関するその他の操作」）はレポートの一般操作メニュー（データ更新・コピー作成・共有・レポート詳細など）を開くだけで**ダウンロード項目が無い**。実際にダウンロード機能があるのは「共有」ボタンに隣接する小さい▼（split-button、`class="split-button-menu-button"`、日本語aria-labelは「詳細オプション」）の方だった。デバッグ用に追加したメニュー展開後のスクリーンショット（`.menu-open.debug.png`）とHTMLダンプのaria-label一覧から特定。ロケールに依存しないよう、aria-labelのテキストマッチではなく構造的なクラス名（`button.split-button-menu-button`）で選択するよう修正。
  - `test/google-session-auth`ブランチで上記2段階の修正を1媒体（36Kr Japan）スモークテストで確認（最終的に1回目の試行でフィルター適用・PDFダウンロード・Driveアップロードまで成功、7ページ崩れなし）してから`main`にマージ・push、ブランチ削除。
- `main`で全71媒体の本番実行（run `37265689135`）を実施し、**71/71件成功、Slack通知も`DOWNLOAD_OUTCOME: success`で正常完了**。
- **次回セッションでやること**：
  1. ログインセッション（`GOOGLE_SESSION_STATE_B64`）はRedashセッション同様に将来期限切れする可能性がある。切れた場合の症状（全媒体が`Could not apply publisher filter`で失敗、デバッグ画面がGoogleログイン画面）と対処（`npm run login`→Secret再登録）はREADMEのトラブルシューティング表に追記済み。
  2. ~~今回の71件successがGAS①（Box転送）・GAS②（ダブルチェック）まで時間主導トリガーで正常に完走したか、次回セッションで確認する~~ → 2026-10-06確認済み。Driveフォルダ内の重複16件削除後、残り76件全てが正式名（`<年月>_スマニュー＋月次レポート_<媒体名>御中.pdf`）にリネーム済みであることを確認（GAS①のリネーム完走）。さらにユーザーがBoxへの転送も完了したことを確認（「転送した」）。GAS②（ダブルチェック）の結果は未確認だが、一連の後続処理は正常に完走したと判断。

## 現在の状態（2026-10-05 続き：同日の手動実行＋定期実行の二重実行でDriveフォルダに重複ファイルが残存）

- 上記の71/71成功確認後、ユーザーからDriveフォルダ（`1UK3wc7RJ-Mw69SxWJJ5NHNTUwVMxyea2`）内に「ダブりやリネームされていないファイル」があるとの指摘があり調査。GAS①側は、GitHub Actions（`script.js`）がアップロードする**素のファイル名**（`<publisher>.pdf`、`sanitizeFilename(publisher)`のみで「御中」等の接頭辞は付けない。[script.js:340](script.js#L340)参照）を、別トリガーで正式名（`<年月>_スマニュー＋月次レポート_<publisher>御中.pdf`）へリネームする役割を担っていると判明（本リポジトリのコードには「御中」という文字列は一切出現しない）。
- 原因は**同日に手動実行（`workflow_dispatch`、04:25〜04:57の間に4回、不具合検証のため）と定期実行（`schedule`、05:50〜06:28、run `37269534669`）の両方が同じ71媒体フルランを実行し、同じDriveフォルダに重複アップロードしたこと**。GAS①のリネーム処理は、先に完了したバッチの分で正式名が既に使われていると、後から来たバッチの同名ファイルをリネームできずに素のファイル名のまま取り残すらしい（GAS①側のコードは未確認、Drive上の`createdTime`/ファイル内容の突き合わせからの推測）。
- 発生した重複は計16件（マネーポストWEBプレミアム・ビズリーチ・KAI-YOU Premium・PRESIDENT・PRESIDENT（旧CMS入稿用）・毎日新聞「経済プレミア」・週刊エコノミスト(フィード版)・現代ビジネスプレミアム（新フィード版）・週刊ベースボールONLINE・週刊文春 電子版・総合情報誌「選択」・集英社オンライン及びその派生3表記、ほか）。削除ツール（`mcp-platform-google-drive`にtrash/delete系ツールが無い）を持たないため、ファイルリンクを提示してユーザーに手動削除してもらう形で対応（対応済み）。
- **次回セッションでやること**：本番運用（cronのみの通常運用）に入ったら、同日に`workflow_dispatch`での手動実行を行わない（または定期実行の時間帯を避ける）運用を徹底する。やむを得ず同日に両方走らせる場合は、実行後にDriveフォルダ内の素のファイル名PDFの有無を確認する。

## 現在の状態（2026-09-04：GAS①のリネーム月ズレ・Box転送の表記ゆれマッチングを修正）
- ユーザーから「ファイル名の月は前月にするはずがうまくいっていなかった」「Boxへの転送で表記ゆれ対応もうまくいっていない」と報告があり、GAS①（`自動実行_リネームとBox転送`）の`mainFlow`関数に3つの修正を実施（コードは[docs/gas1-mainflow-fix-2026-09-04.gs.js](docs/gas1-mainflow-fix-2026-09-04.gs.js)に参照用スナップショットあり）。
  1. **修正①（日付抽出漏れによる前月フォールバック失敗）**：Looker StudioのPDF内の日付表記が数字形式（`2026/07/01`）と英語月名形式（`Aug 1, 2026`）の2種類あり、旧コードは数字形式のみ対応で英語月名形式だと抽出失敗→「当月」にフォールバックしていた（本来は「前月」であるべき）。両形式に対応する正規表現に修正し、抽出失敗時のフォールバックも既存の`getPreviousMonthLabel_()`と同じ「前月」計算に統一。
  2. **修正②（Box転送先フォルダのキーワード一致漏れ）**：Boxのフォルダ名が複数媒体を１フォルダにまとめている（例:「A、B、C」のようにカンマ区切り）場合、媒体名の括弧より前の基本名とフォルダ名内の各キーワードを比較するロジックを追加。
  3. **修正③（括弧内の追記語だけで判定すべきケースへの対応）**：「ガリレオ様ご共有用」のようにフォルダ名が構成媒体名を一切含まず、PDF/媒体名側の括弧内の追記（例:「(ガリレオ社用)」「(インフォグラフィック用)」）とだけキーワードが一致するケースが未対応だった。括弧内の追記語と、フォルダ名の両方から敬称・接尾辞（様/御中/社用/ご共有用/用/社）を除去したうえで双方向の部分一致を取るロジックを追加。
  - 修正①②はユーザー確認済み（「名前変わった」「できました！」）。修正③はまだ実際のBox転送での動作確認待ち（次回ステップ2実行時に「ガリレオ様ご共有用」フォルダへの転送が成功するか確認する）。
- **次回セッションでやること**：ステップ2（Box転送仕分けモード）を実行し、修正③が「ガリレオ様ご共有用」および他の括弧追記のみで判定すべきフォルダで正しく機能するか確認する。うまくいかない場合、`foundMediaName`に括弧内の追記が実際に残っているか（OCR抽出結果・ファイル名パース結果）をログで確認する。

## 現在の状態（2026-09-03：GitHub Actions本番実行は成功、GAS①のBox転送は日次quota超過で機能停止・トリガー削除）
- 朝のcron自動実行（第三営業日09:00 JST判定）が発火していなかったため`gh workflow run schedule.yml --ref main`で手動実行（run `33700192562`）。**71媒体全件成功**、`Notify Slack`ステップも`DOWNLOAD_OUTCOME: success`で正常完了。GitHub Actions側（PDF生成・Driveアップロード・Slack通知）は問題なし。
- 後続のGAS①（`自動実行_リネームとBox転送`、毎分の時間主導トリガー）でBox転送が進まない不具合を調査。2つの問題が連鎖していた。
  1. **Box OAuth2トークン失効**：`getBoxService().hasAccess()`がfalseになり実行ログに「✕ 未認証: https://account.box.com/api/oauth2/authorize?...」が出続けていた。ログ内の認可URLをユーザーがブラウザで開き、Boxに再ログイン・許可して解決（ただし古いログのURLはstateトークンが期限切れで使えず、Apps Scriptエディタで関数を再実行して新しいURLを発行し直す必要があった）。
  2. **quota超過が「フォルダが空」と誤表示される既存バグ**：再認可後も「✕ Boxフォルダが空です。」が出続けた。Box上の対象フォルダ（ID `327976722897`）をユーザー自身のBoxアカウントでブラウザから直接開くと媒体別フォルダは正常に存在しており、フォルダIDやアクセス権自体は問題なかった。原因はコード（GAS①の`getBoxFoldersDirectly`関数）が`try/catch`でBox API呼び出しの全エラー（quota超過含む）を握り潰し、レスポンス不正時に無条件で`[]`を返す実装だったため。診断用に一時追加した`debugBoxFolderItems()`（レスポンスのHTTPステータス・本文をそのままログ出力する関数）を実行したところ、実際には`Exception: Service invoked too many times for one day: premium urlfetch.`（Google Apps ScriptのURL Fetch呼び出し日次quota超過）であることが判明。フォルダは本当は空ではなかった。
- quotaはGoogleアカウント単位・日次リセット（太平洋時間深夜0時＝日本時間で夏時間16時／冬時間17時頃）のため、当日中の復旧は不可能と判断し、**ユーザーが時間主導トリガーを削除**（quota・スクリプト合計実行時間quotaはアカウント全体で共有されるため、他のApps Scriptプロジェクトへの影響を避ける目的）。
- **quota枯渇の推定原因**：毎分実行という頻度の高いトリガー設計に対し、今回追加したAirtable/Box連携コード（`buildFolderRecipientsMap_`、Box権限延長・コラボレーター確認、共有リンク解決など）でAPI呼び出し回数が増えたこと、および「未認証」状態が約40分続いた間の毎分実行や、調査中の手動再実行の繰り返しが積算したことが要因と推測（確定ではない）。71件のPDFはGitHub Actions側のDriveアップロードは完了しているが、**GAS①側のリネーム・Box転送・Airtable送付先への権限延長・Gmail下書き作成はまだ一度も本番で完走していない**。
- **次回セッションでやること（最優先）**：
  1. quotaリセット後（本日16〜17時以降、または翌日）、Apps Scriptエディタから`自動実行_リネームとBox転送()`を手動実行し、71件のPDFがリネーム→Box転送→Airtable送付先への権限延長・Gmail下書き作成まで正常に完走するか確認する。
  2. 正常確認後、時間主導トリガーを再作成する（毎分ではなくもう少し間隔を空ける、または`DriveApp`側に処理対象ファイルが無ければBox/Airtable APIを一切呼ばずに即returnするガードを`mainFlow`冒頭に追加するなど、quota消費を抑える設計を検討）。
  3. `getBoxFoldersDirectly`（および同様のtry/catchで握り潰している他の関数）で、quota超過等の実エラーとレスポンスの内容不備を区別してログに出すよう修正を検討する（同種の問題の再発時に原因特定を早めるため）。
- **手動実行とcronの二重実行が発覚・対応済み**：上記の`workflow_dispatch`手動実行（00:36 UTC）の後、本来の第三営業日cron判定（09:00 JST予定）が約3時間遅延して12:22 JST頃に発火し（run `33711137343`）、同じ71媒体をもう一度生成・Driveアップロードした。`script.js`の`uploadToDrive`は既存ファイルの有無を確認せず常に新規作成するため、Drive処理対象フォルダに71件が2セット（計142件）溜まる状態になっていた。GAS①が142件を処理すると媒体ごとにGmail下書きメールが2通ずつ作成される等の重複が生じるため、ユーザーが重複セットをDrive上で削除し71件に戻した（対応済み）。**教訓**：cronは数時間遅延することがあるため、当日中に`workflow_dispatch`で手動実行する場合はcronが後から重ねて発火する可能性を考慮し、実行後はDrive側の重複有無を確認する。

## 現在の状態（2026-09-01：GAS①にAirtable連携・Box権限延長・メール下書き機能を追加）
- GAS①（`自動実行_リネームとBox転送`、このリポジトリの範囲外だが後続処理を担う既存Apps Scriptプロジェクト）に、Box転送成功時のフックとして3機能を追加：(1) Airtable（送付先管理ベース、`tag`に`レポート送付先`を含む行）からBoxフォルダ単位の送付先を取得、(2) Box viewer権限の自動延長・新規付与（SmartNewsの設定で外部コラボレーターは60日で自動失効するため）、(3) 送付先ごとの月次レポート案内メールをGmail下書きとして作成（誤送信防止のため自動送信はしない）。
- Airtableの`BOXURL`フィールドはルックアップ型で**配列で返る**ため`Array.isArray`で単一値に変換する処理が必要だった（`buildFolderRecipientsMap_`）。
- Gmail下書きの送信元を個人アドレスから部署共有アドレス（`jp-media-support@smartnews.com`、表示名「スマートニュース株式会社 メディアリレーション事務局」）に変更する際、`GmailApp.createDraft`の`from`/`name`オプションは下書きには効かないという既知の制限に遭遇。Advanced Gmail API（`Gmail.Users.Drafts.create`）で生MIMEメッセージを直接組み立てる方式（`buildRawEmail_`/`encodeMimeHeader_`/`chunkBase64_`）に変更し解決。日本語ヘッダーはRFC 2047 encoded-wordでエンコードが必要。
- 本文もプレーンテキストではURLが自動リンク化されない（Gmail APIで直接作成した下書きには自動リンク化パスが走らないため）ことが判明し、`Content-Type: text/html`＋`<a href>`タグ方式に変更して解決。
- 単体テスト（`testBoxAccessAndDraftForOneMedia()`、コルクフォルダ対象）で送信元・改行・リンクすべて確認済み。**未検証**：実PDFを使ったステップ1→2の通し、および次回のGAS①自動実行（時間主導トリガー）での本番動作確認はまだ行っていない。

## 現在の状態（2026-09-01：GitHub Actions完了時のSlack通知を追加）
- `.github/workflows/schedule.yml`の「Run download script」ステップの出力を`/tmp/download.log`に保存（`tee`、`set -o pipefail`で終了コードは維持）するように変更し、新規`notify-slack.js`を実行する「Notify Slack」ステップ（`if: always()`）を追加。ログ内の`Failed for ...`行の有無・件数と`steps.download.outcome`から、🚨全体失敗／⚠️一部媒体失敗（失敗媒体リスト付き）／✅全媒体成功の3パターンでSlackに通知する（コミット`39c9e04`）。
- 通知先は当初、`jp-mb-scripts`側の「未実施検知アラート」（[status.md参照](../jp-mb-scripts/data-studio-pdf-download/status.md)）と同じ`bizreach-article`用のWebhookを再利用したが、投稿時に**Slackのbot表示名・アイコンがそのWebhookが属するApp（`bizreach-article`用）のまま固定され、ペイロード内の`username`/`icon_emoji`上書きが効かない**ことが判明（Slackが多くのワークスペースでこのメッセージ単位の上書きを無効化しているため）。App側の表示名・アイコンを変更すると`bizreach-article`側にも影響するため、これは避けた。
- 対応として、`data-studio-pdf-download`専用の新しいSlack App／Incoming Webhookを作成（表示名・アイコン画像もこのApp単独で設定）し、GitHub Secretsの`SLACK_WEBHOOK_URL`をそちらに切り替えた。`notify-slack.js`のペイロードからは（効いていなかった）`username`/`icon_emoji`指定を削除。
- ローカルで`node notify-slack.js`を直接実行し、新Webhook・新App名/アイコンで`#jp-stardust-contents`への投稿を確認済み（成功パターンのみ確認、⚠️/🚨パターンは未確認）。
- **未検証**：次回の本番実行（2026-09-03、第三営業日09:00 JST）で実際に自動実行から通知まで一連で動くかは未確認。一部失敗・全体失敗パターンの通知文面もまだ実運用では見ていない。

## 次回セッションでやること（2026-08-31時点）
1. `git status`で未コミットの変更（`.github/workflows/schedule.yml`, `README.md`, `package.json`, `status.md`の修正、`check-business-day.js`の新規ファイル）をコミット・push（さらに必要ならPR作成）してよいか、ユーザーに確認する（各git操作は個別に「はい」の承認を得る運用）。
2. コミット後、可能であれば`gh workflow run schedule.yml --ref <ブランチ>`等で第三営業日判定ステップが意図通り動くか（`workflow_dispatch`は判定をスキップして常に実行されること、cron自体は次回1〜9日の実行を待つ必要があること）を確認する。

## 現在の状態（2026-08-31：PDF自動生成を「毎月3日固定」から「毎月第三営業日」に変更）
- 依存プロジェクト（`jp-mb-scripts/data-studio-pdf-download`の`update-monthly-sheets.js`、Redashからのスプレッドシート更新）がOkta SSOのMFAの都合で完全自動化できず、「毎月2日までに手動実行」という運用ルールに落ち着いた（詳細は`jp-mb-scripts/data-studio-pdf-download/status.md`参照）。この運用と噛み合わせるため、PDF生成側も土日・祝日で日付がずれてもスプレッドシート更新の後に確実に実行されるよう、固定の「3日」から「第三営業日」判定に変更した。
- `check-business-day.js`を新規作成。`@holiday-jp/holiday_jp`で祝日判定し、土日・祝日を除いた月内の営業日カウントが3になる日だけ`true`を返す。
- `schedule.yml`のcronを`0 0 3 * *`から`0 0 1-9 * *`（毎月1〜9日、毎日00:00 UTC=09:00 JSTに判定）に変更。判定ステップの結果（`steps.bizday.outputs.run_today`）で以降のPlaywrightインストール・ダウンロード実行・Artifactアップロードステップをガードし、対象日以外は早期に緑チェックで終了する（`workflow_dispatch`による手動実行は判定をスキップし常に実行）。
- ローカルで判定ロジックを検証済み：2026年1月は1/1が祝日（元日）のため第三営業日が1/6にずれる、2026年8月は祝日なしのため第三営業日が8/5になる、など想定通りの計算結果を確認。

## 現在の状態（2026-08-25 続き4：DRIVE_FOLDER_ID不一致バグを発見・修正、GAS①/②とのエンドツーエンド接続を確認）
- `TEST_PUBLISHERS`環境変数（カンマ区切りで媒体名を指定、`workflow_dispatch`の`test_publishers`入力にも対応）を新規追加。後続のBox転送・ダブルチェックの動作確認を、全68媒体を毎回処理せず一部の媒体だけに絞って行えるようにした。
- 上記の検証中、`script.js`の`DRIVE_FOLDER_ID`（`1xkYmPLURyojCnzujByxWircjY3QWVlUa`）が、GAS①（自動実行_リネームとBox転送）が実際に読んでいる`GOOGLE_FOLDER_ID`（`1UK3wc7RJ-Mw69SxWJJ5NHNTUwVMxyea2`）と一致していないことが判明。**以前のセッションで「一致している」と確認済みとされていたが、それは誤りだった**。このため2026-08-24・25に行った複数回の本番相当実行は、GAS①の実行ログ上は正常終了していても実際には1件も処理されておらず、Box転送・ダブルチェックまで一度も到達していなかった（サイレント障害）。
- `DRIVE_FOLDER_ID`をGAS①の`GOOGLE_FOLDER_ID`に合わせて修正（コミット`8cc8255`、push済み）。`TEST_PUBLISHERS=36Kr Japan`でエンドツーエンド再検証し、Drive→GAS①リネーム→GAS①Box転送→GAS②ダブルチェックまで全ステップ成功をユーザー自身のブラウザ・Box・スプレッドシート確認で確認済み。
- GAS①・GAS②はいずれも時間主導トリガーで完全自動実行されることを確認（ユーザー確認済み）。READMEの「アップロード完了後の手順」を「手動実行不要」に更新（コミット`03100b2`、push済み）。
- テストで生じた成果物のクリーンアップも実施：誤フォルダ内の408件のPDFのうち407件を削除（1件は「このアプリに書き込み権限がない」エラーで削除不可、手動対応待ち）、Boxのテストファイルはユーザーが手動削除、突合スプレッドシート（`1MWD6q1-QM39rZUB_Ds6eTTJODpY__Fxx8RihgonRvx4`）のテスト行3件は新規「アーカイブ」シートへ移動（削除ではなく保存）。
- **未検証**：`TEST_PUBLISHERS`を外した全68媒体でのフル本番実行は、この`DRIVE_FOLDER_ID`修正後にまだ実施していない。次回優先で確認する。

## 現在の状態（2026-08-25 続き：GAS後続処理の自動統合は断念、Drive経由設計を維持）
- GASで手動運用している「名前変更／Box転送仕分け」「ダブルチェック」をこの自動化に統合できないか検討し、`test/box-integration`ブランチでNode.jsからBoxへ直接アップロードする実装（Box Service Account／Client Credentials Grant認証、`googleapis`/Google Drive関連コード削除、`pdf-parse`でのPDF直接テキスト抽出）まで作成した。
- 実装後、Box側でCustom App（Client Credentials Grant）を新規作成したところ「承認を保留中」の状態になり、Box管理者による承認（Custom Apps Managerでの許可）が必要と判明。既存のGAS①・GAS②が使っているBoxアプリは既に承認済みで動いているため、**新規アプリの管理者承認というハードルだけがこの統合の障害**だった。
- ユーザー判断により、この統合は見送り、**元のGoogle Drive経由の設計（GitHub ActionsはDriveアップロードのみ、Box転送は既存GAS①が手動トリガーで担当）に戻す**ことを決定。`test/box-integration`ブランチ（未push、ローカルのみ）は削除済み。`main`には一切変更なし。
- 次回また統合を検討する場合は、まず社内のBox管理者に新規Custom Appの承認を先に依頼してから実装に着手するとスムーズ（今回は実装完了後に承認待ちが発覚し手戻りになった）。

## 現在の状態（2026-08-25 最終更新）
- **13媒体の「Row not found」を修正し、本番実行で確認済み**。目視での「半角スペース＋全角括弧」推測が誤りだったことを確認し、実際のDOM表記（スペースなし）に合わせて`publishers`配列を修正。`test/fix-13-publisher-names`ブランチで全68媒体の本番同条件実行（run `32795175768`）を行い、**68/68成功・0失敗**（アップロード68件確認）。`main`にマージ・push済み（`86d3539`）。長らく続いていた表記ズレ問題はこれで解消。

## 現在の状態（2026-08-20 最終更新）
- ローカル`main`ブランチの履歴がリモート`origin/main`に一度も繋がっていない状態を発見・修正（`git update-ref` + `git branch --set-upstream-to`で接続）。以降のコミットは`5082a4c`以降、履歴として正しく積まれている。
- publisherフィルターのUI操作方式を書き換え済み（コミット`5082a4c`〜`f708b82`）。実際のUIはプレーンなinputではなく、チェックボックスリスト形式のテーブルコントロール。検索ボックス（placeholder「検索語句を入力」）で絞り込み、行をhoverして出る「この項目のみ」リンクをクリックする方式に対応。以前の「複数セレクタ試行＋Enterキー」方式は機能していなかった。
- `test/single-publisher-run`ブランチ（36Kr Japan 1媒体のみに絞ったスモークテスト用ブランチ）で生成されたPDFを目視確認したところ、**レポート本体ではなくLooker Studioの編集画面のUIチェイン（「Looker Studio is now called Data Studio」バナー、Reset/Shareツールバー、左のページ一覧サイドバー）がPDFに写り込み、その分レポート本体の表が横に押し出されて左右が欠ける**という不具合を発見。従来の`page.pdf()`（ブラウザ画面をそのまま印刷）方式が根本原因。
- 対応の試行錯誤（コミット`53790a6`〜`2027a05`）：
  1. embed URL（`/embed/reporting/...`）に変更 → レポート所有者側の設定で埋め込み表示が無効化されており「Can't access report」で失敗。通常URLに戻した。
  2. CSSでバナー・ツールバー・サイドバー（`rebranding-banner` / `.header-zone` / `report-navigation-drawer`）を`display:none`にする方式を試したが、根本的な解決には至らず。
  3. 最終的にLooker Studio純正の「共有」▼メニュー内「レポートをダウンロード（Download report）」機能を使う方式に変更（`downloadReportPdfViaMenu()`）。これはサーバー側でレポート本体のみをPDF化する機能で、UIチェインが混ざらない。ただし、メニュー項目クリック後は即ダウンロードではなく「Download Report (PDF)」という確認ダイアログが開く仕様だったため、ダイアログ内の`data-test-id="download-button"`ボタンもクリックする処理が必要だった。
  4. `test/single-publisher-run`ブランチで手動実行し、**7ページ全て崩れなく生成されることを確認**（`36Kr Japan.pdf`、900×675pt、7ページ）。UIチェインの写り込み・表の左右欠けは解消。
- デバッグ用に追加したスクリーンショット保存ステップ（`downloadReportPdfViaMenu()`内の`.menu-open.debug.png`）はそのまま残す方針（ユーザー確認済み、削除しない）。
- `test/single-publisher-run`ブランチ（Download report方式＋フィルター修正一式）を`main`ブランチにマージ（コミット`79b443a`、push済み）。マージ時、`test`ブランチでは検証用に1媒体（36Kr Japan）に絞っていた`publishers`配列を、`main`が持つ全71媒体のリストに戻す選択的統合を実施。
- 全publisher展開前のリスク低減として`test/multi-publisher-run`ブランチ（コミット`c8bd7b6`）を新規作成し、`publishers`を3媒体（`36Kr Japan`／`PRESIDENT`／`みんかぶプレミアム`）に絞って複数媒体の連続実行を検証。選定理由：`PRESIDENT`は`PRESIDENT(インフォグラフィック用)`との誤マッチ（部分一致バグ）が起きやすい名前、`みんかぶプレミアム`は行数が多い媒体。
  - **3媒体とも1回で成功**。生成されたPDF3件を目視確認し、フィルターが正確（`PRESIDENT`が`PRESIDENT(インフォグラフィック用)`と混ざっていないことも確認済み）、7ページとも崩れなし。
  - 実行ログを確認したところ、**3媒体とも`Attempt 1 failed`・`Retrying...`が発生せず、1回目の試行で`Filter applied via frame`に成功**。以前から既知だった「フィルター適用1回目失敗→リトライ成功」という不安定性は、今回の実行では再現しなかった（Download report方式に切り替えたことで、フィルター適用後の待ち時間が自然に増えたためと推測）。ただし規模が3媒体だけなので、71媒体全部での再現有無は要観察。
- **全71媒体でmain初回本番実行（run 32430266287）を実施 → 5媒体成功後、6媒体目以降すべて失敗**。デバッグスクリーンショットを確認したところ、publisherフィルターのコントロールが通常の「閉じたボタン」状態ではなく「編集中」の状態のまま固まっており、`button.lego-control`セレクタで見つからなくなっていた。原因は、Looker StudioのレポートページがAngular SPAであり、同一`page`オブジェクトに対して同じURLへ`page.goto()`を繰り返しても、ブラウザ側が完全なドキュメント再構築を行わずクライアントサイドルーティングとして処理してしまい、内部ウィジェット状態が徐々に壊れていくため（71回連続実行するとどこかで発生、再現条件は不明瞭）。
  - 対応：`downloadPublisherPdf()`内で、レポートURLへ`goto`する前に一度`page.goto('about:blank')`を挟み、前のドキュメント（Angularアプリの内部状態含む）を強制的に完全破棄させる修正を実施。
  - `test/multi-publisher-run`ブランチ（コミット`28556f4`）で、以前の失敗開始地点（6番目）を含む10媒体でスモークテスト→**9/10成功**（失敗はSPA状態破損ではなく別種のエラー、後述）。連鎖的な全滅は再現せず、修正の効果を確認。
  - `about:blank`修正を`main`にマージ（コミット`3e6535b`、全71媒体リスト維持）。
- **`main`ブランチで全71媒体を本番同条件で再実行 → 54/71媒体が成功、17媒体が失敗**。失敗した17媒体はすべて同一パターンのエラー「`Row not found in publisher list for: ...`」（検索ボックスに入力しても該当行が1件も表示されない）で、SPA状態破損とは無関係。失敗した媒体名はほとんどが**括弧付き・記号付きの表記**（`(インフォグラフィック用)`、`(ガリレオ社用)`、`(新フィード版)`、`(フィード版)`、`(ブラン)`、`&`）だが、「コルク」「ONE CAREER PLUS」は括弧なしでも失敗しているため、単純な括弧の有無だけが原因ではない。これは**`publishers`配列に書かれた名前がLooker Studio上の実際のpublisherフィルターの選択肢と一致していない**ことが濃厚（データ側の不整合、コードのバグではない）。
  - 失敗した17媒体：The Economist(ガリレオ社用) / NewsPicks Selection(インフォグラフィック用) / ONE CAREER PLUS / nobico(のびこ)新フィード / PHPオンライン(インフォグラフィック用) / THE GOLD ONLINE(インフォグラフィック用) / Branc(ブラン) / Harvard Health(ガリレオ社用) / The New York Times Opinion(ガリレオ社用) / Worldcrunch(ガリレオ社用) / コルク / ダイヤモンド・プレミアム(インフォグラフィック用) / 婦人画報&美しいキモノプレミアム / PRESIDENT(インフォグラフィック用) / プレジデントオンラインアカデミー(インフォグラフィック用) / 現代ビジネスプレミアム(新フィード版) / 集英社オンライン(フィード版)

## 次回セッションでやること
1. コルク／ONE CAREER PLUS／THE GOLD ONLINE(インフォグラフィック用)の3媒体は、今回も一覧に出現せず（`aria-label`ベースの調査でも0件）、掲載期間中の記事が0件のため選択肢自体に出てこないと再確認。無理に有効化せず、`publishers`配列でコメントアウトしたまま様子を見る（月が変われば出現するかもしれない）。
2. 新規追加した3表記（`PRESIDENT（旧CMS入稿用）`、`集英社オンライン（金鍵記事 CMS版）`、`集英社オンライン（金鍵記事 フィード版）`）が次回本番実行で正しく成功するか確認する。

## 完了済み（2026-08-25）
- 新規発見した未登録表記3件（`PRESIDENT（旧CMS入稿用）`、`集英社オンライン（金鍵記事 CMS版）`、`集英社オンライン（金鍵記事 フィード版）`）をユーザー確認のうえ`publishers`配列に追加。
- デバッグ用CIステップ（`Upload debug artifacts`, `Upload generated PDFs`）はユーザー確認のうえ残す方針で決定（本番運用がまだ間もないため、失敗時の切り分け用に維持）。
- 検証用途を終えた`test/multi-publisher-run`・`test/single-publisher-run`・`test/list-publishers`・`test/fix-13-publisher-names`ブランチを削除済み（いずれもmainに反映済みの内容だったため安全に削除）。
- `smartnews/sn-prototyping`のPR #2331（別プロジェクト、Knativeベースの重複実装）をrevert済み（PR #2337、squash-merge済み）。

## ローカル実行について
- ローカルで`npm start`するにはGoogle OAuth環境変数（`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`）が必要。未設定・`node_modules`も未インストールの状態のため、実行確認は基本的にGitHub Actions手動実行（`gh workflow run schedule.yml --ref <branch>`）を優先する。
- 新規に認証したい場合は`npm run get-refresh-token`でブラウザ経由の認証フローからrefresh tokenを取得できる（`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`は別途必要）。

## 更新履歴
- 2026-10-06: Driveフォルダ（`1UK3wc7RJ-Mw69SxWJJ5NHNTUwVMxyea2`）を再確認し、前日報告した16件の重複（未リネーム）ファイルが全て削除され、残り76件が正式名にリネーム済みであることを確認。ユーザーがBoxへの転送も完了したことを確認（GAS②ダブルチェックの結果は未確認）。これにより9月分の本番実行〜後続処理が一通り完走したと判断。
- 2026-10-05（続き）: 71/71成功確認後、Driveフォルダ内に素のファイル名（未リネーム）の重複PDFが16件発生していることが発覚。原因は同日に`workflow_dispatch`手動実行（4回、04:25〜04:57）と`schedule`定期実行（05:50〜06:28、run `37269534669`）の両方が同じ71媒体フルランを実行し重複アップロードしたため、GAS①のリネーム処理が後発バッチ分を正式名にリネームできず素のファイル名のまま残存したこと。削除ツールが無いためユーザーが手動削除して対応済み。次回以降、本番運用日は手動実行と定期実行を同日に重ねないよう運用を徹底する。
- 2026-10-05: 第三営業日cron未発火を受けた手動実行の前段で、`jp-mb-scripts`側のRedash→スプレッドシート更新が今月未実施だったことが発覚、先に実施してから再実行。再実行時に新規不具合（Looker Studioが匿名・ヘッドレスアクセスにGoogleログインを要求するようになり全媒体失敗）を発見・修正。`login.js`でGoogleログインセッションを取得・`GOOGLE_SESSION_STATE_B64`としてSecret登録（Okta localStorageを除去しないとSecretサイズ上限を超える点に注意）、ログイン済みセッションでUIが日本語化される影響で崩れた「More options」ボタンのセレクタをロケール非依存の構造的クラス名指定に修正。`main`で全71媒体本番実行、71/71成功・Slack通知も正常完了。
- 2026-09-03: 第三営業日cronが未発火だったため`workflow_dispatch`で手動実行（71媒体全件成功、Slack通知も成功パターン確認）。後続のGAS①Box転送が進んでいない件を調査し、Box OAuth2トークン失効（再認可で解決）→`getBoxFoldersDirectly`のエラー握り潰しで「フォルダが空」と誤表示されていた（実体はURL Fetch日次quota超過）ことを特定。quotaリセットまで復旧不可のため時間主導トリガーを削除。次回quotaリセット後に手動実行での完走確認が最優先タスク。
- 2026-09-01: GAS①（自動実行_リネームとBox転送）にAirtable連携・Box viewer権限自動延長・Gmail下書き作成機能を追加。Gmail下書きの送信元変更は`GmailApp.createDraft`の`from`オプションが効かないためGmail API＋生MIME方式に変更、本文リンクも`text/html`化して解決。単体テストは成功、次回のGAS①本番実行（時間主導トリガー）での実PDFを使った動作確認が次回タスク。
- 2026-09-01: GitHub Actions完了時（成功/失敗）のSlack通知機能を追加（`notify-slack.js`新規作成、`schedule.yml`に「Notify Slack」ステップ追加、コミット`39c9e04`）。当初`bizreach-article`用Webhookを再利用したが、Slackのbot表示名/アイコンのメッセージ単位上書きが効かないと判明し、`data-studio-pdf-download`専用の新Slack App/Webhookを作成してSecretsを切り替え。ローカルでの成功パターン通知は確認済み、本番での動作・失敗パターンの通知は次回9/3の実行で確認予定。
- 2026-08-25（続き4）: `TEST_PUBLISHERS`フィルターを追加。検証中に`DRIVE_FOLDER_ID`がGAS①の`GOOGLE_FOLDER_ID`と一致していない（別の未使用フォルダを指していた）バグを発見・修正（`8cc8255`）、36Kr Japanでエンドツーエンド再検証。GAS①/②が完全自動（時間主導トリガー）であることを確認しREADME更新（`03100b2`）。誤フォルダのPDF407件削除、Boxテストファイル削除、突合スプレッドシートのテスト行をアーカイブシートへ移動。
- 2026-08-25（続き）: ユーザー確認のうえ、新規発見した3表記を`publishers`配列に追加し、デバッグ用CIステップは残す方針で決定。検証用の4ブランチ（`test/multi-publisher-run`・`test/single-publisher-run`・`test/list-publishers`・`test/fix-13-publisher-names`）をリモート・ローカルとも削除。`smartnews/sn-prototyping`のPR #2331もrevert済み（PR #2337、squash-merge済み）。
- 2026-08-25: `list-publishers.js`の全件スクロール方式が最新実行でエラー（「Could not open the publisher control in any frame」）になったため、代わりに13媒体それぞれの短い部分文字列（例:「PRESIDENT」）で検索し、該当行の`aria-label`と文字コードをダンプする`debug-remaining-publishers.js`を新規作成してローカルで実行。結果、13媒体全ての実際の表記に**括弧の直前のスペースが一切存在しない**ことが判明（例: 実際は`The Economist（ガリレオ社用）`で、`3ea51ab`で入れた半角スペースは誤り）。`publishers`配列から該当スペースを削除する修正を実施し、ローカルで13件全てが`aria-label`と文字コード単位で完全一致することを確認。また調査中に、`publishers`配列に未登録の新規表記（`PRESIDENT（旧CMS入稿用）`、`集英社オンライン（金鍵記事 CMS版）`、`集英社オンライン（金鍵記事 フィード版）`）がフィルター候補に存在することを発見——これらは今回の13媒体修正の対象外（配列に元から無かったため「Row not found」にもならず、単に収集されていない）。追加するかどうかは要判断（次回セッション）。
- 2026-08-21: 17媒体のうち14媒体について、`list-publishers.js`（`test/list-publishers`ブランチ、publisherコントロールを検索せずに開いてスクリーンショット/HTMLを保存する調査用スクリプト、後に`main`にマージ済みコミット`eb60f6a`）でLooker Studio上の実際の表記を目視確認し、`publishers`配列を修正（コミット`3ea51ab`）。修正内容は主に「半角スペース＋全角括弧」（例: `The Economist(ガリレオ社用)` → `The Economist （ガリレオ社用）`）と「全角&」（婦人画報＆美しいキモノプレミアム）。残り3媒体（コルク/ONE CAREER PLUS/THE GOLD ONLINE(インフォグラフィック用)）は`list-publishers.js`を2回実行してもリストに出現せず、当該期間に記事がないためフィルター選択肢自体に存在しないと推測し、`publishers`配列でコメントアウト（68媒体構成に）。
  - **修正後に全68媒体で本番実行 → 55/68成功、13媒体が依然として「Row not found」で失敗**。失敗した13媒体は全て今回スペース・括弧を修正したはずの媒体（婦人画報＆美しいキモノプレミアムのみ成功、他13件は再現）。目視で読み取った「半角スペース」が実際には全角スペースや他の不可視文字だった可能性が濃厚（画像から文字コードを正確に判別できないため）。この点の再調査が次回最優先課題。`getByText(..., {exact:true})`という完全一致方式そのものの脆さも一因なので、次回は正規化した部分一致、またはDOM構造（`aria-label`属性など）を使った照合方式への切り替えも検討する。
- 2026-08-20（続き2）: 全71媒体でmain本番実行→6媒体目以降が丸ごと失敗する不具合を発見。原因はAngular SPAの内部状態破損（同一pageオブジェクトでの繰り返しgoto()が原因）。about:blank経由の強制リロードで修正し10媒体スモークテストで確認後main反映（`3e6535b`）。再度全71媒体で本番実行した結果、SPA破損は解消（54/71成功）したが、括弧付き表記を中心とする17媒体が「Row not found」で失敗。これは`publishers`配列の表記とLooker Studio実データの不一致によるもので、次回は表記の照合・修正が必要。
- 2026-08-20（続き）: `test/single-publisher-run`をmainにマージ（`79b443a`、全71媒体リストは維持）。3媒体（36Kr Japan/PRESIDENT/みんかぶプレミアム）でのスモークテスト（`test/multi-publisher-run`、`c8bd7b6`）を実行し、フィルター精度・PDF品質・安定性（リトライなしで全件1回成功）を確認。
- 2026-08-20: 生成PDFにLooker StudioのUIチェイン（バナー・ツールバー・サイドバー）が写り込み表が崩れる不具合を発見。embed URL・CSS非表示を試した後、純正の「レポートをダウンロード」機能＋確認ダイアログのDownloadボタンクリックという方式に変更し、7ページ崩れなく生成されることを確認（コミット`2027a05`）。
- 2026-08-07: `test/single-publisher-run`ブランチでワークフロー手動実行を成功確認（run 31160224552）。フィルター1回目失敗→リトライ成功の不安定性は既知の残課題として次回に見送り。status.md新規作成
