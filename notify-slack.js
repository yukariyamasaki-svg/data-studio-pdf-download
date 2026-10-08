const fs = require('fs');
const https = require('https');

const LOG_PATH = '/tmp/download.log';
const { SLACK_WEBHOOK_URL, SLACK_BOT_TOKEN, RUN_URL, DOWNLOAD_OUTCOME } = process.env;

// 2026-10-07: `#jp-stardust-contents`に置いた常設の進行状況Canvas（3システム共通の
// ステータスボード）。GAS①・GAS②もそれぞれ自分のセクションだけをこのCanvasに
// 書き込む設計なので、Canvasを差し替える場合はGAS側の同名定数も合わせて変更すること。
const SLACK_CANVAS_ID = 'F0C7F543EBV';
// セクションのidは書き換えるたびに変わるため、見出しではなく本文内のこの固定文字列で
// 毎回検索し直して対象セクションを特定する（本文は毎回置き換えるが目印は残す）。
const CANVAS_SECTION_ANCHOR = '[GH]';

function readFailedLines() {
  const log = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';
  return log.split('\n').filter((line) => line.startsWith('Failed for '));
}

function buildText(failedLines) {
  if (DOWNLOAD_OUTCOME !== 'success') {
    return `🚨 PDF生成が失敗しました（スクリプト自体が異常終了）: ${RUN_URL}`;
  }
  if (failedLines.length > 0) {
    const list = failedLines.map((line) => `- ${line.slice('Failed for '.length)}`).join('\n');
    return `⚠️ PDF生成が完了しましたが、${failedLines.length}媒体が失敗しました:\n${list}\n${RUN_URL}`;
  }
  return null;
}

function buildCanvasBody(failedLines) {
  const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  if (DOWNLOAD_OUTCOME !== 'success') {
    return `**${CANVAS_SECTION_ANCHOR}** 🚨 スクリプト自体が異常終了 (${timestamp}) — [実行ログ](${RUN_URL})`;
  }
  if (failedLines.length > 0) {
    return `**${CANVAS_SECTION_ANCHOR}** ⚠️ ${failedLines.length}媒体が失敗 (${timestamp}) — [実行ログ](${RUN_URL})`;
  }
  return `**${CANVAS_SECTION_ANCHOR}** ✅ 全媒体成功 (${timestamp}) — [実行ログ](${RUN_URL})`;
}

function postSlackApi(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function updateStatusCanvas(bodyMarkdown) {
  if (!SLACK_BOT_TOKEN) {
    console.log('SLACK_BOT_TOKEN未設定のため、ステータスCanvasの更新をスキップします。');
    return;
  }

  const lookup = await postSlackApi('canvases.sections.lookup', {
    canvas_id: SLACK_CANVAS_ID,
    criteria: { contains_text: CANVAS_SECTION_ANCHOR },
  });
  if (!lookup.ok || !lookup.sections || lookup.sections.length === 0) {
    console.error('ステータスCanvasの更新に失敗（セクションが見つかりません）:', lookup);
    return;
  }

  const edit = await postSlackApi('canvases.edit', {
    canvas_id: SLACK_CANVAS_ID,
    changes: [{
      operation: 'replace',
      section_id: lookup.sections[0].id,
      document_content: { type: 'markdown', markdown: bodyMarkdown },
    }],
  });
  if (!edit.ok) {
    console.error('ステータスCanvasの更新に失敗:', edit);
  } else {
    console.log('ステータスCanvasを更新しました。');
  }
}

async function main() {
  const failedLines = readFailedLines();

  const text = buildText(failedLines);
  if (!text) {
    console.log('全媒体成功のため、Slack通知は送信しません。');
  } else {
    await new Promise((resolve) => {
      const data = JSON.stringify({ text });
      const req = https.request(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      req.on('error', (err) => {
        console.error('Slack通知の送信に失敗しました:', err);
        resolve();
      });
      req.on('response', resolve);
      req.end(data);
    });
  }

  await updateStatusCanvas(buildCanvasBody(failedLines));
}

main().catch((err) => {
  console.error('notify-slack.js実行中にエラー:', err);
});
