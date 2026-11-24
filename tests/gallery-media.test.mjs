import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

function setup() {
  const config = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password',
    GOOGLE_CLIENT_ID: 'synthetic',
    GOOGLE_CLIENT_SECRET: 'synthetic'
  });
  const initial = withRuntime({ config }, createInitialStore);
  initial.content = {
    brand: { name: 'K’anba' },
    hero: { title: 'Cuevas Vivas' },
    intro: { text: 'Bienvenido' },
    contact: { email: 'info@kanba.gt' },
    gallery: [
      { id: 'img_test_1', src: '/assets/img/kanba-cave-01.jpg', caption: 'Cueva 1', category: 'cueva', credit: 'Kanba' },
      { id: 'img_test_2', src: '/uploads/uploaded-photo.jpg', caption: 'Subida 2', category: 'rio', credit: 'Admin' }
    ],
    videos: [
      { id: 'vid_test_1', youtubeId: 'kZusYOYxpA8', title: 'Video 1', description: 'Desc 1', category: 'Cueva' }
    ]
  };

  for (const role of ['user', 'admin']) {
    initial.users.push({
      id: role,
      name: role,
      role,
      email: `${role}@example.invalid`,
      password: initial.admin.password
    });
  }
  initial.admin = { passwordPolicyVersion: 0 };
  const database = memoryRepository(initial);
  // Add synthetic uploaded media file
  database.transaction(async unit => {
    await unit.saveUpload('uploaded-photo.jpg', 'image/jpeg', Buffer.from('synthetic-image-bytes'));
  });

  const services = {
    config,
    database,
    network: () => ({ secure: true, ip: '192.0.2.1' }),
    assets: async () => new Response('protected HTML')
  };
  const app = createApp(services);
  const request = (path, cookie = '', method = 'GET', body) =>
    app.request(config.PUBLIC_URL + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: config.PUBLIC_URL,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });

  async function login(role) {
    const res = await request('/api/auth/login', '', 'POST', {
      email: `${role}@example.invalid`,
      password: 'synthetic-password'
    });
    return (res.headers.get('set-cookie') || '').split(';')[0];
  }

  return { app, request, login, database };
}

test('gallery: admin can add and persistently delete images with automatic upload cleanup', async () => {
  const { request, login, database } = setup();
  const adminCookie = await login('admin');

  // 1. Initial gallery has 2 images
  let siteRes = await request('/api/site');
  let siteData = await siteRes.json();
  assert.equal(siteData.gallery.length, 2);

  // 2. Add an image via POST /api/admin/gallery
  const addRes = await request('/api/admin/gallery', adminCookie, 'POST', {
    src: '/assets/img/kanba-waterfall-cascade.jpg',
    caption: 'Cascada natural',
    category: 'rio',
    credit: 'K’anba'
  });
  assert.equal(addRes.status, 201);
  const addData = await addRes.json();
  assert.equal(addData.ok, true);
  assert.equal(addData.gallery.length, 3);

  // Verify in public site
  siteRes = await request('/api/site');
  siteData = await siteRes.json();
  assert.equal(siteData.gallery.length, 3);
  assert.equal(siteData.gallery.some(g => g.src === '/assets/img/kanba-waterfall-cascade.jpg'), true);

  // 3. Delete uploaded image via DELETE /api/admin/gallery/:id
  const delUploadedRes = await request('/api/admin/gallery/img_test_2', adminCookie, 'DELETE', {});
  assert.equal(delUploadedRes.status, 200);
  const delData = await delUploadedRes.json();
  assert.equal(delData.ok, true);
  assert.equal(delData.gallery.length, 2);
  assert.equal(delData.gallery.some(g => g.id === 'img_test_2'), false);

  // Verify upload binary was deleted from database
  const uploadBinary = await database.readUpload('uploaded-photo.jpg');
  assert.equal(uploadBinary, null, 'Uploaded media binary should be cleaned up from database upon gallery deletion');

  // 4. Reload public site - confirm the deletion persists and does not reappear
  siteRes = await request('/api/site');
  siteData = await siteRes.json();
  assert.equal(siteData.gallery.length, 2);
  assert.equal(siteData.gallery.some(g => g.id === 'img_test_2'), false);

  // 5. Delete another image by src or id
  const delSecond = await request(`/api/admin/gallery/${encodeURIComponent('img_test_1')}`, adminCookie, 'DELETE', {});
  assert.equal(delSecond.status, 200);

  // Final check
  siteRes = await request('/api/site');
  siteData = await siteRes.json();
  assert.equal(siteData.gallery.length, 1);
  assert.equal(siteData.gallery[0].src, '/assets/img/kanba-waterfall-cascade.jpg');
});

test('videos: admin can add and persistently delete videos', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // 1. Initial videos has 1
  let siteRes = await request('/api/site');
  let siteData = await siteRes.json();
  assert.equal(siteData.videos.length, 1);

  // 2. Add video
  const addRes = await request('/api/admin/videos', adminCookie, 'POST', {
    youtubeId: 'dQw4w9WgXcQ',
    title: 'Tour en video',
    description: 'Video de recorrido',
    category: 'Río'
  });
  assert.equal(addRes.status, 200);
  const addData = await addRes.json();
  assert.equal(addData.videos.length, 2);

  // 3. Delete initial video
  const delRes = await request('/api/admin/videos/vid_test_1', adminCookie, 'DELETE', {});
  assert.equal(delRes.status, 200);
  const delData = await delRes.json();
  assert.equal(delData.videos.length, 1);
  assert.equal(delData.videos[0].youtubeId, 'dQw4w9WgXcQ');

  // Verify in public site
  siteRes = await request('/api/site');
  siteData = await siteRes.json();
  assert.equal(siteData.videos.length, 1);
  assert.equal(siteData.videos[0].youtubeId, 'dQw4w9WgXcQ');
});

test('media security: non-admin users cannot delete or add gallery/videos', async () => {
  const { request, login } = setup();
  const userCookie = await login('user');

  const addGallery = await request('/api/admin/gallery', userCookie, 'POST', { src: '/img.jpg' });
  assert.equal(addGallery.status, 403);

  const delGallery = await request('/api/admin/gallery/img_test_1', userCookie, 'DELETE', {});
  assert.equal(delGallery.status, 403);

  const addVideo = await request('/api/admin/videos', userCookie, 'POST', { youtubeId: 'abc12345' });
  assert.equal(addVideo.status, 403);

  const delVideo = await request('/api/admin/videos/vid_test_1', userCookie, 'DELETE', {});
  assert.equal(delVideo.status, 403);
});
