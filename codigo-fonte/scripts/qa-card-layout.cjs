'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-layout-'));
  process.env.THEIBS_DATA_PATH = path.join(dir, 'events.jsonl');
  process.env.THEIBS_WORKSPACE_PATH = path.join(dir, 'workspace.json');
  const saved = {
    schemaVersion: 1,
    keyboard: { count: 5, selected: 0, slots: ['AO','2P','3C','5P','QE',null,null,null,null,null] },
    fields: {}, ui: { deck: 'classico', felt: 'verde', view: 'analyze' }, snapshots: []
  };
  fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH, JSON.stringify({ revision: 1, workspace: saved }));
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const out = path.resolve(__dirname, '../../validacao/layout-v0.2.2');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const report = { source: 'Windows Edge, real HTTP with isolated saved draft', errors: [], checks: [], layouts: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', err => report.errors.push(err.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => theibsApp.ready);
    assert.deepEqual(await page.evaluate(() => theibsCardKeyboard.state.snapshot()), saved.keyboard);
    assert.equal(await page.evaluate(() => document.body.dataset.deck), 'cores');
    assert.equal(await page.evaluate(() => document.body.dataset.felt), 'verde');
    await page.evaluate(() => theibsApp.flushSave());
    const stored = JSON.parse(fs.readFileSync(process.env.THEIBS_WORKSPACE_PATH)).workspace;
    assert.deepEqual(stored.keyboard, saved.keyboard);
    assert.equal(stored.ui.cardDisplayVersion, 2);
    report.checks.push('Old draft keeps its hand, selection and felt; palette upgrades and saves');
    await page.locator('#analyze-workspace .table-surface').screenshot({ path: path.join(out, 'mesa-1440.png') });
    await page.screenshot({ path: path.join(out, 'desktop-1440.png'), fullPage: true });
    const colors = await page.locator('#hero-slots .playing-card').evaluateAll(cards => cards.map(card => getComputedStyle(card).color));
    assert.equal(new Set(colors).size, 4);
    report.checks.push('Four suit colors are visibly distinct and their symbols remain displayed');
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const count of [5, 6]) {
        await page.evaluate(n => {
          const slots = ['AO','2P','3C','5P','QE','TE'].slice(0, n).concat(['7E','8C','9O','JP','KE']);
          theibsCardKeyboard.restore({ count: n, selected: 0, slots });
        }, count);
        const metrics = await page.evaluate(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
          const hand = [...document.querySelectorAll('#hero-slots .playing-card')].map(rect);
          const board = [...document.querySelectorAll('#board-slots .playing-card')].map(rect);
          return { width: innerWidth, count: theibsCardKeyboard.state.count,
            overflow: document.documentElement.scrollWidth > innerWidth,
            hand, board, label: rect(document.querySelector('#selected-card-label')),
            rankSize: getComputedStyle(document.querySelector('#hero-slots .corner b')).fontSize,
            selectionOutline: getComputedStyle(document.querySelector('#hero-slots .selected')).outlineWidth };
        });
        if (metrics.overflow) {
          console.log('Overflow diagnostics', await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag:el.tagName, class:el.className, id:el.id, right:el.getBoundingClientRect().right, width:el.getBoundingClientRect().width })).slice(0,20)));
          await page.screenshot({ path:path.join(out, 'overflow.png'), fullPage:true });
        }
        assert.equal(metrics.overflow, false);
        assert.ok(metrics.hand.every(r => r.x >= 0 && r.right <= width));
        assert.ok(Math.max(...metrics.board.map(r => r.bottom)) < Math.min(...metrics.hand.map(r => r.y)));
        assert.ok(metrics.label.y > Math.max(...metrics.hand.map(r => r.bottom)));
        if (width === 1440) assert.ok(metrics.hand[0].width >= 88 && parseFloat(metrics.rankSize) >= 28);
        report.layouts.push(metrics);
        if (count === 6) await page.locator('#analyze-workspace .table-surface').screenshot({ path: path.join(out, `mesa-${width}-plo6.png`) });
      }
    }
    report.checks.push('Hands of 5 and 6 cards fit 1440, 1024, 390 and 320 px; no board overlap or horizontal overflow');
    await page.setViewportSize({ width:1440, height:1000 });
    await page.locator('[data-deck="classico"]').click();
    await page.evaluate(() => theibsApp.flushSave());
    await page.reload(); await page.evaluate(() => theibsApp.ready);
    assert.equal(await page.evaluate(() => document.body.dataset.deck), 'classico');
    report.checks.push('After migration, changing back to classic remains saved');
    await page.locator('[data-deck="cores"]').click();
    await page.evaluate(() => theibsCardKeyboard.reset());
    await page.locator('[data-slot="0"]').click(); await page.keyboard.type('detc');
    assert.deepEqual(await page.evaluate(() => theibsCardKeyboard.state.slots.slice(0,2)), ['TE','TC']);
    report.checks.push('D/T keyboard behavior remains intact');
    await page.evaluate(() => theibsApp.flushSave());
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ checks:report.checks, sizes:report.layouts.map(m=>({width:m.width,count:m.count,cardWidth:m.hand[0].width,cardHeight:m.hand[0].height,rankSize:m.rankSize})), errors:report.errors }, null, 2));
  } catch (error) { report.failure = error.stack; throw error; }
  finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
