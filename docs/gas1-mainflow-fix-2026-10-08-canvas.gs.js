/**
 * GAS①（自動実行_リネームとBox転送）向け修正パッチ（2026-10-08）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   自動実行_リネームとBox転送: https://script.google.com/home/projects/1KNzq3wKy8DSOhFXCcPnjwf5krWc5dZR1LCGzRV8G4CSZnmftf8Uc7-vI/edit
 *
 * 適用方法:
 *   1. 下の mainFlow(runMode) 全文で、エディタ上の既存の mainFlow 関数を丸ごと置き換える
 *      （docs/gas1-fullsource-2026-10-06.gs.js の修正⑤版からの差分は、"2026-10-08追記"と
 *      コメントした箇所のみ）。
 *   2. 下の updateStatusCanvasGas1_ 関数（新規関数）をプロジェクトのどこかに追加する。
 *   3. スクリプトプロパティに SLACK_BOT_TOKEN を設定する
 *      （canvases:read / canvases:write スコープを持つBotトークン。未設定の間はログに
 *      警告を出すだけでスキップされ、既存の動作に影響しない）。
 *
 * 内容:
 *   - mainFlow内でBox転送の成功/失敗件数（successCount_ / failCount_）を集計。
 *   - runMode==='upload'の実行で、かつ対象ファイルが1件以上あった場合のみ
 *     （新規ファイル0件の実行では呼ばない＝UrlFetchApp呼び出しを増やさない）、
 *     ファイルループ終了後に1回だけ updateStatusCanvasGas1_ を呼び、
 *     `data-studio-pdf-download`リポジトリのnotify-slack.jsが使っているのと同じ
 *     Slack Canvas（#jp-stardust-contents常設）の「GAS①」セクションを書き換える。
 *   - 2026-09-03に発生したUrlFetchApp日次quota超過の再発防止のため、呼び出しは
 *     実行全体で最大2回（canvases.sections.lookup→canvases.edit）に限定している。
 */

function mainFlow(runMode) {
  const service = getBoxService();
  if (!service.hasAccess()) return Logger.log('✕ 未認証: ' + service.getAuthorizationUrl());

  const accessToken = service.getAccessToken();
  const boxFolders = getBoxFoldersDirectly(BOX_PARENT_FOLDER_ID, accessToken);
  if (boxFolders.length === 0) return Logger.log('✕ Boxフォルダが空です。');

  const folderRecipientsMap = (runMode === 'upload') ? buildFolderRecipientsMap_(accessToken) : {};
  // 修正⑤（2026-10-06）: 通知メールは実行全体を通して担当者（email）ごとに1件へまとめるため、
  // ファイルループ中は下書きを作らずここに積んでおき、ループ終了後にまとめて作成する。
  const notificationQueue_ = {};
  // 2026-10-08追記: Slack Canvasステータス更新用の件数カウンタ（uploadモードのみ使用）。
  let successCount_ = 0;
  let failCount_ = 0;

  const files = DriveApp.getFolderById(GOOGLE_FOLDER_ID).getFiles();

  if (runMode === 'rename') {
    Logger.log('▶️ 【ステップ1：名前変更モード】で実行します。');
  } else {
    Logger.log('▶️ 【ステップ2：Box転送仕分けモード】で実行します。');
  }

  while (files.hasNext()) {
    const file = files.next();
    let fileName = file.getName();

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      continue;
    }

    Logger.log('--- 処理開始: ' + fileName);

    // 【モード1：名前変更モード】
    if (runMode === 'rename') {
      const pdfText = extractTextFromPdfWithRetry(file.getId());
      if (!pdfText) {
        Logger.log('✕ PDFの解析に失敗したためスキップします。');
        writeLogToSheet(fileName, '✕ 抽出失敗', '-', 'PDFの解析（文字読み取り）に失敗しました。');
        continue;
      }

      // --- 修正①: 数字形式・英語月名形式の両方に対応し、抽出失敗時は「前月」にフォールバック ---
      let targetYearMonthStr = '';
      const dateMatch =
        pdfText.match(/(\d{4})[\/\-](\d{1,2})[\/\-]\d{1,2}/) ||
        pdfText.match(/([A-Za-z]{3,9})\.?\s+\d{1,2},?\s*(\d{4})/);

      if (dateMatch) {
        if (/^\d+$/.test(dateMatch[1])) {
          // 数字形式: 2026/07/01
          const year = dateMatch[1];
          const month = parseInt(dateMatch[2], 10);
          targetYearMonthStr = year + '年' + month + '月';
        } else {
          // 英語月名形式: Aug 1, 2026
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          const monthIndex = monthNames.indexOf(dateMatch[1].toLowerCase().substring(0, 3));
          if (monthIndex !== -1) {
            targetYearMonthStr = dateMatch[2] + '年' + (monthIndex + 1) + '月';
          }
        }
      }

      if (!targetYearMonthStr) {
        // 抽出できなかった場合の安全策は「当月」ではなく「前月」
        // （このパイプラインは常に前月分のレポートを処理するため）
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        targetYearMonthStr = Utilities.formatDate(d, "Asia/Tokyo", "yyyy年M月");
        Logger.log('⚠️ PDF内から日付を抽出できなかったため、前月表記（' + targetYearMonthStr + '）にフォールバックしました。');
      }
      // --- 修正①ここまで ---

      let foundMediaName = '';
      const match = pdfText.match(/publisher\s*[:：]\s*([^\r\n]+)/i);
      if (match && match[1]) {
        foundMediaName = match[1].trim();
        let previousName = '';
        while (foundMediaName !== previousName) {
          previousName = foundMediaName;
          foundMediaName = foundMediaName.trim().replace(/[▼▽▼▽]$/, '').replace(/\s*[\(（]\d+[\)）]\s*$/, '').trim();
        }
      }

      if (!foundMediaName) {
        for (let i = 0; i < boxFolders.length; i++) {
          let currentBoxFolderName = conv(boxFolders[i].name).trim().toLowerCase();
          if (currentBoxFolderName.length > 2 && conv(pdfText).toLowerCase().includes(currentBoxFolderName)) {
            foundMediaName = boxFolders[i].name;
            break;
          }
        }
      }

      if (foundMediaName) {
        let newFileName = targetYearMonthStr + '_スマニュー＋月次レポート_' + foundMediaName + '御中.pdf';
        file.setName(newFileName);
        Utilities.sleep(200);
        Logger.log('◯ 名前を変更しました（確認待ち）: ' + newFileName);
        writeLogToSheet(fileName, foundMediaName, newFileName, '【確認待ち】名前変更のみ完了（Box未転送）');
      } else {
        Logger.log('✕ 媒体名が見つかりませんでした。');
        writeLogToSheet(fileName, '✕ 未検出', '-', 'PDF内に媒体名に一致するキーワードがありません');
      }
    }

    // 【モード2：Box転送仕分けモード】
    else if (runMode === 'upload') {
      let foundMediaName = '';
      const nameMatch = fileName.match(/_スマニュー\+月次レポート_(.+)御中\.pdf$/i) || fileName.match(/_スマニュー＋月次レポート_(.+)御中\.pdf$/i);

      if (nameMatch && nameMatch[1]) {
        foundMediaName = nameMatch[1].trim();
      } else {
        const pdfText = extractTextFromPdfWithRetry(file.getId());
        if (pdfText) {
          const match = pdfText.match(/publisher\s*[:：]\s*([^\r\n]+)/i);
          if (match && match[1]) {
            foundMediaName = match[1].trim().replace(/[▼▽▼▽]$/, '').replace(/\s*[\(（]\d+[\)）]\s*$/, '').trim();
          }
        }
      }

      if (foundMediaName) {
        let matchedFolderId = null;
        let matchedFolderName = '';

        // --- 修正④（2026-10-06）: 敬称・接尾辞の除去をcleanCompareに統合し、
        //     全ティア（完全一致／修正②／修正③／部分一致）で一貫して適用する。
        const stripHonorificSuffixes = (str) => {
          let result = str.trim();
          let prev;
          do {
            prev = result;
            result = result.replace(/(ご共有用|共有用|社用|御中|様|用|社)$/, '').trim();
          } while (result !== prev);
          return result;
        };
        const cleanCompare = (str) => conv(stripHonorificSuffixes(str)).toLowerCase().replace(/[\s\(\)（）\-\_\.]/g, '').trim();
        // --- 修正④ここまで ---

        const cleanTarget = cleanCompare(foundMediaName);

        // 1. 完全一致（既存ロジック）
        for (let i = 0; i < boxFolders.length; i++) {
          if (cleanCompare(boxFolders[i].name) === cleanTarget) {
            matchedFolderId = boxFolders[i].id;
            matchedFolderName = boxFolders[i].name;
            break;
          }
        }

        // --- 修正②（2026-09-04、2026-10-06に部分一致対応へ強化）:
        //     フォルダ名をキーワード分割し、媒体名の「括弧より前の基本名」と比較 ---
        if (!matchedFolderId) {
          const splitFolderKeywords = (name) => {
            // 2026-10-06: \s を分割対象から除外。"Japan Times Alpha" のような
            // 複数語の媒体名を1キーワードとして保持するため。
            return name
              .split(/[、,／\/・（(]/)
              .map(k => k.replace(/[）)]/g, '').trim())
              .filter(k => k.length > 1);
          };
          const baseNameMatch = foundMediaName.match(/^([^（(]+)/);
          const cleanBase = cleanCompare(baseNameMatch ? baseNameMatch[1] : foundMediaName);

          for (let i = 0; i < boxFolders.length; i++) {
            const keywords = splitFolderKeywords(boxFolders[i].name);
            if (keywords.some(kw => {
              const kwClean = cleanCompare(kw);
              if (kwClean.length < 2) return false;
              // 完全一致に加え、双方向の部分一致も許容（例: "The Japan Times Alpha" と
              // "Japan Times Alpha" のような冠詞の有無の差異を吸収する）
              return kwClean === cleanBase || cleanBase.includes(kwClean) || kwClean.includes(cleanBase);
            })) {
              matchedFolderId = boxFolders[i].id;
              matchedFolderName = boxFolders[i].name;
              break;
            }
          }
        }
        // --- 修正②ここまで ---

        // --- 修正③: 括弧内の追記（例: "(ガリレオ社用)", "(インフォグラフィック用)"）を
        //     cleanCompareで正規化し、フォルダ名（同様に正規化）と部分一致させる。
        //     （cleanCompareが2026-10-06より敬称除去を内包したため、直接cleanCompareを使う）
        if (!matchedFolderId) {
          const qualifierMatch = foundMediaName.match(/[（(]([^）)]+)[）)]/);
          if (qualifierMatch && qualifierMatch[1]) {
            const cleanQualifier = cleanCompare(qualifierMatch[1]);
            if (cleanQualifier.length >= 2) {
              for (let i = 0; i < boxFolders.length; i++) {
                const cleanFolder = cleanCompare(boxFolders[i].name);
                if (cleanFolder.length >= 2 && (cleanFolder.includes(cleanQualifier) || cleanQualifier.includes(cleanFolder))) {
                  matchedFolderId = boxFolders[i].id;
                  matchedFolderName = boxFolders[i].name;
                  break;
                }
              }
            }
          }
        }
        // --- 修正③ここまで ---

        // 4. 部分一致（既存ロジック、変更なし・最後の保険として残す）
        if (!matchedFolderId) {
          for (let i = 0; i < boxFolders.length; i++) {
            let folderNameClean = cleanCompare(boxFolders[i].name);
            if (folderNameClean.includes(cleanTarget) || cleanTarget.includes(folderNameClean)) {
              matchedFolderId = boxFolders[i].id;
              matchedFolderName = boxFolders[i].name;
              break;
            }
          }
        }

        if (!matchedFolderId) {
          matchedFolderId = BOX_PARENT_FOLDER_ID;
          matchedFolderName = '親フォルダ直下（一致するフォルダなし）';
          // 次回の原因調査を楽にするため、候補一覧をログに残す
          Logger.log('⚠️ 「' + foundMediaName + '」に一致するBoxフォルダが見つかりませんでした。候補一覧: ' + boxFolders.map(f => f.name).join(' / '));
        }

        Logger.log('➡️ Boxの「' + matchedFolderName + '」へ安全転送中...');
        const isSuccess = uploadOrUpdateFileInBox(matchedFolderId, file, fileName, accessToken);

        if (isSuccess) {
          successCount_++; // 2026-10-08追記
          file.setTrashed(true);
          Logger.log('→ 成功したため、元のファイルをゴミ箱に移動しました。');
          writeLogToSheet(fileName, foundMediaName, fileName, '成功：仕分け・Box転送完了（' + matchedFolderName + '）');

          if (matchedFolderId !== BOX_PARENT_FOLDER_ID) {
            const recipients = folderRecipientsMap[matchedFolderId] || [];
            if (recipients.length > 0) {
              const accessResults = extendBoxAccessForFolder_(matchedFolderId, recipients, accessToken);
              accessResults.forEach(r => Logger.log('  Box権限[' + r.email + ']: ' + r.status));
              // 修正⑤: ここでは下書きを作らず、担当者ごとに媒体名・リンクをキューへ積むだけにする
              recipients.forEach(r => {
                if (!notificationQueue_[r.email]) {
                  notificationQueue_[r.email] = { name: r.name, items: [] };
                }
                notificationQueue_[r.email].items.push({ mediaName: foundMediaName, boxUrl: r.boxUrl });
              });
            } else {
              Logger.log('  ⚠️ Airtableに送付先が見つかりませんでした（' + matchedFolderName + '）。権限延長・通知メールはスキップ。');
            }
          }
        } else {
          failCount_++; // 2026-10-08追記
          Logger.log('✕ Boxへのアップロード中にエラーが発生しました。');
          writeLogToSheet(fileName, foundMediaName, fileName, '✕ Boxアップロードエラー');
        }
      } else {
        failCount_++; // 2026-10-08追記
        Logger.log('✕ ファイル名から媒体名を特定できませんでした: ' + fileName);
        writeLogToSheet(fileName, '✕ 特定失敗', '-', 'ファイル名が指定形式になっていません');
      }
    }
  }

  // 修正⑤ここまで: ファイルループ終了後、担当者ごとに積んだ媒体をまとめて1件の下書きにする
  Object.keys(notificationQueue_).forEach(email => {
    const entry = notificationQueue_[email];
    const draftStatus = createConsolidatedNotificationDraft_(email, entry.name, entry.items);
    Logger.log('通知メール下書き[' + email + ']（' + entry.items.length + '媒体分を1件にまとめ）: ' + draftStatus);
  });

  // 2026-10-08追記: uploadモードの実行結果をSlack Canvasへ反映する。
  // 新規ファイルが0件（successCount_ + failCount_ === 0）だった実行では呼ばない
  // ＝毎分トリガーの空振り実行でUrlFetchApp呼び出しを増やさないため。
  if (runMode === 'upload' && (successCount_ + failCount_ > 0)) {
    updateStatusCanvasGas1_(successCount_, failCount_, Object.keys(notificationQueue_).length);
  }

  Logger.log('--- すべての処理が完了しました ---');
}

// ===== Slack Canvasステータス更新（2026-10-08追加・新規関数） =====
// `data-studio-pdf-download`リポジトリのnotify-slack.jsが更新しているのと同じ
// #jp-stardust-contents常設Canvasの「GAS①」セクションを、lookup→editの2回のAPI呼び出しで
// 書き換える。呼び出し元のmainFlowは1回のupload実行につき最大1回しかこの関数を呼ばない。
const SLACK_CANVAS_ID_ = 'F0C7F543EBV';
const CANVAS_SECTION_ANCHOR_GAS1_ = '[GAS1]';

function updateStatusCanvasGas1_(successCount, failCount, draftCount) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    Logger.log('⚠️ SLACK_BOT_TOKEN未設定のため、ステータスCanvasの更新をスキップします。');
    return;
  }

  const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + ' JST';
  const icon = failCount > 0 ? '⚠️' : '✅';
  const body = '**' + CANVAS_SECTION_ANCHOR_GAS1_ + '** ' + icon + ' Box転送 ' + successCount + '件成功' +
    (failCount > 0 ? '・' + failCount + '件失敗' : '') + '、下書き作成 ' + draftCount + '件 (' + timestamp + ')';

  try {
    const lookupRes = UrlFetchApp.fetch('https://slack.com/api/canvases.sections.lookup', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ canvas_id: SLACK_CANVAS_ID_, criteria: { contains_text: CANVAS_SECTION_ANCHOR_GAS1_ } }),
      muteHttpExceptions: true
    });
    const lookup = JSON.parse(lookupRes.getContentText());
    if (!lookup.ok || !lookup.sections || lookup.sections.length === 0) {
      Logger.log('✕ ステータスCanvasの更新に失敗（セクションが見つかりません）: ' + lookupRes.getContentText());
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
      Logger.log('✕ ステータスCanvasの更新に失敗: ' + editRes.getContentText());
    } else {
      Logger.log('◯ ステータスCanvasを更新しました。');
    }
  } catch (e) {
    Logger.log('✕ ステータスCanvas更新中に例外: ' + e.toString());
  }
}
