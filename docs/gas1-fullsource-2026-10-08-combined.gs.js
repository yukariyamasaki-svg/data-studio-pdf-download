/**
 * GAS①（自動実行_リネームとBox転送）の全文（2026-10-08、Canvas更新＋Webアプリ化 反映済み）
 *
 * 元のプロジェクト（このリポジトリの範囲外）:
 *   自動実行_リネームとBox転送: https://script.google.com/home/projects/1KNzq3wKy8DSOhFXCcPnjwf5krWc5dZR1LCGzRV8G4CSZnmftf8Uc7-vI/edit
 *
 * ベースはユーザーが2026-10-08に取得した「2026-10-06・修正⑤版」の全文。
 * これに docs/gas1-mainflow-fix-2026-10-08-combined.gs.js の内容を関数単位で反映した。
 * 変更点（"2026-10-08追記"とコメントした箇所、および新規関数3つ）以外は無変更。
 *
 * このファイルは完全に自己完結している（他の関数・定数に依存していない独自の全文）。
 * 定数（BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_PARENT_FOLDER_ID, GOOGLE_FOLDER_ID,
 * SPREADSHEET_ID, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID等）はこのファイルに含まれていないため、
 * 既存プロジェクトの値をそのまま使うこと（スクリプトプロパティ or 別ファイルに定義済みのはず）。
 *
 * 適用方法:
 *   GASエディタの既存コードを全選択→削除し、このファイルの内容をそのまま貼り付けて保存する。
 *
 * 貼り付け後、スクリプトプロパティに以下を追加設定すること:
 *   TRIGGER_SECRET      ... GitHub Actionsからの呼び出しを検証する共有シークレット
 *                           （GitHub SecretsのGAS1_TRIGGER_SECRETと同じ値）
 *   GAS2_WEBAPP_URL     ... GAS②のWebアプリURL（GAS②デプロイ後に設定、未設定でも動く）
 *   GAS2_TRIGGER_SECRET ... GAS②のdoPostが検証するシークレット（GAS②側TRIGGER_SECRETと同じ値）
 *   SLACK_BOT_TOKEN     ... Canvas更新用（未設定の間はログに警告を出すだけでスキップされる）
 * その後、エディタ右上「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」で公開し、
 * 発行されたURLをGAS1_WEBAPP_URLとしてGitHub Secretsに設定する。
 */

// ==============================================================
// 👆 画面上のメニューから実行したいステップを選んで「実行」してください。
//    もうコードを直接書き換える必要はありません！
// ==============================================================

// 【ボタン1】名前変更だけを一度にやって確認したいときはこれを選ぶ
function ステップ1_名前変更のみ実行() {
  mainFlow('rename');
}

// 【ボタン2】名前を確認して、Boxへ仕分け・転送したいときはこれを選ぶ
function ステップ2_Box転送仕分けを実行() {
  mainFlow('upload');
}

// ーーー 以下、自動処理の共通プログラム ーーー

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

function writeLogToSheet(originalName, mediaName, newName, resultMessage) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets()[0];
    const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([timestamp, originalName, mediaName, newName, resultMessage]);
  } catch (e) {
    Logger.log('⚠️ ログ書き込み失敗: ' + e.message);
  }
}

function extractTextFromPdfWithRetry(fileId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let tempDocId = null;
    try {
      const blob = DriveApp.getFileById(fileId).getBlob();
      const resource = { name: 'temp_doc_' + fileId, mimeType: MimeType.GOOGLE_DOCS };
      const tempDoc = Drive.Files.create(resource, blob, { ocr: true });
      tempDocId = tempDoc.id;
      Utilities.sleep(1000);
      const doc = DocumentApp.openById(tempDocId);
      const text = doc.getBody().getText();
      Drive.Files.remove(tempDocId);
      if (text && text.trim().length > 0) return text;
    } catch (e) {
      if (tempDocId) { try { Drive.Files.remove(tempDocId); } catch(err) {} }
    }
    Utilities.sleep(1500);
  }
  return null;
}

function conv(str) {
  return str.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/ /g, ' ');
}

function getBoxService() {
  return OAuth2.createService('Box')
      .setAuthorizationBaseUrl('https://account.box.com/api/oauth2/authorize').setTokenUrl('https://api.box.com/oauth2/token')
      .setClientId(BOX_CLIENT_ID).setClientSecret(BOX_CLIENT_SECRET)
      .setCallbackFunction('authCallback').setPropertyStore(PropertiesService.getUserProperties()).setScope('root_readwrite');
}

function authCallback(request) {
  return HtmlService.createHtmlOutput(getBoxService().handleCallback(request) ? 'Box成功。' : '失敗。');
}

function getBoxFoldersDirectly(parentFolderId, accessToken) {
  try {
    const response = UrlFetchApp.fetch('https://api.box.com/2.0/folders/' + parentFolderId + '/items?limit=1000&fields=id,name,type', {
      method: 'get', headers: { 'Authorization': 'Bearer ' + accessToken }, muteHttpExceptions: true
    });
    const text = response.getContentText();
    if (!text || text.trim() === "") return [];
    const json = JSON.parse(text);
    return (json.entries || []).filter(e => e.type === 'folder');
  } catch(e) { return []; }
}

function uploadOrUpdateFileInBox(folderId, googleFile, fileName, accessToken) {
  try {
    const checkRes = UrlFetchApp.fetch('https://api.box.com/2.0/folders/' + folderId + '/items?limit=1000&fields=id,name,type', {
      method: 'get', headers: { 'Authorization': 'Bearer ' + accessToken }, muteHttpExceptions: true
    });
    const resText = checkRes.getContentText();
    let items = [];
    if (resText && resText.trim() !== "") {
      try { items = JSON.parse(resText).entries || []; } catch(jsErr) {}
    }

    let existingFileId = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'file' && items[i].name === fileName) {
        existingFileId = items[i].id;
        break;
      }
    }

    const fileBlob = googleFile.getBlob();
    let url = '';
    let payload = {};

    if (existingFileId) {
      url = 'https://upload.box.com/api/2.0/files/' + existingFileId + '/content';
      payload = { 'file': fileBlob };
    } else {
      url = 'https://upload.box.com/api/2.0/files/content';
      let attributes = { name: fileName, parent: { id: folderId } };
      payload = {
        'attributes': JSON.stringify(attributes),
        'file': fileBlob
      };
    }

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + accessToken },
      payload: payload,
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    return (code === 200 || code === 201);
  } catch(e) {
    return false;
  }
}

// 2026-10-08追記: triggerGas2_()を末尾に1行追加（mainFlow呼び出し2行自体は変更なし）。
// プッシュ起動・毎分→低頻度フォールバック起動のどちらで呼ばれても、この関数の最後で
// 必ずGAS②へプッシュ起動を試みる。
function 自動実行_リネームとBox転送() {
  mainFlow('rename');
  mainFlow('upload');
  triggerGas2_(); // 2026-10-08追記
}

// ===== Webアプリ化（2026-10-08追加・新規関数） =====
// GitHub ActionsのPDFダウンロード完了直後にPOSTされる想定。リクエストボディ内の
// 共有シークレットをスクリプトプロパティTRIGGER_SECRETと照合してから本処理を実行する。
function doPost(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('TRIGGER_SECRET');
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid JSON' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!expected || payload.secret !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  自動実行_リネームとBox転送();

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// GAS②のWebアプリへプッシュ起動する。GAS2_WEBAPP_URL/GAS2_TRIGGER_SECRETが
// 未設定の間はログに警告を出すだけでスキップし、GAS②自身の時間主導トリガー
// （フォールバック）に処理を委ねる。失敗時も例外を投げず、呼び出し元の
// mainFlow結果（Box転送・通知メール下書き・Canvas更新）には影響させない。
function triggerGas2_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('GAS2_WEBAPP_URL');
  const secret = props.getProperty('GAS2_TRIGGER_SECRET');
  if (!url || !secret) {
    Logger.log('⚠️ GAS2_WEBAPP_URL/GAS2_TRIGGER_SECRET未設定のため、GAS②へのプッシュ起動をスキップします（毎分→低頻度フォールバックトリガーに委ねます）。');
    return;
  }
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ secret: secret }),
      muteHttpExceptions: true
    });
    Logger.log('◯ GAS②へプッシュ起動しました: ' + res.getContentText());
  } catch (e) {
    Logger.log('✕ GAS②へのプッシュ起動に失敗しました（フォールバックトリガーに委ねます）: ' + e.toString());
  }
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

// ===== Airtable連携 =====

function getAirtableRecipients_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('AIRTABLE_API_KEY');
  if (!apiKey) {
    Logger.log('⚠️ AIRTABLE_API_KEYが未設定のため、権限延長・通知メールはスキップします。');
    return [];
  }

  const records = [];
  let offset = null;
  do {
    let url = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + AIRTABLE_TABLE_ID + '?pageSize=100';
    if (offset) url += '&offset=' + offset;
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + apiKey },
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    (json.records || []).forEach(r => records.push(r.fields));
    offset = json.offset;
  } while (offset);

  return records.filter(f => {
    const tags = f.tag;
    return Array.isArray(tags) && tags.indexOf('レポート送付先') !== -1;
  });
}

function resolveBoxFolderIdFromSharedLink_(sharedUrl, accessToken, cache) {
  if (cache[sharedUrl] !== undefined) return cache[sharedUrl];
  let folderId = null;
  try {
    const res = UrlFetchApp.fetch('https://api.box.com/2.0/shared_items', {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        BoxApi: 'shared_link=' + sharedUrl
      },
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    if (json.type === 'folder') folderId = json.id;
  } catch (e) {
    Logger.log('✕ Box共有リンク解決失敗 [' + sharedUrl + ']: ' + e.message);
  }
  cache[sharedUrl] = folderId;
  return folderId;
}

function buildFolderRecipientsMap_(accessToken) {
  const recipients = getAirtableRecipients_();
  const linkCache = {};
  const map = {};

  recipients.forEach(rec => {
    const boxUrl = Array.isArray(rec.BOXURL) ? rec.BOXURL[0] : rec.BOXURL;
    if (!boxUrl || !rec.email) return;
    const folderId = resolveBoxFolderIdFromSharedLink_(boxUrl, accessToken, linkCache);
    if (!folderId) return;
    if (!map[folderId]) map[folderId] = [];
    if (!map[folderId].some(r => r.email === rec.email)) {
      map[folderId].push({ email: rec.email, name: rec.person_name || '', company: rec.company || '', boxUrl: boxUrl });
    }
  });

  return map;
}

// ===== Box権限延長 =====

function isoDateDaysFromNow_(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function getBoxFolderCollaborationsMap_(folderId, accessToken) {
  const map = {};
  try {
    const res = UrlFetchApp.fetch('https://api.box.com/2.0/folders/' + folderId + '/collaborations', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    (json.entries || []).forEach(c => {
      const email = c.accessible_by && c.accessible_by.login;
      if (email) map[email.toLowerCase()] = { id: c.id, role: c.role };
    });
  } catch (e) {
    Logger.log('✕ コラボレーター一覧取得失敗 [folder=' + folderId + ']: ' + e.message);
  }
  return map;
}

function extendBoxCollaborationExpiry_(collaborationId, role, accessToken) {
  const res = UrlFetchApp.fetch('https://api.box.com/2.0/collaborations/' + collaborationId, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({ role: role, expires_at: isoDateDaysFromNow_(60) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) return 'extended';
  Logger.log('✕ Box有効期限延長失敗 [id=' + collaborationId + ']: HTTP ' + res.getResponseCode());
  return 'failed';
}

function addBoxViewerCollaboration_(folderId, email, accessToken) {
  const res = UrlFetchApp.fetch('https://api.box.com/2.0/collaborations', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({
      item: { type: 'folder', id: folderId },
      accessible_by: { type: 'user', login: email },
      role: 'viewer',
      expires_at: isoDateDaysFromNow_(60)
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 201) return 'added';
  const text = res.getContentText();
  if (text.indexOf('user_already_collaborator') !== -1) return 'already_collaborator';
  Logger.log('✕ Boxコラボレーター追加失敗 [' + email + ']: HTTP ' + code + ' - ' + text.substring(0, 300));
  return 'failed';
}

function extendBoxAccessForFolder_(folderId, recipients, accessToken) {
  const collabMap = getBoxFolderCollaborationsMap_(folderId, accessToken);
  return recipients.map(r => {
    const existing = collabMap[r.email.toLowerCase()];
    const status = existing
      ? extendBoxCollaborationExpiry_(existing.id, existing.role, accessToken)
      : addBoxViewerCollaboration_(folderId, r.email, accessToken);
    return { email: r.email, status: status };
  });
}

// ===== 通知メール（下書きのみ） =====

function getPreviousMonthLabel_() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年M月');
}

function encodeMimeHeader_(text) {
  return '=?UTF-8?B?' + Utilities.base64Encode(text, Utilities.Charset.UTF_8) + '?=';
}

function chunkBase64_(base64Str) {
  const lines = [];
  for (let i = 0; i < base64Str.length; i += 76) {
    lines.push(base64Str.substring(i, i + 76));
  }
  return lines.join('\r\n');
}

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildRawEmail_(fromDisplayName, fromEmail, toEmail, subject, htmlBody) {
  const fromHeader = encodeMimeHeader_(fromDisplayName) + ' <' + fromEmail + '>';
  const encodedSubject = encodeMimeHeader_(subject);
  const encodedBody = chunkBase64_(Utilities.base64Encode(htmlBody, Utilities.Charset.UTF_8));

  const lines = [
    'From: ' + fromHeader,
    'To: ' + toEmail,
    'Subject: ' + encodedSubject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody
  ];
  return lines.join('\r\n');
}

function createNotificationDraft_(recipient, mediaName) {
  const monthLabel = getPreviousMonthLabel_();
  const name = recipient.name ? recipient.name + '様' : 'ご担当者様';
  const subject = '[スマートニュース＋] ' + monthLabel + '度分 月次レポートのご案内';
  const boxUrl = recipient.boxUrl || '';

  const htmlBody =
    escapeHtml_(name) + '<br><br>' +
    '平素より大変お世話になっております。スマートニュースメディアリレーション事務局です。<br><br>' +
    'いつも「スマートニュース＋」へ記事をご提供いただき、誠にありがとうございます。<br><br>' +
    '「スマートニュース＋」の先月分レポートをBOXに保管いたしました。是非ともご活用いただければ幸いです。<br>' +
    '<a href="' + boxUrl + '">' + escapeHtml_(boxUrl) + '</a><br><br>' +
    'ご不都合な点やご不明な点がございましたら、お気軽にご連絡くださいませ。<br>' +
    '引き続き、どうぞよろしくお願い申し上げます。<br><br>' +
    '-----------------------------------------------------------------<br>' +
    'スマートニュース株式会社 メディアリレーション事務局<br><br>' +
    ' ▼お問い合わせフォーム<br>' +
    '<a href="https://publishers.smartnews.com/hc/ja/requests/new">https://publishers.smartnews.com/hc/ja/requests/new</a><br><br>' +
    ' ▼SmartNews媒体運営者向けサポートサイト<br>' +
    '<a href="https://publishers.smartnews.com/">https://publishers.smartnews.com/</a><br><br>' +
    ' ▼SmartNews<br>' +
    '<a href="https://www.smartnews.com/">https://www.smartnews.com/</a>';

  const rawEmail = buildRawEmail_(
    'スマートニュース株式会社 メディアリレーション事務局',
    'jp-media-support@smartnews.com',
    recipient.email,
    subject,
    htmlBody
  );
  const encodedMessage = Utilities.base64EncodeWebSafe(rawEmail, Utilities.Charset.UTF_8);

  try {
    Gmail.Users.Drafts.create({ message: { raw: encodedMessage } }, 'me');
    return 'drafted';
  } catch (e) {
    Logger.log('✕ メール下書き作成失敗 [' + recipient.email + ']: ' + e.message);
    return 'failed';
  }
}

/**
 * 修正⑤（2026-10-06）: 複数媒体を兼任する担当者向けに、媒体ごとに別々の下書きを作らず
 * 1件のメールに全媒体分のリンクをまとめて記載する。createNotificationDraft_の
 * 複数媒体版（mainFlowのnotificationQueue_から呼ばれる）。
 */
function createConsolidatedNotificationDraft_(email, name, items) {
  const monthLabel = getPreviousMonthLabel_();
  const displayName = name ? name + '様' : 'ご担当者様';
  const subject = '[スマートニュース＋] ' + monthLabel + '度分 月次レポートのご案内';

  const linksHtml = items
    .map(item => '・' + escapeHtml_(item.mediaName) + '：<a href="' + item.boxUrl + '">' + escapeHtml_(item.boxUrl) + '</a>')
    .join('<br>');

  const htmlBody =
    escapeHtml_(displayName) + '<br><br>' +
    '平素より大変お世話になっております。スマートニュースメディアリレーション事務局です。<br><br>' +
    'いつも「スマートニュース＋」へ記事をご提供いただき、誠にありがとうございます。<br><br>' +
    '「スマートニュース＋」の先月分レポートをBOXに保管いたしました。是非ともご活用いただければ幸いです。<br>' +
    linksHtml + '<br><br>' +
    'ご不都合な点やご不明な点がございましたら、お気軽にご連絡くださいませ。<br>' +
    '引き続き、どうぞよろしくお願い申し上げます。<br><br>' +
    '-----------------------------------------------------------------<br>' +
    'スマートニュース株式会社 メディアリレーション事務局<br><br>' +
    ' ▼お問い合わせフォーム<br>' +
    '<a href="https://publishers.smartnews.com/hc/ja/requests/new">https://publishers.smartnews.com/hc/ja/requests/new</a><br><br>' +
    ' ▼SmartNews媒体運営者向けサポートサイト<br>' +
    '<a href="https://publishers.smartnews.com/">https://publishers.smartnews.com/</a><br><br>' +
    ' ▼SmartNews<br>' +
    '<a href="https://www.smartnews.com/">https://www.smartnews.com/</a>';

  const rawEmail = buildRawEmail_(
    'スマートニュース株式会社 メディアリレーション事務局',
    'jp-media-support@smartnews.com',
    email,
    subject,
    htmlBody
  );
  const encodedMessage = Utilities.base64EncodeWebSafe(rawEmail, Utilities.Charset.UTF_8);

  try {
    Gmail.Users.Drafts.create({ message: { raw: encodedMessage } }, 'me');
    return 'drafted';
  } catch (e) {
    Logger.log('✕ メール下書き作成失敗 [' + email + ']: ' + e.message);
    return 'failed';
  }
}



// ===== 動作確認用 =====
function testBoxAccessAndDraftForOneMedia() {
  const testMediaName = '36Kr'; // テストしたい媒体名に変更してください
  const service = getBoxService();
  if (!service.hasAccess()) return Logger.log('✕ 未認証: ' + service.getAuthorizationUrl());
  const accessToken = service.getAccessToken();

  const boxFolders = getBoxFoldersDirectly(BOX_PARENT_FOLDER_ID, accessToken);

  const cleanCompare = (str) => conv(str).toLowerCase().replace(/[\s \(\)（）\-\_\.御中様]/g, '').trim();
  const cleanTarget = cleanCompare(testMediaName);

  let folder = boxFolders.find(f => cleanCompare(f.name) === cleanTarget);
  if (!folder) {
    folder = boxFolders.find(f => {
      const c = cleanCompare(f.name);
      return c.includes(cleanTarget) || cleanTarget.includes(c);
    });
  }
  if (!folder) {
    Logger.log('✕ Boxフォルダに「' + testMediaName + '」に一致するものが見つかりません。');
    Logger.log('候補一覧: ' + boxFolders.map(f => f.name).join(', '));
    return;
  }

  const folderRecipientsMap = buildFolderRecipientsMap_(accessToken);
  const recipients = folderRecipientsMap[folder.id] || [];
  if (recipients.length === 0) {
    Logger.log('⚠️ 「' + folder.name + '」に該当するAirtable送付先がありません。');
    return;
  }

  Logger.log('対象フォルダ: ' + folder.name + ' (id=' + folder.id + ')');
  Logger.log('送付先: ' + JSON.stringify(recipients, null, 2));

  const accessResults = extendBoxAccessForFolder_(folder.id, recipients, accessToken);
  accessResults.forEach(r => Logger.log('Box権限[' + r.email + ']: ' + r.status));

  recipients.forEach(r => {
    const draftStatus = createNotificationDraft_(r, folder.name);
    Logger.log('通知メール下書き[' + r.email + ']: ' + draftStatus);
  });
}
function debugBoxFolderItems() {
  const service = getBoxService();
  if (!service.hasAccess()) { Logger.log('未認証: ' + service.getAuthorizationUrl()); return; }
  const accessToken = service.getAccessToken();
  const response = UrlFetchApp.fetch(
    'https://api.box.com/2.0/folders/' + BOX_PARENT_FOLDER_ID + '/items?limit=1000&fields=id,name,type',
    { method: 'get', headers: { 'Authorization': 'Bearer ' + accessToken }, muteHttpExceptions: true }
  );
  Logger.log('HTTP status: ' + response.getResponseCode());
  Logger.log('Body: ' + response.getContentText());
}
function trashDuplicateReports() {
  const ids = [
    // 1. 重複（新しい方）
    '1ArOSa1h-J-UfVriV4fRUwhAv8u-kWdfO', // 36Kr Japan 重複
    '1ibBpURy1raPmoTVnaKKUQWIVPG4TeFVB', // 36Kr Japan 重複
    '1QWC5YQSuDIPnertQkeaYDF873At6MwsR', // ALBA Net 重複
    '1jua3XB_PCuDOQuzyew-1po6674myMwWA', // Full-Count 重複
    '1KHs47LFxgjlep_ynzNi8aFIvggzedYym', // Bloomberg 重複
    '1il2MfCdXo3lwjl3Xzz5xwKNRnlktKc8m', // プレジデントオンラインアカデミー(インフォ) 重複
    // 2. 未リネームの27枚
    '1bDlWJUo3WuD2W0aIAOb7iTUe9C-0KuDW', // Fortune.pdf
    '10kGSU3p_Oe47lkyHQT1WJcH5zRklDVeg', // The Economist（ガリレオ社用）.pdf
    '1ermxfYRarzlWLQTzkFcXopCrRTLkDE3Q', // The Washington Post.pdf
    '1tZh45bJ91VqWjnfIqSX3triIFqpmPzd9', // MIT Technology Review.pdf
    '16Z7eZqy-OnvkHTkCQ2FMQgt51nxclVa-', // MONOQLO.pdf
    '1lJ67TsuVWY7X8vmxSiFtrw5zS0MVHy_q', // Myゴルフダイジェスト.pdf
    '1SZkp7crlrCYeNj_PQTKyMniQh5vNVQct', // NewsPicks Selection（インフォグラフィック用）.pdf
    '1wencDlHjGTACLjtrk94mIIvqfbCOHSGM', // NewsPicks Selection.pdf
    '1XY0r764cZhKraWPhlxKL2ulLi1RNN1Qu', // NumberPREMIER.pdf
    '1leU3ZNk-e7jTGZIrTaBJ7KWvCmZwHqXF', // nobico（のびこ）新フィード.pdf
    '1S1fZVd58rU-lqgR_8AGfh96Wn3xSu1e8', // nobico.pdf
    '1s_yN2zvr4njqTRe1Y7RD523A40Hm9F83', // PHPオンライン（インフォグラフィック用）.pdf
    '1AdczPGjCKc78eQTqvZSwZnx4gXUpR2g3', // PHPオンライン.pdf
    '1b317XUDoHXPJkHxHnN7DANgpjB6pavay', // THE21オンライン.pdf
    '1ISQOzsq2JUUfWGkMYq3bvShVc3F6MhKd', // WEB Voice.pdf
    '1Qtsy6fiZLAvGxxRpey_2kzxDRQIQzC_F', // WEB歴史街道.pdf
    '18-o_OhUjwYJ9BYFS-b6hfd6JU8q2YSj4', // SERENDIP.pdf
    '1mdkeJwX5FW97Gq7zWog7SErhfcwTUxna', // SPODUCATION.pdf
    '10aus5Wofo4GjD1D1tdtetK73TguL0xEv', // Strainer premium.pdf
    '1muaCT2NbGCHAAXzPDX-HjmSgX4lYUIjT', // THE GOLD ONLINE.pdf
    '1h3ybRRUIzrRDqCbOeXPMTVFd9sSDoKMj', // theLetter.pdf
    '1NhWTGZNsfw_ulg1aFSylGCTg3Y4FSZTg', // THE WALL STREET JOURNAL 日本版.pdf
    '1npZuL5T_Tj2oVTvnUVZbGpPlKG5cygpm', // webスポルティーバ.pdf
    '12rzXvLvl4aYKyBQr7IXuGgJ1pymHEG46', // Wedge ONLINE PREMIUM.pdf
    '1sow8DicRX6B5qxkyMOv9sXxWccyiKQyh', // WWDJAPAN.pdf
    '182IMpSyBdjlxHAPE_lJbUzkxXoEdOJh_', // YOUTRUST.pdf
    '1Zv--UzqaradQaZHrE571YU9i2HseGFDr', // ほんのれん.pdf
  ];
  ids.forEach(id => {
    const f = DriveApp.getFileById(id);
    Logger.log('trash: ' + f.getName());
    f.setTrashed(true);
  });
}
