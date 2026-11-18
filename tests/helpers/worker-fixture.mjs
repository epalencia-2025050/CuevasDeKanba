import { createApp } from '../../server/index.js';
import { createConfig, withRuntime } from '../../server/runtime.js';
import { createInitialStore } from '../../server/store.js';
import { memoryRepository } from './memory-repository.mjs';
let database;
export default {
  async fetch(request) {
    const config = createConfig({ NODE_ENV: 'test', PUBLIC_URL: 'https://kanba.test', ADMIN_PASSWORD: 'SYNTHETIC-ADMIN-PASSWORD' });
    database ||= memoryRepository(withRuntime({ config }, createInitialStore));
    const services = { config, database, fetch,
      network: () => ({ secure: true, ip: '192.0.2.1' }), mailConfigured: false,
      assets: async () => new Response('static fixture'), sendMail: async () => { throw new Error('mail forbidden'); } };
    return createApp(services).fetch(request);
  }
};
