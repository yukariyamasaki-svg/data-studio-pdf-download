const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

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

async function applyPublisherFilter(page, publisher) {
  // フレームも含めて input を探す
  const selectors = [
    'input[aria-label*="Publisher"]',
    'input[placeholder*="Publisher"]',
    'input[aria-label*="媒体"]',
    'input[placeholder*="媒体"]',
    'input[type="search"]',
    'input'
  ];

  // メインページ
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.fill(publisher);
      await page.keyboard.press('Enter');
      console.log(`Filter applied via main page: ${sel}`);
      return true;
    }
  }

  // iframe内
  const frames = page.frames();
  console.log(`Checking ${frames.length} frames...`);
  for (const frame of frames) {
    for (const sel of selectors) {
      try {
        const el = frame.locator(sel).first();
        if (await el.count() > 0) {
          await el.fill(publisher);
          await frame.locator('body').press('Enter');
          console.log(`Filter applied via frame (${frame.url()}): ${sel}`);
          return true;
        }
      } catch (e) {
        // continue
      }
    }
  }

  console.log(`Filter not found for: ${publisher}`);
  return false;
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
  } else {
    await page.waitForTimeout(1200);
  }

  const fileName = `${sanitizeFilename(publisher)}.pdf`;
  const filePath = path.join('/tmp', fileName);
  await page.pdf({ path: filePath, format: 'A4', printBackground: true });
  return { filePath, fileName };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
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
          fs.unlinkSync(filePath);
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
