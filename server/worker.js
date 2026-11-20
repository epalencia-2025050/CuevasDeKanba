import { createApp, runMaintenance } from './index.js';
import { createConfig } from './runtime.js';
import { createDatabase } from './db.js';
import { createHttpMailTransport } from './mail-transport.js';
import { safeErrorMessage } from './safe-errors.js';

export function workerServices(env) {
  const config = createConfig(env);
  if (!env.HYPERDRIVE && (config.PG_TLS_CA || config.PG_TLS_SERVERNAME)) {
    throw new Error('Workers direct sockets require a publicly trusted certificate for the database hostname. Configure custom TLS at Hyperdrive or use Node.');
  }
  const database = createDatabase(config, {
    connectionString: env.HYPERDRIVE?.connectionString || config.DATABASE_URL,
    managedTransport: Boolean(env.HYPERDRIVE)
  });
  return { config, database, fetch,
    mailConfigured: Boolean(config.MAIL_API_URL && config.MAIL_API_TOKEN),
    sendMail: createHttpMailTransport(config),
    assets: request => env.ASSETS.fetch(request),
    network: c => ({ secure: new URL(c.req.url).protocol === 'https:',
      ip: c.req.header('CF-Connecting-IP') || 'unknown' })
  };
}

export default {
  async fetch(request, env, ctx) {
    let services;
    try {
      services = workerServices(env);
      return await createApp(services).fetch(request);
    } catch (error) {
      console.error('[worker]', safeErrorMessage(error));
      return Response.json({ error: { code: 'configuration_error', message: 'Servicio no disponible.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    } finally {
      if (services) ctx.waitUntil(services.database.close());
    }
  },
  async scheduled(event, env, ctx) {
    const services = workerServices(env);
    ctx.waitUntil(runMaintenance(services).finally(() => services.database.close()));
  }
};
