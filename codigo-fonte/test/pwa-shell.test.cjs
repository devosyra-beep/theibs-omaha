'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-pwa-'));
process.env.THEIBS_DATA_PATH = path.join(temp, 'events.jsonl');
process.env.THEIBS_WORKSPACE_PATH = path.join(temp, 'workspace.json');
process.env.THEIBS_LLM_CONFIG_PATH = path.join(temp, 'llm.json');
const { server } = require('../server');

test('landing, PWA shell, Google login and icons are served with correct media types', async t => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const [landing, page, manifestResponse, worker, svg, png, landingImage, dashboard, multiway] = await Promise.all([
    fetch(origin + '/').then(response => response.text()),
    fetch(origin + '/app').then(response => response.text()),
    fetch(origin + '/manifest.webmanifest'),
    fetch(origin + '/service-worker.js'),
    fetch(origin + '/icons/theibs.svg'),
    fetch(origin + '/icons/theibs-192.png'),
    fetch(origin + '/landing-assets/theibs-training.png'),
    fetch(origin + '/dashboard.js').then(response => response.text()),
    fetch(origin + '/multiway-ui.js').then(response => response.text())
  ]);
  assert.match(landing, /Poker training/);
  assert.match(landing, /Built for accessibility/);
  assert.match(landing, /href="\/app\?login=1"/);
  assert.match(landing, /<img[^>]+src="\/landing-assets\/theibs-training\.png"/);
  assert.match(page, /id="login-screen"/);
  assert.match(page, /Continue with Google/);
  assert.match(page, /id="header-signout"[^>]*>Sign out</);
  assert.doesNotMatch(page, /Continue with Apple/);
  assert.doesNotMatch(page, /Continue on this device/);
  assert.match(page, /rel="manifest"/);
  assert.equal(manifestResponse.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/app');
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(landingImage.headers.get('content-type'), 'image/png');
  assert.match(dashboard, /data-close-dialog commandfor="\$\{id\}" command="close"/);
  assert.match(dashboard, /data-dialog-target="#settings-dialog" commandfor="settings-dialog" command="show-modal"/);
  assert.doesNotMatch(dashboard, /openCardsSettings|addEventListener\('focusin'/);
  assert.match(multiway, /id: 'leave', key: null, code: null/);
  assert.match(multiway, /id: 'call', key: ',', code: 'Comma'/);
  assert.match(multiway, /id: 'check', key: '\.', code: 'Period'/);
  assert.match(multiway, /id: 'aggressive', key: ';', code: 'Semicolon'/);
});
