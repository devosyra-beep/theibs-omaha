'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || `../validacao/opponent-inputs-${stamp}`);
fs.mkdirSync(out, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-opponent-inputs-'));
Object.assign(process.env, {
  THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
  THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'),
  THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'),
  THEIBS_LLM_PROVIDER: 'none'
});
const { server } = require('../server');
const pool = require('../src/analysis-worker');
const report = { version: require('../package.json').version, execution: 'LOCAL_BROWSER_REAL_HTTP', status: 'RUNNING', checks: [], errors: [], output: out };
let browser, page;
const state = () => page.evaluate(() => theibsApp.getState());
const input = () => page.evaluate(() => theibsApp.getAnalysisInput());
const snapshot = () => page.evaluate(() => theibsOpponentInputs.snapshot());
async function check(name, run) { await run(); report.checks.push({ name, status: 'PASS' }); console.log('PASS', name); }
async function open() { await page.locator('#open-opponent-inputs').click(); }
async function close() { await page.locator('#settings-dialog [data-close-dialog]').click(); }
async function analyze() {
  const response = page.waitForResponse(result => result.url().endsWith('/api/analyze'));
  await page.locator('#quick-analyze').click();
  const result = await (await response).json();
  await page.waitForFunction(() => !theibsApp.getState().analysisBusy && theibsApp.getState().lastAnalysis?.data?.status === 'OK');
  return result;
}

(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    report.browser = browser.version();
    page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);
    await page.waitForFunction(() => Boolean(window.theibsApp));
    await page.evaluate(() => theibsApp.ready);
    await page.evaluate(() => {
      document.getElementById('auto-analysis').checked = false;
      document.getElementById('samples').value = '500';
      theibsCardKeyboard.restore({ count: 5, slots: ['AE', 'KE', 'QC', 'JC', 'TO', null, null, null, null, null], selected: 5 });
      theibsCardPicker.close();
    });
    await page.locator('#open-settings').click();
    await page.locator('#mw-setup-details').evaluate(element => { element.open = true; });
    await page.locator('#mw-player-count').selectOption('3');
    await page.locator('#mw-hero-position').selectOption('SB');
    await page.locator('#mw-start').click();
    await page.waitForFunction(() => !theibsApp.getState().multiwayBusy && Boolean(theibsApp.getState().multiwayState));
    if ((await state()).multiwayState.actor !== (await state()).multiwayState.heroId) {
      assert.ok((await state()).multiwayState.legal.actions.includes('CALL'), 'the first opponent can call the blind');
      await page.locator('[data-mw-command="call"]').click();
    }
    await page.waitForFunction(() => !theibsApp.getState().multiwayBusy && theibsApp.getState().multiwayState?.actor === theibsApp.getState().multiwayState?.heroId);

    await check('Quick analysis exposes equity inputs only; seat-specific opponent editor is available in Multiway', async () => {
      assert.equal(await page.locator('#open-opponent-inputs').isVisible(), true);
      const payload = await input();
      assert.equal(payload.multiway.enabled, true);
      assert.deepEqual(payload.opponentOverrides, []);
      assert.equal(payload.unknownOpponentModel, 'UNIFORM');
      const result = await analyze();
      assert.equal(result.status, 'OK');
      assert.equal(result.equity.opponents, 2);
      assert.equal((await state()).lastAnalysis.data.status, 'OK');
    });

    await check('Applying a range and call hypothesis affects only the selected physical seat', async () => {
      await open();
      await page.locator('#opponent-seat').selectOption('1');
      await page.locator('#opponentRange').fill('AP KP QP JP TP');
      await page.locator('#opponent-call-probability').fill('70');
      await page.locator('#opponent-apply').click();
      assert.deepEqual((await input()).opponentOverrides, [{ seatId: 1, enabled: true, range: { hands: [['Ac', 'Kc', 'Qc', 'Jc', 'Tc']] }, callProbability: .7 }]);
      assert.match(await page.locator('#opponent-input-list').innerText(), /ADV\. 1 · BB: range manual; call 70%/);
      await close();
      const result = await analyze();
      assert.equal(result.status, 'OK');
      assert.equal(result.equity.opponents, 2);
    });

    await check('Unapplied drafts survive switching seats without entering the calculation', async () => {
      const before = await input();
      await open();
      await page.locator('#opponentRange').fill('AP KP QP JP 9P');
      await page.locator('#opponent-call-probability').fill('81');
      await page.locator('#opponent-seat').selectOption('2');
      assert.equal(await page.locator('#opponentRange').inputValue(), '');
      assert.equal(await page.locator('#opponent-call-probability').inputValue(), '');
      await page.locator('#opponent-seat').selectOption('1');
      assert.equal(await page.locator('#opponentRange').inputValue(), 'AP KP QP JP 9P');
      assert.equal(await page.locator('#opponent-call-probability').inputValue(), '81');
      assert.deepEqual((await input()).opponentOverrides, before.opponentOverrides);
      await close();
    });

    await check('Invalid or unapplied text never replaces active assumptions', async () => {
      const before = await input();
      await open();
      await page.locator('#opponentRange').fill('invalid');
      await page.locator('#opponent-call-probability').fill('99');
      assert.deepEqual((await input()).opponentOverrides, before.opponentOverrides);
      await page.locator('#opponent-apply').click();
      assert.deepEqual((await input()).opponentOverrides, before.opponentOverrides);
      assert.equal(await page.locator('#opponent-input-message.warning-text').count(), 1);
      await close();
    });

    await check('Removing a hypothesis restores the unknown-hand model', async () => {
      await open();
      await page.locator('#opponent-seat').selectOption('1');
      await page.locator('#opponent-remove').click();
      assert.deepEqual((await input()).opponentOverrides, []);
      assert.match(await page.locator('#opponent-input-scope').innerText(), /mãos legais aleatórias/);
      await close();
    });

    await check('Applied assumptions persist on reload and reset with a new hand', async () => {
      await open();
      for (const [seat, rate] of [['1', '60'], ['2', '20']]) {
        await page.locator('#opponent-seat').selectOption(seat);
        await page.locator('#opponent-call-probability').fill(rate);
        await page.locator('#opponent-apply').click();
      }
      await close();
      await page.evaluate(() => theibsApp.flushSave());
      await page.waitForFunction(() => !theibsApp.getState().saveBusy && !theibsApp.getState().saveDirty);
      await page.reload();
      await page.waitForFunction(() => Boolean(window.theibsApp));
      await page.evaluate(() => theibsApp.ready);
      assert.deepEqual((await input()).opponentOverrides, [
        { seatId: 1, enabled: true, callProbability: .6 },
        { seatId: 2, enabled: true, callProbability: .2 }
      ]);
      await page.locator('#new-hand').click();
      assert.equal(await page.locator('#mw-position-prompt').isVisible(), true);
      await page.locator('#mw-hero-position').selectOption('SB');
      await page.locator('#mw-start').click();
      await page.waitForFunction(() => !theibsApp.getState().multiwayBusy && theibsApp.getState().multiway?.events.length === 0);
      assert.deepEqual((await snapshot()).opponents, []);
    });

    await check('Folded seats lose their hypothesis; undo restores the seat without silently restoring it', async () => {
      await open();
      await page.locator('#opponent-seat').selectOption('1');
      await page.locator('#opponent-call-probability').fill('60');
      await page.locator('#opponent-apply').click();
      await close();
      if ((await state()).multiwayState.actor !== (await state()).multiwayState.heroId) {
        await page.locator('[data-mw-command="call"]').click();
        await page.waitForFunction(() => !theibsApp.getState().multiwayBusy && theibsApp.getState().multiwayState.actor === theibsApp.getState().multiwayState.heroId);
      }
      await page.locator('[data-mw-command="aggressive"]').click();
      await page.locator('#mw-size').fill('3');
      await page.locator('#mw-size-confirm').click();
      await page.waitForFunction(() => !theibsApp.getState().multiwayBusy && theibsApp.getState().multiwayState.actor === 1);
      const before = (await state()).multiway.events.length;
      await page.locator('[data-multiway-player="1"]').click();
      assert.equal(await page.locator('#mw-seat-fold').isEnabled(), true, 'the big blind now owes chips after the observed raise');
      await page.locator('#mw-seat-fold').click();
      await page.waitForFunction(count => theibsApp.getState().multiway.events.length === count + 1 && !theibsApp.getState().multiwayBusy, before);
      assert.deepEqual((await snapshot()).opponents, []);
      await page.locator('#mw-undo').click();
      await page.waitForFunction(count => theibsApp.getState().multiway.events.length === count - 1 && !theibsApp.getState().multiwayBusy, before + 1);
      assert.deepEqual((await snapshot()).opponents, []);
      await open();
      assert.equal(await page.locator('#opponent-seat option[value="1"]').count(), 1);
      await close();
    });

    await check('Opponent editor remains usable at 390px without horizontal overflow', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open();
      assert.equal(await page.locator('#opponent-apply').isVisible(), true);
      const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(size.scroll <= size.client + 2, JSON.stringify(size));
      await page.screenshot({ path: path.join(out, 'opponent-mobile.png') });
      await close();
    });

    assert.deepEqual(report.errors, []);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1;
    await page?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser?.close(); await pool.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
