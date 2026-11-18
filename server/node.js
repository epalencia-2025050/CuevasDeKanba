import { serve } from '@hono/node-server';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, runMaintenance } from './index.js';
import { createConfig } from './runtime.js';
import { createDatabase } from './db.js';
import { createRequestSecurity } from './request-security.js';
import { sendSmtpMail } from './smtp.js';
import { createHttpMailTransport } from './mail-transport.js';
import { safeErrorMessage } from './safe-errors.js';

const config = createConfig(process.env);
const database = createDatabase(config);
const security = createRequestSecurity(config);
const publicDir = await realpath(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
const services = {
  config, database, fetch,
  mailConfigured: Boolean(config.MAIL_API_URL && config.MAIL_API_TOKEN) || Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS),
  sendMail: config.MAIL_API_URL ? createHttpMailTransport(config) : message => sendSmtpMail(message, config),
  network: c => ({ secure: security.secure(c.env.incoming), ip: security.ip(c.env.incoming) }),
  async assets(request) {
    try {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const target = await realpath(path.resolve(publicDir, '.' + pathname));
      if (!target.startsWith(publicDir + path.sep) || !(await stat(target)).isFile()) return new Response('No encontrado', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : await readFile(target),
        { headers: { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' } });
    } catch { return new Response('No encontrado', { status: 404 }); }
  }
};
await database.health();
const server = serve({ fetch: createApp(services).fetch, hostname: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000) });
let current = null, stopping = false;
const timer = setInterval(() => {
  if (current || stopping) return;
  current = runMaintenance(services).catch(error => console.error('[maintenance]', safeErrorMessage(error))).finally(() => { current = null; });
}, 15000);
timer.unref();
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await new Promise(resolve => server.close(resolve));
  await current;
  await database.close();
}
process.once('SIGTERM', () => { stop().catch(() => { process.exitCode = 1; }); });
process.once('SIGINT', () => { stop().catch(() => { process.exitCode = 1; }); });
