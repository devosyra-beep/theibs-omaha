'use strict';
// Mobile UI integration with controlled recognizer events. This verifies the
// activation flow, not speech acoustics or a physical phone microphone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-voice-one-tap-'));
Object.assign(process.env, {
  THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
  THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'),
  THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'),
  THEIBS_LLM_PROVIDER: 'none'
});

let server, pool, browser;
(async () => {
  try {
    ({ server } = require('../server'));
    pool = require('../src/analysis-worker');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const cases = [];
    for (const width of [320, 390, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__asr = [];
        window.SpeechRecognition = class {
          constructor() { window.__asr.push(this); }
          start() {
            this.startedInGesture = navigator.userActivation?.isActive ?? null;
            window.dispatchEvent(new Event('blur')); // Browser permission sheet.
            setTimeout(() => { this.onstart?.(); this.onaudiostart?.(); }, 25);
          }
          stop() { this.onend?.(); }
          abort() { this.aborted = true; this.onend?.(); }
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/app`);
      await page.evaluate(() => theibsApp.ready);
      await page.evaluate(() => { document.querySelector('#auto-analysis').checked = false; theibsCardKeyboard.reset(); });
      await page.waitForTimeout(200);
      const toggle = page.locator('#voice-consent');
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await page.evaluate(() => __asr.length), 0);
      await toggle.check();
      await page.waitForFunction(() => theibsCardVoice.getStatus().audioReady, null, { timeout: 5000 });
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await page.evaluate(() => __asr.length), 1);
      assert.equal(await page.evaluate(() => __asr[0].startedInGesture), true);
      assert.match(await page.locator('#voice-capture-state').innerText(), /Ouvindo/);
      await page.evaluate(() => {
        const result = Object.assign([{ transcript: 'oito de paus', confidence: .99 }], { isFinal: true });
        __asr[0].onresult?.({ resultIndex: 0, results: [result] });
      });
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots[0] === '8P');
      await toggle.uncheck();
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().listening), false);
      assert.equal(await page.evaluate(() => __asr[0].aborted), true);
      await toggle.check();
      await page.evaluate(() => __asr.at(-1).onerror?.({ error: 'not-allowed' }));
      assert.equal(await toggle.isChecked(), false);
      assert.match(await page.locator('#voice-capture-state').innerText(), /Permissão negada/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      cases.push({ width, activation: 'one checkbox tap', permissionBlur: 'kept pending', recognizedEvent: 'card applied', stop: 'passed', deniedPermission: 'visible and stopped', horizontalOverflow: false });
      await page.close();
    }
    console.log(JSON.stringify({ status: 'PASS', layer: 'CONTROLLED_ASR_EVENTS', browser: browser.version(), cases }));
  } finally {
    await browser?.close();
    await pool?.close();
    server?.closeAllConnections?.();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
