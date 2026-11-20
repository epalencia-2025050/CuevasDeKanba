import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('all public navbar login links start neutral in HTML, before JavaScript runs', async () => {
  let checked = 0;
  for (const file of await fs.readdir(new URL('../public/', import.meta.url))) {
    if (!file.endsWith('.html')) continue;
    const html = await fs.readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    for (const match of html.matchAll(/<a\b[^>]*class="[^"]*\bbtn-login\b[^"]*"[^>]*>(.*?)<\/a>/g)) {
      checked++;
      assert.equal(match[1], 'Cuenta', file);
      assert.match(match[0], /aria-busy="true"/);
      assert.match(match[0], /href="login.html"/);
    }
  }
  assert.equal(checked, 9);
});

test('navbar remains neutral until auth resolves and clears stale identity on anonymous or failed response', async () => {
  const source = await fs.readFile(new URL('../public/js/site.js', import.meta.url), 'utf8');
  const functionCode = source.slice(source.indexOf('  async function loadAuth()'), source.indexOf('  function guardAuth()'));
  for (const mode of ['authenticated', 'anonymous', 'failure']) {
    let resolve, reject;
    const attributes = new Map([['aria-busy', 'true'], ['title', 'old identity']]);
    const button = { textContent: 'Cuenta', dataset: {}, removeAttribute: key => attributes.delete(key) };
    const badge = { textContent: 'old identity', hidden: false };
    const context = vm.createContext({
      AbortSignal,
      state: { user: { name: 'Old' }, authChecked: false },
      document: { querySelector: () => button },
      $: key => key === '#authBadge' ? badge : null, $$: () => [],
      api: (_path, options) => {
        assert.equal(options.cache, 'no-store');
        return new Promise((yes, no) => { resolve = yes; reject = no; });
      }
    });
    vm.runInContext(functionCode, context);
    const pending = context.loadAuth();
    assert.equal(button.textContent, 'Cuenta');
    assert.equal(attributes.get('aria-busy'), 'true');
    if (mode === 'failure') reject(new Error('synthetic'));
    else resolve({ authenticated: mode === 'authenticated', user: { name: 'Synthetic User' } });
    await pending;
    assert.equal(attributes.has('aria-busy'), false);
    assert.equal(context.state.authChecked, true);
    if (mode === 'authenticated') assert.equal(button.className, 'user-profile-btn');
    else {
      assert.equal(button.textContent, 'Iniciar sesión');
      assert.equal(context.state.user, null);
      assert.equal(attributes.has('title'), false);
      assert.equal(badge.hidden, true);
      assert.equal(button.onclick, null);
    }
  }
});
