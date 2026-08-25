# Project Status

## 目的
Looker Studio（旧Data Studio）の媒体（publisher）別レポートページをPlaywrightでPDF化し、Google Driveにアップロードするスクリプト。GitHub Actions（`.github/workflows/schedule.yml`）で毎月3日00:00 UTCに自動実行、`workflow_dispatch`で手動実行も可能。

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
- 2026-08-25（続き4）: `TEST_PUBLISHERS`フィルターを追加。検証中に`DRIVE_FOLDER_ID`がGAS①の`GOOGLE_FOLDER_ID`と一致していない（別の未使用フォルダを指していた）バグを発見・修正（`8cc8255`）、36Kr Japanでエンドツーエンド再検証。GAS①/②が完全自動（時間主導トリガー）であることを確認しREADME更新（`03100b2`）。誤フォルダのPDF407件削除、Boxテストファイル削除、突合スプレッドシートのテスト行をアーカイブシートへ移動。
- 2026-08-25（続き）: ユーザー確認のうえ、新規発見した3表記を`publishers`配列に追加し、デバッグ用CIステップは残す方針で決定。検証用の4ブランチ（`test/multi-publisher-run`・`test/single-publisher-run`・`test/list-publishers`・`test/fix-13-publisher-names`）をリモート・ローカルとも削除。`smartnews/sn-prototyping`のPR #2331もrevert済み（PR #2337、squash-merge済み）。
- 2026-08-25: `list-publishers.js`の全件スクロール方式が最新実行でエラー（「Could not open the publisher control in any frame」）になったため、代わりに13媒体それぞれの短い部分文字列（例:「PRESIDENT」）で検索し、該当行の`aria-label`と文字コードをダンプする`debug-remaining-publishers.js`を新規作成してローカルで実行。結果、13媒体全ての実際の表記に**括弧の直前のスペースが一切存在しない**ことが判明（例: 実際は`The Economist（ガリレオ社用）`で、`3ea51ab`で入れた半角スペースは誤り）。`publishers`配列から該当スペースを削除する修正を実施し、ローカルで13件全てが`aria-label`と文字コード単位で完全一致することを確認。また調査中に、`publishers`配列に未登録の新規表記（`PRESIDENT（旧CMS入稿用）`、`集英社オンライン（金鍵記事 CMS版）`、`集英社オンライン（金鍵記事 フィード版）`）がフィルター候補に存在することを発見——これらは今回の13媒体修正の対象外（配列に元から無かったため「Row not found」にもならず、単に収集されていない）。追加するかどうかは要判断（次回セッション）。
- 2026-08-21: 17媒体のうち14媒体について、`list-publishers.js`（`test/list-publishers`ブランチ、publisherコントロールを検索せずに開いてスクリーンショット/HTMLを保存する調査用スクリプト、後に`main`にマージ済みコミット`eb60f6a`）でLooker Studio上の実際の表記を目視確認し、`publishers`配列を修正（コミット`3ea51ab`）。修正内容は主に「半角スペース＋全角括弧」（例: `The Economist(ガリレオ社用)` → `The Economist （ガリレオ社用）`）と「全角&」（婦人画報＆美しいキモノプレミアム）。残り3媒体（コルク/ONE CAREER PLUS/THE GOLD ONLINE(インフォグラフィック用)）は`list-publishers.js`を2回実行してもリストに出現せず、当該期間に記事がないためフィルター選択肢自体に存在しないと推測し、`publishers`配列でコメントアウト（68媒体構成に）。
  - **修正後に全68媒体で本番実行 → 55/68成功、13媒体が依然として「Row not found」で失敗**。失敗した13媒体は全て今回スペース・括弧を修正したはずの媒体（婦人画報＆美しいキモノプレミアムのみ成功、他13件は再現）。目視で読み取った「半角スペース」が実際には全角スペースや他の不可視文字だった可能性が濃厚（画像から文字コードを正確に判別できないため）。この点の再調査が次回最優先課題。`getByText(..., {exact:true})`という完全一致方式そのものの脆さも一因なので、次回は正規化した部分一致、またはDOM構造（`aria-label`属性など）を使った照合方式への切り替えも検討する。
- 2026-08-20（続き2）: 全71媒体でmain本番実行→6媒体目以降が丸ごと失敗する不具合を発見。原因はAngular SPAの内部状態破損（同一pageオブジェクトでの繰り返しgoto()が原因）。about:blank経由の強制リロードで修正し10媒体スモークテストで確認後main反映（`3e6535b`）。再度全71媒体で本番実行した結果、SPA破損は解消（54/71成功）したが、括弧付き表記を中心とする17媒体が「Row not found」で失敗。これは`publishers`配列の表記とLooker Studio実データの不一致によるもので、次回は表記の照合・修正が必要。
- 2026-08-20（続き）: `test/single-publisher-run`をmainにマージ（`79b443a`、全71媒体リストは維持）。3媒体（36Kr Japan/PRESIDENT/みんかぶプレミアム）でのスモークテスト（`test/multi-publisher-run`、`c8bd7b6`）を実行し、フィルター精度・PDF品質・安定性（リトライなしで全件1回成功）を確認。
- 2026-08-20: 生成PDFにLooker StudioのUIチェイン（バナー・ツールバー・サイドバー）が写り込み表が崩れる不具合を発見。embed URL・CSS非表示を試した後、純正の「レポートをダウンロード」機能＋確認ダイアログのDownloadボタンクリックという方式に変更し、7ページ崩れなく生成されることを確認（コミット`2027a05`）。
- 2026-08-07: `test/single-publisher-run`ブランチでワークフロー手動実行を成功確認（run 31160224552）。フィルター1回目失敗→リトライ成功の不安定性は既知の残課題として次回に見送り。status.md新規作成
