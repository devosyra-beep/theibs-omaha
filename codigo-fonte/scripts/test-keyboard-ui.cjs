'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, _electron } = require('playwright');

(async () => {
  const report = { mode: process.argv.includes('--electron') ? 'Windows Electron packaged executable' : 'Windows Edge headless, real HTTP', checks: [], errors: [] };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-keyboard-test-'));
  process.env.THEIBS_DATA_PATH = path.join(temp, 'events.jsonl');
  process.env.THEIBS_WORKSPACE_PATH = path.join(temp, 'workspace.json');
  let server, browser, electron, page;
  const check = async (name, run) => { await run(); report.checks.push(name); console.log('PASS', name); };
  const state = () => page.evaluate(() => theibsCardKeyboard.state.snapshot());
  const reset = async () => {
    await page.evaluate(() => theibsCardKeyboard.reset());
    await page.locator('[data-slot="0"]').click();
  };
  try {
    if (process.argv.includes('--electron')) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      electron = await _electron.launch({
        executablePath: process.env.THEIBS_EXECUTABLE || path.resolve(__dirname, '../../THEIBS/THEIBS.exe'),
        args: ['--user-data-dir=' + path.join(temp, 'profile')], env, timeout: 20000
      });
      page = await electron.firstWindow({ timeout: 20000 });
    } else {
      ({ server } = require('../server'));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ headless: true, channel: 'msedge' });
      page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
    }
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.waitForFunction(() => Boolean(window.theibsApp), { timeout: 15000 });
    await page.evaluate(() => theibsApp.ready);
    await check('D / T / 10, lowercase and all four suits', async () => {
      await reset(); await page.keyboard.type('deTc10odp');
      assert.deepEqual((await state()).slots.slice(0, 4), ['TE', 'TC', 'TO', 'TP']);
    });
    await check('Tab selects the focused slot; auto-advance keeps focus aligned', async () => {
      await reset(); await page.keyboard.press('Tab'); await page.keyboard.type('ae');
      assert.deepEqual((await state()).slots.slice(0, 3), [null, 'AE', null]);
      assert.equal((await state()).selected, 2);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.slot), '2');
    });
    await check('settings block card shortcuts; closing restores card entry', async () => {
      await reset();
      await page.locator('#open-settings').click();
      await page.locator('#assumeNoRake').locator('xpath=ancestor::details[1]').locator('summary').click();
      await page.locator('#assumeNoRake').check(); await page.keyboard.type('kc');
      assert.equal((await state()).slots[0], null);
      await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.locator('[data-slot="0"]').click();await page.keyboard.type('kc');
      assert.equal((await state()).slots[0], 'KC');
    });
    await check('text fields and selects remain protected', async () => {
      const before = await state();
      await page.locator('#open-settings').click();
      await page.locator('#opponentHand').fill('de tc 10o dp ae');
      await page.locator('#settings-dialog [data-close-dialog]').click();
      await page.locator('#variant-select').focus(); await page.keyboard.type('de');
      assert.deepEqual(await state(), before);
    });
    await check('all 52 physical rank/suit combinations in PLO4, PLO5 and PLO6', async () => {
      for (const count of [4, 5, 6]) {
        await reset(); await page.locator('#variant-select').selectOption(String(count));
        for (const suit of 'ECOP') for (const rank of 'AKQJT98765432') {
          await reset(); await page.keyboard.type(rank.toLowerCase() + suit.toLowerCase());
          assert.equal((await state()).slots[0], rank + suit);
        }
      }
    });
    await check('fast mixed entry, numeric 10 and D/T do not drop cards', async () => {
      await reset(); await page.locator('#variant-select').selectOption('5');
      await page.locator('[data-slot="0"]').click();
      await page.keyboard.type('deTc10odpAE2e3c4o5p6e');
      assert.deepEqual((await state()).slots, ['TE','TC','TO','TP','AE','2E','3C','4O','5P','6E']);
    });
    await check('duplicate aliases are rejected, then a valid rank recovers', async () => {
      await reset(); await page.keyboard.type('de10e');
      assert.equal((await state()).slots.filter(Boolean).length, 1);
      assert.match(await page.locator('#keyboard-status').innerText(), /já está/);
      await page.keyboard.type('kc'); assert.equal((await state()).slots[1], 'KC');
    });
    await check('Backspace, Ctrl+Z, Delete, arrows and street shortcuts', async () => {
      await reset(); await page.keyboard.type('dekc');
      await page.keyboard.press('Control+z'); assert.equal((await state()).slots[1], null);
      await page.keyboard.type('tc'); await page.keyboard.press('Backspace'); assert.equal((await state()).slots[1], null);
      await page.keyboard.type('d'); await page.keyboard.press('Backspace'); assert.equal((await state()).slots[0], 'TE');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Delete'); assert.equal((await state()).slots[0], null);
      await page.keyboard.press('Control+z'); assert.equal((await state()).slots[0], 'TE');
      for (const [key, selected] of [['2',5], ['3',8], ['4',9], ['1',0]]) {
        await page.keyboard.press('Control+' + key); assert.equal((await state()).selected, selected);
      }
    });
    await check('mouse entry and physical keys share the same next slot', async () => {
      await reset(); await page.locator('[data-card="AE"]').click(); await page.keyboard.type('dc');
      assert.deepEqual((await state()).slots.slice(0, 2), ['AE', 'TC']);
    });
    await check('paste and manual text accept D, T and 10; duplicate paste is atomic', async () => {
      await reset(); await page.locator('#open-entry').click();
      await page.locator('#paste-cards').fill('de tc 10o dp ae'); await page.locator('#paste-apply').click();
      assert.deepEqual((await state()).slots.slice(0,5), ['TE','TC','TO','TP','AE']);
      const before = await state();
      await page.locator('#paste-cards').fill('2e 10e'); await page.locator('#paste-apply').click();
      assert.deepEqual(await state(), before);
      await page.locator('#heroCards').fill('dc te dp 10o ac');
      assert.deepEqual((await state()).slots.slice(0,5), ['TC','TE','TP','TO','AC']);
      assert.equal(await page.evaluate(() => theibsCardKeyboard.isManualInvalid()), false);
    });
    await check('real engine receives canonical tens and Portuguese suit conversion', async () => {
      await page.locator('#board').fill('2e 3c 4o 5p 6e');
      await page.locator('#entry-dialog [data-close-dialog]').click();
      await page.locator('#open-settings').click();
      await page.locator('#opponentHand').fill('7e 8c 9o jp qe');
      await page.locator('#players').fill('2');
      await page.locator('#settings-dialog [data-close-dialog]').click();
      const request = page.waitForRequest(req => req.url().endsWith('/api/analyze'));
      await page.locator('#quick-analyze').click();
      const data = (await request).postDataJSON();
      assert.deepEqual(data.heroCards, ['Th','Ts','Tc','Td','Ah']);
      await page.waitForFunction(() => !theibsApp.getState().analysisBusy);
      assert.equal(await page.evaluate(() => theibsApp.getState().lastAnalysis.data.status), 'OK');
    });
    await check('help and other views do not receive card shortcuts', async () => {
      const before = await state();
      await page.keyboard.press('F1'); await page.keyboard.type('de'); assert.deepEqual(await state(), before);
      assert.match(await page.locator('#help-dialog').innerText(), /D, T e 10/);
      await page.locator('#close-help').click();
      await page.locator('[data-view="train"]').click(); await page.keyboard.type('de'); assert.deepEqual(await state(), before);
      await page.locator('[data-view="analyze"]').click();
    });
    await check('saved draft restores after reload', async () => {
      const before = await state(); await page.evaluate(() => theibsApp.flushSave());
      await page.reload(); await page.evaluate(() => theibsApp.ready);
      assert.deepEqual(await state(), before);
    });
    await check('no JavaScript errors', () => assert.deepEqual(report.errors, []));
    await page.screenshot({ path: path.resolve(__dirname, '../../validacao/teclado-' + (electron ? 'electron' : 'edge') + '.png'), fullPage: true });
    await page.evaluate(() => theibsApp.flushSave());
  } catch (error) {
    report.failure = error.stack; throw error;
  } finally {
    fs.mkdirSync(path.resolve(__dirname, '../../validacao'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '../../validacao/teclado-' + (electron ? 'electron' : 'edge') + '.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    if (electron) {
      try { await electron.evaluate(({ app }) => app.exit(0)); } catch {}
      await electron.close();
    }
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
