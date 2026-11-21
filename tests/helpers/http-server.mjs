import { defaultTours, defaultSettings } from './tour-catalog.mjs';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../server/index.js';
import { createConfig, withRuntime } from '../../server/runtime.js';
import { createInitialStore } from '../../server/store.js';
import { memoryRepository } from './memory-repository.mjs';

let app;
const server = serve({ fetch: (...args) => app.fetch(...args), hostname: '127.0.0.1', port: 0 });
if (!server.listening) await once(server, 'listening');
const port = server.address().port;
const config = createConfig({ ...process.env, PUBLIC_URL: `http://127.0.0.1:${port}` });
const initial = withRuntime({ config }, createInitialStore);
initial.users.push({ id: 'test-admin', name: 'Test Admin', email: 'admin@example.invalid',
  role: 'admin', password: initial.admin.password, createdAt: new Date().toISOString() });
initial.tours = defaultTours();
initial.settings = defaultSettings();
const database = memoryRepository(initial, document => fs.writeFile(path.join(process.env.DATA_DIR, 'db.json'), JSON.stringify(document)));
app = createApp({ config, database, fetch, mailConfigured: false,
  sendMail: async () => { throw new Error('External mail forbidden in tests.'); },
  network: () => ({ secure: false, ip: '127.0.0.1' }), assets: async () => new Response('fixture') });
process.send({ port });
process.on('SIGTERM', () => server.close());
