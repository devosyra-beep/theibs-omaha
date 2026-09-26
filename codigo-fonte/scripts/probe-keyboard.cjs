'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-keyboard-probe-'));
  process.env.THEIBS_DATA_PATH = path.join(temp, 'events.jsonl');
  process.env.THEIBS_WORKSPACE_PATH = path.join(temp, 'workspace.json');
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => theibsApp.ready);
    const snapshot = () => page.evaluate(() => ({
      slots: theibsCardKeyboard.state.slots,
      selected: theibsCardKeyboard.state.selected,
      focus: document.activeElement.dataset.slot ?? document.activeElement.id,
      status: document.querySelector('#keyboard-status').textContent
    }));
    await page.locator('[data-slot="0"]').click();
    await page.keyboard.type('de');
    console.log('D+E:', await snapshot());
    await page.evaluate(() => theibsCardKeyboard.reset());
    await page.locator('[data-slot="0"]').click();
    await page.keyboard.press('Tab');
    await page.keyboard.type('ae');
    console.log('Tab to second slot, then A+E:', await snapshot());
    await page.locator('.controls-panel').last().locator('summary').click();
    await page.locator('#assumeNoRake').check();
    await page.keyboard.type('kc');
    console.log('Checkbox then K+C:', await snapshot());
    await page.evaluate(() => theibsApp.flushSave());
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
