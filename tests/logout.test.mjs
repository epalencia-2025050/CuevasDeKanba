import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

test('user and admin logout revoke persisted token, expire matching cookie and cannot reuse old cookie', async () => {
  const config = createConfig({ PUBLIC_URL: 'https://kanba.test', ADMIN_PASSWORD: 'synthetic-admin-password' });
  const database = memoryRepository(withRuntime({ config }, createInitialStore));
  const app = createApp({ config, database, network: () => ({ secure: true, ip: '192.0.2.1' }) });
  const post = (path, body, cookie = '', json = true) => app.request(config.PUBLIC_URL + path, {
    method: 'POST', headers: { Origin: config.PUBLIC_URL, Cookie: cookie, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    ...(json ? { body: JSON.stringify(body) } : {})
  });
  for (const [kind, loginPath, credentials, storeKey, cookieName] of [
    ['auth', 'register', { name: 'Synthetic User', email: 'synthetic@example.invalid', password: 'synthetic-user-password' }, 'userSessions', 'kanba_user'],
    ['admin', 'login', { password: config.ADMIN_PASSWORD }, 'sessions', 'kanba_session']
  ]) {
    const loggedIn = await post(`/api/${kind}/${loginPath}`, credentials);
    assert.equal(loggedIn.status, kind === 'auth' ? 201 : 200);
    const issued = loggedIn.headers.get('set-cookie');
    const cookie = issued.split(';')[0];
    assert(cookie.startsWith(cookieName + '='));
    const token = cookie.slice(cookie.indexOf('=') + 1);
    assert(database.snapshot()[storeKey][token]);
    const rejected = await post(`/api/${kind}/logout`, {}, cookie, false);
    assert.equal(rejected.status, 415); // Reproduces the original frontend request.
    assert(database.snapshot()[storeKey][token]);
    const loggedOut = await post(`/api/${kind}/logout`, {}, cookie);
    assert.equal(loggedOut.status, 200);
    const expired = loggedOut.headers.get('set-cookie');
    assert(expired.startsWith(cookieName + '=;'));
    assert(expired.includes('Max-Age=0'));
    for (const attribute of ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']) {
      assert(issued.includes(attribute)); assert(expired.includes(attribute));
    }
    assert(!issued.includes('Domain=')); assert(!expired.includes('Domain='));
    assert.equal(database.snapshot()[storeKey][token], undefined);
    const me = await app.request(`${config.PUBLIC_URL}/api/${kind}/me`, { headers: { Cookie: cookie } });
    assert.equal((await me.json()).authenticated, false);
  }
});

test('frontend logout waits for success, sends JSON and does not pretend success on failure', async () => {
  for (const kind of ['site', 'admin']) {
    const source = await fs.readFile(new URL(`../public/js/${kind}.js`, import.meta.url), 'utf8');
    const apiStart = source.indexOf('  async function api(');
    const apiEnd = source.indexOf('\n  }', apiStart) + 4;
    const start = source.indexOf(kind === 'site' ? '          loginBtn.onclick = async (e) => {' : '  async function logout() {');
    const end = source.indexOf(kind === 'site' ? '\n          };' : '\n  }', start) + (kind === 'site' ? 13 : 4);
    for (const success of [true, false]) {
      let finish, completed = 0, messages = 0;
      const button = { dataset: {}, disabled: false, removeAttribute() {} };
      const context = vm.createContext({
        loginBtn: button, state: { user: { name: 'Synthetic' } },
        $: () => button, busy: (b, on) => { b.disabled = on; },
        toast: () => { messages++; }, confirm: () => true,
        window: { location: { reload: () => { completed++; } } },
        showLogin: () => { completed++; },
        fetch: async (_url, options) => {
          assert.equal(options.method, 'POST');
          assert.equal(options.headers['Content-Type'], 'application/json');
          assert.equal(options.body, '{}');
          return new Promise(resolve => { finish = () => resolve({ ok: success, status: success ? 200 : 503,
            json: async () => success ? { ok: true } : { error: { message: 'Synthetic failure' } } }); });
        }
      });
      vm.runInContext(source.slice(apiStart, apiEnd) + '\n' + source.slice(start, end), context);
      const pending = kind === 'site' ? context.loginBtn.onclick({ target: { closest: () => true }, preventDefault() {} })
        : context.logout();
      assert.equal(completed, 0);
      finish(); await pending;
      assert.equal(completed, success ? 1 : 0);
      assert.equal(messages, success ? 0 : 1);
      if (kind === 'site') assert.equal(context.state.user === null, success);
    }
  }
});
