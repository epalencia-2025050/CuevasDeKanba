import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('account renders real profile and separates upcoming, cancelled and historic bookings', async () => {
  const source = await fs.readFile(new URL('../public/js/cuenta.js', import.meta.url), 'utf8');
  const nodes = new Map();
  function node() {
    return { children: [], append(...children) { this.children.push(...children); },
      get childElementCount() { return this.children.length; }, addEventListener() {} };
  }
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  }
  const today = '2030-01-02';
  const reservations = [['confirmed', today], ['pending_payment', today], ['cancelled', today],
    ['expired', today], ['confirmed', '2030-01-01']].map(([status, date], i) => ({ status, date, code: String(i), tourName: 'Tour' }));
  vm.runInNewContext(source, {
    document: { getElementById: get, createElement: node },
    fetch: async () => ({ ok: true, json: async () => ({ today, reservations, user: { name: 'Ana Luna', email: 'ana@example.invalid' } }) })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('initials').textContent, 'AL');
  assert.equal(get('contact').hidden, true);
  assert.equal(get('accountContent').hidden, false);
  assert.deepEqual(['active', 'cancelled', 'history'].map(id => get(id).childElementCount), [2, 1, 2]);
  assert.equal(get('active').children[0].children.at(-1).href, '/mi-reserva.html?code=0');
});
