import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

function setup() {
  const config = createConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password', GOOGLE_CLIENT_ID: 'synthetic', GOOGLE_CLIENT_SECRET: 'synthetic' });
  const initial = withRuntime({ config }, createInitialStore);
  for (const role of ['user', 'admin']) initial.users.push({ id: role, name: role, role,
    email: `${role}@example.invalid`, password: initial.admin.password });
  initial.admin = { passwordPolicyVersion: 0 }; // Retired global password cannot block unified auth.
  initial.sessions.legacy = { role: 'admin', expiresAt: new Date(Date.now() + 3600000).toISOString() };
  initial.reservations = [{ userId: 'user', code: 'OWN' }, { userId: 'admin', code: 'OTHER' }];
  const database = memoryRepository(initial);
  let assets = 0;
  const services = { config, database, network: () => ({ secure: true, ip: '192.0.2.1' }),
    assets: async () => { assets++; return new Response('protected HTML'); } };
  const app = createApp(services);
  const request = (path, cookie = '', method = 'GET', body) => app.request(config.PUBLIC_URL + path,
    { method, headers: { Cookie: cookie, Origin: config.PUBLIC_URL, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  async function login(role) {
    const response = await request('/api/auth/login', '', 'POST', { email: `${role}@example.invalid`, password: 'synthetic-password', role: 'admin' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redirectTo, role === 'admin' ? '/admin.html' : '/');
    return response.headers.getSetCookie().find(c => c.startsWith('kanba_user=')).split(';')[0];
  }
  return { request, login, database, services, assets: () => assets };
}

test('admin HTML aliases and all API families require current store role, never legacy cookie', async () => {
  const { request, login, database, assets } = setup();
  const user = await login('user'), admin = await login('admin');
  for (const path of ['/admin', '/admin.html', '/%61dmin.html', '/ADMIN.HTML', '/admin/']) {
    const before = assets();
    assert.equal((await request(path)).status, 302);
    assert.equal((await request(path, 'kanba_session=legacy')).status, 302);
    assert.equal((await request(path, user)).status, 403);
    assert.equal(assets(), before);
    assert.equal((await request(path, admin)).status, 200);
    assert.equal((await request(path, admin, 'HEAD')).status, 200);
  }
  for (const path of ['me', 'overview', 'reservations', 'settings', 'content', 'media', 'password', 'report']) {
    assert.equal((await request('/api/admin/' + path)).status, 401);
    assert.equal((await request('/api/admin/' + path, user)).status, 403);
  }
  assert.equal((await request('/api/admin/me', admin)).status, 200);
  assert.equal((await request('/api/admin/logout', '', 'POST', {})).status, 401);
  assert.equal((await request('/api/admin/logout', user, 'POST', {})).status, 403);
  assert.equal((await request('/api/admin/login', '', 'POST', { password: 'synthetic-password' })).status, 410);
  await database.transaction(unit => { unit.document.users.find(u => u.id === 'admin').role = 'user'; unit.dirty = true; });
  assert.equal((await request('/admin.html', admin)).status, 403);
  assert.equal((await request('/api/admin/me', admin)).status, 403);
});

test('dashboard contains only owned reservations and logout revokes administrative access', async () => {
  const { request, login } = setup();
  assert.equal((await request('/cuenta.html')).status, 302);
  const user = await login('user');
  assert.equal((await request('/cuenta.html', user)).status, 200);
  const data = await (await request('/api/auth/dashboard', user)).json();
  assert.deepEqual(data.reservations.map(r => r.code), ['OWN']);
  const admin = await login('admin');
  assert.equal((await request('/cuenta.html', admin)).headers.get('location'), '/admin.html');
  assert.equal((await request('/api/auth/logout', admin, 'POST', {})).status, 200);
  assert.equal((await request('/api/admin/me', admin)).status, 401);
  assert.equal((await request('/admin.html', admin)).status, 302);
  for (const token of ['__proto__', 'constructor', 'toString', '%E0%A4%A']) {
    assert.equal((await request('/api/admin/me', `kanba_user=${token}`)).status, 401);
  }
});

test('Google chooses dashboard by store role and never elevates new users from provider profile', async () => {
  for (const role of ['admin', 'user', 'new']) {
    const { request, services, database } = setup();
    services.fetch = async url => Response.json(String(url).includes('/token') ? { access_token: 'synthetic' }
      : { sub: `synthetic-${role}`, email: `${role}@example.invalid`, email_verified: true, role: 'admin' });
    const start = await request('/api/auth/google?next=/admin.html');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const callback = await request(`/api/auth/google/callback?state=${state}&code=synthetic`, cookie);
    assert.equal(callback.headers.get('location'), role === 'admin' ? '/admin.html' : '/');
    const sessionCookie = callback.headers.getSetCookie().find(c => c.startsWith('kanba_user=')).split(';')[0];
    assert.equal((await request('/api/admin/me', sessionCookie)).status, role === 'admin' ? 200 : 403);
    if (role === 'new') assert.equal(database.snapshot().users.find(u => u.email === 'new@example.invalid').role, 'user');
  }
});

test('public HTML and login controller expose no admin selector or admin dashboard link', async () => {
  for (const name of await fs.readdir(new URL('../public/', import.meta.url))) {
    if (!name.endsWith('.html') || name === 'admin.html') continue;
    const html = await fs.readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
    assert(!/href=["'][^"']*admin(?:\.html)?["']/.test(html), name);
    assert(!html.includes('panel-admin'), name);
  }
  const script = await fs.readFile(new URL('../public/js/login.js', import.meta.url), 'utf8');
  assert(!script.includes('/api/admin/login'));
  assert(!script.includes('/admin.html'));
});

test('registration ignores requested role and expired or deleted-user sessions cannot access admin', async () => {
  const { request, login, database } = setup();
  const registration = await request('/api/auth/register', '', 'POST', {
    name: 'New Visitor', email: 'visitor@example.invalid', password: 'synthetic-password', role: 'admin'
  });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).user.role, 'user');
  const admin = await login('admin');
  await database.transaction(unit => {
    for (const session of Object.values(unit.document.userSessions)) {
      if (session.userId === 'admin') session.expiresAt = new Date(0).toISOString();
    }
    unit.dirty = true;
  });
  assert.equal((await request('/api/admin/me', admin)).status, 401);
  const fresh = await login('admin');
  await database.transaction(unit => { unit.document.users = unit.document.users.filter(u => u.id !== 'admin'); unit.dirty = true; });
  assert.equal((await request('/admin.html', fresh)).status, 302);
  assert.equal((await request('/api/admin/content', fresh, 'PUT', { content: {} })).status, 401);
});

test('admin password change targets the authenticated user and revokes unified sessions', async () => {
  const { request, login, database } = setup();
  const admin = await login('admin');
  const response = await request('/api/admin/password', admin, 'POST', { current: 'synthetic-password', next: 'synthetic-new-password' });
  assert.equal(response.status, 200);
  assert(response.headers.getSetCookie().some(c => c.startsWith('kanba_user=;')));
  assert.equal((await request('/api/admin/me', admin)).status, 401);
  assert.equal(database.snapshot().admin.passwordPolicyVersion, 0);
  const loginResponse = await request('/api/auth/login', '', 'POST', { email: 'admin@example.invalid', password: 'synthetic-new-password' });
  assert.equal(loginResponse.status, 200);
  assert.equal((await loginResponse.json()).redirectTo, '/admin.html');
});
