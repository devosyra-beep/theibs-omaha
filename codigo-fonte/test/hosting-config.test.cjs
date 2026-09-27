'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { runtimeConfig, validateDeployment } = require('../src/hosting-config');
const { publicConfig } = require('../src/supabase-service');

const hosted = {
  RENDER: 'true', RENDER_EXTERNAL_URL: 'https://theibs-test.onrender.com', PORT: '10000',
  THEIBS_AUTH_REQUIRED: 'true', THEIBS_AUTH_GOOGLE_ENABLED: 'true',
  SUPABASE_URL: 'https://testproject.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test'
};

test('local startup stays on loopback; hosting uses PORT and the Render HTTPS URL', () => {
  assert.deepEqual(runtimeConfig({}), { port: 4173, host: '127.0.0.1', origin: null, hosted: false });
  assert.equal(runtimeConfig({ THEIBS_PORT: '4175' }).port, 4175);
  assert.deepEqual(validateDeployment({ ...hosted, THEIBS_PORT: '4175' }), {
    port: 10000, host: '0.0.0.0', origin: 'https://theibs-test.onrender.com', hosted: true
  });
});

test('a custom public domain overrides Render, but insecure or malformed origins fail', () => {
  assert.equal(validateDeployment({ ...hosted, THEIBS_PUBLIC_ORIGIN: 'https://poker.example/app' }).origin, 'https://poker.example');
  for (const value of ['http://poker.example', 'invalid', 'https://user:secret@poker.example']) {
    assert.throws(() => validateDeployment({ ...hosted, THEIBS_PUBLIC_ORIGIN: value }), /HTTPS/);
  }
  assert.throws(() => validateDeployment({ ...hosted, PORT: 'not-a-port' }), /PORT/);
});

test('public startup fails closed without the configured Google authentication backend', () => {
  assert.throws(() => validateDeployment({ ...hosted, THEIBS_AUTH_REQUIRED: 'false' }), /AUTH_REQUIRED/);
  assert.throws(() => validateDeployment({ ...hosted, SUPABASE_SECRET_KEY: '' }), /SUPABASE_SECRET_KEY/);
  assert.throws(() => validateDeployment({ ...hosted, THEIBS_AUTH_GOOGLE_ENABLED: 'false' }), /Google/);
});

test('free preview cannot enable payments with incomplete configuration or ephemeral history', () => {
  const billing = { ...hosted, ABACATEPAY_API_KEY: 'dev_test', ABACATEPAY_PRODUCT_ID: 'prod_test', THEIBS_ABACATEPAY_WEBHOOK_SECRET: 'test-secret' };
  assert.throws(() => validateDeployment({ ...hosted, ABACATEPAY_API_KEY: 'dev_test' }), /webhook secret/);
  assert.throws(() => validateDeployment(billing), /persistent user storage/);
  assert.throws(() => validateDeployment({ ...billing, THEIBS_USER_DATA_ROOT: '/data/users' }), /persistent user storage/);
  assert.equal(validateDeployment({ ...billing, THEIBS_USER_DATA_ROOT: '/data/users', THEIBS_STORAGE_PERSISTENT: 'true' }).hosted, true);
});

test('misplaced privileged keys cannot reach the public config or start a hosted server', () => {
  const legacyServiceKey = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'), 'test'].join('.');
  for (const key of ['sb_secret_private', legacyServiceKey, 'unknown-key']) {
    const env = { ...hosted, SUPABASE_PUBLISHABLE_KEY: key };
    assert.throws(() => publicConfig(env), /sb_publishable_/);
    assert.throws(() => validateDeployment(env), /sb_publishable_/);
  }
  assert.throws(() => validateDeployment({ ...hosted, SUPABASE_SECRET_KEY: hosted.SUPABASE_PUBLISHABLE_KEY }), /sb_secret_/);
  assert.equal(publicConfig(hosted).supabasePublishableKey, hosted.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(JSON.stringify(publicConfig(hosted)).includes(hosted.SUPABASE_SECRET_KEY), false);
});

test('the real entrypoint exits before listening when hosted authentication is disabled', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, ...hosted, THEIBS_AUTH_REQUIRED: 'false' },
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /startup blocked: Hosted mode requires THEIBS_AUTH_REQUIRED/);
  assert.doesNotMatch(result.stdout, /THEIBS disponível/);
});
