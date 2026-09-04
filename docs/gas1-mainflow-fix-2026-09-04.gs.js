/**
 * GAS①（自動実行_リネームとBox転送）の mainFlow 修正版（参照用スニペット）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   自動実行_リネームとBox転送: https://script.google.com/home/projects/1KNzq3wKy8DSOhFXCcPnjwf5krWc5dZR1LCGzRV8G4CSZnmftf8Uc7-vI/edit
 * 作成日: 2026-09-04
 *
 * 修正内容:
 * 1. リネーム時の月判定（前月表記）が、PDF内の日付表記が英語月名形式（例: "Aug 1, 2026"）の場合に
 *    抽出できず、「当月」にフォールバックしてしまう不具合を修正。
 *    - 英語月名形式にも対応する正規表現を追加。
 *    - 抽出に失敗した場合のフォールバックを「当月」から「前月」に変更
 *      （このパイプラインは常に前月分のレポートを処理するため、前月の方が安全な既定値）。
 * 2. Box転送先フォルダの判定で、媒体名に括弧付き補足（例: "PRESIDENT(インフォグラフィック用)"）が
 *    付くと、既存の丸ごと文字列比較では複数媒体グループフォルダ名（例: "株式会社プレジデント社様
 *    （PRESIDENT, プレジデントオンラインアカデミー）ご共有用"）と一致しなくなる不具合を修正。
 *    - フォルダ名を区切り文字でキーワードに分割し、媒体名の「括弧より前の基本名」と
 *      キーワード単位で比較する処理を、完全一致と部分一致の間に追加（修正②）。
 * 3. 上記②では括弧内の補足（"(ガリレオ社用)"等）を切り捨てて比較していたため、
 *    フォルダ名が配下媒体名を列記せず、その補足の宛先名だけで命名されているケース
 *    （例: "ガリレオ様ご共有用"）は一致しなかった。括弧内の補足から敬称・接尾辞
 *    （様/御中/社用/ご共有用/用/社）を取り除いた「芯」の文字列と、フォルダ名を同様に
 *    正規化した文字列を比較するマッチングを修正②の直後に追加（修正③）。
 *    例: 媒体名側 "(ガリレオ社用)" → "ガリレオ" / フォルダ名 "ガリレオ様ご共有用" → "ガリレオ" で一致。
 *
 * 本体（Apps Scriptエディタ）に貼り付けて mainFlow 関数を置き換えることを想定。
 * 他の関数（writeLogToSheet, extractTextFromPdfWithRetry, conv, getBoxService,
 * getBoxFoldersDirectly, uploadOrUpdateFileInBox, buildFolderRecipientsMap_,
 * extendBoxAccessForFolder_, createNotificationDraft_ など）は変更なし。
 */

function mainFlow(runMode) {
  const service = getBoxService();
  if (!service.hasAccess()) return Logger.log('✕ 未認証: ' + service.getAuthorizationUrl());

  const accessToken = service.getAccessToken();
  const boxFolders = getBoxFoldersDirectly(BOX_PARENT_FOLDER_ID, accessToken);
  if (boxFolders.length === 0) return Logger.log('✕ Boxフォルダが空です。');

  const folderRecipientsMap = (runMode === 'upload') ? buildFolderRecipientsMap_(accessToken) : {};

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

        const cleanCompare = (str) => {
          return conv(str).toLowerCase().replace(/[\s \(\)（）\-\_\.御中様]/g, '').trim();
        };
        const cleanTarget = cleanCompare(foundMediaName);

        // 1. 完全一致（既存ロジック、変更なし）
        for (let i = 0; i < boxFolders.length; i++) {
          if (cleanCompare(boxFolders[i].name) === cleanTarget) {
            matchedFolderId = boxFolders[i].id;
            matchedFolderName = boxFolders[i].name;
            break;
          }
        }

        // --- 修正②: フォルダ名をキーワード分割し、媒体名の「括弧より前の基本名」と比較 ---
        if (!matchedFolderId) {
          const splitFolderKeywords = (name) => {
            return name
              .split(/[、,／\/・\s（(]/)
              .map(k => k.replace(/[）)]/g, '').trim())
              .filter(k => k.length > 1);
          };
          const baseNameMatch = foundMediaName.match(/^([^（(]+)/);
          const cleanBase = cleanCompare(baseNameMatch ? baseNameMatch[1] : foundMediaName);

          for (let i = 0; i < boxFolders.length; i++) {
            const keywords = splitFolderKeywords(boxFolders[i].name);
            if (keywords.some(kw => cleanCompare(kw) === cleanBase)) {
              matchedFolderId = boxFolders[i].id;
              matchedFolderName = boxFolders[i].name;
              break;
            }
          }
        }
        // --- 修正②ここまで ---

        // --- 修正③: 括弧内の追記（例: "(ガリレオ社用)", "(インフォグラフィック用)"）を
        //     敬称・接尾辞（様/御中/社用/ご共有用/用/社）を除いて正規化し、
        //     フォルダ名（同様に正規化）に含まれていればマッチさせる。
        //     例: 媒体名側 "(ガリレオ社用)" → "ガリレオ" / フォルダ名 "ガリレオ様ご共有用" → "ガリレオ" で一致
        if (!matchedFolderId) {
          const stripHonorificSuffixes = (str) => {
            return str.replace(/(ご共有用|共有用|社用|御中|様|用|社)+$/g, '').trim();
          };
          const qualifierMatch = foundMediaName.match(/[（(]([^）)]+)[）)]/);
          if (qualifierMatch && qualifierMatch[1]) {
            const cleanQualifier = cleanCompare(stripHonorificSuffixes(qualifierMatch[1]));
            if (cleanQualifier.length >= 2) {
              for (let i = 0; i < boxFolders.length; i++) {
                const cleanFolder = cleanCompare(stripHonorificSuffixes(boxFolders[i].name));
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
          file.setTrashed(true);
          Logger.log('→ 成功したため、元のファイルをゴミ箱に移動しました。');
          writeLogToSheet(fileName, foundMediaName, fileName, '成功：仕分け・Box転送完了（' + matchedFolderName + '）');

          if (matchedFolderId !== BOX_PARENT_FOLDER_ID) {
            const recipients = folderRecipientsMap[matchedFolderId] || [];
            if (recipients.length > 0) {
              const accessResults = extendBoxAccessForFolder_(matchedFolderId, recipients, accessToken);
              accessResults.forEach(r => Logger.log('  Box権限[' + r.email + ']: ' + r.status));
              recipients.forEach(r => {
                const draftStatus = createNotificationDraft_(r, foundMediaName);
                Logger.log('  通知メール下書き[' + r.email + ']: ' + draftStatus);
              });
            } else {
              Logger.log('  ⚠️ Airtableに送付先が見つかりませんでした（' + matchedFolderName + '）。権限延長・通知メールはスキップ。');
            }
          }
        } else {
          Logger.log('✕ Boxへのアップロード中にエラーが発生しました。');
          writeLogToSheet(fileName, foundMediaName, fileName, '✕ Boxアップロードエラー');
        }
      } else {
        Logger.log('✕ ファイル名から媒体名を特定できませんでした: ' + fileName);
        writeLogToSheet(fileName, '✕ 特定失敗', '-', 'ファイル名が指定形式になっていません');
      }
    }
  }
  Logger.log('--- すべての処理が完了しました ---');
}
