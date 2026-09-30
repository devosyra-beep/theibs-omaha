'use strict';
// Browser smoke for the observed-hand flow. Speech events here are simulated;
// this does not exercise microphone hardware or an external ASR provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-quick-hand-'));
  Object.assign(process.env, {
    THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
    THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'),
    THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm-config.json')
  });
  const workspace = {
    schemaVersion: 1,
    keyboard: { count: 4, selected: 0, slots: Array(9).fill(null) },
    fields: { players: '3', position: 'BTN', samples: '500', seed: '42', 'auto-analysis': false },
    ui: { felt: 'preto', deck: 'cores', view: 'analyze', cardDisplayVersion: 2, workflowVersion: 1, sidebarCollapsed: true },
    snapshots: []
  };
  fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH, JSON.stringify({ revision: 1, workspace }));
  const { server } = require('../server');
  let browser, page;
  const checks = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(20000);
    const errors = [];
    const analyses = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
    page.on('response', response => { if (response.status() >= 400) console.error('HTTP ERROR:', response.status(), response.url()); });
    page.on('request', request => { if (request.url().endsWith('/api/analyze')) analyses.push(request.url()); });
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => {
      class FakeRecognition {
        constructor() { (window.__fakeRecognition ||= []).push(this); this.ended = false; }
        start() { setTimeout(() => { this.onstart?.(); this.onaudiostart?.(); }, 0); }
        stop() { this.finish(); }
        abort() { this.finish(); }
        finish() { if (this.ended) return; this.ended = true; this.onaudioend?.(); this.onend?.(); }
        emit(text, isFinal = true) {
          const result = [{ transcript: text }]; result.isFinal = isFinal;
          this.onresult?.({ results: [result], resultIndex: 0 });
        }
      }
      window.SpeechRecognition = FakeRecognition;
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app?login=1`);
    await page.waitForFunction(() => Boolean(window.theibsApp));
    await page.evaluate(() => window.theibsApp.ready);
    const state = () => page.evaluate(() => window.theibsApp.getState());
    const idle = () => page.waitForFunction(() => !window.theibsApp.getState().multiwayBusy);
    const blur = () => page.evaluate(() => document.activeElement?.blur());
    async function checkHeader(mode) {
      for (const width of [320, 390, 1366, 1920]) {
        await page.setViewportSize({ width, height: 1080 });
        const geometry = await page.evaluate(() => {
          const node = document.querySelector('#new-hand'), rect = node.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(node);
          const menu = document.querySelector('#mobile-tools>summary')?.getBoundingClientRect();
          return { text:node.textContent.trim(), width:rect.width, right:rect.right,
            left:rect.left, top:rect.top, bottom:rect.bottom, accessibleName:node.getAttribute('aria-label'),
            menu:menu ? {left:menu.left,right:menu.right,top:menu.top,bottom:menu.bottom,width:menu.width} : null,
            contentWidth:node.scrollWidth, clientWidth:node.clientWidth,
            lineFragments:range.getClientRects().length, viewport:innerWidth,
            pageWidth:document.documentElement.scrollWidth };
        });
        assert.ok(geometry.right <= width && geometry.pageWidth <= width,
          `${mode} header button clipped at ${width}: ${JSON.stringify(geometry)}`);
        if (width <= 390) {
          assert.ok(geometry.width >= 44 && geometry.menu && geometry.left >= geometry.menu.right + 5,
            `${mode} mobile Menu/New Game collide at ${width}: ${JSON.stringify(geometry)}`);
          assert.ok(Math.abs((geometry.top + geometry.bottom) / 2 - (geometry.menu.top + geometry.menu.bottom) / 2) <= 1,
            `${mode} mobile Menu/New Game vertical alignment at ${width}: ${JSON.stringify(geometry)}`);
          assert.ok(geometry.accessibleName?.includes('New'), `${mode} mobile New Game lacks an accessible name`);
        } else {
          assert.ok(geometry.width >= 100 && geometry.contentWidth <= geometry.clientWidth + 1 && geometry.lineFragments === 1,
            `${mode} header button wraps at ${width}: ${JSON.stringify(geometry)}`);
        }
        await page.screenshot({ path:path.join(temp, `${mode}-header-${width}.png`) });
      }
      await page.setViewportSize({ width:1366, height:900 });
      checks.push(`${mode} header Menu/New Game align at 320/390 and text remains single-line at 1366/1920 px`);
    }
    async function action(key, expectedCount) {
      await blur(); await page.keyboard.press(key);
      await page.waitForFunction(n => window.theibsApp.getState().multiway?.events.length === n, expectedCount);
      await idle();
      return (await state()).multiwayState;
    }
    await checkHeader('simple');
    await page.locator('[data-simple-seat="0"]').click();
    await page.locator('#simple-seat-toggle').click();
    assert.deepEqual((await state()).simpleFoldedSeats, [0]);
    await blur(); await page.keyboard.press('a'); await page.keyboard.press('e');
    assert.equal(await page.evaluate(() => window.theibsCardKeyboard.state.slots[0]), 'AE');
    await blur(); await page.keyboard.press('Shift');
    await page.waitForFunction(() => window.theibsCardKeyboard.state.slots.every(card => card === null));
    assert.deepEqual((await state()).simpleFoldedSeats, [0]);
    await page.locator('#new-hand').click();
    assert.deepEqual((await state()).simpleFoldedSeats, []);
    await page.locator('[data-simple-seat="0"]').click();
    await page.locator('#simple-seat-toggle').click();
    assert.deepEqual((await state()).simpleFoldedSeats, [0]);
    await page.evaluate(() => { const input=document.createElement('input');input.id='qa-shortcut-field';input.style.cssText='position:fixed;top:0;left:0;z-index:99999';document.body.append(input); });
    await page.locator('#qa-shortcut-field').focus();
    await page.keyboard.press("'");
    assert.deepEqual((await state()).simpleFoldedSeats, [0]);
    await page.evaluate(() => document.querySelector('#qa-shortcut-field').remove());
    await blur(); await page.keyboard.press("'");
    await page.waitForFunction(() => window.theibsApp.getState().simpleFoldedSeats.length === 0);
    checks.push('Simple Shift clears cards but preserves folds; New Game button/apostrophe clear folds; apostrophe inside a text input is ignored');
    await page.locator('#open-settings').click();
    await page.locator('#mw-setup-details>summary').click();
    await page.locator('#mw-player-count').selectOption('3');
    await page.locator('#mw-hero-position').selectOption('BTN');
    await page.locator('#mw-small-blind').fill('0.5');
    await page.locator('#mw-big-blind').fill('1');
    await page.locator('#mw-starting-stack').fill('100');
    await page.locator('#mw-start').click();
    await page.waitForFunction(() => window.theibsApp.getState().multiwayState?.heroId === 2);
    await idle();
    let hand = await state();
    assert.equal(hand.multiwayState.actor, 2);
    assert.equal(hand.multiwayState.pot, 1.5);
    assert.equal(hand.multiwayState.cardTarget, 'HERO');
    assert.equal(await page.locator('#auto-analysis').isChecked(), false);
    checks.push('PLO4 three-player BTN begins with a 1.5 blind pot and Hero cards pending');
    await checkHeader('multiway');

    await page.locator('#card-voice-disclosure > summary').click();
    await page.locator('.voice-advanced > summary').click();
    await page.locator('#voice-language').selectOption('en-US');
    await page.locator('#voice-processing').selectOption('browser');
    await page.locator('#voice-consent').check();
    await page.waitForFunction(() => window.__fakeRecognition?.length && window.theibsCardVoice.getStatus().audioReady);
    const automaticAnalysis = page.waitForRequest(request => request.url().endsWith('/api/analyze'), { timeout: 20000 });
    await page.evaluate(() => window.__fakeRecognition.at(-1).emit('ace hearts, ten clubs, queen diamonds, jack spades'));
    await page.waitForFunction(() => window.theibsApp.getState().multiway?.config.heroCards.length === 4);
    await automaticAnalysis;
    hand = await state();
    assert.deepEqual(hand.multiway.config.heroCards, ['Ah', 'Tc', 'Qd', 'Js']);
    assert.equal(hand.multiway.events.length, 0);
    checks.push('Simulated final speech enters unprefixed Hero cards; Hero auto-analysis requests despite standalone checkbox off');

    await page.locator('#voice-consent').uncheck();
    await blur(); await page.keyboard.press(';');
    assert.equal(await page.locator('#mw-inline-size').isVisible(), true);
    assert.equal(await page.locator('#mw-size').inputValue(), '2');
    // Shift is guarded inside a number editor; Esc cancels only its draft.
    await page.locator('#mw-size').press('Escape');
    assert.equal(await page.locator('#mw-inline-size').isVisible(), false);
    assert.equal((await state()).multiway.events.length, 0);
    await blur(); await page.keyboard.press(';');
    await page.locator('#mw-size').fill('2.25');
    await page.locator('#mw-size').press('Enter');
    await page.waitForFunction(() => window.theibsApp.getState().multiway.events.length === 1);
    await idle();
    hand = await state();
    assert.equal(hand.multiwayState.players[2].streetPaid, 2.25);
    assert.equal(hand.multiwayState.players[2].stack, 97.75);
    assert.equal(hand.multiwayState.pot, 3.75);
    assert.equal(hand.multiwayState.actor, 0);
    await page.waitForFunction(() => !window.theibsApp.getState().analysisBusy, null, { timeout: 30000 });
    assert.equal((await state()).lastAnalysis, null, 'Hero EV from the prior revision cannot display during A1 turn');
    checks.push('Semicolon opens inline total sizing; Esc leaves ledger unchanged; 2.25 raise moves 1.75 chips and invalidates Hero EV');

    await page.locator('#voice-consent').check();
    await page.waitForFunction(() => window.theibsCardVoice.getStatus().audioReady);
    const staleCapture = await page.evaluate(() => window.__fakeRecognition.length - 1);
    await page.evaluate(index => window.__fakeRecognition[index].emit('call', false), staleCapture);
    await page.locator('#hero-slots .playing-card').first().click();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 3);
    hand = await state();
    assert.deepEqual(hand.multiway.config.heroCards, ['Ah', 'Tc', 'Qd', 'Js']);
    assert.equal(hand.multiway.events.length, 1);
    assert.equal(await page.locator('#mw-actions [data-mw-command="passive"]').isDisabled(), true);
    await page.evaluate(index => window.__fakeRecognition[index].emit('call', true), staleCapture);
    await page.waitForTimeout(100);
    assert.equal((await state()).multiway.events.length, 1);
    await page.locator('#voice-consent').uncheck();
    await blur(); await page.keyboard.press('k'); await page.keyboard.press('c');
    await page.waitForFunction(() => window.theibsApp.getState().multiway.config.heroCards[0] === 'Kh');
    await idle();
    hand = await state();
    assert.deepEqual(hand.multiway.config.heroCards, ['Kh', 'Tc', 'Qd', 'Js']);
    assert.equal(hand.multiway.events.length, 1);
    assert.equal(hand.multiwayState.pot, 3.75);
    await page.waitForFunction(() => !document.querySelector('#mw-actions [data-mw-command="passive"]')?.disabled);
    await page.locator('#hero-slots .playing-card').first().click();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 3);
    assert.equal((await state()).multiway.events.length, 1);
    await blur(); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.theibsApp.getState().multiway.events.length === 0 && window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 4);
    await idle();
    hand = await state();
    assert.deepEqual(hand.multiway.config.heroCards, ['Kh', 'Tc', 'Qd', 'Js']);
    assert.equal(hand.multiwayState.actor, 2);
    assert.equal(hand.multiwayState.pot, 1.5);
    await blur(); await page.keyboard.press(';');
    await page.locator('#mw-size').fill('2.25');
    await page.locator('#mw-size').press('Enter');
    await page.waitForFunction(() => window.theibsApp.getState().multiway.events.length === 1);
    await idle();
    await page.locator('#hero-slots .playing-card').first().click();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 3);
    await page.locator('#voice-language').selectOption('pt-BR');
    await page.locator('#voice-consent').check();
    await page.waitForFunction(() => window.theibsCardVoice.getStatus().audioReady);
    await page.evaluate(() => window.__fakeRecognition.at(-1).emit('desfazer'));
    await page.waitForFunction(() => window.theibsApp.getState().multiway.events.length === 0 && window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 4);
    await idle();
    hand = await state();
    assert.deepEqual(hand.multiway.config.heroCards, ['Kh', 'Tc', 'Qd', 'Js']);
    assert.equal(hand.multiwayState.pot, 1.5);
    assert.equal(hand.multiwayState.actor, 2);
    await page.locator('#voice-consent').uncheck();
    await blur(); await page.keyboard.press(';');
    await page.locator('#mw-size').fill('2.25');
    await page.locator('#mw-size').press('Enter');
    await page.waitForFunction(() => window.theibsApp.getState().multiway.events.length === 1);
    await idle();
    await page.locator('#hero-slots .playing-card').first().click();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 3);
    await blur(); await page.keyboard.press('Shift');
    await page.waitForFunction(() => window.theibsCardKeyboard.state.slots.slice(0, 4).filter(Boolean).length === 4);
    hand = await state();
    assert.deepEqual(hand.multiway.config.heroCards, ['Kh', 'Tc', 'Qd', 'Js']);
    assert.equal(hand.multiwayState.pot, 3.75);
    assert.equal(hand.multiway.events.length, 1);
    await page.waitForFunction(() => !document.querySelector('#mw-actions [data-mw-command="passive"]')?.disabled);
    checks.push('Incomplete Hero edit preserves confirmed cards/ledger and blocks actions; valid replacement revalidates; stale speech ignored; Ctrl+Z, spoken desfazer and Shift restore draft');

    hand.multiwayState = await action('.', 2);
    assert.equal(hand.multiwayState.players[0].streetPaid, 2.25);
    assert.equal(hand.multiwayState.players[0].stack, 97.75);
    hand.multiwayState = await action('.', 3);
    assert.equal(hand.multiwayState.players[1].streetPaid, 2.25);
    assert.equal(hand.multiwayState.players[1].stack, 97.75);
    assert.equal(hand.multiwayState.phase, 'WAIT_BOARD');
    assert.equal(hand.multiwayState.pot, 6.75);
    checks.push('Two calls pay only the outstanding difference; pot and per-seat stacks balance');

    await blur(); await page.keyboard.press('Shift');
    hand = await state();
    assert.equal(hand.multiway.events.length, 3);
    assert.equal(hand.multiwayState.phase, 'WAIT_BOARD');
    assert.equal(hand.multiwayState.pot, 6.75);
    checks.push('Shift alone preserves confirmed ledger, turn, pot and stacks');

    await page.locator('#mw-undo').click();
    await page.waitForFunction(() => window.theibsApp.getState().multiway.events.length === 2);
    await idle();
    hand = await state();
    assert.equal(hand.multiwayState.phase, 'BETTING');
    assert.equal(hand.multiwayState.actor, 1);
    assert.equal(hand.multiwayState.pot, 5.5);
    checks.push('Undo restores the BB response, action queue, pot and stack');

    await page.locator('[data-multiway-player="1"]').click();
    await page.locator('#mw-seat-fold').click();
    await page.waitForFunction(() => window.theibsApp.getState().multiwayState.players[1].folded);
    const priorHandId = (await state()).multiway.handId;
    await page.locator('#new-hand').click();
    await page.waitForFunction(() => window.theibsApp.getState().multiway?.events.length === 0);
    await idle();
    hand = await state();
    assert.notEqual(hand.multiway.handId, priorHandId);
    assert.equal(hand.multiwayState.pot, 1.5);
    assert.equal(hand.multiwayState.players.filter(p => p.folded).length, 0);
    assert.equal(hand.multiway.config.heroCards.length, 0);
    checks.push('New Game starts a fresh preflop hand and clears cards, actions and folds');

    const afterButtonHandId = hand.multiway.handId;
    await blur(); await page.keyboard.press("'");
    await page.waitForFunction(id => window.theibsApp.getState().multiway.handId !== id, afterButtonHandId);
    await idle();
    hand = await state();
    assert.equal(hand.multiway.events.length, 0);
    assert.equal(hand.multiwayState.pot, 1.5);
    checks.push('Apostrophe starts another fresh New Game');

    const layout = [], layoutDefects = [];
    for (const [width, height] of [[320, 800], [390, 844], [768, 1024], [1366, 900]]) {
      await page.setViewportSize({ width, height });
      const measure = await page.evaluate(() => {
        const box = node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
        const pot = box(document.querySelector('.table-pot-summary'));
        const board = box(document.querySelector('#board-slots'));
        const hero = box(document.querySelector('#hero-slots'));
        const intersects = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const stacks = [...document.querySelectorAll('.multiway-seat')].map(box);
        return { viewport: innerWidth, content: document.documentElement.scrollWidth, pot, board, hero,
          potBoardOverlap: intersects(pot, board), potHeroOverlap: intersects(pot, hero),
          boardHeroOverlap: intersects(board, hero), stackHeroOverlap: stacks.some(stack => intersects(stack, hero)), stacks };
      });
      layout.push({ width, height, ...measure });
      await page.screenshot({ path: path.join(temp, `layout-${width}.png`) });
      if (measure.content > width) layoutDefects.push(`horizontal overflow at ${width}px`);
      if (measure.potBoardOverlap || measure.potHeroOverlap) layoutDefects.push(`pot overlaps cards at ${width}px: ${JSON.stringify(measure)}`);
      if (measure.boardHeroOverlap || measure.stackHeroOverlap) layoutDefects.push(`card/seat overlap at ${width}px: ${JSON.stringify(measure)}`);
      if (!(measure.pot.width > 0 && measure.pot.height > 0)) layoutDefects.push(`pot is hidden at ${width}px`);
      if (measure.stacks.length !== 2 || !measure.stacks.every(rect => rect.width > 0 && rect.height > 0)) layoutDefects.push(`stack/seat hidden at ${width}px`);
    }
    assert.deepEqual(layoutDefects, []);
    assert.deepEqual(errors, []);
    checks.push('Pot, board and seats remain visible without horizontal overflow at 320, 390, 768 and 1366 px');
    console.log(JSON.stringify({ status:'PASS', checks, analysesObserved:analyses.length,
      speechLayer:'SIMULATED_ASR_EVENTS', acousticGate:'NOT_EXECUTED', evidenceDir:temp, layout }, null, 2));
  } catch (error) {
    if (page) {
      try { console.error(JSON.stringify({ url: page.url(), title: await page.title(), body: (await page.locator('body').innerText()).slice(0, 900) })); } catch {}
    }
    console.error(JSON.stringify({ status:'FAIL', checks, evidenceDir:temp, error:String(error.stack || error) }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})();
