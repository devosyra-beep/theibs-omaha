'use strict';

// Browser integration check with simulated auth, billing responses and ASR.
// It never opens the microphone or creates a real payment.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:4175';
const edge = process.env.THEIBS_QA_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'qa@example.com' };
const config = { required: true, supabaseUrl: 'https://fixture.supabase.co',
  supabasePublishableKey: 'sb_publishable_fixture', providers: { google: true },
  billingEnabled: true, trialDays: 3, planPriceBrl: 250 };
const access = { allowed: true, state: 'TRIAL', daysRemaining: 2, user };

async function run() {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('theibs.auth.session.v1', JSON.stringify({ access_token: 'qa-jwt',
        refresh_token: 'qa-refresh', expires_at: Date.now() + 3_600_000 }));
      class FakeRecognition {
        start() { this.onstart?.(); this.onaudiostart?.(); }
        abort() { this.onaudioend?.(); this.onend?.(); }
        stop() { this.onaudioend?.(); this.onend?.(); }
      }
      window.SpeechRecognition = FakeRecognition;
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/public-config', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ status: 'OK', auth: config }) }));
    await page.route('**/api/access', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ status: 'OK', access }) }));
    await page.route('**/api/billing/offer', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ status: 'OK', access,
        offer: { priceCents: 25000, currency: 'BRL', accessLabel: 'Permanent access',
          renewal: false, methods: ['PIX', 'CARD'] } }) }));
    await page.route('**/api/billing/order', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ status: 'OK', access, order: null }) }));
    await page.goto(new URL('/app', base).href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.theibsCardVoice && !document.querySelector('#app-shell').hidden);
    await page.locator('#card-voice-disclosure > summary').click();
    await page.locator('#voice-consent').check();
    await page.waitForFunction(() => window.theibsCardVoice.getStatus().enabled);
    const before = await page.evaluate(() => window.theibsCardKeyboard.state.snapshot().slots);
    const voiceBefore = await page.evaluate(() => window.theibsCardVoice.getStatus());
    assert.equal(voiceBefore.enabled, true);
    assert.equal(await page.locator('#voice-consent').isChecked(), true);
    await page.locator('#mobile-nav-toggle').click();
    await page.locator('#mobile-tools > summary').click();
    await page.locator('#open-auth').click();
    await page.waitForFunction(() => document.querySelector('#billing-dialog').open);
    assert.equal(await page.evaluate(() => window.theibsCardVoice.getStatus().enabled), true);
    assert.equal(await page.locator('#voice-consent').isChecked(), true);
    assert.equal(await page.evaluate(() => window.theibsCardVoice.getStatus().audioReady), false);
    await page.keyboard.press('a');
    await page.keyboard.press('e');
    assert.deepEqual(await page.evaluate(() => window.theibsCardKeyboard.state.snapshot().slots), before,
      'Account modal must block card keyboard input');
    assert.equal(await page.locator('#billing-price').innerText(), 'R$250.00');
    assert.equal(await page.locator('#billing-methods button').count(), 2);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#billing-dialog').open);
    assert.equal(await page.evaluate(() => window.theibsCardVoice.getStatus().enabled), true);
    assert.equal(await page.locator('#voice-consent').isChecked(), true);
    await page.waitForFunction(() => window.theibsCardVoice.getStatus().audioReady, null, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.theibsCardKeyboard.state.snapshot().slots), before,
      'Closing Account must preserve the hand');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', auth: 'SIMULATED', gateway: 'SIMULATED',
      speech: 'SIMULATED', browser: 'Edge', checks: ['voice intent retained', 'ASR paused in modal',
        'card shortcuts blocked', 'Escape closes', 'hand preserved', 'payment offer shown'] }));
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
