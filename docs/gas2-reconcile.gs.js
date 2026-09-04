/**
 * GAS②（ダブルチェック）のコード（参照用コピー）
 *
 * 本体は以下のGoogle Apps Scriptプロジェクトで管理されている（このリポジトリの範囲外）。
 * このファイルはレビュー・差分確認用に貼り付けたスナップショットであり、
 * 実行や自動デプロイの対象ではない。
 *
 * プロジェクトURL: https://script.google.com/home/projects/1RbTEF52nZDsHUrH3P8CUxk_kQMriDd70d9ZDB9J9Qr7kqkxFJcTaatWp/edit?hl=ja
 * 取得日: 2026-09-04
 *
 * 役割：Google Drive→GAS①（自動実行_リネームとBox転送）でBoxへ転送された
 * 今月分のPDFについて、Box上の各媒体フォルダ内のファイルをOCR抽出し、
 * フォルダ名（媒体名）とファイル名/抽出テキストが一致するかを判定して
 * 突合スプレッドシートに記録する（startReconcileが本体、時間主導トリガーで実行）。
 *
 * 参照: 呼び出し元グローバル定数（このファイルには含まれていない）
 *   SS_ID, P_SERVICE, PARENT_FOLDER_ID, CLIENT_ID, CLIENT_SECRET
 */

/**
 * メイン関数：照合実行
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
        const isMatch = checkMatch(folder.name, file.name, extractedText);

        // シートへ書き込み
        sheet.appendRow([
          Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss"),
          folder.name,
          file.name,
          extractedText.substring(0, 100).replace(/\n/g, " "),
          isMatch ? "✅一致" : "❌不一致"
        ]);

        processedFiles.push(String(file.name));
      });
    });
    console.log("照合処理が正常に完了しました。");
  } catch (e) {
    console.error("実行エラー:", e.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * Boxの指定フォルダ内の全アイテム（100件超対応のページネーション関数）
 */
function getBoxItems(folderId, token) {
  let allEntries = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  try {
    while (hasMore) {
      const url = `https://api.box.com/2.0/folders/${folderId}/items?fields=id,name,type,created_at&limit=${limit}&offset=${offset}`;
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      });

      if (res.getResponseCode() !== 200) {
        console.error(`Box API エラー (Folder ID: ${folderId}, HTTP ${res.getResponseCode()}): ${res.getContentText()}`);
        break;
      }

      const data = JSON.parse(res.getContentText());
      const entries = data.entries || [];
      allEntries = allEntries.concat(entries);

      if (offset + entries.length >= data.total_count || entries.length === 0) {
        hasMore = false;
      } else {
        offset += entries.length;
      }
    }
  } catch (e) {
    console.error(`getBoxItems例外エラー (${folderId}):`, e.toString());
  }

  return allEntries;
}

/**
 * 履歴移動処理（エラーガード強化版）
 */
function manageHistory(ss, currentSheet) {
  let historySheet = ss.getSheetByName("履歴") || ss.insertSheet("履歴");
  const lastRow = currentSheet.getLastRow();
  const lastColumn = currentSheet.getLastColumn();

  if (lastRow > 0 && lastColumn > 0) {
    const targetRow = historySheet.getLastRow() + 1;
    currentSheet.getRange(1, 1, lastRow, lastColumn).copyTo(historySheet.getRange(targetRow, 1));
  }
  currentSheet.clear();
}

/**
 * 部分一致・表記ゆれ対応判定関数
 */
function checkMatch(folderName, fileName, text) {
  if (!folderName) return false;

  const normalize = (str) => {
    if (!str) return "";
    return str.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
              .replace(/[「」『』（）\(\)\[\]]/g, "")
              .replace(/[\s \-\_\.\・\/]/g, "")
              .replace(/様|御中|ご共有用|株式会社|有限会社|合同会社|社$/g, "")
              .toLowerCase();
  };
  const nFileName = normalize(fileName);
  const nText = normalize(text);

  let keywords = folderName.split(/[・,，\/／\s （\(\)）]/).filter(k => k.length > 0);
  if (keywords.length === 0) return false;

  return keywords.some(kw => {
    const nKw = normalize(kw);
    if (nKw.length < 2) return false;
    return nFileName.indexOf(nKw) !== -1 || nText.indexOf(nKw) !== -1;
  });
}

/**
 * Boxファイルからテキスト（OCR）抽出
 */
function extractTextFromBoxFile(fileId, token) {
  try {
    const url = `https://api.box.com/2.0/files/${fileId}/content`;
    const res = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      console.error(`Boxファイル取得エラー (File ID: ${fileId}, HTTP ${res.getResponseCode()})`);
      return "抽出失敗";
    }

    const blob = res.getBlob();
    const tempFile = Drive.Files.insert({ title: 'temp', mimeType: blob.getContentType() }, blob, { ocr: true, ocrLanguage: 'ja' });
    const text = DocumentApp.openById(tempFile.id).getBody().getText();
    Drive.Files.remove(tempFile.id);
    return text;
  } catch (e) {
    console.error(`OCR処理失敗 (File ID: ${fileId}):`, e.toString());
    return "抽出失敗";
  }
}

/**
 * トークン自動更新（エラーガード強化版）
 */
function getValidAccessToken() {
  const refreshToken = P_SERVICE.getProperty('BOX_REFRESH_TOKEN');
  if (!refreshToken) {
    console.error("BOX_REFRESH_TOKEN が設定されていません。OAuth再認証を行ってください。");
    return null;
  }

  try {
    const res = UrlFetchApp.fetch('https://api.box.com/oauth2/token', {
      method: 'post',
      payload: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      },
      muteHttpExceptions: true
    });

    const status = res.getResponseCode();
    const responseText = res.getContentText();

    // 正常レスポンス（200 OK）でない場合はエラーログを出力して中断
    if (status !== 200) {
      console.error(`トークン更新エラー (HTTP ${status}): ${responseText}`);
      return null;
    }

    const data = JSON.parse(responseText);
    if (data.access_token) {
      P_SERVICE.setProperty('BOX_ACCESS_TOKEN', data.access_token);
      P_SERVICE.setProperty('BOX_REFRESH_TOKEN', data.refresh_token);
      return data.access_token;
    }
  } catch (e) {
    console.error("getValidAccessToken 例外エラー:", e.toString());
  }
  return null;
}

/**
 * 認証用 Step 1
 */
function step1_getAuthUrl() {
  const redirectUri = 'https://www.google.com';
  const authUrl = `https://account.box.com/api/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${redirectUri}`;
  console.log(authUrl);
}

/**
 * 認証用 Step 2
 */
function step2_finishAuth() {
  const code = 'ここにAuthorization_Codeを貼り付け';
  const options = {
    method: 'post',
    payload: {
      grant_type: 'authorization_code',
      code: code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: 'https://www.google.com'
    },
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch('https://api.box.com/oauth2/token', options);
  if (res.getResponseCode() === 200) {
    const data = JSON.parse(res.getContentText());
    P_SERVICE.setProperty('BOX_ACCESS_TOKEN', data.access_token);
    P_SERVICE.setProperty('BOX_REFRESH_TOKEN', data.refresh_token);
    console.log("認証完了。アクセストークンとリフレッシュトークンを保持しました。");
  } else {
    console.error(`認証失敗 (HTTP ${res.getResponseCode()}): ${res.getContentText()}`);
  }
}
