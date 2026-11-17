const { chromium } = require('playwright');

let browser;
let idleTimer;
let queue = Promise.resolve();

async function closeBrowser() {
  clearTimeout(idleTimer);
  const current = browser;
  browser = null;
  if (current) await current.close();
}

// Use the site's normal browser/advertisement flow. Do not fabricate unlock
// tokens, alter advertisement state, or intercept protected responses.
function readRenderedKujiLot(url) {
  const task = queue.then(async () => {
    const target = new URL(url);
    if (target.origin !== 'https://kujimap.com' || !/^\/1bankuji\/1bankuji_\d{6}\/[^/]+\/?$/.test(target.pathname)) {
      throw new Error('허용되지 않은 수량 출처 주소입니다.');
    }
    clearTimeout(idleTimer);
    if (!browser?.isConnected()) {
      browser = await chromium.launch({
        headless: false,
        ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
        timeout: 20000
      });
    }
    const page = await browser.newPage();
    try {
      const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!response?.ok()) throw new Error(`쿠지맵 브라우저 응답 오류 (${response?.status()})`);
      const landed = new URL(page.url());
      if (landed.origin !== target.origin || landed.pathname.replace(/\/$/, '') !== target.pathname.replace(/\/$/, '')) {
        throw new Error('수량 출처 페이지가 변경되었습니다.');
      }
      return await page.locator('.entry-content table').filter({ hasText: /1\s*セット/ }).first().innerText({ timeout: 35000 });
    } finally {
      await page.close();
      idleTimer = setTimeout(() => { closeBrowser().catch(() => {}); }, 30000);
      idleTimer.unref();
    }
  });
  queue = task.catch(() => {});
  return task;
}

module.exports = { readRenderedKujiLot, closeBrowser };
