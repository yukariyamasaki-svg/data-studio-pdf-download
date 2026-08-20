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
// then scrolls the (likely virtualized) list a few times before capturing.
//
// 2026-08-2X update: a first round of fixes based on eyeballing screenshots
// (guessing "half-width space + full-width parens") did NOT fix 13 of the
// 17 publishers — they still fail with "Row not found". Eyeballing a
// screenshot cannot reliably distinguish half-width vs full-width spaces or
// other invisible characters. This version instead reads each row's exact
// text via its `aria-label` attribute directly from the DOM (not OCR'd from
// a screenshot) and dumps both the raw string and its Unicode code points,
// so mismatches like U+0020 (half-width space) vs U+3000 (full-width space)
// are unambiguous.
const REPORT_URL = 'https://datastudio.google.com/u/0/reporting/6ab590f1-9fad-4bdb-8336-cd145cfbb35f/page/vnXDE';

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

      // Collect every row's exact text via its checkbox's aria-label,
      // scrolling the (virtualized) list repeatedly so later rows get
      // rendered into the DOM and captured too. Using a Map keyed by the
      // label text automatically de-dupes rows seen across multiple
      // scroll positions.
      const collected = new Map();
      const collectNow = async () => {
        const labels = await frame.evaluate(() =>
          Array.from(document.querySelectorAll('md-checkbox[aria-label]'))
            .map(el => el.getAttribute('aria-label'))
            .filter(Boolean)
        );
        for (const label of labels) {
          if (!collected.has(label)) {
            collected.set(label, codePointsOf(label));
          }
        }
      };

      await collectNow();
      for (let i = 0; i < 10; i++) {
        await frame.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('div'))
            .filter(el => el.scrollHeight > el.clientHeight + 20);
          for (const el of candidates) {
            el.scrollTop = el.scrollTop + 400;
          }
        });
        await frame.waitForTimeout(400);
        await collectNow();
        await page.screenshot({ path: `/tmp/publisher-list-scroll-${i + 1}.debug.png`, fullPage: true });
      }

      const entries = Array.from(collected.entries()).map(([label, codePoints]) => ({ label, codePoints }));
      console.log(`Collected ${entries.length} unique publisher label(s).`);
      fs.writeFileSync('/tmp/publisher-list.json', JSON.stringify(entries, null, 2), 'utf8');
      // Also a plain-text version that's easy to skim/grep.
      fs.writeFileSync(
        '/tmp/publisher-list.txt',
        entries.map(e => `${e.label}\n  ${e.codePoints}`).join('\n\n'),
        'utf8'
      );

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
    console.log('Saved /tmp/publisher-list.json, /tmp/publisher-list.txt, /tmp/publisher-list-1.debug.png, and /tmp/publisher-list-scroll-*.debug.png');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
