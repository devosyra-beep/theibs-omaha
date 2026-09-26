'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium, _electron } = require('playwright');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-nuts-ui-'));
  Object.assign(process.env, { THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
    THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'), THEIBS_LLM_PROVIDER: 'none' });
  const version = require('../package.json').version, native = process.argv.includes('--electron'), mode = native ? 'electron' : 'edge';
  const out = path.resolve(__dirname, '../../validacao/nuts-v' + version);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH, JSON.stringify({ revision: 1, workspace: {
    schemaVersion: 1, keyboard: { count: 4, selected: 0, slots: Array(9).fill(null) },
    fields: { players: '2', potBeforeAction: '12', amountToCall: '1', effectiveStack: '100', samples: '500', seed: '42',
      assumeNoRake: true, 'auto-analysis': false }, ui: { felt: 'verde', deck: 'cores', view: 'analyze', cardDisplayVersion: 2 }, snapshots: []
  } }));
  const report = { version, environment: native ? 'PACKAGED_ELECTRON' : 'EDGE_HTTP',
    scope: 'REAL_UI_AND_LOCAL_NUMERICAL_ENGINE_WITH_ISOLATED_WORKSPACE', checks: [], cases: [], layouts: [], errors: [] };
  let server, browser, app, page;
  try {
    if (native) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({ executablePath: process.env.THEIBS_EXECUTABLE || path.resolve(__dirname, '../../THEIBS/THEIBS.exe'),
        args: ['--user-data-dir=' + path.join(temp, 'profile')], env, timeout: 20000 });
      page = await app.firstWindow();
    } else {
      ({ server } = require('../server'));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ headless: true, channel: 'msedge' });
      page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
    }
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.waitForFunction(() => Boolean(window.theibsApp));
    await page.evaluate(() => theibsApp.ready);
    if (app) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.setBackgroundThrottling(false); window.setIgnoreMouseEvents(true); window.setFocusable(false);
    }));
    const badge = page.locator('#nuts-badge');
    assert.equal(await badge.count(), 1);
    assert.equal(await badge.isVisible(), false);
    const enterAt = async (slot, keys) => { await page.locator(`[data-slot="${slot}"]`).click(); await page.keyboard.type(keys); };
    const analyze = async () => {
      const response = page.waitForResponse(item => item.url().endsWith('/api/analyze'));
      await page.locator('#quick-analyze').click();
      const result = await (await response).json();
      await page.waitForFunction(() => !theibsApp.getState().analysisBusy && theibsApp.getState().lastAnalysis?.data.status === 'OK');
      assert.equal(result.status, 'OK', result.reason);
      return result;
    };
    await enterAt(0, 'aeke2c3o');
    let result = await analyze();
    assert.equal(result.handInsights.made, null);
    assert.equal(await badge.isVisible(), false);
    report.cases.push({ name: 'preflop', cards: result.state.heroCards, board: result.state.board, badgeVisible: false });
    report.checks.push('Preflop never displays NUTS');

    await enterAt(4, 'qejete');
    result = await analyze();
    assert.equal(result.handInsights.made.category, 'STRAIGHT_FLUSH');
    assert.equal(result.handInsights.nuts.unbeaten, true);
    assert.equal(await badge.isVisible(), true);
    assert.equal(await badge.innerText(), 'NUTS');
    assert.match(await badge.getAttribute('aria-label'), /board atual.*Pode empatar/);
    report.cases.push({ name: 'royal-flush', cards: result.state.heroCards, board: result.state.board,
      category: result.handInsights.made.category, nuts: result.handInsights.nuts, badgeVisible: true });
    report.checks.push('As Ks with Qs Js Ts shows NUTS only after a successful engine result');

    for (const [width, height] of [[1366, 768], [1024, 660]]) {
      await page.setViewportSize({ width, height });
      const metrics = await page.evaluate(() => {
        const badge = document.getElementById('nuts-badge'), panel = document.querySelector('#analyze-workspace .insight-panel');
        const rectangle = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const style = getComputedStyle(badge);
        const textRange = document.createRange(); textRange.selectNodeContents(badge);
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight, badge: rectangle(badge), textBounds: rectangle(textRange), equity: rectangle(panel),
          fontSize: parseFloat(style.fontSize), color: style.color, stroke: style.webkitTextStrokeColor,
          badgeScrollWidth: badge.scrollWidth, badgeClientWidth: badge.clientWidth, text: badge.textContent, visible: !badge.hidden };
      });
      report.layouts.push(metrics);
      const screenshot = path.join(out, `${mode}-nuts-${width}.png`);
      await page.screenshot({ path: screenshot });
      assert.equal(metrics.visible, true);
      assert.ok(metrics.fontSize >= 12, `NUTS text too small at ${width}`);
      assert.ok(metrics.scrollWidth <= width && metrics.scrollHeight <= height, `Document overflow at ${width}`);
      assert.ok(metrics.badge.x >= 0 && metrics.badge.right <= width && metrics.badge.bottom <= height, `NUTS outside viewport at ${width}`);
      assert.ok(metrics.textBounds.y >= metrics.equity.bottom - 1, `NUTS text overlaps equity at ${width}`);
      assert.ok(metrics.badgeScrollWidth <= metrics.badgeClientWidth + 1, `NUTS text clipped at ${width}`);
    }
    report.checks.push('NUTS is readable below equity with no overflow at 1366x768 and 1024x660');
    await page.setViewportSize({ width: 1366, height: 768 });

    await enterAt(1, 'kc');
    assert.equal(await badge.isVisible(), false);
    result = await analyze();
    assert.equal(result.handInsights.made.usedHeroCards.length, 2);
    assert.notEqual(result.handInsights.made.category, 'FLUSH');
    assert.notEqual(result.handInsights.made.category, 'STRAIGHT_FLUSH');
    assert.equal(result.handInsights.nuts.unbeaten, false);
    assert.equal(await badge.isVisible(), false);
    report.cases.push({ name: 'single-private-spade', cards: result.state.heroCards, board: result.state.board,
      category: result.handInsights.made.category, nuts: result.handInsights.nuts, badgeVisible: false });
    report.checks.push('Changing Ks to Kh clears the badge immediately; one private spade cannot use the three board spades as an Omaha flush');

    await enterAt(1, 'ke'); await analyze(); assert.equal(await badge.isVisible(), true);
    await page.locator('[data-slot="1"]').click(); await page.keyboard.press('Delete');
    assert.equal(await badge.isVisible(), false);
    assert.equal(await page.evaluate(() => theibsApp.getState().lastAnalysis), null);
    report.checks.push('Removing a private card clears the previous NUTS result');
    await enterAt(1, 'ke'); await analyze(); assert.equal(await badge.isVisible(), true);
    await page.locator('#new-hand').click();
    await page.waitForFunction(() => !theibsCardKeyboard.state.slots.some(Boolean));
    assert.equal(await badge.isVisible(), false);
    assert.equal(await page.evaluate(() => theibsApp.getState().lastAnalysis), null);
    report.checks.push('New hand clears cards, analysis and the badge');
    await page.evaluate(() => theibsApp.flushSave());
    await page.waitForFunction(() => !theibsApp.getState().saveBusy && !theibsApp.getState().saveDirty);
    assert.deepEqual(report.errors, []);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = error.stack;
    if (page) await page.screenshot({ path: path.join(out, `${mode}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, `${mode}-report.json`), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    if (app) { try { await app.evaluate(({ app }) => app.exit(0)); } catch {} await app.close(); }
    if (server) { await require('../src/analysis-worker').close(); await new Promise(resolve => server.close(resolve)); }
  }
  console.log(JSON.stringify({ status: report.status, environment: report.environment, checks: report.checks, layouts: report.layouts }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
