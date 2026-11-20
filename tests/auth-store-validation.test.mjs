import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../server/security.js';
import { createApp } from '../server/index.js';
import { createConfig } from '../server/runtime.js';
import { createRepository } from '../server/db.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

const credentials = { email: 'synthetic@example.invalid', password: 'synthetic-password-only' };
const valid = () => ({ meta: {}, settings: {}, admin: { passwordPolicyVersion: 2 },
  users: [{ id: 'synthetic', email: credentials.email, password: hashPassword(credentials.password) }],
  sessions: {}, userSessions: {} });
function login(database) {
  const config = createConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://kanba.test' });
  return createApp({ config, database, network: () => ({ secure: true, ip: '192.0.2.1' }) })
    .request('https://kanba.test/api/auth/login', { method: 'POST',
      headers: { Origin: config.PUBLIC_URL, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
}

test('password validation rejects malformed JSON values without throwing', () => {
  const stored = hashPassword(credentials.password);
  assert.equal(verifyPassword(credentials.password, stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  for (const password of [null, {}, 123, 'x'.repeat(257)]) assert.equal(verifyPassword(password, stored), false);
  for (const value of [null, {}, 123, [], 'x', 'g'.repeat(128)]) {
    assert.equal(verifyPassword(credentials.password, { ...stored, salt: value }), false);
    assert.equal(verifyPassword(credentials.password, { ...stored, hash: value }), false);
  }
});

test('invalid store returns 503 without changing persisted document or publishing cookie', async () => {
  for (const field of ['users', 'meta', 'sessions', 'userSessions']) {
    for (const value of [undefined, null, 'invalid', 1, ...(field === 'users' ? [{}] : [[]])]) {
      const doc = valid(); doc[field] = value;
      const database = memoryRepository(doc);
      const response = await login(database);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'store_invalid');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(database.snapshot(), doc);
    }
  }
});

test('valid login persists session; malformed hash returns clean 401', async () => {
  const database = memoryRepository(JSON.parse(JSON.stringify(valid())));
  assert.equal((await login(database)).status, 200);
  assert.equal(Object.keys(database.snapshot().userSessions).length, 1);
  const doc = valid(); doc.users[0].password.salt = {};
  const response = await login(memoryRepository(doc));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'invalid_credentials');
});

test('availability errors on global/route counters and commit return 503, unexpected errors remain 500', async () => {
  for (const stage of ['global', 'account', 'commit']) {
    for (const code of ['ECONNRESET', 'CONNECT_TIMEOUT', '57P03', '55P03', '42P01']) {
      const database = memoryRepository(valid());
      const failure = () => { throw Object.assign(new Error('synthetic'), { code }); };
      if (stage === 'commit') {
        const original = database.transaction.bind(database);
        database.transaction = work => original(async unit => { await work(unit); failure(); });
      } else {
        database.rateLimit = async key => { if (stage === 'global' || key.startsWith('account:')) failure(); return 1; };
      }
      const response = await login(database);
      assert.equal(response.status, code === '42P01' ? 500 : 503);
      assert.equal((await response.json()).error.code, code === '42P01' ? 'server_error' : 'database_unavailable');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(database.snapshot().userSessions, {});
    }
  }
});

test('repository rejects missing row and corrupted write before UPDATE', async () => {
  let row = null, updates = 0;
  const sql = (parts) => {
    if (typeof parts === 'string') return parts;
    const query = parts.join('?');
    if (query.startsWith('UPDATE')) updates++;
    return Promise.resolve(query.startsWith('SELECT doc') ? (row ? [row] : []) : []);
  };
  sql.begin = work => work(sql);
  const repository = createRepository(sql);
  await assert.rejects(repository.transaction(() => {}), { code: 'store_invalid' });
  row = { doc: valid() };
  await assert.rejects(repository.transaction(unit => { unit.document.meta = null; unit.dirty = true; }), { code: 'store_invalid' });
  assert.equal(updates, 0);
});
