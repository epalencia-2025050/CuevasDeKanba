import { Hono } from 'hono';
import { withRuntime } from './runtime.js';
import { createHandlers } from './routes.js';
import { webRequest, webReply, readWebBody, validateRequest } from './web-http.js';
import { withStoreTransaction, getDb, AppError, closeExpiredHolds } from './store.js';
import { PaymentPolicyError } from './payment-policy.js';
import { RequestSecurityError } from './request-security.js';
import { notifyExpired, processEmailRetryQueue } from './mailer.js';
import { safeErrorMessage } from './safe-errors.js';

export function createApp(services) {
  const app = new Hono();
  const handlers = createHandlers(services.config);
  app.use('*', async (c, next) => withRuntime(services, async () => {
    const reply = webReply();
    handlers.securityHeaders(reply);
    reply.end();
    for (const [key, value] of reply.response().headers) c.header(key, value);
    if (services.network(c).secure) c.header('Strict-Transport-Security', 'max-age=15552000');
    await next();
  }));
  app.onError((error, c) => {
    const known = error instanceof AppError || error instanceof PaymentPolicyError || error instanceof RequestSecurityError;
    if (!known) console.error('[app]', safeErrorMessage(error));
    c.header('Cache-Control', 'no-store');
    return c.json({ error: { code: known ? error.code : 'server_error',
      message: known ? error.message : 'Ocurrió un error inesperado. Intenta de nuevo.' } }, known ? error.status : 500);
  });
  app.get('/api/health', c => { c.header('Cache-Control', 'no-store'); return c.json({ ok: true, service: 'kanba' }); });
  app.all('/api/*', async c => {
    const req = webRequest(c.req.raw, services.network(c));
    validateRequest(req, services.config);
    if (await services.database.rateLimit(`request:${req.ip}`, 60000) > 180) throw new AppError('Demasiados intentos.', 429, 'rate_limited');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      await readWebBody(req, c.req.path === '/api/admin/media' ? 12 * 1024 * 1024 : 65536);
    }
    const reply = webReply();
    await withStoreTransaction(async () => {
      if (services.config.NODE_ENV === 'production' && getDb().admin?.passwordPolicyVersion !== 2) {
        throw new AppError('La credencial administrativa requiere rotación.', 503, 'configuration_required');
      }
      await handlers.handleApi(req, reply, new URL(c.req.url));
    });
    c.header('Cache-Control', 'no-store');
    return reply.response();
  });
  app.get('/uploads/:name', async c => {
    const name = c.req.param('name');
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return c.notFound();
    const file = await services.database.readUpload(name);
    if (!file) return c.notFound();
    return new Response(file.data, { headers: { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=604800' } });
  });
  app.all('*', async c => {
    if (!['GET', 'HEAD'].includes(c.req.method)) return c.text('Método no permitido.', 405);
    const url = new URL(c.req.url);
    if (url.pathname === '/favicon.ico') url.pathname = '/assets/favicon.svg';
    else if (url.pathname === '/') url.pathname = '/index.html';
    else if (/^\/[a-z-]+$/.test(url.pathname)) url.pathname += '.html';
    const response = await services.assets(new Request(url, c.req.raw));
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', url.pathname.endsWith('.html') ? 'no-store' : /\.(js|css)$/.test(url.pathname) ? 'no-cache' : 'public, max-age=604800');
    return new Response(c.req.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  });
  return app;
}

export async function runMaintenance(services) {
  return withRuntime(services, async () => {
    await withStoreTransaction(async () => {
      for (const reservation of closeExpiredHolds()) await notifyExpired(reservation);
      createHandlers(services.config).cleanupSessions();
    });
    await processEmailRetryQueue();
    await services.database.cleanup();
  });
}
