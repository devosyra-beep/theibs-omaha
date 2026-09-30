'use strict';

// Real-browser geometry and keyboard smoke test for the responsive navigation.
// Run with NODE_PATH pointing to the bundled Playwright packages if needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:4175';
const edge = process.env.THEIBS_QA_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const shots = process.env.THEIBS_QA_SHOTS;

async function geometry(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: box.width, height: box.height, display: style.display };
    };
    return {
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      toggle: rect('#mobile-nav-toggle'), brand: rect('.rail-header .brand'),
      nav: rect('#main-nav'), topbar: rect('#app-topbar'), plus: rect('#new-hand'),
      heading: rect('#analyze-workspace .view-heading')
    };
  });
}

async function run() {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [];
  try {
    for (const width of [320, 393, 700, 701, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL('/app', base).href, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!document.querySelector('#mobile-nav-toggle'));
      let g = await geometry(page);
      assert.ok(g.scrollWidth <= width + 1, `${width}px initial horizontal overflow: ${g.scrollWidth}`);
      if (width <= 700) {
        assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'), 'false');
        assert.notEqual(g.toggle.display, 'none');
        assert.equal(g.brand.display, 'none');
        assert.equal(g.nav.display, 'none');
        assert.equal(g.topbar.display, 'none');
        assert.ok(g.heading.width <= 1, `${width}px heading still occupies mobile layout`);
        if (shots && width === 393) {
          fs.mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: path.join(shots, 'mobile-closed.png') });
        }
        await page.locator('#mobile-nav-toggle').click();
        g = await geometry(page);
        assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'), 'true');
        assert.notEqual(g.brand.display, 'none');
        assert.notEqual(g.nav.display, 'none');
        assert.notEqual(g.topbar.display, 'none');
        assert.ok(g.scrollWidth <= width + 1, `${width}px expanded horizontal overflow: ${g.scrollWidth}`);
        assert.ok(g.plus.left >= g.topbar.left && g.plus.right <= g.topbar.right + 1,
          `${width}px plus is outside the topbar`);
        assert.ok(Math.abs((g.plus.top + g.plus.bottom) / 2 - (g.topbar.top + g.topbar.bottom) / 2) <= 5,
          `${width}px plus is vertically misaligned`);
        if (shots && width === 393) await page.screenshot({ path: path.join(shots, 'mobile-open.png') });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'mobile-nav-toggle');
      } else {
        assert.equal(g.toggle.display, 'none');
        assert.notEqual(g.nav.display, 'none');
        assert.notEqual(g.topbar.display, 'none');
        assert.ok(g.plus.left >= g.topbar.left && g.plus.right <= g.topbar.right + 1,
          `${width}px plus is outside the topbar`);
        if (shots && width === 1440) {
          fs.mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: path.join(shots, 'desktop.png') });
        }
      }
      assert.deepEqual(errors, [], `${width}px browser errors`);
      checks.push({ width, status: 'PASS' });
      await context.close();
    }
    console.log(JSON.stringify({ base, checks }));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
