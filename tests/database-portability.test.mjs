import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRepository } from '../server/db.js';

test('Postgres.js receives strict TLS and does not retry failed connections in plaintext', async () => {
  const configs = [], calls = [];
  const context = vm.createContext({ URL, Promise, Date });
  const driver = (url, options) => {
    configs.push({ url, options });
    const sql = async () => { calls.push('query'); const error = new Error('synthetic failure'); error.code = 'CERT_HAS_EXPIRED'; throw error; };
    sql.end = async () => {};
    return sql;
  };
  const module = new vm.SourceTextModule(await fs.readFile(new URL('../server/db.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new vm.SyntheticModule(name === 'postgres' ? ['default'] : ['serializeStore'], function () {
    this.setExport(name === 'postgres' ? 'default' : 'serializeStore', name === 'postgres' ? driver : JSON.stringify);
  }, { context }));
  await module.evaluate();
  const config = { DATABASE_URL: 'postgres://synthetic:synthetic@db.example.invalid/app?sslmode=verify-full', DB_SCHEMA: 'kanba' };
  const database = module.namespace.createDatabase(config);
  await assert.rejects(database.health(), { code: 'CERT_HAS_EXPIRED' });
  assert.equal(calls.length, 1);
  assert.equal(configs.length, 2);
  for (const { options, url } of configs) {
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.minVersion, 'TLSv1.2');
    assert.equal(options.prepare, true);
    assert(!url.includes('sslmode'));
  }
  assert.throws(() => module.namespace.createDatabase({ ...config, DATABASE_URL: 'postgres://user:pass@host/db?sslmode=disable' }));
  await database.close();
});

test('repository binds values, locks authoritative state, commits after save and rejects commit failures', async () => {
  const events = [];
  let commitFailure = false;
  const initial = { meta: {}, settings: {}, count: 0 };
  const sql = (parts, ...values) => {
    if (typeof parts === 'string') return { identifier: parts };
    const query = parts.join('?'); events.push({ query, values });
    return Promise.resolve(query.startsWith('SELECT doc') ? [{ doc: structuredClone(initial) }] : []);
  };
  sql.begin = async work => {
    events.push('BEGIN');
    try {
      const result = await work(sql);
      if (commitFailure) throw new Error('commit failed');
      events.push('COMMIT'); return result;
    } catch (error) { events.push('ROLLBACK'); throw error; }
  };
  const repository = createRepository(sql, 'kanba');
  assert.equal(await repository.transaction(unit => { unit.document.count++; unit.dirty = true; return 'done'; }), 'done');
  assert(events.some(e => e.query?.includes('FOR UPDATE')));
  const update = events.find(e => e.query?.startsWith('UPDATE'));
  assert.equal(JSON.parse(update.values[1]).count, 1);
  assert.equal(events.at(-1), 'COMMIT');
  commitFailure = true;
  await assert.rejects(repository.transaction(unit => { unit.dirty = true; return 'not published'; }));
  assert.equal(events.at(-1), 'ROLLBACK');
  assert.throws(() => createRepository(sql, 'public; DROP SCHEMA public'));
});
