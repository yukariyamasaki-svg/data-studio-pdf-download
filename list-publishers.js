const { chromium } = require('playwright');
const fs = require('fs');

// One-off investigation script: open the report's "publisher" filter
// control *without* typing anything into its search box, and dump the
// resulting screenshot + HTML so we can read off the exact wording of
// every publisher option. A full 71-publisher run on main (2026-08-21)
// found that 17 publishers with parenthesized/symbol-heavy names (e.g.
// "現代ビジネスプレミアム(新フィード版)", "PRESIDENT(インフォグラフィック
// 用)") — plus two without parentheses ("コルク", "ONE CAREER PLUS") — all
// failed with "Row not found in publisher list", meaning the search box
// found zero matching rows for the exact string in script.js's `publishers`
// array. This script skips the search step entirely so every row renders,
// then scrolls the (likely virtualized) list a few times before capturing,
// so later rows aren't missed.
const REPORT_URL = 'https://datastudio.google.com/u/0/reporting/6ab590f1-9fad-4bdb-8336-cd145cfbb35f/page/vnXDE';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1024 });

  await page.goto(REPORT_URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(8000);

  const frames = page.frames();
  console.log(`Checking ${frames.length} frame(s) for publisher control...`);

  let found = false;
  for (const frame of frames) {
    try {
      const controlButton = frame.locator('button.lego-control').filter({ hasText: 'publisher' }).first();
      if (await controlButton.count() === 0) {
        continue;
      }
      await controlButton.click();

      const searchInput = frame.locator('.search-bar input').first();
      await searchInput.waitFor({ state: 'visible', timeout: 5000 });
      console.log(`Opened publisher control in frame: ${frame.url()}`);

      // Deliberately do NOT type into the search box, so the full,
      // unfiltered list renders.
      await frame.waitForTimeout(1500);
      await page.screenshot({ path: '/tmp/publisher-list-1.debug.png', fullPage: true });
      fs.writeFileSync('/tmp/publisher-list.debug.html', await frame.content(), 'utf8');

      // Scroll the list a handful of times in case it's virtualized /
      // lazily rendered, capturing a screenshot after each scroll so we can
      // see rows that were off-screen initially.
      for (let i = 0; i < 6; i++) {
        await frame.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('div'))
            .filter(el => el.scrollHeight > el.clientHeight + 20);
          for (const el of candidates) {
            el.scrollTop = el.scrollTop + 400;
          }
        });
        await frame.waitForTimeout(400);
        await page.screenshot({ path: `/tmp/publisher-list-scroll-${i + 1}.debug.png`, fullPage: true });
      }

      found = true;
      break;
    } catch (e) {
      console.log(`Error in frame (${frame.url()}): ${e.message}`);
    }
  }

  if (!found) {
    console.error('Could not open the publisher control in any frame.');
    await page.screenshot({ path: '/tmp/publisher-list-notfound.debug.png', fullPage: true });
    fs.writeFileSync('/tmp/publisher-list-notfound.debug.html', await page.content(), 'utf8');
    process.exitCode = 1;
  } else {
    console.log('Saved /tmp/publisher-list-1.debug.png, /tmp/publisher-list-scroll-*.debug.png, and /tmp/publisher-list.debug.html');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
