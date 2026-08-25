const { chromium } = require('playwright');
const fs = require('fs');

// Targeted follow-up to list-publishers.js: that script tries to render the
// *entire* unfiltered publisher list by scrolling a virtualized table, which
// on 2026-08-24 failed outright ("Could not open the publisher control in
// any frame"), and even when it worked, scrolling might not reliably surface
// every row. Instead, for each of the 13 publishers still failing in
// production with "Row not found in publisher list", search for a short,
// unambiguous substring (e.g. "PRESIDENT" instead of the full parenthesized
// name) and dump the aria-label + Unicode code points of every row that
// matches. This reuses the same search box the production script searches
// with, so if a term doesn't match here, it won't match there either.
const REPORT_URL = 'https://datastudio.google.com/u/0/reporting/6ab590f1-9fad-4bdb-8336-cd145cfbb35f/page/vnXDE';

// Short substrings for the 13 publishers currently failing with "Row not
// found", plus the 3 disabled ones in case they show up under a shorter
// search term than their full name.
const SEARCH_TERMS = [
  'Economist',
  'NewsPicks',
  'nobico',
  'PHP',
  'Branc',
  'Harvard Health',
  'New York Times',
  'Worldcrunch',
  'ダイヤモンド',
  'PRESIDENT',
  'プレジデント',
  '現代ビジネス',
  '集英社',
  'ONE CAREER',
  'GOLD ONLINE',
  'コルク'
];

function codePointsOf(str) {
  return Array.from(str).map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1024 });

  await page.goto(REPORT_URL, { waitUntil: 'load', timeout: 90000 });
  // The report needs more warmup time than production's 8s wait before the
  // publisher control reliably exists in any frame — 8s intermittently
  // raced the dashboard's own load and produced a false "not found".
  await page.waitForTimeout(15000);

  const frames = page.frames();
  console.log(`Checking ${frames.length} frame(s) for publisher control...`);

  let targetFrame = null;
  for (const frame of frames) {
    const controlButton = frame.locator('button.lego-control').filter({ hasText: 'publisher' }).first();
    if (await controlButton.count() > 0) {
      targetFrame = frame;
      await controlButton.click();
      break;
    }
  }

  if (!targetFrame) {
    console.error('Could not open the publisher control in any frame.');
    await page.screenshot({ path: '/tmp/debug-remaining-notfound.debug.png', fullPage: true });
    fs.writeFileSync('/tmp/debug-remaining-notfound.debug.html', await page.content(), 'utf8');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const searchInput = targetFrame.locator('.search-bar input').first();
  await searchInput.waitFor({ state: 'visible', timeout: 5000 });

  const results = {};
  for (const term of SEARCH_TERMS) {
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.fill(term);
    await targetFrame.waitForTimeout(1000);

    const labels = await targetFrame.evaluate(() =>
      Array.from(document.querySelectorAll('md-checkbox[aria-label]'))
        .map(el => el.getAttribute('aria-label'))
        .filter(Boolean)
    );

    results[term] = labels.map(label => ({ label, codePoints: codePointsOf(label) }));
    console.log(`"${term}" -> ${labels.length} row(s): ${JSON.stringify(labels)}`);
  }

  fs.writeFileSync('/tmp/debug-remaining-publishers.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Saved /tmp/debug-remaining-publishers.json');

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
