'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium, _electron } = require('playwright');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-multiway-')), version = require('../package.json').version;
  const native = process.argv.includes('--electron'), mode = native ? 'electron' : 'edge';
  Object.assign(process.env, { THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'), THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm-config.json') });
  const initial = { schemaVersion: 1, keyboard: { count: 6, selected: 0, slots: ['AE', 'KE', 'QC', 'JC', 'TO', '9O', null, null, null, null, null] },
    fields: { players: '5', position: 'BTN', potBeforeAction: '12', amountToCall: '4', effectiveStack: '100', samples: '500', seed: '42', 'auto-analysis': false },
    ui: { felt: 'preto', deck: 'cores', view: 'analyze', cardDisplayVersion: 2, workflowVersion: 1, sidebarCollapsed: true }, snapshots: [] };
  fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH, JSON.stringify({ revision: 1, workspace: initial }));
  const out = path.resolve(__dirname, '../../validacao/multiway-v' + version); fs.mkdirSync(out, { recursive: true });
  const report = { version, mode: native ? 'PACKAGED_ELECTRON' : 'EDGE_HTTP', checks: [], layouts: [], errors: [] };
  let server, browser, app, page;
  const appState = () => page.evaluate(() => theibsApp.getState());
  const idle = () => page.waitForFunction(() => !theibsApp.getState().multiwayBusy && !theibsMultiwayUI.getState().busy);
  const focusCanvas = () => page.evaluate(() => document.activeElement?.blur());
  async function record(action) {
    const before = (await appState()).multiway?.events.length ?? 0;
    await action(); await page.waitForFunction(count => theibsApp.getState().multiway?.events.length === count, before + 1); await idle();
    return (await appState()).multiwayState;
  }
  async function key(keyName) { return record(async () => { await focusCanvas(); await page.keyboard.press(keyName); }); }
  async function undo() {
    const count = (await appState()).multiway.events.length;
    await page.locator('#mw-undo').click(); await page.waitForFunction(expected => theibsApp.getState().multiway.events.length === expected, count - 1); await idle();
  }
  async function sized(keyName, value) {
    await focusCanvas(); await page.keyboard.press(keyName); await page.locator('#multiway-size-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mw-size-cost').innerText(), /adds/);
    return record(async () => { await page.locator('#mw-size').fill(String(value)); await page.locator('#mw-size').press('Enter'); });
  }
  async function board(text) { return record(async () => {
    const current = await page.evaluate(() => ({ count: theibsCardKeyboard.state.count, board: theibsMultiwayUI.getState().state.board.length }));
    assert.equal(await page.locator('#mw-next-board').count(), 0, 'no separate Deal street button');
    assert.equal(await page.locator('.card-keyboard').evaluate(element => element.parentElement.classList.contains('table-column')), true, 'virtual deck is docked beside the table');
    assert.equal(await page.locator('#card-picker').evaluate(element => element.open), false, 'virtual deck stays compact on a street transition');
    assert.equal(await page.evaluate(() => theibsCardKeyboard.state.selected), current.count + current.board, 'first empty board slot is selected without opening the deck');
    await page.setViewportSize({ width: 1160, height: 855 });
    const compact = await page.evaluate(() => ({ width:innerWidth,scrollWidth:document.documentElement.scrollWidth,open:document.querySelector('#card-picker').open,height:document.querySelector('.card-keyboard').getBoundingClientRect().height }));
    assert.equal(compact.open,false); assert.ok(compact.height<100,'street transition keeps the card keyboard compact'); assert.ok(compact.scrollWidth<=compact.width);
    await page.screenshot({path:path.join(out,'multiway-wait-board-compact-1160x855.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.card-keyboard').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'multiway-wait-board-compact-390x844.png')});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),'compact phone layout has no horizontal overflow');
    await page.evaluate(() => scrollTo(0,0));
    await page.evaluate(() => theibsCardPicker.open());
    await page.setViewportSize({ width: 1160, height: 855 });
    const geometry = await page.evaluate(() => {
      const box = element => { const r = element.getBoundingClientRect(); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom }; };
      const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const hero = [...document.querySelectorAll('#hero-slots .playing-card')].map(box), board = [...document.querySelectorAll('#board-slots .playing-card')].map(box);
      const seats = [...document.querySelectorAll('#analysis-seats .multiway-seat')].map(box);
      return { width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
        seats,hero,board,
        intersections:seats.flatMap((seat,i)=>[...hero.map((card,j)=>overlaps(seat,card)?`seat${i}-hero${j}`:null),...board.map((card,j)=>overlaps(seat,card)?`seat${i}-board${j}`:null)].filter(Boolean)),
        heroBoard:hero.some(card=>board.some(slot=>overlaps(card,slot))), table:box(document.querySelector('.poker-table')) };
    });
    report.layouts.push({phase:'WAIT_BOARD',...geometry});
    await page.screenshot({path:path.join(out,'multiway-wait-board-1160x855.png')});
    assert.ok(geometry.scrollWidth<=geometry.width,'no horizontal overflow at 1160px during board entry');
    assert.deepEqual(geometry.intersections,[],'opponent seats do not overlap hero or board cards during board entry');
    assert.equal(geometry.heroBoard,false,'hero and community card areas stay separate');
    for (const [width,height] of [[320,800],[360,800],[390,844],[430,900],[768,1024],[1024,768],[1160,855],[1366,768]]) {
      await page.setViewportSize({width,height}); await page.waitForTimeout(60);
      const layout = await page.evaluate(() => {
        const box = element => { const r=element.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; };
        const overlaps = (a,b) => a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
        const hero=[...document.querySelectorAll('#hero-slots .playing-card')].map(box),board=[...document.querySelectorAll('#board-slots .playing-card')].map(box),seats=[...document.querySelectorAll('#analysis-seats .multiway-seat')].map(box);
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
          collisions:seats.flatMap((seat,i)=>[...hero.map((card,j)=>overlaps(seat,card)?`seat${i}-hero${j}`:null),...board.map((card,j)=>overlaps(seat,card)?`seat${i}-board${j}`:null)].filter(Boolean)),
          heroBoard:hero.some(card=>board.some(slot=>overlaps(card,slot)))};
      });
      report.layouts.push({phase:'WAIT_BOARD',...layout});
      assert.ok(layout.scrollWidth<=width,`horizontal overflow at ${width}px during board entry`);
      assert.deepEqual(layout.collisions,[],`seat/card overlap at ${width}px during board entry`);
      assert.equal(layout.heroBoard,false,`hand/board overlap at ${width}px during board entry`);
      if(width===390)await page.screenshot({path:path.join(out,'multiway-wait-board-390x844.png')});
    }
    await page.setViewportSize({width:1160,height:855});
    for (const [offset, card] of text.trim().split(/\s+/).entries()) {
      assert.equal(await page.evaluate(() => theibsCardKeyboard.state.selected), current.count + current.board + offset, 'next board slot is preselected for direct keyboard entry');
      await page.locator(`#card-grid [data-card="${card}"]`).click();
    }
  }); }
  async function analyze() {
    const pending = page.waitForResponse(response => response.url().endsWith('/api/analyze'));
    await page.locator('#quick-analyze').click(); const data = await (await pending).json();
    await page.waitForFunction(() => !theibsApp.getState().analysisBusy); return data;
  }
  const save = async () => { await page.evaluate(() => theibsApp.flushSave()); await page.waitForFunction(() => { const s = theibsApp.getState(); return !s.saveBusy && !s.saveDirty; }); };
  try {
    if (native) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({ executablePath: process.env.THEIBS_EXECUTABLE || path.resolve(__dirname, '../../THEIBS/THEIBS.exe'), args: ['--user-data-dir=' + path.join(temp, 'profile')], env });
      page = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.webContents.setBackgroundThrottling(false); window.hide(); }));
    } else {
      ({ server } = require('../server')); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ headless: true, channel: 'msedge' }); page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/app?login=1`);
    }
    page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.waitForFunction(() => Boolean(window.theibsApp)); await page.evaluate(() => theibsApp.ready);
    assert.equal(await page.evaluate(() => theibsCardKeyboard.state.count), 6, 'saved PLO6 restored');
    assert.equal((await appState()).multiway, null); assert.equal(await page.locator('#multiway-controls').isVisible(), false);
    assert.equal(await page.locator('#mw-setup-details').getAttribute('open'), null);
    await page.locator('#open-settings').click(); await page.locator('#mw-setup-details>summary').click();
    assert.equal(await page.locator('#mw-player-count option').count(), 4); assert.equal(await page.locator('#mw-player-count').inputValue(), '5');
    await page.locator('#mw-hero-position').selectOption('BTN'); await page.locator('#mw-small-blind').fill('0.5'); await page.locator('#mw-big-blind').fill('1'); await page.locator('#mw-starting-stack').fill('100');
    await page.locator('#mw-start').click(); await page.waitForFunction(() => theibsApp.getState().multiwayState?.actor === 2); await idle();
    let state = (await appState()).multiwayState;
    assert.deepEqual(state.players.map(player => player.position), ['SB', 'BB', 'HJ', 'CO', 'BTN']); assert.equal(state.heroId, 4); assert.equal(state.activeOpponentCount, 4);
    assert.equal(await page.locator('#analysis-seats [data-multiway-player]').count(), 4);
    assert.equal(await page.locator('[data-mw-command="leave"]').getAttribute('data-mw-action'), 'FOLD');
    assert.equal(await page.locator('[data-mw-command="call"]').getAttribute('data-mw-action'), 'CALL');
    assert.equal(await page.locator('[data-mw-command="check"]').getAttribute('data-mw-action'), '');
    assert.equal(await page.locator('[data-mw-command="aggressive"]').getAttribute('data-mw-action'), 'RAISE');
    assert.deepEqual(await page.locator('.mw-action-row [data-mw-command] span').allTextContents(), ['Fold', 'Call 1', 'Raise', 'Check']);
    assert.equal(await page.locator('[data-mw-command="leave"] kbd').count(), 0, 'Fold stays available by touch/click, without the M shortcut');
    assert.deepEqual(await page.locator('.mw-action-row kbd').allTextContents(), [',', ';', '.']);
    report.checks.push('Multiway is opt-in; PLO6 setup caps total players at 5 and starts preflop with stable SB/BB/HJ/CO/BTN identities');

    await page.locator('[data-multiway-player="0"]').click(); await record(() => page.locator('#mw-seat-fold').click());
    state = (await appState()).multiwayState; assert.equal(state.players[0].folded, true); assert.equal(state.actor, 2); assert.equal(state.heroId, 4); assert.equal(state.activeOpponentCount, 3);
    assert.equal((await appState()).multiway.events.at(-1).type, 'MARK_FOLD'); await undo(); assert.equal((await appState()).multiwayState.players[0].folded, false);
    const beforeM = (await appState()).multiway.events.length;
    await focusCanvas(); await page.keyboard.press('m');
    assert.equal((await appState()).multiway.events.length, beforeM, 'M no longer records a Fold');
    assert.equal((await appState()).multiwayState.players[2].folded, false);
    report.checks.push('Clicking an eligible seat records its physical identity as an observed fold; M is not an action shortcut');

    const protectedCount = (await appState()).multiway.events.length;
    await page.evaluate(() => { const root = document.createElement('div'); root.id = 'qa-editors'; root.innerHTML = '<input><textarea></textarea><select><option>One</option></select><div contenteditable="true">Text</div>'; root.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#000'; document.body.append(root); });
    for (const selector of ['input', 'textarea', 'select', '[contenteditable]']) { await page.locator('#qa-editors ' + selector).focus(); await page.keyboard.press('m'); }
    await page.evaluate(() => { document.querySelector('#qa-editors').remove(); for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { repeat: true }]) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, ...modifiers })); });
    await page.locator('#open-settings').click(); await page.keyboard.press('m'); await page.locator('#settings-dialog [data-close-dialog]').click();
    await page.locator('.nav-tab[data-view="train"]').click(); await focusCanvas(); await page.keyboard.press('m'); await page.locator('.nav-tab[data-view="analyze"]').click();
    assert.equal((await appState()).multiway.events.length, protectedCount);
    report.checks.push('Shortcuts ignore all text editors, select, contenteditable, open dialogs, modifiers, repeated events and the training tab');

    state = await key(','); assert.equal(state.actor, 3); assert.equal(state.players[2].lastAction, 'CALL');
    state = await sized(';', 2); assert.equal(state.actor, 4); assert.equal(state.players[3].streetPaid, 2); assert.match(await page.locator('#mw-actor').innerText(), /(?:Sua vez|Your turn).*BTN/);
    const pendingResponses = await analyze();
    assert.equal(pendingResponses.status, 'OK'); assert.equal(pendingResponses.equity.opponents, 4);
    assert.equal(pendingResponses.ev.actions.CALL.status, 'NOT_MODELED'); assert.equal(pendingResponses.potMath.evCall, null);
    assert.equal(pendingResponses.recommendedAction, 'NO_DECISION'); assert.equal(await page.locator('#ev-value').innerText(), '—');
    report.checks.push('Facing a raise with other seats still owing chips, CALL stays unmodeled and no recommendation is inferred from FOLD alone');
    for (const expected of [0, 1, 2]) { state = await key(','); assert.equal(state.actor, expected); }
    state = await key(','); assert.equal(state.phase, 'WAIT_BOARD'); assert.equal(state.nextStreet, 'FLOP');
    state = await board('2E 3C 4O'); assert.deepEqual(state.board, ['2s', '3h', '4d']); assert.equal(state.actor, 0);
    state = await key('.'); assert.equal(state.actor, 1); assert.equal(state.players[0].lastAction, 'CHECK');
    assert.equal(await page.locator('[data-multiway-player="0"]').evaluate(node => node.classList.contains('checked')), true, 'checked player uses a distinct status class');
    state = await sized(';', 1); assert.equal(state.actor, 2); assert.equal(state.players[1].lastAction, 'BET');
    for (let index = 0; index < 4; index++) state = await key(',');
    assert.equal(state.phase, 'WAIT_BOARD'); assert.equal(state.nextStreet, 'TURN');
    state = await board('5P'); assert.deepEqual(state.board, ['2s', '3h', '4d', '5c']); assert.equal(state.street, 'TURN');
    report.checks.push('Comma calls; period checks; semicolon opens bet/raise sizing; checked seats receive a distinct visual status; flop and turn preserve previous board cards');
    for (let index = 0; index < 4; index++) state = await key('.');
    assert.equal(state.actor, state.heroId); assert.equal(state.pot, 15);
    const turnAnalysis = await analyze();
    assert.equal(turnAnalysis.status, 'OK'); assert.equal(turnAnalysis.equity.opponents, 4);
    assert.equal(turnAnalysis.ev.actions.CHECK.status, 'MODELED'); assert.ok(Number.isFinite(turnAnalysis.ev.actions.CHECK.ev));
    assert.equal(turnAnalysis.state.potBeforeAction, state.pot); assert.equal(turnAnalysis.ranges.length, 4);
    assert.ok(turnAnalysis.ranges.every(range => range.kind === 'UNIFORM'));
    assert.notEqual(await page.locator('#hero-equity').innerText(), '—'); assert.notEqual(await page.locator('#ev-value').innerText(), '—');

    for (const picker of [false, true]) for (const [width, height] of [[1910, 1000], [1366, 768], [1024, 660]]) {
      await page.evaluate(open => theibsCardPicker[open ? 'open' : 'close'](), picker);
      await page.setViewportSize({ width, height }); await page.waitForTimeout(80);
      const layout = await page.evaluate(() => { const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }; return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
        hero: [...document.querySelectorAll('#hero-slots .playing-card')].map(box), board: [...document.querySelectorAll('#board-slots .playing-card')].map(box),
        controls: box(document.querySelector('#multiway-controls')), panels: [...document.querySelectorAll('#analyze-workspace .context-rail>.panel,.card-keyboard,.top-actions')].map(box) }; });
      report.layouts.push({ picker, ...layout }); assert.ok(layout.scrollWidth <= width && layout.scrollHeight <= height, `page overflow ${width}/picker=${picker}`);
      assert.ok(Math.max(...layout.board.map(card => card.bottom)) + 1 <= Math.min(...layout.hero.map(card => card.top)), `board/hero overlap ${width}/picker=${picker} ${JSON.stringify({board:layout.board,hero:layout.hero})}`);
      await page.screenshot({ path: path.join(out, `${mode}-${picker ? 'cards-' : ''}${width}.png`) });
      assert.ok([...layout.panels, layout.controls].every(panel => panel.left >= 0 && panel.right <= width + 1 && panel.bottom <= height + 1), `panel overflow ${width}/picker=${picker}`);
    }
    await page.evaluate(() => theibsCardPicker.close());
    report.checks.push('Active Multiway with both collapsed and expanded card picker fits 1910×1000, 1366×768 and 1024×660 without scrolling or board/hand overlap');
    state = await key('.'); assert.equal(state.phase, 'WAIT_BOARD'); assert.equal((await appState()).lastAnalysis, null);
    assert.equal(await page.locator('#hero-equity').innerText(), '—'); assert.equal(await page.locator('#ev-value').innerText(), '—');
    report.checks.push('On the hero turn, CHECK uses the tracked pot and all four unknown opponents; acting clears stale EV and equity immediately');
    const persisted = (await appState()).multiway; await save(); await page.reload(); await page.waitForFunction(() => Boolean(window.theibsApp)); await page.evaluate(() => theibsApp.ready); await idle();
    assert.deepEqual((await appState()).multiway, persisted); assert.deepEqual((await appState()).multiwayState.board, ['2s', '3h', '4d', '5c']);
    const setupBeforeReset = { ...(await appState()).multiway.config }; delete setupBeforeReset.heroCards;
    await page.locator('#new-hand').click();
    assert.equal(await page.locator('#mw-position-prompt').isVisible(), true, 'new Multiway hand asks for the hero seat');
    assert.equal(await page.locator('#mw-hero-position').inputValue(), '', 'new hand requires an explicit position');
    await page.screenshot({path:path.join(out,'multiway-new-hand-position-1366x900.png'),fullPage:true});
    await page.locator('#mw-hero-position').selectOption('CO'); await page.locator('#mw-start').click(); await page.waitForFunction(() => theibsApp.getState().multiway?.events.length === 0); await idle();
    const restarted = (await appState()).multiway, setupAfterReset = { ...restarted.config }; delete setupAfterReset.heroCards;
    assert.equal(restarted.config.heroPosition,'CO');
    delete setupBeforeReset.heroPosition; delete setupAfterReset.heroPosition;
    assert.deepEqual(setupAfterReset, setupBeforeReset); assert.deepEqual(restarted.events, []); assert.deepEqual(restarted.config.heroCards, []);
    assert.deepEqual((await appState()).multiwayState.board, []); assert.equal(await page.locator('#multiway-controls').isVisible(), true);
    report.checks.push('New hand resets cards/actions, asks for hero position, and starts with the selected seat');
    await page.locator('#open-settings').click(); await page.locator('#mw-setup-details>summary').click(); await page.locator('#mw-exit').click(); await page.waitForFunction(() => !theibsApp.getState().multiway); await page.locator('#settings-dialog [data-close-dialog]').click();
    assert.deepEqual(await page.evaluate(() => theibsCardKeyboard.state.snapshot().slots), initial.keyboard.slots);
    assert.equal(await page.locator('#potBeforeAction').inputValue(), '12'); assert.equal(await page.locator('#amountToCall').inputValue(), '4'); assert.equal(await page.locator('#multiway-controls').isVisible(), false);
    for (const keys of ['de', 'te', '10e']) {
      await page.locator('[data-slot="0"]').click(); await focusCanvas(); await page.keyboard.type(keys); assert.equal(await page.evaluate(() => theibsCardKeyboard.state.slots[0]), 'TE'); await page.keyboard.press('Control+z'); assert.notEqual(await page.evaluate(() => theibsCardKeyboard.state.slots[0]), 'TE');
    }
    await page.evaluate(() => theibsCardPicker.close()); await save(); await page.reload(); await page.waitForFunction(() => Boolean(window.theibsApp)); await page.evaluate(() => theibsApp.ready); assert.equal((await appState()).multiway, null);
    report.checks.push('Observed actions and identities survive reload; returning to Simple restores its original cards/context; D, T and 10 card aliases remain functional');
    assert.deepEqual(report.errors, []); report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.failure = error.stack; if (page) { report.uiState = await page.evaluate(() => ({ count: window.theibsCardKeyboard?.state.count, draft: window.theibsMultiwayUI?.getDraft(), save: document.querySelector('#save-status')?.textContent })).catch(() => null); await page.screenshot({ path: path.join(out, mode + '-failure.png') }).catch(() => {}); } throw error; }
  finally {
    fs.writeFileSync(path.join(out, mode + '-report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close(); if (app) { try { await app.evaluate(({ app }) => app.exit(0)); } catch {} await app.close(); }
    if (server) await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify({ status: report.status, checks: report.checks }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
