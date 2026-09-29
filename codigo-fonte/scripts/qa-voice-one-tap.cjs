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
          abort() { this.aborted = true; setTimeout(() => this.onend?.(), 200); }
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
      const emit = parts => page.evaluate(parts => {
        const results = parts.map(text => Object.assign([{ transcript: text, confidence: .99 }], { isFinal: true }));
        __asr.at(-1).onresult?.({ resultIndex: results.length - 1, results });
      }, parts);
      await emit(['palavra confusa']);
      assert.equal(await page.evaluate(() => theibsCardKeyboard.state.snapshot().slots[0]), null);
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await page.evaluate(() => __asr.length), 1);
      await emit(['palavra confusa', 'oito de paus']);
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots[0] === '8P');
      await emit(['palavra confusa', 'oito de paus', 'oito de paus']);
      assert.equal(await page.evaluate(() => theibsCardKeyboard.state.snapshot().slots[1]), null);
      assert.equal(await toggle.isChecked(), true);
      await emit(['palavra confusa', 'oito de paus', 'oito de paus', 'rei de copas']);
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots[1] === 'KC');
      await emit(['palavra confusa', 'oito de paus', 'oito de paus', 'rei de copas', 'ás de']);
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().needsClarification), true);
      await emit(['palavra confusa', 'oito de paus', 'oito de paus', 'rei de copas', 'ás de', 'dama de ouros']);
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots[2] === 'QO');
      await emit(['palavra confusa', 'oito de paus', 'oito de paus', 'rei de copas', 'ás de', 'dama de ouros', 'desfazer']);
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots[2] === null);
      assert.equal(await toggle.isChecked(), true);
      await emit(['palavra confusa', 'oito de paus', 'oito de paus', 'rei de copas', 'ás de', 'dama de ouros', 'desfazer', 'dama de ouros']);
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots[2] === 'QO');
      await page.evaluate(() => __asr.at(-1).onnomatch?.());
      await page.waitForFunction(() => __asr.length === 2 && theibsCardVoice.getStatus().audioReady);
      assert.equal(await toggle.isChecked(), true);
      await page.evaluate(() => __asr.at(-1).onerror?.({ error: 'no-speech' }));
      await page.waitForFunction(() => __asr.length === 3 && theibsCardVoice.getStatus().audioReady);
      assert.equal(await toggle.isChecked(), true);
      await toggle.uncheck();
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().listening), false);
      assert.equal(await page.evaluate(() => __asr.at(-1).aborted), true);
      await toggle.check();
      await page.waitForFunction(() => __asr.length === 4 && theibsCardVoice.getStatus().audioReady);
      await page.evaluate(() => __asr.at(-1).onerror?.({ error: 'not-allowed' }));
      assert.equal(await toggle.isChecked(), false);
      assert.match(await page.locator('#voice-capture-state').innerText(), /Permissão negada/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      cases.push({ width, activation: 'one checkbox tap', invalidAndDuplicate: 'ignored while listening', correctedCards: 'applied', fullCardAfterIncomplete: 'applied', spokenUndo: 'stays listening', noMatchAndSilence: 'restarted while enabled', stop: 'passed', deniedPermission: 'visible and stopped', horizontalOverflow: false });
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
