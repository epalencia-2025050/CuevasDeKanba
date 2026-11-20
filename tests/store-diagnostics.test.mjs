import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { createConfig } from '../server/runtime.js';
import { createRepository } from '../server/db.js';

const token = 'synthetic-diagnostic-token-not-a-real-secret';
const endpoint = 'https://kanba.test/api/internal/store-diagnostics';
const keys = ['connectionSource', 'schemaMatchesExpected', 'rowFound', 'sqlDocIsObject',
  'jsDocType', 'usersIsArray', 'metaIsObject', 'sessionsIsObject', 'userSessionsIsObject',
  'invalidUserCount', 'validationStage'];
function setup(row, { secret = token, secure = true, failure = false } = {}) {
  const queries = [];
  const sql = (parts) => {
    if (typeof parts === 'string') return parts;
    queries.push(parts.join('?'));
    if (failure) throw new Error('synthetic-sensitive-error');
    return Promise.resolve(row === undefined ? [] : [row]);
  };
  const database = createRepository(sql, 'kanba_rel');
  const config = createConfig({ PUBLIC_URL: 'https://kanba.test', STORE_DIAGNOSTICS_TOKEN: secret });
  return { queries, app: createApp({ config, database, network: () => ({ secure, ip: '192.0.2.1' }) }) };
}
test('diagnostics fail closed without SQL for disabled, wrong/missing token, HTTP and wrong method', async () => {
  for (const options of [{ secret: '' }, { secret: 'short' }, { secure: false }, {}]) {
    const { app, queries } = setup(undefined, options);
    for (const auth of ['', 'Bearer wrong', ...(Object.keys(options).length ? [`Bearer ${token}`] : [])]) {
      const response = await app.request(endpoint, { headers: { Authorization: auth } });
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal((await app.request(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 404);
    assert.equal(queries.length, 0);
  }
});
test('diagnostics inspect raw driver value, expose only approved fields and execute SELECT only', async () => {
  const doc = { users: [{ email: 'synthetic@example.invalid', password: 'must-not-escape' }, null],
    meta: {}, sessions: {}, userSessions: {} };
  for (const row of [undefined, { doc, sql_doc_is_object: true }, { doc: JSON.stringify(doc), sql_doc_is_object: true }]) {
    const { app, queries } = setup(row);
    const response = await app.request(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), keys);
    assert.equal(body.rowFound, Boolean(row));
    assert.equal(body.jsDocType, typeof row?.doc);
    assert.equal(body.invalidUserCount, row?.doc === doc ? 1 : 0);
    assert.equal(body.validationStage, 'read');
    assert.equal(body.connectionSource, 'database_url');
    assert.equal(body.schemaMatchesExpected, true);
    assert(!JSON.stringify(body).includes('must-not-escape'));
    assert(!JSON.stringify(body).includes('example.invalid'));
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^SELECT doc/);
    assert(!queries[0].includes('FOR UPDATE'));
  }
});
test('diagnostic SQL failure returns empty 503 without exposing driver errors', async () => {
  const { app } = setup(undefined, { failure: true });
  const response = await app.request(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '');
});
