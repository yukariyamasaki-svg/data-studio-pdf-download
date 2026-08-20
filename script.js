const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// NOTE: the "embed" URL form (/embed/reporting/...) would normally strip the
// Looker Studio chrome (banner/toolbar/sidebar) from around the report, but
// this specific report has embedding disabled by the owner ("Can't access
// report - Viewing in other websites has been disabled by the report
// owner"), so we use the normal viewer URL and get a clean PDF instead via
// Data Studio's own "Download report" feature (see downloadReportPdfViaMenu()).
const REPORT_URL = 'https://datastudio.google.com/u/0/reporting/6ab590f1-9fad-4bdb-8336-cd145cfbb35f/page/vnXDE';
const DRIVE_FOLDER_ID = '1xkYmPLURyojCnzujByxWircjY3QWVlUa';

const publishers = [
  '36Kr Japan',
  'ALBA Net',
  'Full-Count',
  'Bloomberg',
  'Fortune',
  'The Economist(ガリレオ社用)',
  'The Washington Post',
  'KAI-YOU Premium',
  'MIT Technology Review',
  'MONOQLO',
  'Myゴルフダイジェスト',
  'NewsPicks Selection(インフォグラフィック用)',
  'NewsPicks Selection',
  'NumberPREMIER',
  'ONE CAREER PLUS',
  'nobico(のびこ)新フィード',
  'nobico',
  'PHPオンライン(インフォグラフィック用)',
  'PHPオンライン',
  'THE21オンライン',
  'WEB Voice',
  'WEB歴史街道',
  'SERENDIP',
  'SPODUCATION',
  'Strainer premium',
  'THE GOLD ONLINE(インフォグラフィック用)',
  'THE GOLD ONLINE',
  'theLetter',
  'THE WALL STREET JOURNAL 日本版',
  'webスポルティーバ',
  'Wedge ONLINE PREMIUM',
  'WWDJAPAN',
  'YOUTRUST',
  'ほんのれん',
  'みんかぶプレミアム',
  'Branc(ブラン)',
  'レスポンス',
  '決算が読めるようになるノート',
  'Harvard Health(ガリレオ社用)',
  'The New York Times Opinion(ガリレオ社用)',
  'Worldcrunch(ガリレオ社用)',
  'コルク',
  'SLUGGER',
  'サッカーダイジェストWeb',
  'シャドーイングバディ',
  'The Japan Times Alpha',
  'The Japan Times Alpha（英語学習法）',
  'ジャパンタイムズ出版',
  'ダイヤモンド・プレミアム(インフォグラフィック用)',
  'ダイヤモンド・プレミアム',
  'バロンズ・ダイジェスト',
  'ビズリーチ',
  'マネーポストWEBプレミアム',
  '婦人画報&美しいキモノプレミアム',
  'ブレーン',
  '宣伝会議',
  '広報会議',
  '販促会議',
  '日刊ゲンダイDIGITAL',
  'PRESIDENT(インフォグラフィック用)',
  'PRESIDENT',
  'プレジデントオンラインアカデミー(インフォグラフィック用)',
  'プレジデントオンラインアカデミー',
  '毎日新聞「経済プレミア」',
  '週刊エコノミスト(フィード版)',
  '現代ビジネスプレミアム(新フィード版)',
  '週刊ベースボールONLINE',
  '週刊文春 電子版',
  '総合情報誌「選択」',
  '集英社オンライン(フィード版)',
  '集英社オンライン'
];

async function getAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    console.log('Using OAuth2 refresh token authentication.');
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    return oAuth2Client;
  }

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const creds = JSON.parse(serviceAccountJson);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
  }

  throw new Error(
    'Missing Google authentication configuration. Set either GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.'
  );
}

async function uploadToDrive(filePath, fileName) {
  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: fs.createReadStream(filePath)
    },
    fields: 'id'
  });
  console.log(`Uploaded: ${fileName} (${response.data.id})`);
}

function sanitizeFilename(name) {
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

async function applyPublisherFilterInFrame(frame, publisher) {
  // The "publisher" control starts out collapsed as a button labeled
  // "publisher" with a "▼" dropdown arrow (aria-label "Open data control
  // menu"). Clicking it expands a checkbox-list table with a search box
  // (class "search-bar"). Typing a name filters the rows, and hovering a
  // row reveals an "only this item" link (class "only") that isolates the
  // filter to that single row. The runner renders the UI in English while
  // local runs render Japanese, so target these structural classes instead
  // of the localized placeholder/link text.
  const controlButton = frame.locator('button.lego-control').filter({ hasText: 'publisher' }).first();
  if (await controlButton.count() === 0) {
    return false;
  }
  await controlButton.click();

  const searchInput = frame.locator('.search-bar input').first();
  try {
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return false;
  }

  await searchInput.click();
  await searchInput.fill('');
  await searchInput.fill(publisher);
  // Let the list re-render after the search/debounce.
  await frame.waitForTimeout(1000);

  // Use an exact text match so substrings like "PRESIDENT" don't
  // accidentally match "PRESIDENT(インフォグラフィック用)".
  const row = frame.getByText(publisher, { exact: true }).first();
  if (await row.count() === 0) {
    console.log(`Row not found in publisher list for: ${publisher}`);
    return false;
  }

  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await frame.waitForTimeout(300);

  const onlyThisItem = frame.locator('span.only').first();
  if (await onlyThisItem.count() === 0) {
    console.log(`"only this item" link not found for: ${publisher}`);
    return false;
  }

  await onlyThisItem.click({ force: true });

  // The open dropdown overlay covers the dashboard, so the control button
  // itself is no longer clickable to close it — press Escape instead. Give
  // the dashboard time to recompute its charts/tables against the new
  // filter before the page is captured as a PDF.
  await frame.locator('body').press('Escape');
  await frame.waitForTimeout(2000);

  console.log(`Filter applied via frame (${frame.url()}) for: ${publisher}`);
  return true;
}

async function applyPublisherFilter(page, publisher) {
  // page.frames() already includes the main frame.
  const frames = page.frames();
  console.log(`Checking ${frames.length} frame(s) for publisher filter...`);

  for (const frame of frames) {
    try {
      const applied = await applyPublisherFilterInFrame(frame, publisher);
      if (applied) {
        return true;
      }
    } catch (e) {
      console.log(`Error applying filter in frame (${frame.url()}): ${e.message}`);
    }
  }

  console.log(`Filter not found for: ${publisher}`);
  return false;
}

async function downloadReportPdfViaMenu(page, publisher) {
  // Instead of screenshotting the live dashboard with page.pdf() (which
  // captures the surrounding chrome — rebranding banner, toolbar, page-list
  // sidebar — and forces the report table to reflow into a narrower space),
  // use Data Studio's own "Download report" feature. It renders the report
  // canvas only, server-side, exactly as the report owner intends. This is
  // the "共有" (Share) split-button's "More options" (▼) menu, then
  // "Download report" (Japanese UI: "レポートをダウンロード").
  const moreOptionsButton = page.locator('button[aria-label="More options"]').first();
  await moreOptionsButton.waitFor({ state: 'visible', timeout: 15000 });
  await moreOptionsButton.click();
  console.log('Clicked "More options" button.');

  await page.screenshot({ path: path.join('/tmp', `${sanitizeFilename(publisher)}.menu-open.debug.png`), fullPage: true });

  // The menu item text differs by locale ("Download report" / "レポートを
  // ダウンロード"), so match on the underlying menu item structure instead
  // via role, which Playwright can select on the accessible name across
  // locales isn't reliable here, so fall back to a regex covering both.
  const downloadMenuItem = page.getByRole('menuitem', { name: /download report|レポートをダウンロード/i }).first();
  await downloadMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Found "Download report" menu item.');

  await downloadMenuItem.click();
  console.log('Clicked "Download report" menu item, waiting for the "Download Report (PDF)" dialog...');

  // Clicking the menu item doesn't download directly — it opens a
  // confirmation dialog ("Download Report (PDF)", with All Pages/Select
  // Pages options) that needs its own "Download" button clicked before the
  // actual file download starts.
  const confirmDownloadButton = page.locator('button[data-test-id="download-button"]').first();
  await confirmDownloadButton.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Found dialog\'s "Download" button.');

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await confirmDownloadButton.click();
  console.log('Clicked dialog\'s "Download" button, waiting for the download to start...');

  const download = await downloadPromise;

  const filePath = path.join('/tmp', `${sanitizeFilename(publisher)}.pdf`);
  await download.saveAs(filePath);
  return filePath;
}

async function downloadPublisherPdf(page, publisher) {
  console.log(`Opening report for ${publisher}...`);
  // Looker Studio dashboards keep background network activity going
  // indefinitely (polling, streaming charts, etc.), so 'networkidle'
  // never resolves and always times out. Use 'load' instead, and give
  // the dashboard extra time afterward to finish rendering.
  await page.goto(REPORT_URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(8000);

  const filterApplied = await applyPublisherFilter(page, publisher);

  if (!filterApplied) {
    const debugPath = path.join('/tmp', `${sanitizeFilename(publisher)}.debug.png`);
    await page.screenshot({ path: debugPath, fullPage: true });
    const htmlPath = path.join('/tmp', `${sanitizeFilename(publisher)}.debug.html`);
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    console.log(`Saved debug files: ${debugPath}, ${htmlPath}`);
    throw new Error(`Could not apply publisher filter for: ${publisher}`);
  }

  await page.waitForTimeout(1200);

  const fileName = `${sanitizeFilename(publisher)}.pdf`;
  const filePath = await downloadReportPdfViaMenu(page, publisher);
  return { filePath, fileName };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // acceptDownloads defaults to true in modern Playwright, but set it
  // explicitly since downloadReportPdfViaMenu() now relies on catching a
  // 'download' event from Data Studio's "Download report" menu item.
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1024 });

  try {
    for (const publisher of publishers) {
      let lastError;
      let succeeded = false;
      for (let attempt = 1; attempt <= 2 && !succeeded; attempt++) {
        try {
          const { filePath, fileName } = await downloadPublisherPdf(page, publisher);
          await uploadToDrive(filePath, fileName);
          if (!process.env.KEEP_LOCAL_PDF) {
            fs.unlinkSync(filePath);
          }
          succeeded = true;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            console.warn(`Attempt ${attempt} failed for ${publisher}: ${error.message}. Retrying...`);
          }
        }
      }
      if (!succeeded) {
        console.error(`Failed for ${publisher}: ${lastError.message}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
