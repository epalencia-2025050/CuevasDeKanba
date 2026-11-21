import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createRequestSecurity, parseJsonObject } from '../server/request-security.js';
import { StoreTransaction, bufferedResponse } from '../server/store-transaction.js';
import { migrateJsonToRelational } from '../server/migrations.js';

const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function extract(s, name) { const start = s.indexOf('function ' + name + '('); assert(start >= 0); return s.slice(start, s.indexOf('\n}', start) + 2); }

test('only configured proxy networks can supply protocol and client IP; spoofed leftmost IP is ignored', () => {
  const security = createRequestSecurity({ TRUSTED_PROXY_CIDRS: '10.0.0.0/24' });
  const direct = { socket: { remoteAddress: '192.0.2.1' }, headers: { 'x-forwarded-for': '198.51.100.1', 'x-forwarded-proto': 'https' } };
  assert.equal(security.ip(direct), '192.0.2.1');
  assert.equal(security.secure(direct), false);
  const proxied = { socket: { remoteAddress: '10.0.0.2' }, headers: { 'x-forwarded-for': '203.0.113.1, 192.0.2.4, 10.0.0.3', 'x-forwarded-proto': 'https' } };
  assert.equal(security.ip(proxied), '192.0.2.4');
  assert(security.secure(proxied));
  assert.throws(() => createRequestSecurity({ TRUSTED_PROXY_CIDRS: 'not-a-network' }));
});

test('request security rejects cross-origin mutations, insecure production and prototype-bearing JSON', () => {
  const security = createRequestSecurity({ NODE_ENV: 'production', PUBLIC_URL: 'https://kanba.example.invalid' });
  const req = { url: '/api/auth/login', method: 'POST', socket: { encrypted: true }, headers: { origin: 'https://kanba.example.invalid', 'content-type': 'application/json' } };
  security.validate(req);
  assert.throws(() => security.validate({ ...req, headers: { ...req.headers, origin: 'https://attacker.invalid' } }));
  assert.throws(() => security.validate({ ...req, socket: {} }));
  for (const raw of ['null', '[]', '{"__proto__":{}}', '{"a":{"constructor":{}}}']) assert.throws(() => parseJsonObject(raw));
  assert.deepEqual(parseJsonObject('{"safe":true}'), { safe: true });
});

function sharedPool(initial) {
  let document = structuredClone(initial), lock = Promise.resolve(), commitFailure = false;
  const queries = [];
  const pool = { async connect() {
    let unlock, pending;
    return {
      async query(sql, args) {
        queries.push(sql);
        if (sql.startsWith('SELECT doc')) {
          const previous = lock;
          lock = new Promise(resolve => { unlock = resolve; });
          await previous;
          return { rows: [{ doc: structuredClone(document) }] };
        }
        if (sql.startsWith('UPDATE')) pending = JSON.parse(args[0]);
        if (sql === 'COMMIT') {
          if (commitFailure) throw new Error('synthetic commit failure');
          if (pending) document = pending;
          unlock?.(); unlock = null;
        }
        if (sql === 'ROLLBACK') { pending = undefined; unlock?.(); unlock = null; }
        return { rows: [] };
      },
      release() {}
    };
  } };
  return { pool, queries, read: () => document, failCommit: () => { commitFailure = true; } };
}
function unit(pool, initial = { count: 0 }) {
  let data = structuredClone(initial);
  const transactions = new StoreTransaction({ pool, read: () => data, replace: value => { data = value; }, serialize: JSON.stringify, persistLocal: () => {} });
  return { transactions, read: () => data };
}

test('two instances serialize updates against the authoritative row without lost writes', async () => {
  const shared = sharedPool({ count: 0 });
  const first = unit(shared.pool), second = unit(shared.pool);
  await Promise.all(Array.from({ length: 20 }, (_, index) => {
    const instance = index % 2 ? first : second;
    return instance.transactions.run(async () => {
      const before = instance.read().count;
      await Promise.resolve();
      instance.read().count = before + 1;
      instance.transactions.markDirty();
    });
  }));
  assert.equal(shared.read().count, 20);
  assert(shared.queries.some(query => query.includes('FOR UPDATE')));
});

test('commit failure restores local state and prevents publishing a success response', async () => {
  const shared = sharedPool({ count: 0 }); shared.failCommit();
  const instance = unit(shared.pool), reply = bufferedResponse();
  let published = false;
  await assert.rejects(async () => {
    await instance.transactions.run(() => { instance.read().count++; instance.transactions.markDirty(); reply.end('ok'); });
    reply.publish({ setHeader() {}, writeHead() {}, end() { published = true; } });
  });
  assert.equal(shared.read().count, 0);
  assert.equal(instance.read().count, 0);
  assert.equal(published, false);
  assert(shared.queries.includes('ROLLBACK'));
  assert.throws(() => instance.transactions.markDirty());
});

test('explicit relational export is transaction-scoped, skips completed imports and rolls back failures', async () => {
  let applied = false, fail = false;
  const queries = [];
  const pool = { async connect() { return {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith('SELECT version')) return { rows: applied ? [{ version: 'existing' }] : [] };
      if (sql.startsWith('SELECT doc')) return { rows: [{ doc: { reservations: [{ code: 'synthetic', customer: {}, history: [{ label: 'synthetic', at: '2026-01-01' }] }] } }] };
      if (fail && sql.startsWith('INSERT INTO kanba_reservations')) throw new Error('synthetic failure');
      if (sql.startsWith('INSERT INTO kanba_schema_migrations')) applied = true;
      return { rows: [] };
    }, release() {}
  }; } };
  await migrateJsonToRelational(pool);
  const count = queries.filter(query => query.includes('INSERT INTO kanba_reservation_history')).length;
  assert.equal((await migrateJsonToRelational(pool)).reason, 'already_applied');
  assert.equal(queries.filter(query => query.includes('INSERT INTO kanba_reservation_history')).length, count);
  applied = false; fail = true;
  await assert.rejects(migrateJsonToRelational(pool));
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('HTTP workflow: auth, reservation, retry idempotency, ownership, payment sandbox, receipt and cancellation', { timeout: 30000 }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kanba-functional-'));
  const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', DATA_DIR: temporary,
    UPLOADS_DIR: path.join(temporary, 'uploads'), ADMIN_PASSWORD: 'SYNTHETIC-ADMIN-PASSWORD' };
  for (const key of Object.keys(env)) if (/^(SMTP_|PAYMENTS_|PG|DATABASE_URL|PUBLIC_URL|TRUST_PROXY|TRUSTED_PROXY|FORCE_ADMIN_PASSWORD|RENDER)/.test(key)) delete env[key];
  const child = fork(new URL('./helpers/http-server.mjs', import.meta.url), [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  try {
    const ready = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Test server failed: ' + diagnostics); })]);
    const base = `http://127.0.0.1:${ready[0].port}`;
    async function call(method, url, body, cookie = '', headers = {}) {
      const response = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: base } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
    }
    assert.equal((await call('GET', '/api/admin/overview', undefined, 'kanba_session=__proto__')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', {}, '', { Origin: 'https://attacker.invalid' })).status, 403);
    const owner = await call('POST', '/api/auth/register', { name: 'Synthetic Owner', email: 'owner@example.invalid', password: 'SYNTHETIC-USER-PASSWORD' });
    assert.equal(owner.status, 201);
    const other = await call('POST', '/api/auth/register', { name: 'Synthetic Other', email: 'other@example.invalid', password: 'SYNTHETIC-OTHER-PASSWORD' });
    assert.equal(other.status, 201);
    const availability = await call('GET', '/api/availability?days=10');
    assert.equal(availability.status, 200, JSON.stringify(availability.body));
    let slot;
    for (const day of availability.body.daysList.slice(2)) for (const tour of day.tours) {
      const departure = tour.departures.find(d => d.status === 'open');
      if (departure && !slot) slot = { tourId: tour.tourId, date: day.date, time: departure.time };
    }
    assert(slot);
    const booking = { ...slot, requestId: crypto.randomUUID(), participants: 1, customer: { name: 'Synthetic Owner', email: 'owner@example.invalid', phone: '55555555', country: 'Guatemala', acceptPolicies: true, acceptTerms: true } };
    const reservation = await call('POST', '/api/reservations', booking, owner.cookie);
    assert.equal(reservation.status, 201, JSON.stringify(reservation.body));
    const repeated = await call('POST', '/api/reservations', booking, owner.cookie);
    assert.equal(repeated.body.code, reservation.body.code);
    const code = reservation.body.code;
    assert.equal((await call('POST', '/api/reservations', { ...booking, participants: 2 }, owner.cookie)).status, 409);
    assert.equal((await call('POST', '/api/reservations/lookup', { code, email: 'owner@example.invalid' })).status, 401);
    assert.equal((await call('POST', '/api/reservations/lookup', { code, email: 'owner@example.invalid' }, other.cookie)).status, 404);
    const recovered = await call('POST', '/api/reservations/lookup', { code, email: 'owner@example.invalid' }, owner.cookie);
    assert.equal(recovered.status, 200);
    assert.equal((await call('GET', `/api/reservations/${code}?token=${reservation.body.token}`)).status, 403);
    const token = recovered.body.token;
    const privateView = await call('GET', `/api/reservations/${code}?token=${token}`);
    assert.equal(privateView.status, 200);
    const paid = await call('POST', `/api/payments/${privateView.body.reservation.payment.intentId}/pay`, { token, paymentToken: 'tok_demo_4242' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal((await call('GET', `/api/receipt/${code}?token=${token}`)).status, 200);
    const verification = await call('GET', `/api/verify/${code}`);
    assert.deepEqual(Object.keys(verification.body).sort(), ['code', 'ok', 'status', 'valid']);
    assert.equal((await call('POST', `/api/reservations/${code}/cancel`, { token, email: 'owner@example.invalid', reason: 'synthetic reason' }, other.cookie)).status, 403);
    assert.equal((await call('POST', `/api/reservations/${code}/cancel`, { token, email: 'owner@example.invalid', reason: 'synthetic reason' }, owner.cookie)).status, 200);
    assert.equal((await call('GET', `/api/reservations/${code}?token=${token}`)).status, 403);
    const admin = await call('POST', '/api/auth/login', { email: 'admin@example.invalid', password: env.ADMIN_PASSWORD });
    assert.equal(admin.status, 200);
    const mail = await call('GET', '/api/admin/emails', undefined, admin.cookie);
    assert(mail.body.emails.every(record => record.status === 'queued'));
    const persisted = JSON.parse(fs.readFileSync(path.join(temporary, 'db.json'), 'utf8'));
    assert.equal(persisted.reservations.length, 1);
    assert.equal(persisted.reservations[0].status, 'cancelled');
    assert.equal(persisted.emails.filter(record => record.template === 'pending').length, 1);

    const settings = await call('GET', '/api/admin/settings', undefined, admin.cookie);
    assert.equal(settings.status, 200);
    assert.equal((await call('PUT', '/api/admin/settings', { settings: settings.body.settings }, admin.cookie)).status, 200);
    assert.equal((await call('PUT', '/api/admin/settings', { settings: { payments: { secretKey: 'SYNTHETIC_SECRET' } } }, admin.cookie)).status, 422);
    const content = await call('GET', '/api/admin/content', undefined, admin.cookie);
    assert.equal((await call('PUT', '/api/admin/content', { content: content.body.content }, admin.cookie)).status, 200);
    const tour = await call('POST', '/api/admin/tours', { id: 'synthetic-tour', name: 'Synthetic Tour', price: 10, capacity: 4, maxParticipants: 4, durationMinutes: 60, days: [1], includes: ['Synthetic item'], startDate: '2030-01-01', endDate: '2030-01-31', startTime: '09:00', endTime: '13:00', times: ['12:00'] }, admin.cookie);
    assert.equal(tour.status, 201);
    assert.equal(tour.body.tour.endDate, '2030-01-31');
    assert.deepEqual(tour.body.tour.includes, ['Synthetic item']);
    assert.equal((await call('PUT', '/api/admin/tours/synthetic-tour', { ...tour.body.tour, endDate: '2029-01-01' }, admin.cookie)).status, 422);
    assert.equal((await call('PUT', '/api/admin/tours/synthetic-tour', { ...tour.body.tour, price: 15 }, admin.cookie)).status, 200);
    assert.equal((await call('DELETE', '/api/admin/tours/synthetic-tour', {}, admin.cookie)).status, 200);
    assert.equal((await call('PUT', '/api/admin/settings', { booking: { lastSeatsPercent: 101 } }, admin.cookie)).status, 422);
    assert.equal((await call('PUT', '/api/admin/settings', { booking: { pendingLimit: 5, lastSeatsPercent: 30 } }, admin.cookie)).status, 200);
    const closure = await call('POST', '/api/admin/closures', { date: slot.date, tourId: 'all', reason: 'Synthetic closure' }, admin.cookie);
    assert.equal(closure.status, 201);
    assert.equal((await call('DELETE', '/api/admin/closures/' + closure.body.closure.id, {}, admin.cookie)).status, 200);
    const image = fs.readFileSync(new URL('../public/vendor/leaflet/marker-icon.png', import.meta.url));
    const uploaded = await call('POST', '/api/admin/media', { dataUrl: 'data:image/png;base64,' + image.toString('base64') }, admin.cookie);
    assert.equal(uploaded.status, 201);
    assert.equal((await fetch(base + uploaded.body.url)).status, 200);
    assert.equal((await call('GET', '/api/admin/report', undefined, admin.cookie)).status, 200);
    const site = await call('GET', '/api/site');
    const selected = site.body.tours.find(t => t.id === slot.tourId);
    const participants = Math.min(selected.capacity, selected.maxParticipants);
    const attempts = Math.floor(selected.capacity / participants) + 1;
    const participantNames = Array.from({ length: participants }, (_, index) => 'Viajero ' + (index + 1));
    assert.equal((await call('POST', '/api/reservations', {
      ...booking, requestId: crypto.randomUUID(), participants, participantNames: []
    }, owner.cookie)).status, 422);
    const simultaneous = await Promise.all(Array.from({ length: attempts }, (_, index) => call('POST', '/api/reservations', {
      ...booking, requestId: crypto.randomUUID(), participants, participantNames
    }, index % 2 ? owner.cookie : other.cookie)));
    assert.equal(simultaneous.filter(result => result.status === 201).length, Math.floor(selected.capacity / participants));
    assert(simultaneous.some(result => result.status === 409));
    assert.equal((await call('POST', '/api/admin/password', { current: env.ADMIN_PASSWORD, next: 'SYNTHETIC-NEW-ADMIN' }, admin.cookie)).status, 200);
    assert.equal((await call('GET', '/api/admin/overview', undefined, admin.cookie)).status, 401);
    assert.equal((await call('GET', '/api/health')).status, 200);
  } finally {
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    const resolved = fs.realpathSync(temporary);
    assert(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('kanba-functional-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
