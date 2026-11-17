import { safeEqual } from '../server/security.js';
import { safeErrorMessage } from '../server/safe-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { charge } from '../server/gateway.js';
import { requirePaymentPermission, PaymentPolicyError } from '../server/payment-policy.js';
import { postgresConnectionOptions, verifiedTlsOptions } from '../server/tls-config.js';
import { paymentSecrets, settingsWithoutSecrets, serializeStore, containsIncomingSecrets } from '../server/runtime-secrets.js';

const source = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert(start >= 0);
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
async function environment(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return await callback(); }
  finally { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } }
}
function router(mode) {
  const reservation = { code: 'SYNTHETIC', token: 'synthetic-token', status: 'pending_payment', total: 10,
    currency: 'GTQ', holdExpiresAt: new Date(Date.now() + 600000).toISOString(), history: [],
    payment: { intentId: 'pi_synthetic', provider: 'test' } };
  const db = { settings: { payments: { mode, provider: 'test' } }, reservations: [reservation] };
  let saves = 0;
  const context = vm.createContext({ process, Date, Buffer, requirePaymentPermission, charge,
    paymentSecrets, settingsWithoutSecrets, containsIncomingSecrets, safeEqual, getReservation: () => reservation,
    getDb: () => db, saveDb: () => saves++, readJson: async req => req.body,
    readBody: async () => { throw new Error('webhook body must not be read'); },
    requireAdmin: () => ({}), nextReceiptNumber: () => 'synthetic-receipt',
    notifyConfirmed: async () => {}, sendJson: (res, status, body) => ({ status, body }),
    AppError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
  });
  const s = source('server/index.js');
  for (const name of ['applyApprovedPayment', 'mergeAdminSettings', 'publicAdminSettings']) vm.runInContext(fn(s, name), context);
  vm.runInContext('async ' + fn(s, 'handleApi'), context);
  return { context, db, reservation, saves: () => saves,
    request: (path, body = {}) => context.handleApi({ method: 'POST', body }, {}, new URL(path, 'https://test.invalid')) };
}

test('production rejects sandbox, live, unknown modes, demo/test tokens and manual confirmations', async () => {
  await environment({ NODE_ENV: 'production' }, async () => {
    for (const mode of ['sandbox', 'live', 'invalid', '', null]) {
      for (const token of ['tok_demo_4242', 'tok_test_4242', 'provider_token']) {
        assert.equal(charge({ reservation: { total: 10 }, paymentToken: token, mode }).approved, false);
      }
      const r = router(mode);
      const before = JSON.stringify(r.reservation);
      await assert.rejects(r.request('/api/payments/pi_synthetic/pay', { token: 'synthetic-token', paymentToken: 'tok_demo_4242', mode: 'sandbox' }), PaymentPolicyError);
      await assert.rejects(r.request('/api/webhooks/payments'), PaymentPolicyError);
      await assert.rejects(r.request('/api/admin/reservations/SYNTHETIC/confirm'), PaymentPolicyError);
      assert.equal(JSON.stringify(r.reservation), before);
      assert.equal(r.saves(), 0);
      assert.throws(() => r.context.applyApprovedPayment(r.reservation, { approved: true }), PaymentPolicyError);
    }
  });
});

test('development sandbox works; browser cannot override live mode; unknown modes and webhooks fail closed', async () => {
  await environment({ NODE_ENV: 'development' }, async () => {
    const r = router('sandbox');
    const result = await r.request('/api/payments/pi_synthetic/pay', { token: 'synthetic-token', paymentToken: 'tok_demo_4242', mode: 'live' });
    assert.equal(result.status, 200);
    assert.equal(r.reservation.status, 'confirmed');
    const live = router('live');
    await assert.rejects(live.request('/api/payments/pi_synthetic/pay', { token: 'synthetic-token', paymentToken: 'tok_demo_4242', mode: 'sandbox' }), PaymentPolicyError);
    assert.equal(live.saves(), 0);
    assert.throws(() => requirePaymentPermission('unknown'), PaymentPolicyError);
    await assert.rejects(router('sandbox').request('/api/webhooks/payments'), PaymentPolicyError);
  });
});

test('PostgreSQL TLS verifies host and certificates; URL/environment overrides cannot downgrade it', () => {
  const config = postgresConnectionOptions('postgres://synthetic:synthetic@db.example.invalid/app?sslmode=verify-full', {});
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.minVersion, 'TLSv1.2');
  assert.equal(config.ssl.servername, 'db.example.invalid');
  assert(!config.connectionString.includes('sslmode'));
  assert(config.ssl.checkServerIdentity('ignored', { subjectaltname: 'DNS:other.invalid' }) instanceof Error);
  assert.equal(config.ssl.checkServerIdentity('ignored', { subjectaltname: 'DNS:db.example.invalid' }), undefined);
  for (const query of ['sslmode=disable', 'sslmode=require', 'sslmode=no-verify', 'ssl=false', 'sslrootcert=file', 'host=other.invalid', 'uselibpqcompat=true']) {
    assert.throws(() => postgresConnectionOptions('postgres://test.invalid/app?' + query, {}));
  }
  for (const env of [{ PGSSLMODE: 'disable' }, { PGSSLMODE: 'prefer' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) {
    assert.throws(() => postgresConnectionOptions('postgres://test.invalid/app', env));
  }
});

test('custom TLS identity and CA configuration are validated without exposing values', () => {
  const opts = verifiedTlsOptions('SMTP', '192.0.2.1', { SMTP_TLS_SERVERNAME: 'mail.example.invalid' });
  assert.equal(opts.servername, 'mail.example.invalid');
  assert.equal(opts.checkServerIdentity('', { subjectaltname: 'DNS:mail.example.invalid' }), undefined);
  for (const env of [{ SMTP_TLS_CA: 'SYNTHETIC_SECRET' }, { SMTP_TLS_CA_FILE: 'missing-synthetic-ca' }, { SMTP_TLS_CA: 'x', SMTP_TLS_CA_FILE: 'y' }]) {
    assert.throws(() => verifiedTlsOptions('SMTP', 'test.invalid', env), error => !error.message.includes('SYNTHETIC_SECRET'));
  }
});

test('settings APIs reject secrets, snapshots omit them and runtime uses environment only', async () => {
  await environment({ PAYMENTS_SECRET_KEY: 'ENV_SYNTHETIC_A', PAYMENTS_WEBHOOK_SECRET: 'ENV_SYNTHETIC_B', SMTP_PASS: 'ENV_SYNTHETIC_C' }, async () => {
    const base = { payments: { secretKey: 'OLD_SYNTHETIC_A', webhookSecret: 'OLD_SYNTHETIC_B' }, smtp: { pass: 'OLD_SYNTHETIC_C' } };
    const r = router('sandbox');
    assert.throws(() => r.context.mergeAdminSettings(base, { payments: { secretKey: 'NEW_SYNTHETIC' } }));
    const clean = r.context.mergeAdminSettings(base, { payments: { secretKey: '', webhookSecret: '' }, smtp: { pass: '' } });
    assert(!JSON.stringify(clean).includes('SYNTHETIC'));
    const publicSettings = r.context.publicAdminSettings(base);
    assert(!JSON.stringify(publicSettings).includes('SYNTHETIC'));
    assert(publicSettings.payments.secretKeyConfigured);
    const serialized = serializeStore({ settings: base, reservations: [{ code: 'preserved' }] });
    assert(!serialized.includes('SYNTHETIC'));
    assert.equal(JSON.parse(serialized).reservations[0].code, 'preserved');
    assert.equal(base.payments.secretKey, 'OLD_SYNTHETIC_A');
    assert.equal(paymentSecrets().secretKey, 'ENV_SYNTHETIC_A');
    const context = vm.createContext({ process, getDb: () => ({ settings: base }) });
    vm.runInContext(fn(source('server/mailer.js'), 'getEffectiveSmtpConfig'), context);
    assert.equal(context.getEffectiveSmtpConfig().pass, 'ENV_SYNTHETIC_C');
    delete process.env.SMTP_PASS;
    assert.equal(context.getEffectiveSmtpConfig().pass, '');
  });
});

async function smtpScenario({ secure = false, starttls = true, handshakeFail = false, authorized = true, authFail = false, fragmented = false, textBody = 'test' } = {}) {
  const writes = [], tlsCalls = [], logs = [];
  class Socket extends EventEmitter {
    constructor(encrypted = false) { super(); this.encrypted = encrypted; this.authorized = encrypted && authorized; }
    setEncoding() {}
    destroy() { this.destroyed = true; queueMicrotask(() => this.emit('close')); }
    reply(value) {
      queueMicrotask(() => {
        if (this.destroyed) return;
        if (fragmented) for (let i = 0; i < value.length; i += 7) this.emit('data', value.slice(i, i + 7));
        else this.emit('data', value);
      });
    }
    write(line) {
      writes.push({ line, encrypted: this.encrypted, authorized: this.authorized });
      if (line.startsWith('EHLO')) this.reply(this.encrypted ? '250-server\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 100000\r\n' : `250-server\r\n${starttls ? '250-STARTTLS\r\n' : ''}250 SIZE 100000\r\n`);
      else if (line.startsWith('STARTTLS')) this.reply('220 Ready\r\n');
      else if (line.startsWith('AUTH')) this.reply(authFail ? '535 SYNTHETIC_SECRET_REMOTE\r\n' : '235 Authenticated\r\n');
      else if (line === 'DATA\r\n') this.reply('354 Continue\r\n');
      else this.reply('250 Accepted\r\n');
    }
  }
  const net = { connect() { const socket = new Socket(); socket.reply('220 Ready\r\n'); return socket; } };
  const tls = { connect(options) {
    tlsCalls.push(options);
    const socket = new Socket(true);
    queueMicrotask(() => {
      if (handshakeFail) socket.emit('error', new Error('SYNTHETIC_SECRET_CERT'));
      else {
        socket.emit('secureConnect');
        if (!options.socket) socket.reply('220 Ready\r\n');
      }
    });
    return socket;
  } };
  const context = vm.createContext({ Buffer, setTimeout, clearTimeout, console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  const module = new vm.SourceTextModule(source('server/smtp.js'), { context });
  await module.link(specifier => {
    const exports = specifier === 'node:net' ? { default: net } : specifier === 'node:tls' ? { default: tls } : { verifiedTlsOptions };
    return new vm.SyntheticModule(Object.keys(exports), function() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  let result, error;
  try { result = await module.namespace.sendSmtpMail({ host: 'smtp.example.invalid', secure, user: 'synthetic-user', pass: 'SYNTHETIC_SECRET_PASS', fromEmail: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'test', html: '<p>test</p>', text: textBody }); }
  catch (err) { error = err; }
  return { result, error, writes, tlsCalls, logs };
}

test('SMTP missing STARTTLS sends no credentials or mail', async () => {
  const s = await smtpScenario({ starttls: false });
  assert(s.error);
  assert.equal(s.tlsCalls.length, 0);
  assert(!s.writes.some(w => /AUTH|MAIL FROM|SYNTHETIC_SECRET/.test(w.line)));
});

test('SMTP failed TLS handshake never falls back to plaintext; errors and logs omit secrets', async () => {
  for (const secure of [true, false]) {
    const s = await smtpScenario({ secure, handshakeFail: true });
    assert(s.error);
    assert.equal(s.tlsCalls.length, 1);
    assert.equal(s.tlsCalls[0].rejectUnauthorized, true);
    assert(!s.writes.some(w => /AUTH|MAIL FROM/.test(w.line)));
    assert(!s.error.message.includes('SYNTHETIC_SECRET'));
    assert.deepEqual(s.logs, []);
  }
});

test('SMTP refuses secureConnect without certificate authorization', async () => {
  const s = await smtpScenario({ authorized: false });
  assert(s.error);
  assert(!s.writes.some(w => /AUTH|MAIL FROM/.test(w.line)));
});

test('SMTP parses fragmented multiline capabilities, upgrades TLS and completes DATA acknowledgement', async () => {
  for (const secure of [true, false]) {
    const s = await smtpScenario({ secure, fragmented: true });
    assert.equal(s.error, undefined);
    assert.equal(s.result.ok, true);
    assert(s.writes.some(w => w.line.startsWith('AUTH')));
    assert(s.writes.filter(w => /AUTH|MAIL FROM|RCPT TO|^DATA/.test(w.line)).every(w => w.encrypted && w.authorized));
  }
});

test('SMTP remote authentication errors never echo server text or credentials', async () => {
  const s = await smtpScenario({ authFail: true });
  assert(s.error.message.includes('535'));
  assert(!s.error.message.includes('SYNTHETIC_SECRET'));
  assert.deepEqual(s.logs, []);
  assert(!s.writes.some(w => w.line.startsWith('MAIL FROM')));
});


test('operational logs never serialize raw exceptions, secrets or database connection strings', () => {
  for (const code of ['ECONNREFUSED', 'SYNTHETIC_SECRET', undefined]) {
    const result = safeErrorMessage({ code, message: 'postgres://user:SYNTHETIC_SECRET@db.invalid/test', detail: 'SYNTHETIC_SECRET', stack: 'SYNTHETIC_SECRET' });
    assert(!result.includes('SYNTHETIC_SECRET'));
    assert(!result.includes('postgres://'));
  }
  const store = source('server/store.js');
  assert(!store.split('\n').some(line => line.includes('console.') && line.includes('${generated}')));
  for (const file of ['server/index.js', 'server/store.js', 'server/mailer.js']) {
    assert(!source(file).split('\n').some(line => line.includes('console.') && /\b(?:err|migErr|globalErr)\.message/.test(line)));
  }
});


test('store passes strict TLS to pg and never retries without TLS after connection failure', async () => {
  const pools = [], queries = [];
  class Pool {
    constructor(config) { pools.push(config); }
    async query(sql) { queries.push(sql); const error = new Error('synthetic certificate failure'); error.code = 'CERT_HAS_EXPIRED'; throw error; }
  }
  const context = vm.createContext({ process: { env: { DATABASE_URL: 'postgres://synthetic:synthetic@db.example.invalid/app', NODE_ENV: 'production' } }, console, Buffer, setTimeout, clearTimeout });
  function synthetic(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  }
  const module = new vm.SourceTextModule(source('server/store.js'), {
    context, initializeImportMeta(meta) { meta.url = new URL('../server/store.js', import.meta.url).href; },
    importModuleDynamically: async specifier => {
      assert.equal(specifier, 'pg');
      const pg = synthetic({ default: { Pool } });
      await pg.link(() => {}); await pg.evaluate(); return pg;
    }
  });
  await module.link(async specifier => {
    if (specifier === './migrations.js') return synthetic({ RELATIONAL_SCHEMA: '', migrateJsonToRelational: () => { throw new Error('migration forbidden'); } });
    if (specifier === './tls-config.js') return synthetic({ postgresConnectionOptions: url => postgresConnectionOptions(url, {}) });
    if (specifier === 'node:fs') return synthetic({ default: new Proxy({}, { get() { throw new Error('filesystem forbidden'); } }) });
    const exports = specifier.startsWith('node:') ? await import(specifier) : await import(new URL('../server/' + specifier.slice(2), import.meta.url));
    return synthetic(exports);
  });
  await module.evaluate();
  await assert.rejects(module.namespace.initStore(), { code: 'CERT_HAS_EXPIRED' });
  assert.equal(pools.length, 1);
  assert.equal(queries.length, 1);
  assert.equal(pools[0].ssl.rejectUnauthorized, true);
  assert.equal(pools[0].ssl.minVersion, 'TLSv1.2');
  assert.equal(pools[0].ssl.servername, 'db.example.invalid');
});


test('SMTP normalizes line endings and dot-stuffs embedded message terminators', async () => {
  const s = await smtpScenario({ textBody: 'line\n.\nMAIL FROM:<synthetic@example.invalid>\r.\rline' });
  assert.equal(s.error, undefined);
  const payload = s.writes.find(write => write.line.includes('multipart/alternative')).line;
  assert(payload.includes('line\r\n..\r\nMAIL FROM:'));
  assert(!payload.includes('\r\n.\r\nMAIL FROM:'));
});
