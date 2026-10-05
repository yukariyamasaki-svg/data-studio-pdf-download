const { chromium } = require('playwright');
const path = require('path');

// 初回のみ実行: レポートへのアクセス権があるGoogleアカウントにログインして
// セッションを保存する。GitHub Actions上のheadless Chromiumは匿名アクセスだと
// Looker Studioからログイン画面に弾かれるため、このセッションをCIに持ち込んで使う。
// 実行: npm run login
async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://accounts.google.com/');

  console.log('');
  console.log('=== ブラウザでGoogleアカウントにログインしてください ===');
  console.log('=== ログイン完了後、自動的に次に進みます ===');
  console.log('');

  await page.waitForURL('https://myaccount.google.com/**', { timeout: 300000 });

  const storagePath = path.join(__dirname, 'auth', 'google-session.json');
  await context.storageState({ path: storagePath });
  console.log(`セッション保存完了: ${storagePath}`);

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
