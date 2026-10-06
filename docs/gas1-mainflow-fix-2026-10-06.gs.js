/**
 * GAS①（自動実行_リネームとBox転送）の mainFlow 修正版（参照用スニペット、2026-10-06）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   自動実行_リネームとBox転送: https://script.google.com/home/projects/1KNzq3wKy8DSOhFXCcPnjwf5krWc5dZR1LCGzRV8G4CSZnmftf8Uc7-vI/edit
 * 前回の修正: docs/gas1-mainflow-fix-2026-09-04.gs.js（修正①②③）
 *
 * きっかけ：2026-10-06の本番実行で、以下10件が実際には対応するBoxフォルダが
 * 存在するにもかかわらず「親フォルダ直下（一致するフォルダなし）」に仕分け漏れした
 * （ユーザーがBox上で手動移動して対応済み、本修正は再発防止のためのコード側対応）。
 *   - NewsPicks Selection(インフォグラフィック用) → フォルダ「NewsPicksSelection様ご共有用」
 *   - The Japan Times Alpha → フォルダ「ジャパンタイムズ出版様（Japan Times Alpha, ...）ご共有用」
 *   - ダイヤモンド・プレミアム(インフォグラフィック用) → フォルダ「ダイヤモンド・プレミアム様ご共有用」
 *   - 週刊エコノミスト(フィード版) → フォルダ「毎日新聞社様（..., 週刊エコノミスト）ご共有用」
 *   - 現代ビジネスプレミアム(新フィード版) → フォルダ「現代ビジネスプレミアム様ご共有用」
 *   - 総合情報誌「選択」 → フォルダ「選択様ご共有用」
 *   - 集英社オンライン(フィード版)/(金鍵記事CMS版)/(金鍵記事フィード版) → フォルダ「集英社オンライン様ご共有用」
 *   - プレジデントオンラインアカデミー(インフォグラフィック用) → フォルダ「株式会社プレジデント社様（PRESIDENT, ...）ご共有用」
 *
 * 原因は2点：
 *   (a) 旧cleanCompareは「御」「中」「様」を1文字ずつしか除去せず、「ご共有用」「用」「社」等の
 *       接尾辞がフォルダ名側に残るため、修正②の完全一致判定が本来一致すべきケースでも
 *       不一致になっていた（例: 「NewsPicksSelection様ご共有用」→「newspicksselectionご共有用」）。
 *   (b) splitFolderKeywordsが空白でも分割していたため、"Japan Times Alpha"のような複数語の
 *       媒体名が"Japan"/"Times"/"Alpha"に分断され、1つのキーワードとして比較できなかった。
 *   さらに(c) "The Japan Times Alpha"のように英語の冠詞の有無だけで完全一致にならないケースに
 *       対応するため、完全一致に加えて双方向の部分一致を許容する。
 *
 * 修正④の内容:
 *   - stripHonorificSuffixes（様/御中/用/社/社用/共有用/ご共有用の繰り返し除去）をcleanCompareに
 *     統合し、全ティア（完全一致／修正②／修正③／部分一致）で一貫して適用。
 *   - splitFolderKeywordsの分割対象から空白(\s)を除外し、複数語の媒体名を1キーワードとして保持。
 *   - 修正②（キーワード単位の基本名比較）を完全一致だけでなく双方向部分一致（includes）も許容。
 *
 * 本体（Apps Scriptエディタ）に貼り付けて mainFlow 関数を置き換えることを想定。
 * runMode==='rename' 側（修正①）およびその他の関数は前回スナップショットから変更なし。
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

    // 【モード1：名前変更モード】（修正①、前回スナップショットから変更なし）
    if (runMode === 'rename') {
      const pdfText = extractTextFromPdfWithRetry(file.getId());
      if (!pdfText) {
        Logger.log('✕ PDFの解析に失敗したためスキップします。');
        writeLogToSheet(fileName, '✕ 抽出失敗', '-', 'PDFの解析（文字読み取り）に失敗しました。');
        continue;
      }

      let targetYearMonthStr = '';
      const dateMatch =
        pdfText.match(/(\d{4})[\/\-](\d{1,2})[\/\-]\d{1,2}/) ||
        pdfText.match(/([A-Za-z]{3,9})\.?\s+\d{1,2},?\s*(\d{4})/);

      if (dateMatch) {
        if (/^\d+$/.test(dateMatch[1])) {
          const year = dateMatch[1];
          const month = parseInt(dateMatch[2], 10);
          targetYearMonthStr = year + '年' + month + '月';
        } else {
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          const monthIndex = monthNames.indexOf(dateMatch[1].toLowerCase().substring(0, 3));
          if (monthIndex !== -1) {
            targetYearMonthStr = dateMatch[2] + '年' + (monthIndex + 1) + '月';
          }
        }
      }

      if (!targetYearMonthStr) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        targetYearMonthStr = Utilities.formatDate(d, "Asia/Tokyo", "yyyy年M月");
        Logger.log('⚠️ PDF内から日付を抽出できなかったため、前月表記（' + targetYearMonthStr + '）にフォールバックしました。');
      }

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
        //     全ティアで一貫して適用する。詳細はファイル先頭のコメント参照。
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
