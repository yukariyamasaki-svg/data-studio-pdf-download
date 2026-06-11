const puppeteer = require('puppeteer-core');
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

// Authentication fallback:
// 1) Use GOOGLE_SERVICE_ACCOUNT_JSON for service account access.
// 2) Otherwise use OAuth2 refresh token with GOOGLE_CLIENT_ID,
//    GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.
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

async function downloadPublisherPdf(browser, publisher) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1024 });

  console.log(`Opening report for ${publisher}...`);
  await page.goto(REPORT_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log(`Page loaded: ${page.url()} (${page.frames().length} frames)`);

  // ========== カスタムのフィルタ操作 ==========
  // 汎用フィルタ適用ロジック: 見つかれば publisher を指定して絞り込みます。
  async function applyPublisherFilter(page, publisher) {
    // Helper: try selector on page or within frames
    async function trySelectors(root) {
      const inputSelectors = [
        'input[aria-label*="Publisher"]',
        'input[placeholder*="Publisher"]',
        'input[aria-label*="媒体"]',
        'input[placeholder*="媒体"]',
        'input[type="search"]',
        'input'
      ];
      for (const sel of inputSelectors) {
        try {
          const el = await root.$(sel);
          if (el) {
            await el.click({ clickCount: 3 }).catch(() => {});
            await el.type(publisher, { delay: 50 }).catch(() => {});
            await root.keyboard.press('Enter').catch(() => {});
            return true;
          }
        } catch (e) {
          // continue
        }
      }
      return false;
    }

    // 1) try on main page
    try {
      if (await trySelectors(page)) return true;
    } catch (e) {
      console.log('trySelectors page failed:', e.message);
    }

    // 2) try within frames
    try {
      const frames = page.frames();
      console.log('Frame URLs:', frames.map((f) => f.url()).slice(0, 10));
      for (const f of frames) {
        try {
          if (await trySelectors(f)) return true;
        } catch (e) {
          // continue
        }
      }
    } catch (e) {
      console.log('Frame enumeration failed:', e.message);
    }

    // 3) try clicking filter-like buttons then selecting text
    try {
      const candidateButtons = await page.$$('button, div[role="button"], [role="button"]');
      const buttonTexts = [];
      for (const btn of candidateButtons) {
        const text = (await (await btn.getProperty('innerText')).jsonValue() || '').trim();
        if (text) buttonTexts.push(text);
        if (/filter|フィルタ|絞り|媒体|publisher/i.test(text)) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(700);
          // look for item containing publisher
          const handles = await page.$x(`//*[contains(normalize-space(.), "${publisher}")]`);
          if (handles.length) {
            await handles[0].click().catch(() => {});
            await page.waitForTimeout(1200);
            return true;
          }
        }
      }
      if (buttonTexts.length) {
        console.log('Candidate button texts:', buttonTexts.slice(0, 30));
      }
    } catch (e) {
      console.log('Filter candidate button search failed:', e.message);
    }

    return false;
  }

  const filterApplied = await applyPublisherFilter(page, publisher);
  if (!filterApplied) {
    console.log(`Filter not applied for ${publisher} — saving debug screenshot/html`);
    try {
      const debugPath = path.join('/tmp', `${sanitizeFilename(publisher)}.debug.png`);
      await page.screenshot({ path: debugPath, fullPage: true });
      const htmlPath = path.join('/tmp', `${sanitizeFilename(publisher)}.debug.html`);
      const html = await page.content();
      fs.writeFileSync(htmlPath, html, 'utf8');
      console.log(`Saved debug files: ${debugPath}, ${htmlPath}`);
    } catch (e) {
      console.log('Failed to write debug files:', e.message);
    }
  } else {
    console.log(`Filter applied for ${publisher}`);
    await page.waitForTimeout(1200);
  }
  // =======================================

  // 画面全体をPDF化
  const fileName = `${sanitizeFilename(publisher)}.pdf`;
  const filePath = path.join('/tmp', fileName);
  await page.pdf({ path: filePath, format: 'A4', printBackground: true });
  await page.close();
  return { filePath, fileName };
}

async function launchBrowser() {
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  return puppeteer.launch(launchOptions);
}

async function main() {
  const browser = await launchBrowser();
  try {
    for (const publisher of publishers) {
      try {
        const { filePath, fileName } = await downloadPublisherPdf(browser, publisher);
        await uploadToDrive(filePath, fileName);
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`Failed for ${publisher}: ${error.message}`);
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
