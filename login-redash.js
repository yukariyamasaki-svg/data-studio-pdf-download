const { chromium, request } = require('playwright');
const fs = require('fs');
const path = require('path');

// Redash（query.smartnews.net）にOkta SSO経由でログインしてセッションを保存する。
// query.smartnews.netはOkta SSOゲートの背後にあり、クエリ単体のAPIキーだけでは
// HTTPリクエストが素通りできない（ログインページのHTMLが返ってくる）ため、
// Googleアカウント用のlogin.jsと同じ「ブラウザで一度ログイン→セッション保存」方式を使う。
//
// セッションには有効期限があり、update-monthly-sheets.jsが
// 「Redashのログインセッションが失効している可能性があります」というエラーで
// 失敗するようになったら、このスクリプトを再実行してGitHub Secretsの
// REDASH_SESSION_STATE_B64を更新する必要がある（この手動更新だけは自動化できない、
// Okta SSOのMFAが人の操作を要求するため）。
//
// 実行: npm run login-redash
// 実行後、以下でGitHub Secretsを更新する:
//   base64 -i auth/redash-session.json | gh secret set REDASH_SESSION_STATE_B64
async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://query.smartnews.net/queries/43763');

  console.log('');
  console.log('=== ブラウザでOkta SSOログインを完了してください ===');
  console.log('=== ログイン完了後、自動的に次に進みます ===');
  console.log('');

  // query.smartnews.net配下には未ログイン時に表示される/loginページ自体も含まれる
  // ため、単に "query.smartnews.net/**" を待つだけではログイン完了前に即マッチして
  // しまう（未認証のセッションが保存される不具合があった）。/login配下から抜けるまで
  // 待つことで、実際にログインが完了するまで待機する。
  await page.waitForURL((url) => url.hostname === 'query.smartnews.net' && !url.pathname.startsWith('/login'), { timeout: 300000 });

  const storagePath = path.join(__dirname, 'auth', 'redash-session.json');
  const storageState = await context.storageState();
  await browser.close();

  // GitHub Secretsの1件あたり48KBというサイズ上限を超えないよう、cookie以外
  // （originsに乗るlocalStorage等）は保存しない。認証に必要なのはcookieのみ。
  const strippedState = { ...storageState, origins: [] };
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, JSON.stringify(strippedState), 'utf8');

  // query.smartnews.netへの到達=認証済みとは限らない（Okta側の中間画面が
  // 同ドメインの別パスに載ることがあり、その場合ログイン未完了のセッションが
  // 保存されてしまう）。実際にAPIが正しくJSONを返すかを確認してから成功と判定する。
  const apiCtx = await request.newContext({ storageState: storagePath, baseURL: 'https://query.smartnews.net' });
  try {
    const res = await apiCtx.get('/api/queries/43763');
    const contentType = res.headers()['content-type'] || '';
    if (!res.ok() || !contentType.includes('application/json')) {
      console.error('セッションの検証に失敗しました。ログインが完全に完了していない可能性があります。もう一度 npm run login-redash を実行し、最後まで（MFA含め）ログインを完了させてください。');
      process.exit(1);
    }
    await res.json();
  } finally {
    await apiCtx.dispose();
  }

  console.log(`セッション保存完了（検証OK）: ${storagePath}`);
  console.log('以下でGitHub Secretsを更新してください:');
  console.log(`  base64 -i ${storagePath} | gh secret set REDASH_SESSION_STATE_B64`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
