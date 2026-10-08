const { google } = require('googleapis');
const { request } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 月次レポートのPDF生成が参照する「媒体別用」「記事カテゴリ」シートを更新するスクリプト。
// 元は jp-mb-scripts/data-studio-pdf-download/update-monthly-sheets.js の手動実行専用版。
// このリポジトリでは schedule.yml の「Run download script」の直前に SKIP_CONFIRM=true で
// 組み込み、TARGET_MONTH未指定時は前月を自動算出することで、毎月2日までの手動実行という
// 締切そのものを無くしている。
//
// 1. 媒体別レポート（Redashクエリ43763, 対象月dt指定）→「媒体別用」シート:
//    最も古い月の行をすべて削除し、対象月のデータを末尾に追加する。
// 2. 記事カテゴリレポート（Redashクエリ30424, 直近12ヶ月）→「記事カテゴリ」シート:
//    シート全体を最新の直近12ヶ月データで置き換える。
//
// 実行（手動バックフィル時のみTARGET_MONTH/REFRESH_MONTHを指定）: TARGET_MONTH=YYYY-MM npm run update-sheets
// 自動実行時はSKIP_CONFIRM=trueを渡して対話確認を省略する。
//
// query.smartnews.netは会社のOkta SSOゲートの背後にあり、Redashのクエリ単体API
// キーを渡すだけではHTTPリクエストが素通りできない（ログイン画面のHTMLが返る）
// ため、login.jsのGoogleセッションと同じ「ブラウザで一度ログイン→セッション保存→
// そのセッションのcookieで認証済みリクエストを送る」方式を使う。GitHub Actions上では
// REDASH_SESSION_STATE_B64をauth/redash-session.jsonに復元してから実行する想定。

const SPREADSHEET_ID = '13d0xzFBUShE77P-6VcCF2B1ahFSckA5FdPPuAf9j9Nc';
const MEDIA_SHEET_NAME = '媒体別用';
const CATEGORY_SHEET_NAME = '記事カテゴリ';
const MEDIA_QUERY_ID = 43763;
const CATEGORY_QUERY_ID = 30424;
const REDASH_BASE_URL = 'https://query.smartnews.net';
const REDASH_SESSION_PATH = path.join(__dirname, 'auth', 'redash-session.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // skip; \n handles the line break
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function loadRedashContext() {
  if (!fs.existsSync(REDASH_SESSION_PATH)) {
    throw new Error(`Redashのログインセッションがありません（${REDASH_SESSION_PATH}）。先に npm run login-redash を実行してください。`);
  }
  return request.newContext({ storageState: REDASH_SESSION_PATH, baseURL: REDASH_BASE_URL });
}

async function pollJob(redashCtx, jobId) {
  for (let i = 0; i < 180; i++) {
    const res = await redashCtx.get(`/api/jobs/${jobId}`);
    const data = await res.json();
    const job = data.job;
    if (job.status === 3) return job.query_result_id;
    if (job.status === 4) throw new Error(`Redashジョブが失敗しました: ${job.error || 'unknown error'}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Redashジョブがタイムアウトしました。');
}

async function redashResults(redashCtx, queryId, parameters, debugFileName) {
  const execRes = await redashCtx.post(`/api/queries/${queryId}/results`, {
    data: { parameters, max_age: 0 },
  });
  if (!execRes.ok()) {
    throw new Error(`Redashクエリ${queryId}の実行に失敗しました: HTTP ${execRes.status()}。Redashのログインセッションが失効している可能性があります（npm run login-redash で再取得してください）。`);
  }
  const execData = await execRes.json();

  let queryResultId = execData.query_result && execData.query_result.id;
  if (!queryResultId) {
    if (!execData.job) {
      throw new Error(`Redashクエリ${queryId}の応答形式が想定外です。`);
    }
    queryResultId = await pollJob(redashCtx, execData.job.id);
  }

  const csvRes = await redashCtx.get(`/api/query_results/${queryResultId}.csv`);
  if (!csvRes.ok()) {
    throw new Error(`Redashクエリ${queryId}の結果取得に失敗しました: HTTP ${csvRes.status()}`);
  }
  const csvText = await csvRes.text();

  if (debugFileName) {
    fs.writeFileSync(path.join('/tmp', debugFileName), csvText, 'utf8');
  }

  const rows = parseCsv(csvText.trim());
  return { header: rows[0], dataRows: rows.slice(1) };
}

function last12MonthsRange() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

// TARGET_MONTH/REFRESH_MONTH が未指定の場合、JST基準で前月をデフォルトにする
// （このパイプラインは毎月1〜9日のGitHub Actions実行時に、常に完全に終わった前月分を
// 対象にするため）。
function defaultTargetMonth() {
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  jstNow.setDate(1);
  jstNow.setMonth(jstNow.getMonth() - 1);
  const year = jstNow.getFullYear();
  const month = String(jstNow.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function loadSheetsClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_SHEETS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_SHEETS_REFRESH_TOKEN 環境変数が必要です。');
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

async function getSheetIdMap(sheets) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });
  const map = {};
  for (const sheet of res.data.sheets) {
    map[sheet.properties.title] = sheet.properties.sheetId;
  }
  return map;
}

// 「媒体別用」シートの月列（A列）を読み、最古の月をすべて削除する行範囲を求める。
// 対象月が既に存在する場合や、最古月の行がシート内で連続していない場合は、
// データ破壊を避けるため処理を中断する（安全チェック）。
async function planMediaSheetUpdate(sheets, sheetId, targetMonth) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MEDIA_SHEET_NAME}!A2:A`,
  });
  const monthColumn = (res.data.values || []).map((r) => r[0]);
  if (monthColumn.length === 0) {
    throw new Error(`${MEDIA_SHEET_NAME}シートにデータ行がありません。`);
  }
  if (monthColumn.includes(targetMonth)) {
    throw new Error(`${MEDIA_SHEET_NAME}シートに対象月（${targetMonth}）のデータが既に存在します。重複追加を避けるため中断しました。`);
  }

  const oldestMonth = monthColumn[0];
  let blockEnd = 0;
  while (blockEnd < monthColumn.length && monthColumn[blockEnd] === oldestMonth) {
    blockEnd++;
  }
  // 万一、最古月と同じ値の行がブロックの後にも現れる場合は非連続とみなし中断する。
  if (monthColumn.slice(blockEnd).includes(oldestMonth)) {
    throw new Error(`${MEDIA_SHEET_NAME}シートの最古月（${oldestMonth}）の行が連続していません。手動確認が必要です。`);
  }

  return {
    oldestMonth,
    deleteRowCount: blockEnd,
    // values.get の range は2行目から始まるため、シート上の実際の行インデックス（0始まり）に+1する。
    deleteStartIndex: 1,
    deleteEndIndex: 1 + blockEnd,
    async apply(newDataRows) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: 1,
                  endIndex: 1 + blockEnd,
                },
              },
            },
          ],
        },
      });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${MEDIA_SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newDataRows },
      });
    },
  };
}

// 既存の対象月（例: 月末前に一度実行してしまい不完全なデータが入っている月）の行を
// 削除し、同じ月の最新データで再追加する。通常の月次ロールオーバー（最古月を削除し
// 新しい月を追加する planMediaSheetUpdate）とは別の、同月データの差し替え専用モード。
async function planMediaSheetRefresh(sheets, sheetId, targetMonth) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MEDIA_SHEET_NAME}!A2:A`,
  });
  const monthColumn = (res.data.values || []).map((r) => r[0]);
  const blockStart = monthColumn.indexOf(targetMonth);
  if (blockStart === -1) {
    throw new Error(`${MEDIA_SHEET_NAME}シートに対象月（${targetMonth}）のデータが見つかりません。REFRESH_MONTHは既存の月を差し替える専用モードです（新しい月の追加にはTARGET_MONTHを使ってください）。`);
  }
  let blockEnd = blockStart;
  while (blockEnd < monthColumn.length && monthColumn[blockEnd] === targetMonth) {
    blockEnd++;
  }
  if (monthColumn.slice(blockEnd).includes(targetMonth)) {
    throw new Error(`${MEDIA_SHEET_NAME}シートの対象月（${targetMonth}）の行が連続していません。手動確認が必要です。`);
  }

  return {
    oldestMonth: targetMonth,
    deleteRowCount: blockEnd - blockStart,
    async apply(newDataRows) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: 1 + blockStart,
                  endIndex: 1 + blockEnd,
                },
              },
            },
          ],
        },
      });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${MEDIA_SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newDataRows },
      });
    },
  };
}

async function replaceCategorySheet(sheets, allRowsWithHeader) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: CATEGORY_SHEET_NAME,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CATEGORY_SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: allRowsWithHeader },
  });
}

function confirmRun(targetMonth, mediaPlan, categoryRowCount, categoryRange, isRefresh) {
  console.log('');
  console.log(`=== ${SPREADSHEET_ID} への変更内容 ===`);
  if (isRefresh) {
    console.log(`[${MEDIA_SHEET_NAME}] 対象月「${targetMonth}」の既存${mediaPlan.deleteRowCount}行を削除し、最新の${mediaPlan.newDataRowCount}行で差し替えます（同月データの再取得・上書き）。`);
  } else {
    console.log(`[${MEDIA_SHEET_NAME}] 最古月「${mediaPlan.oldestMonth}」の${mediaPlan.deleteRowCount}行を削除し、対象月「${targetMonth}」の${mediaPlan.newDataRowCount}行を追加します。`);
  }
  console.log(`[${CATEGORY_SHEET_NAME}] シート全体を削除し、直近12ヶ月（${categoryRange.start}〜${categoryRange.end}）の${categoryRowCount}行（ヘッダー含む）で置き換えます。`);
  console.log('このスプレッドシートはLooker Studioの本番ダッシュボードが参照しています。');

  if (process.env.SKIP_CONFIRM === 'true') {
    console.log('SKIP_CONFIRM=true のため、確認をスキップして続行します。');
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('続行しますか？ (y/N): ', (answer) => {
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

async function main() {
  if (process.env.TARGET_MONTH && process.env.REFRESH_MONTH) {
    console.error('TARGET_MONTH と REFRESH_MONTH は同時に指定できません。');
    process.exit(1);
  }
  const isRefresh = !!process.env.REFRESH_MONTH;
  const targetMonth = process.env.REFRESH_MONTH || process.env.TARGET_MONTH || defaultTargetMonth();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    console.error('TARGET_MONTH（新しい月の追加）またはREFRESH_MONTH（既存月の差し替え）をYYYY-MM形式で指定してください（例: TARGET_MONTH=2026-08）。');
    process.exit(1);
  }
  if (!process.env.TARGET_MONTH && !process.env.REFRESH_MONTH) {
    console.log(`TARGET_MONTH未指定のため、前月（${targetMonth}）を自動的に対象とします。`);
  }
  const redashCtx = await loadRedashContext();

  let media;
  let category;
  const categoryRange = last12MonthsRange();
  try {
    console.log(`媒体別レポート（クエリ${MEDIA_QUERY_ID}, dt=${targetMonth}）を取得中...`);
    media = await redashResults(
      redashCtx,
      MEDIA_QUERY_ID,
      { dt: targetMonth },
      `media-report-${targetMonth}.csv`
    );
    console.log(`  ${media.dataRows.length}行取得。`);

    console.log(`記事カテゴリレポート（クエリ${CATEGORY_QUERY_ID}, ${categoryRange.start}〜${categoryRange.end}）を取得中...`);
    category = await redashResults(
      redashCtx,
      CATEGORY_QUERY_ID,
      { calendar: categoryRange },
      `article-category-${categoryRange.end}.csv`
    );
    console.log(`  ${category.dataRows.length}行取得。`);
  } finally {
    await redashCtx.dispose();
  }

  const sheets = loadSheetsClient();
  const sheetIdMap = await getSheetIdMap(sheets);
  const mediaSheetId = sheetIdMap[MEDIA_SHEET_NAME];
  if (mediaSheetId === undefined) {
    throw new Error(`シート「${MEDIA_SHEET_NAME}」が見つかりません。`);
  }
  if (sheetIdMap[CATEGORY_SHEET_NAME] === undefined) {
    throw new Error(`シート「${CATEGORY_SHEET_NAME}」が見つかりません。`);
  }

  const mediaPlan = isRefresh
    ? await planMediaSheetRefresh(sheets, mediaSheetId, targetMonth)
    : await planMediaSheetUpdate(sheets, mediaSheetId, targetMonth);
  mediaPlan.newDataRowCount = media.dataRows.length;

  const proceed = await confirmRun(
    targetMonth,
    mediaPlan,
    category.dataRows.length + 1,
    categoryRange,
    isRefresh
  );
  if (!proceed) {
    console.log('キャンセルしました。');
    process.exit(1);
  }

  console.log(`${MEDIA_SHEET_NAME}シートを更新中...`);
  await mediaPlan.apply(media.dataRows);
  console.log('  完了。');

  console.log(`${CATEGORY_SHEET_NAME}シートを更新中...`);
  await replaceCategorySheet(sheets, [category.header, ...category.dataRows]);
  console.log('  完了。');

  console.log('全ての更新が完了しました。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
