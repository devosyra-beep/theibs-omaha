'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-image-'));
Object.assign(process.env, { THEIBS_AUTH_REQUIRED: 'false', THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
  THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json') });
const { server } = require('../server');
const checks = [], errors = [];
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const cardSets = { 4: ['As', 'Kd', 'Qh', 'Jc'], 5: ['As', 'Kd', 'Qh', 'Jc', 'Ts'], 6: ['As', 'Kd', 'Qh', 'Jc', 'Ts', '9d'] };
    for (const width of [320, 360, 390, 430, 768, 1440]) for (const count of [390, 1440].includes(width) ? [4, 5, 6] : [4]) {
      const initial = { schemaVersion: 1, keyboard: { count, selected: 0, slots: Array(count + 5).fill(null) },
        fields: { players: '2', position: 'SB', potBeforeAction: '', amountToCall: '', effectiveStack: '100', samples: '500', seed: '42', 'auto-analysis': false },
        ui: { felt: 'preto', deck: 'cores', view: 'analyze', cardDisplayVersion: 2, workflowVersion: 1, sidebarCollapsed: true }, snapshots: [] };
      fs.writeFileSync(process.env.THEIBS_WORKSPACE_PATH, JSON.stringify({ revision: 1, workspace: initial }));
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      page.on('pageerror', error => errors.push(`${width}/PLO${count}: ${error.stack || error.message}`));
      page.setDefaultTimeout(15000);
      await page.goto(`http://127.0.0.1:${server.address().port}/app`);
      await page.waitForFunction(() => Boolean(window.theibsApp));
      await page.evaluate(() => theibsApp.ready);
      assert.equal(await page.evaluate(() => theibsCardKeyboard.state.count), count);
      assert.equal(await page.locator('#mw-image-open').isVisible(), false);
      await page.evaluate(() => document.querySelector('#settings-dialog').showModal());
      await page.locator('#mw-setup-details>summary').click();
      await page.locator('#mw-player-count').selectOption('2');
      await page.locator('#mw-hero-position').selectOption('SB');
      await page.locator('#mw-start').click();
      await page.waitForFunction(() => theibsApp.getState().multiwayState?.phase === 'BETTING');
      assert.equal(await page.locator('#mw-image-open').isVisible(), true);
      const fixture = Buffer.from(await page.evaluate(heroText => {
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#211332'; ctx.fillRect(0, 0, 1000, 600);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 36px Arial'; ctx.fillText('2s 3h 4d', 370, 300);
        ctx.fillText(heroText, 330, 500);
        return canvas.toDataURL('image/png').split(',')[1];
      }, cardSets[count].join(' ')), 'base64');
      await page.locator('#mw-image-open').click();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'mw-image-file');
      assert.equal(await page.locator('#mw-image-camera').getAttribute('capture'), 'environment');
      await page.locator('#mw-image-file').setInputFiles({ name: 'mesa-de-teste.png', mimeType: 'image/png', buffer: fixture });
      await page.locator('#mw-image-stage').waitFor({ state: 'visible', timeout: 5000 }).catch(async error => { const data = await page.evaluate(async () => { const f = document.querySelector('#mw-image-file').files?.[0]; const b = f && await f.arrayBuffer(); const u = URL.createObjectURL(f); const i = new Image(); i.src = u; let decoded = 'ok'; try { await i.decode(); } catch(e) { decoded = e.message; } URL.revokeObjectURL(u); return { type:f?.type,size:f?.size,head:b ? Array.from(new Uint8Array(b).slice(0,12)) : [], decoded }; }); throw Error(`${error.message}; status=${await page.locator('#mw-image-status').innerText()}; file=${JSON.stringify(data)}; errors=${errors.join('|')}`); });
      if (width === 390 && process.env.THEIBS_TEST_OCR === '1') {
        const started = Date.now();
        await page.locator('#mw-image-read').click();
        await page.waitForFunction(() => document.querySelector('#mw-image-status').textContent.startsWith('Leitura preliminar.'), null, { timeout: 45000 });
        const recognized = await page.evaluate(() => ({ hero: document.querySelector('#mw-image-hero').value, board: document.querySelector('#mw-image-board').value }));
        assert.deepEqual(recognized.hero.split(' '), cardSets[count]);
        assert.equal(recognized.board, '2s 3h 4d');
        checks.push(`390px PLO${count}: OCR local leu cartas sintéticas da mão e flop em ${Date.now() - started} ms`);
        if (count === 4 && process.env.THEIBS_IMAGE_QA_DIR) {
          fs.mkdirSync(process.env.THEIBS_IMAGE_QA_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.THEIBS_IMAGE_QA_DIR, 'multiway-image-390-ocr.png') });
        }
      }
      await page.locator('#mw-image-hero').fill(cardSets[count].join(' '));
      await page.locator('#mw-image-apply-hero').click();
      await page.waitForFunction(expected => JSON.stringify(theibsApp.getState().multiway.config.heroCards) === JSON.stringify(expected), cardSets[count], { timeout: 5000 }).catch(async error => { throw Error(`${error.message}; status=${await page.locator('#mw-image-status').innerText()}; state=${JSON.stringify(await page.evaluate(() => ({ config:theibsApp.getState().multiway.config, count:theibsCardKeyboard.state.count, input:document.querySelector('#mw-image-hero').value })))}`); });
      await page.locator('#mw-image-board').fill('2s 3h 4d');
      await page.locator('#mw-image-apply-board').click();
      assert.match(await page.locator('#mw-image-status').innerText(), /Record the observed actions/);
      assert.equal((await page.evaluate(() => theibsApp.getState().multiwayState.board)).length, 0);
      await page.locator('[data-mw-image-close]').click();
      for (let i = 0; i < 3; i++) {
        const state = await page.evaluate(() => theibsApp.getState().multiwayState);
        if (state.phase === 'WAIT_BOARD') break;
        const action = state.legal.actions.includes('CHECK') ? 'CHECK' : 'CALL';
        await page.locator(`[data-mw-action="${action}"]`).click();
        await page.waitForFunction(previous => theibsApp.getState().multiwayState.log.length > previous, state.log.length);
      }
      assert.equal(await page.evaluate(() => theibsApp.getState().multiwayState.phase), 'WAIT_BOARD');
      await page.locator('#mw-image-open').click();
      await page.locator(width === 390 && count === 4 ? '#mw-image-camera' : '#mw-image-file').setInputFiles({ name: 'mesa-flop.png', mimeType: 'image/png', buffer: fixture });
      await page.locator('#mw-image-stage').waitFor({ state: 'visible' });
      await page.locator('#mw-image-hero').fill(cardSets[count].join(' '));
      await page.locator('#mw-image-board').fill('2s 3h 4d');
      await page.locator('#mw-image-apply-board').click();
      await page.waitForFunction(() => theibsApp.getState().multiwayState.board.length === 3);
      assert.deepEqual(await page.evaluate(() => theibsApp.getState().multiwayState.board), ['2s', '3h', '4d']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      assert.equal(await page.locator('#mw-image-apply-board').evaluate(el => el.getBoundingClientRect().height >= 44), true);
      if (count === 4 && process.env.THEIBS_IMAGE_QA_DIR) {
        fs.mkdirSync(process.env.THEIBS_IMAGE_QA_DIR, { recursive: true });
        await page.locator('#mw-image-dialog').evaluate(element => { element.scrollTop = 0; });
        await page.screenshot({ path: path.join(process.env.THEIBS_IMAGE_QA_DIR, `multiway-image-${width}-top.png`) });
        await page.locator('#mw-image-dialog').evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.screenshot({ path: path.join(process.env.THEIBS_IMAGE_QA_DIR, `multiway-image-${width}.png`) });
      }
      checks.push(`${width}px PLO${count}: imagem aberta, cartas aplicadas, avanço prematuro bloqueado, flop registrado`);
      await page.evaluate(() => theibsApp.flushSave());
      await page.waitForFunction(() => !theibsApp.getState().saveBusy);
      assert.equal(fs.readFileSync(process.env.THEIBS_WORKSPACE_PATH, 'utf8').includes('data:image'), false);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', checks, errors, note: 'Synthetic image only; OCR accuracy on GGPoker/PokerStars not measured.' }, null, 2));
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
