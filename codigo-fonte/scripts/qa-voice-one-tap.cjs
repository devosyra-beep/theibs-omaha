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
          stop() { this.stopped = true; this.onend?.(); }
          abort() { this.aborted = true; setTimeout(() => this.onend?.(), 200); }
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/app`);
      await page.evaluate(() => theibsApp.ready);
      await page.evaluate(() => { document.querySelector('#auto-analysis').checked = false; theibsCardKeyboard.reset(); });
      await page.waitForTimeout(200);
      const disclosure = page.locator('#card-voice-disclosure');
      const summary = disclosure.locator('summary').first();
      const badge = page.locator('#voice-capture-state');
      const toggle = page.locator('#voice-consent');
      assert.equal(await disclosure.evaluate(element => element.open), false);
      assert.equal(await badge.isVisible(), true);
      assert.match(await badge.innerText(), /Voice off/);
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await page.evaluate(() => __asr.length), 0);
      await summary.click();
      await page.locator('.voice-advanced>summary').click();
      await page.locator('#voice-language').selectOption('en-US');
      assert.match(await summary.innerText(), /Voice input · EN-US/);
      assert.match(await badge.innerText(), /Voice off/);
      assert.equal(await page.locator('[data-voice-language-guide="pt-BR"]').evaluate(element => element.hidden), true);
      assert.equal(await page.locator('[data-voice-language-guide="en-US"]').evaluate(element => element.hidden), false);
      assert.match(await page.locator('[data-voice-language-guide="en-US"]').textContent(), /my cards, ace of spades/);
      await page.locator('#voice-language').selectOption('pt-BR');
      assert.match(await summary.innerText(), /Voice input · PT-BR/);
      assert.equal(await page.locator('[data-voice-language-guide="pt-BR"]').evaluate(element => element.hidden), false);
      assert.equal(await page.locator('[data-voice-language-guide="en-US"]').evaluate(element => element.hidden), true);
      assert.match(await page.locator('[data-voice-language-guide="pt-BR"]').textContent(), /minhas cartas, ás de espadas/);
      await page.locator('.voice-advanced>summary').click();
      await toggle.check();
      await page.waitForFunction(() => theibsCardVoice.getStatus().audioReady, null, { timeout: 5000 });
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await page.evaluate(() => __asr.length), 1);
      assert.equal(await page.evaluate(() => __asr[0].startedInGesture), true);
      assert.match(await badge.innerText(), /Listening/);
      await summary.click();
      assert.equal(await disclosure.evaluate(element => element.open), false);
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().listening), true);
      assert.equal(await page.evaluate(() => __asr.length), 1);
      assert.equal(await page.evaluate(() => Boolean(__asr[0].aborted)), false);
      assert.match(await badge.innerText(), /Listening/);
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
      await page.waitForFunction(() => document.querySelector('#voice-capture-state').dataset.state === 'recognized');
      assert.equal(await badge.isVisible(), true);
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await disclosure.evaluate(element => element.open), true);
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().listening), true);
      await summary.click();
      assert.equal(await disclosure.evaluate(element => element.open), false);
      assert.equal(await page.evaluate(() => __asr.length), 1);
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
      const beforeSelection = await page.evaluate(() => __asr.length);
      await page.locator('[data-slot="3"]').first().click();
      await page.waitForFunction(previous => __asr.length === previous + 1 && theibsCardVoice.getStatus().audioReady, beforeSelection);
      assert.equal(await toggle.isChecked(), true);
      const beforeLateFinal = await page.evaluate(() => theibsCardKeyboard.state.snapshot().slots[3]);
      await page.evaluate(index => {
        __asr[index].onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'ás de espadas' }], { isFinal: true })] });
      }, beforeSelection - 1);
      assert.equal(await page.evaluate(() => theibsCardKeyboard.state.snapshot().slots[3]), beforeLateFinal);
      const beforeNavigation = await page.evaluate(() => __asr.length);
      await page.evaluate(() => theibsApp.showView('history', false));
      await page.waitForFunction(() => theibsCardVoice.getStatus().blocked);
      assert.equal(await toggle.isChecked(), true);
      await page.evaluate(() => theibsApp.showView('analyze', false));
      await page.waitForFunction(previous => __asr.length === previous + 1 && theibsCardVoice.getStatus().audioReady, beforeNavigation);
      assert.equal(await toggle.isChecked(), true);
      await summary.click();
      await toggle.uncheck();
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().listening), false);
      assert.equal(await page.evaluate(() => __asr.at(-1).stopped), true);
      assert.match(await badge.innerText(), /Voice off/);
      const afterStop = await page.evaluate(() => __asr.length);
      await page.waitForTimeout(650);
      assert.equal(await page.evaluate(() => __asr.length), afterStop);
      await page.locator('.voice-advanced>summary').click();
      await page.locator('#voice-language').selectOption('en-US');
      await page.locator('.voice-advanced>summary').click();
      await toggle.check();
      await page.waitForFunction(previous => __asr.length === previous + 1 && theibsCardVoice.getStatus().audioReady, afterStop);
      await summary.click();
      await emit(['ace of spades']);
      await page.waitForFunction(() => theibsCardKeyboard.state.snapshot().slots.includes('AE'));
      assert.match(await badge.innerText(), /Recognized/);
      await summary.click();
      await toggle.uncheck();
      await page.locator('.voice-advanced>summary').click();
      await page.locator('#voice-language').selectOption('pt-BR');
      await page.locator('.voice-advanced>summary').click();
      const afterEnglishStop = await page.evaluate(() => __asr.length);
      await toggle.check();
      await page.waitForFunction(previous => __asr.length === previous + 1 && theibsCardVoice.getStatus().audioReady, afterEnglishStop);
      await summary.click();
      await page.evaluate(() => __asr.at(-1).onerror?.({ error: 'audio-capture' }));
      assert.equal(await disclosure.evaluate(element => element.open), false);
      assert.match(await badge.innerText(), /Voice error/);
      assert.equal(await toggle.isChecked(), true);
      await page.waitForFunction(previous => __asr.length === previous + 2 && theibsCardVoice.getStatus().audioReady, afterEnglishStop);
      assert.equal(await disclosure.evaluate(element => element.open), false);
      assert.match(await badge.innerText(), /Listening/);
      await page.evaluate(() => __asr.at(-1).onerror?.({ error: 'network' }));
      assert.equal(await toggle.isChecked(), true);
      await page.waitForFunction(previous => __asr.length === previous + 3 && theibsCardVoice.getStatus().audioReady, afterEnglishStop);
      await page.evaluate(() => __asr.at(-1).onerror?.({ error: 'not-allowed' }));
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await disclosure.evaluate(element => element.open), false);
      assert.match(await badge.innerText(), /Permission denied/);
      assert.equal(await badge.isVisible(), true);
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().blocked), true);
      const deniedRecognitions = await page.evaluate(() => __asr.length);
      await page.waitForTimeout(1300);
      assert.equal(await page.evaluate(() => __asr.length), deniedRecognitions);
      await summary.click();
      await toggle.uncheck();
      assert.match(await badge.innerText(), /Voice off/);
      assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().enabled), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      cases.push({ width, activation: 'one checkbox tap', disclosureClosed: 'same capture keeps listening and applies commands', keyboardReopen: 'same capture keeps listening', recognized: 'visible while closed', locales: 'PT and EN guides and spoken commands', invalidAndDuplicate: 'ignored while listening', correctedCards: 'applied', fullCardAfterIncomplete: 'applied', spokenUndo: 'stays listening', noMatchAndSilence: 'restarted while enabled', selection: 'rebound without disabling or late final', navigation: 'paused and resumed without disabling', stop: 'only explicit off remains stopped', microphoneError: 'visible while closed and recoverable', networkError: 'recoverable without disabling', deniedPermission: 'visible while closed and blocked', horizontalOverflow: false });
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
