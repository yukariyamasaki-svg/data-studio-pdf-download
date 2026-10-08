/**
 * GAS②（ダブルチェック）向け修正パッチ（2026-10-08）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   https://script.google.com/home/projects/1RbTEF52nZDsHUrH3P8CUxk_kQMriDd70d9ZDB9J9Qr7kqkxFJcTaatWp/edit?hl=ja
 *
 * 適用方法:
 *   1. 下の startReconcile() 全文で、エディタ上の既存の startReconcile 関数を丸ごと置き換える
 *      （docs/gas2-reconcile.gs.js からの差分は "2026-10-08追記" とコメントした箇所のみ）。
 *   2. 下の updateStatusCanvasGas2_ 関数（新規関数）をプロジェクトのどこかに追加する。
 *   3. スクリプトプロパティに SLACK_BOT_TOKEN を設定する
 *      （canvases:read / canvases:write スコープを持つBotトークン。未設定の間はログに
 *      警告を出すだけでスキップされ、既存の動作に影響しない）。
 *
 * 内容:
 *   - checkMatchの結果（一致/不一致/OCR失敗）を一致件数・不一致件数・OCR失敗件数として集計。
 *   - 今回の実行で新規に処理したファイルが1件以上あった場合のみ（0件の空振り実行では
 *     呼ばない＝UrlFetchApp呼び出しを増やさない）、全フォルダ処理後に1回だけ
 *     updateStatusCanvasGas2_ を呼び、`data-studio-pdf-download`リポジトリの
 *     notify-slack.jsが更新しているのと同じSlack Canvas（#jp-stardust-contents常設）の
 *     「GAS②」セクションを書き換える。
 *   - 2026-09-03に発生したUrlFetchApp日次quota超過の再発防止のため、呼び出しは
 *     実行全体で最大2回（canvases.sections.lookup→canvases.edit）に限定している。
 */

function startReconcile() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.warn("別のプロセスが実行中のため終了します。");
    return;
  }

  try {
    const ss = SpreadsheetApp.openById(SS_ID);
    let sheet = ss.getSheetByName("シート1") || ss.getActiveSheet();

    // 1. 日付が変わったら「履歴」シートへ退避
    const todayStr = Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd");
    const lastRunDate = P_SERVICE.getProperty('LAST_RUN_DATE');

    if (lastRunDate !== todayStr) {
      manageHistory(ss, sheet);
      P_SERVICE.setProperty('LAST_RUN_DATE', todayStr);
      sheet.appendRow(['実行日時', 'フォルダ名', 'ファイル名', '抽出テキスト(一部)', '処理結果 / 転送先']);
    }

    const accessToken = getValidAccessToken();
    if (!accessToken) {
      console.error("有効なアクセストークンを取得できなかったため処理を中止します。");
      return;
    }

    const targetYearMonth = Utilities.formatDate(new Date(), "JST", "yyyy-MM");

    // 2. 既読ファイルの取得（C列：ファイル名で重複判定）
    const lastRow = sheet.getLastRow();
    let processedFiles = [];
    if (lastRow > 1) {
      processedFiles = sheet.getRange(2, 3, lastRow - 1, 1).getValues().flat().map(String);
    }

    // 全フォルダを取得（100件制限解除のページネーション対応）
    const folders = getBoxItems(PARENT_FOLDER_ID, accessToken);
    console.log(`対象サブフォルダ数: ${folders.length}件`);

    // 2026-10-08追記: Slack Canvasステータス更新用の件数カウンタ。
    let matchCount_ = 0;
    let mismatchCount_ = 0;
    let ocrFailCount_ = 0;

    folders.forEach(folder => {
      if (folder.type !== 'folder') return;

      // 全ファイルを取得（100件制限解除のページネーション対応）
      const files = getBoxItems(folder.id, accessToken);

      files.forEach(file => {
        if (file.type !== 'file') return;

        // 今月作成されたファイルのみ対象（過去ファイルを対象にする場合はこの行をコメントアウト）
        if (Utilities.formatDate(new Date(file.created_at), "JST", "yyyy-MM") !== targetYearMonth) return;

        // すでにシートにあればスキップ
        if (processedFiles.indexOf(String(file.name)) !== -1) return;

        console.log(`新規解析: ${folder.name} / ${file.name}`);
        const extractedText = extractTextFromBoxFile(file.id, accessToken);
        const ocrFailed = extractedText === "抽出失敗";
        const matchResult = checkMatch(folder.name, file.name, extractedText);

        // 2026-10-06追記：OCR抽出に失敗した場合、ファイル名一致だけで
        // 「✅一致」と表示されると本文の二重チェックが機能していないことが
        // 見えなくなるため、OCR失敗時は別ステータスで区別する。
        let resultLabel;
        if (!matchResult.isMatch) {
          resultLabel = ocrFailed ? "❌不一致（OCR失敗）" : "❌不一致";
          mismatchCount_++; // 2026-10-08追記
        } else if (ocrFailed && matchResult.matchedBy === 'filename') {
          resultLabel = "⚠️OCR失敗（ファイル名のみ一致）";
          ocrFailCount_++; // 2026-10-08追記
        } else {
          resultLabel = "✅一致";
          matchCount_++; // 2026-10-08追記
        }

        // シートへ書き込み
        sheet.appendRow([
          Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss"),
          folder.name,
          file.name,
          extractedText.substring(0, 100).replace(/\n/g, " "),
          resultLabel
        ]);

        processedFiles.push(String(file.name));
      });
    });
    console.log("照合処理が正常に完了しました。");

    // 2026-10-08追記: 今回新規に処理したファイルが1件以上あった場合のみSlack Canvasへ反映。
    // 新規ファイル0件（空振り）の実行では呼ばない＝トリガー実行ごとにUrlFetchApp呼び出しを
    // 増やさないため。
    if (matchCount_ + mismatchCount_ + ocrFailCount_ > 0) {
      updateStatusCanvasGas2_(matchCount_, mismatchCount_, ocrFailCount_);
    }
  } catch (e) {
    console.error("実行エラー:", e.toString());
  } finally {
    lock.releaseLock();
  }
}

// ===== Slack Canvasステータス更新（2026-10-08追加・新規関数） =====
// `data-studio-pdf-download`リポジトリのnotify-slack.jsが更新しているのと同じ
// #jp-stardust-contents常設Canvasの「GAS②」セクションを、lookup→editの2回のAPI呼び出しで
// 書き換える。呼び出し元のstartReconcileは1回の実行につき最大1回しかこの関数を呼ばない。
const SLACK_CANVAS_ID_ = 'F0C7F543EBV';
const CANVAS_SECTION_ANCHOR_GAS2_ = '[GAS2]';

function updateStatusCanvasGas2_(matchCount, mismatchCount, ocrFailCount) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    console.warn('SLACK_BOT_TOKEN未設定のため、ステータスCanvasの更新をスキップします。');
    return;
  }

  const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + ' JST';
  const icon = (mismatchCount + ocrFailCount) > 0 ? '⚠️' : '✅';
  const body = '**' + CANVAS_SECTION_ANCHOR_GAS2_ + '** ' + icon + ' 一致' + matchCount + '件・不一致' + mismatchCount + '件・OCR失敗' + ocrFailCount + '件 (' + timestamp + ')';

  try {
    const lookupRes = UrlFetchApp.fetch('https://slack.com/api/canvases.sections.lookup', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ canvas_id: SLACK_CANVAS_ID_, criteria: { contains_text: CANVAS_SECTION_ANCHOR_GAS2_ } }),
      muteHttpExceptions: true
    });
    const lookup = JSON.parse(lookupRes.getContentText());
    if (!lookup.ok || !lookup.sections || lookup.sections.length === 0) {
      console.error('ステータスCanvasの更新に失敗（セクションが見つかりません）: ' + lookupRes.getContentText());
      return;
    }

    const editRes = UrlFetchApp.fetch('https://slack.com/api/canvases.edit', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        canvas_id: SLACK_CANVAS_ID_,
        changes: [{ operation: 'replace', section_id: lookup.sections[0].id, document_content: { type: 'markdown', markdown: body } }]
      }),
      muteHttpExceptions: true
    });
    const edit = JSON.parse(editRes.getContentText());
    if (!edit.ok) {
      console.error('ステータスCanvasの更新に失敗: ' + editRes.getContentText());
    } else {
      console.log('ステータスCanvasを更新しました。');
    }
  } catch (e) {
    console.error('ステータスCanvas更新中に例外: ' + e.toString());
  }
}
