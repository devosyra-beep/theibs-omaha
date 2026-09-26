'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-multiway-races-'));
  Object.assign(process.env, { THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
    THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm-config.json') });
  const version = require('../package.json').version;
  const out = path.resolve(__dirname, '../../validacao/multiway-races-v' + version);
  fs.mkdirSync(out, { recursive: true });
  const initial = { schemaVersion: 1,
    keyboard: { count: 5, selected: 0, slots: ['AE', 'KO', 'QC', 'JP', '9E', null, null, null, null, null] },
    fields: { players: '4', position: 'BTN', potBeforeAction: '12', amountToCall: '4', effectiveStack: '100', samples: '500', seed: '42', 'auto-analysis': false },
    ui: { felt: 'preto', deck: 'cores', view: 'analyze', cardDisplayVersion: 2, workflowVersion: 1, sidebarCollapsed: true }, snapshots: [] };
  fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH, JSON.stringify({ revision: 1, workspace: initial }));
  const report = { version, mode: 'EDGE_SOURCE_DELAYED_HTTP', workspace: temp, startedAt: new Date().toISOString(), checks: [], heldRequests: [], pageErrors: [] };
  let server, browser, page;
  const gates = [];
  const state = () => page.evaluate(() => theibsApp.getState());
  const cards = () => page.evaluate(() => theibsCardKeyboard.state.cards().hero.map(TheibsCards.toCanonical));
  const idle = () => page.waitForFunction(() => !theibsApp.getState().multiwayBusy && !theibsMultiwayUI.getState().busy);
  async function aligned() {
    const current = await state();
    assert.deepEqual(await cards(), current.multiway.config.heroCards, 'Visible private cards must equal the configuration used for analysis');
    assert.deepEqual(current.multiwayState.board, await page.evaluate(() => theibsCardKeyboard.state.cards().board.map(TheibsCards.toCanonical)));
    return current;
  }
  async function editFirstCard(keys) {
    await page.evaluate(() => { theibsCardKeyboard.select(0); document.activeElement?.blur(); });
    await page.keyboard.type(keys);
  }
  async function hold(url, count = 1) {
    const pending = Array.from({ length: count }, () => ({ seen: deferred(), release: deferred() }));
    gates.push(...pending);
    let index = 0;
    const handler = async route => {
      const payload = route.request().postDataJSON();
      const response = await route.fetch();
      const item = pending[index++];
      if (item) {
        report.heldRequests.push({ endpoint: url, events: payload.multiway?.events.length,
          heroCards: payload.multiway?.config.heroCards, event: payload.event || null });
        item.seen.resolve(payload);
        await item.release.promise;
      }
      await route.fulfill({ response });
    };
    await page.route('**' + url, handler);
    return { pending, stop: () => page.unroute('**' + url, handler) };
  }
  async function save() {
    await page.evaluate(() => theibsApp.flushSave());
    await page.waitForFunction(() => { const current = theibsApp.getState(); return !current.saveBusy && !current.saveDirty && !current.saveBlocked; });
  }
  try {
    ({ server } = require('../server'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(15000);
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => Boolean(window.theibsApp));
    await page.evaluate(() => theibsApp.ready);
    await page.locator('#open-settings').click();
    await page.locator('#mw-setup-details>summary').click();
    await page.locator('#mw-player-count').selectOption('4');
    await page.locator('#mw-hero-position').selectOption('BTN');
    await page.locator('#mw-start').click();
    await page.waitForFunction(() => Boolean(theibsApp.getState().multiway)); await idle();
    const beginning = await aligned();
    assert.equal(beginning.multiwayState.actor, 2);
    assert.equal(beginning.multiwayState.heroId, 3);

    // Hold a real successful backend response while attempting conflicting UI edits.
    const step = await hold('/api/multiway/step');
    await page.locator('[data-mw-action="CALL"]').click();
    await step.pending[0].seen.promise;
    assert.equal((await state()).multiwayBusy, true);
    await editFirstCard('2e');
    await page.locator('#open-card-picker').click();
    await page.locator('#remove-card').click();
    await page.locator('#clear').click();
    assert.deepEqual(await cards(), beginning.multiway.config.heroCards);
    assert.deepEqual((await state()).multiway, beginning.multiway);
    assert.equal((await state()).lastAnalysis, null);
    step.pending[0].release.resolve();
    await page.waitForFunction(() => theibsApp.getState().multiway.events.length === 1); await idle();
    await step.stop();
    let current = await aligned();
    assert.equal(current.multiwayState.actor, 3);
    assert.equal(current.multiwayAnalysis.available, true);
    report.checks.push('Delayed step blocks keyboard edits, reverts remove-card and rejects Clear; backend record and visible cards stay identical');

    // Two overlapping private-card replays, completed in the opposite order.
    const overlapping = await hold('/api/multiway/state', 2);
    await editFirstCard('2e');
    const firstPayload = await overlapping.pending[0].seen.promise;
    assert.equal(firstPayload.multiway.config.heroCards[0], '2s');
    await editFirstCard('3e');
    const secondPayload = await overlapping.pending[1].seen.promise;
    assert.equal(secondPayload.multiway.config.heroCards[0], '3s');
    await page.locator('#open-settings').click();
    await page.locator('#samples').selectOption('10000');
    await page.locator('#settings-dialog [data-close-dialog]').click();
    overlapping.pending[1].release.resolve();
    await page.waitForFunction(() => theibsApp.getState().multiwayAnalysis.available === true);
    current = await aligned(); assert.equal(current.multiway.config.heroCards[0], '3s');
    const staleCardResponse = page.waitForResponse(response => response.url().endsWith('/api/multiway/state'));
    overlapping.pending[0].release.resolve();
    await staleCardResponse;
    await page.waitForTimeout(75);
    await overlapping.stop();
    current = await aligned();
    assert.equal(current.multiway.config.heroCards[0], '3s');
    assert.equal(current.multiwayAnalysis.available, true);
    assert.equal(await page.locator('#samples').inputValue(), '10000');
    report.checks.push('Latest private-card replay wins over older response; changing samples during replay does not leave availability stuck or desynchronize the hand');

    // A card replay returning after an actual action cannot restore old events.
    const oldReplay = await hold('/api/multiway/state');
    await editFirstCard('4e'); await oldReplay.pending[0].seen.promise;
    await page.locator('[data-mw-action="CALL"]').click();
    await page.waitForFunction(() => theibsApp.getState().multiway.events.length === 2); await idle();
    const olderActionResponse = page.waitForResponse(response => response.url().endsWith('/api/multiway/state'));
    oldReplay.pending[0].release.resolve();
    await olderActionResponse;
    await page.waitForTimeout(75); await oldReplay.stop();
    current = await aligned();
    assert.equal(current.multiway.events.length, 2);
    assert.equal(current.multiway.config.heroCards[0], '4s');
    assert.equal(current.multiwayState.actor, 0);
    assert.equal(current.multiwayAnalysis.available, false);
    assert.ok(current.multiwayAnalysis.reasons.some(reason => reason.code === 'NOT_HERO_TURN'));
    report.checks.push('An old card replay cannot erase the subsequent CALL or restore a stale hero-turn recommendation');

    await save(); const persisted = (await state()).multiway;
    const restore = await hold('/api/multiway/state');
    await page.reload();
    await restore.pending[0].seen.promise;
    await page.waitForFunction(() => Boolean(window.theibsApp) && theibsApp.getState().multiwayBusy);
    const restoredVisible = await cards();
    await editFirstCard('5e');
    await page.locator('#open-card-picker').click();
    await page.locator('#remove-card').click();
    await page.locator('#clear').click();
    assert.deepEqual(await cards(), restoredVisible);
    restore.pending[0].release.resolve();
    await page.evaluate(() => theibsApp.ready); await idle(); await restore.stop();
    current = await aligned();
    assert.deepEqual(current.multiway, persisted);
    assert.equal(current.multiwayAnalysis.available, false);
    report.checks.push('Delayed workspace restoration blocks conflicting edits/Clear and restores the exact saved cards, events, physical seats and turn');

    await save();
    await page.screenshot({ path: path.join(out, 'edge-races-final.png') });
    assert.deepEqual(report.pageErrors, []);
    report.finalState = { heroCards: current.multiway.config.heroCards, events: current.multiway.events,
      heroId: current.multiwayState.heroId, actor: current.multiwayState.actor,
      activeOpponentCount: current.multiwayState.activeOpponentCount,
      analysisAvailable: current.multiwayAnalysis.available };
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = error.stack;
    if (page) { report.finalState = await state().catch(() => null); await page.screenshot({ path: path.join(out, 'edge-races-failure.png') }).catch(() => {}); }
    throw error;
  } finally {
    for (const gate of gates) gate.release.resolve();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'edge-report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify({ status: report.status, checks: report.checks, report: path.join(out, 'edge-report.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
