import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { createHttpMailTransport } from '../server/mail-transport.js';

function setup(values = {}, database) {
  const config = createConfig({ NODE_ENV: 'test', PUBLIC_URL: 'https://kanba.test', ADMIN_PASSWORD: 'SYNTHETIC-ADMIN-PASSWORD', ...values });
  database ||= memoryRepository(withRuntime({ config }, createInitialStore));
  const services = { config, database, fetch, mailConfigured: false,
    network: () => ({ secure: true, ip: '192.0.2.1' }), assets: async () => new Response('asset'),
    sendMail: async () => { throw new Error('mail forbidden'); } };
  return { services, database, app: createApp(services) };
}
function post(app, path, body) {
  return app.request('https://kanba.test' + path, { method: 'POST', headers: { Origin: 'https://kanba.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('concurrent application instances keep configuration, users and transactions isolated', async () => {
  const a = setup(), b = setup();
  const responses = await Promise.all([post(a.app, '/api/auth/register', { name: 'User A', email: 'a@example.invalid', password: 'synthetic-password-A' }),
    post(b.app, '/api/auth/register', { name: 'User B', email: 'b@example.invalid', password: 'synthetic-password-B' })]);
  assert.deepEqual(responses.map(r => r.status), [201, 201]);
  assert.deepEqual(a.database.snapshot().users.map(u => u.email), ['a@example.invalid']);
  assert.deepEqual(b.database.snapshot().users.map(u => u.email), ['b@example.invalid']);
});

test('failed commit never publishes user/session success', async () => {
  const { app, database } = setup();
  database.failCommit = true;
  const response = await post(app, '/api/auth/register', { name: 'User A', email: 'a@example.invalid', password: 'synthetic-password-A' });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(database.snapshot().users.length, 0);
});

test('Google state survives app instances, is browser-bound and consumed once', async () => {
  const values = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret' };
  const first = setup(values), second = setup(values, first.database);
  let exchanges = 0;
  second.services.fetch = async url => {
    exchanges++;
    return Response.json(String(url).includes('/token') ? { access_token: 'synthetic-access' }
      : { sub: 'google-synthetic', email: 'google@example.invalid', email_verified: true, name: 'Google User' });
  };
  const start = await first.app.request('https://kanba.test/api/auth/google?next=/reservar.html', { headers: { 'x-forwarded-host': 'attacker.invalid' } });
  const location = new URL(start.headers.get('location'));
  assert.equal(location.searchParams.get('redirect_uri'), 'https://kanba.test/api/auth/google/callback');
  const state = location.searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const callback = `https://kanba.test/api/auth/google/callback?code=synthetic&state=${state}`;
  const missing = await second.app.request(callback);
  assert.match(missing.headers.get('location'), /google_state/);
  assert.equal(exchanges, 0);
  const success = await second.app.request(callback, { headers: { Cookie: cookie } });
  assert.equal(success.headers.get('location'), '/reservar.html');
  assert(success.headers.getSetCookie().some(c => c.startsWith('kanba_user=')));
  assert.equal(second.database.snapshot().users.length, 1);
  const replay = await first.app.request(callback, { headers: { Cookie: cookie } });
  assert.match(replay.headers.get('location'), /google_state/);
  assert.equal(exchanges, 2);
  const userCookie = success.headers.getSetCookie().find(c => c.startsWith('kanba_user=')).split(';')[0];
  const logout = await second.app.request('https://kanba.test/api/auth/logout', {
    method: 'POST', headers: { Origin: 'https://kanba.test', 'Content-Type': 'application/json', Cookie: userCookie }, body: '{}'
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /^kanba_user=;.*Max-Age=0/);
  assert.deepEqual(second.database.snapshot().userSessions, {});
  const me = await first.app.request('https://kanba.test/api/auth/me', { headers: { Cookie: userCookie } });
  assert.equal((await me.json()).authenticated, false);
});

test('OAuth reports safe failure stages, consumes state once and rejects recursive next destinations', async () => {
  for (const [scenario, expected] of [
    ['invalid_client', 'google_client_rejected'], ['invalid_grant', 'google_code_rejected'],
    ['network', 'google_token_network_failed'], ['bad_json', 'google_token_invalid_response'],
    ['profile', 'google_profile_failed'], ['unverified', 'google_email_unverified'],
    ['missing', 'google_code_missing'], ['success', null]
  ]) {
    const { app, services, database } = setup({ GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic' });
    let calls = 0;
    services.fetch = async url => {
      calls++;
      if (String(url).includes('/token')) {
        if (scenario === 'network') throw new Error('SENSITIVE_SYNTHETIC');
        if (scenario === 'bad_json') return new Response('not JSON');
        if (scenario.startsWith('invalid_')) return Response.json({ error: scenario, error_description: 'SENSITIVE_SYNTHETIC' }, { status: 400 });
        return Response.json({ access_token: 'synthetic-access' });
      }
      if (scenario === 'profile') return Response.json({ error: 'SENSITIVE_SYNTHETIC' }, { status: 500 });
      return Response.json({ sub: 'synthetic-sub', email: 'synthetic@example.invalid', email_verified: scenario !== 'unverified', name: 'Synthetic' });
    };
    const start = await app.request('https://kanba.test/api/auth/google?next=/api/auth/google');
    const issued = start.headers.get('set-cookie');
    assert.match(issued, /SameSite=Lax; Path=\/api\/auth\/google; Max-Age=600; Secure/);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cookie = issued.split(';')[0];
    const callback = `https://kanba.test/api/auth/google/callback?state=${state}${scenario === 'missing' ? '' : '&code=synthetic'}`;
    const result = await app.request(callback, { headers: { Cookie: cookie } });
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('location'), expected ? `/login.html?error=${expected}` : '/');
    assert(result.headers.getSetCookie().some(c => /^kanba_oauth=;.*Path=\/api\/auth\/google; Max-Age=0; Secure/.test(c)));
    assert(!result.headers.get('location').includes('SENSITIVE'));
    if (expected) {
      assert.equal(database.snapshot().users.length, 0);
      assert.deepEqual(database.snapshot().userSessions, {});
      assert(!result.headers.getSetCookie().some(c => c.startsWith('kanba_user=')));
    }
    const beforeReplay = calls;
    const replay = await app.request(callback, { headers: { Cookie: cookie } });
    assert.match(replay.headers.get('location'), /google_state/);
    assert.equal(calls, beforeReplay);
  }
});

test('OAuth persistence failure rolls back user creation and publishes no session cookie', async () => {
  const { app, services, database } = setup({ GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic' });
  services.fetch = async url => Response.json(String(url).includes('/token') ? { access_token: 'synthetic' }
    : { sub: 'synthetic', email: 'synthetic@example.invalid', email_verified: true });
  const start = await app.request('https://kanba.test/api/auth/google');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  database.failCommit = true;
  const result = await app.request(`https://kanba.test/api/auth/google/callback?state=${state}&code=synthetic`, { headers: { Cookie: cookie } });
  assert.equal(result.status, 500);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(database.snapshot().users.length, 0);
  assert.deepEqual(database.snapshot().userSessions, {});
});

test('production payment routes retain fail-closed behavior through Hono', async () => {
  const { app } = setup({ NODE_ENV: 'production' });
  for (const path of ['/api/payments/pi_synthetic/pay', '/api/webhooks/payments']) {
    const response = await post(app, path, { paymentToken: 'tok_demo_4242' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'gateway_not_configured');
  }
});

test('mail gateway sends only the portable message contract, never SMTP credentials', async () => {
  let sent;
  const transport = createHttpMailTransport({ MAIL_API_URL: 'https://mail.example.invalid/send', MAIL_API_TOKEN: 'synthetic' }, async (url, options) => {
    sent = options; return new Response(null, { status: 202 });
  });
  await transport({ to: 'test@example.invalid', fromEmail: 'sender@example.invalid', subject: 'Test', messageId: 'mail_one', pass: 'DO_NOT_SEND', user: 'DO_NOT_SEND', host: 'DO_NOT_SEND' });
  assert(!sent.body.includes('DO_NOT_SEND'));
  assert.equal(sent.headers['Idempotency-Key'], 'mail_one');
});

test('actual workerd runs Hono, scrypt registration, sessions, CSRF and assets', { timeout: 60000 }, async () => {
  const bundle = await build({ entryPoints: ['tests/helpers/worker-fixture.mjs'], bundle: true, write: false,
    format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*'] });
  const mf = new Miniflare({ workers: [{ config: { name: 'kanba-test',
    compatibilityDate: '2026-11-18', compatibilityFlags: ['nodejs_compat'],
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle.outputFiles[0].text } } }
  } }] });
  try {
    const response = await mf.dispatchFetch('https://kanba.test/api/auth/register', { method: 'POST',
      headers: { Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Worker User', email: 'worker@example.invalid', password: 'synthetic-worker-password' }) });
    assert.equal(response.status, 201, await response.clone().text());
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const me = await mf.dispatchFetch('https://kanba.test/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal((await me.json()).user.email, 'worker@example.invalid');
    const csrf = await mf.dispatchFetch('https://kanba.test/api/auth/logout', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(csrf.status, 403);
    const asset = await mf.dispatchFetch('https://kanba.test/');
    assert.equal(await asset.text(), 'static fixture');
    assert.equal(asset.headers.get('cache-control'), 'no-store');
  } finally { await mf.dispose(); }
});

test('production Workers entry loads Postgres.js and serves health/assets without opening a database connection', { timeout: 60000 }, async () => {
  const bundle = await build({ entryPoints: ['tests/helpers/worker-entry-fixture.mjs'], bundle: true, write: false,
    format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'],
    alias: Object.fromEntries(builtinModules.filter(name => !name.startsWith('node:')).map(name => [name, `node:${name}`])),
    external: ['node:*', 'cloudflare:*'] });
  const mf = new Miniflare({ workers: [{ config: { name: 'kanba-entry-test',
    compatibilityDate: '2026-11-18', compatibilityFlags: ['nodejs_compat'],
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle.outputFiles[0].text } } }
  } }] });
  try {
    const health = await mf.dispatchFetch('https://kanba.test/api/health');
    assert.equal(health.status, 200, await health.clone().text());
    assert.equal((await health.json()).ok, true);
    const asset = await mf.dispatchFetch('https://kanba.test/');
    assert.equal(await asset.text(), 'asset from binding');
    assert.equal(asset.headers.get('cache-control'), 'no-store');
  } finally { await mf.dispose(); }
});
