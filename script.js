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

async function getAuthClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error('Environment variable GOOGLE_SERVICE_ACCOUNT_JSON is missing');
  }
  const creds = JSON.parse(json);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
}

async function uploadToDrive(filePath, fileName) {
  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.create({
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

  // ========== カスタムのフィルタ操作 ==========
  // ここはData StudioレポートのフィルタUIに応じて調整が必要です
  // 例: テキスト入力フィールドにpublisher名を入れて絞り込む
  //
  // await page.click('selector-for-filter-input');
  // await page.type('selector-for-filter-input', publisher);
  // await page.keyboard.press('Enter');
  // await page.waitForTimeout(4000);
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
