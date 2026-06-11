const puppeteer = require('puppeteer-core');
const path = require('path');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 980, height: 1200, deviceScaleFactor: 2 });
  const filePath = path.join(__dirname, 'diagram.html');
  await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const body = await page.$('body');
  await body.screenshot({ path: path.join(__dirname, 'diagram.png') });
  await browser.close();
  console.log('保存しました: diagram.png');
}

main().catch(err => { console.error(err); process.exit(1); });
