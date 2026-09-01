const fs = require('fs');
const https = require('https');

const LOG_PATH = '/tmp/download.log';
const { SLACK_WEBHOOK_URL, RUN_URL, DOWNLOAD_OUTCOME } = process.env;

function buildText() {
  const log = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';
  const failedLines = log.split('\n').filter((line) => line.startsWith('Failed for '));

  if (DOWNLOAD_OUTCOME !== 'success') {
    return `🚨 PDF生成が失敗しました（スクリプト自体が異常終了）: ${RUN_URL}`;
  }
  if (failedLines.length > 0) {
    const list = failedLines.map((line) => `- ${line.slice('Failed for '.length)}`).join('\n');
    return `⚠️ PDF生成が完了しましたが、${failedLines.length}媒体が失敗しました:\n${list}\n${RUN_URL}`;
  }
  return `✅ PDF生成が完了しました（全媒体成功）: ${RUN_URL}`;
}

const data = JSON.stringify({ text: buildText() });
const req = https.request(SLACK_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
});
req.on('error', (err) => {
  console.error('Slack通知の送信に失敗しました:', err);
});
req.end(data);
