import { AsyncLocalStorage } from 'node:async_hooks';

// Request-local dependency injection. Never copy bindings into process.env.
const runtime = new AsyncLocalStorage();
export function withRuntime(services, work) { return runtime.run(services, work); }
export function getRuntime() {
  const value = runtime.getStore();
  if (!value) throw new Error('Application runtime is not configured.');
  return value;
}
export function getConfig() { return getRuntime().config; }

export function createConfig(input = {}) {
  const keys = ['NODE_ENV', 'PUBLIC_URL', 'DATABASE_URL', 'DB_SCHEMA', 'ADMIN_PASSWORD',
    'ADMIN_SESSION_IDLE_MS', 'USER_SESSION_IDLE_MS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI', 'PAYMENTS_PROVIDER', 'PAYMENTS_SECRET_KEY', 'PAYMENTS_WEBHOOK_SECRET', 'SMTP_HOST',
    'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME',
    'MAIL_API_URL', 'MAIL_API_TOKEN', 'PG_TLS_CA', 'PG_TLS_SERVERNAME', 'TRUSTED_PROXY_CIDRS',
    'SMTP_TLS_CA', 'SMTP_TLS_CA_FILE', 'SMTP_TLS_SERVERNAME'];
  const config = Object.fromEntries(keys.map(key => [key, input[key] === undefined ? '' : String(input[key])]));
  config.NODE_ENV ||= 'production';
  config.DB_SCHEMA ||= 'public';
  config.PUBLIC_URL ||= config.NODE_ENV === 'production' ? '' : 'http://localhost:3000';
  if (!['production', 'development', 'test'].includes(config.NODE_ENV)) throw new Error('Invalid NODE_ENV.');
  const origin = new URL(config.PUBLIC_URL);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      (config.NODE_ENV === 'production' && origin.protocol !== 'https:')) throw new Error('Invalid PUBLIC_URL.');
  config.PUBLIC_URL = origin.origin;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(config.DB_SCHEMA)) throw new Error('Invalid DB_SCHEMA.');
  if (config.GOOGLE_REDIRECT_URI && config.GOOGLE_REDIRECT_URI !== `${config.PUBLIC_URL}/api/auth/google/callback`) {
    throw new Error('GOOGLE_REDIRECT_URI must match PUBLIC_URL callback.');
  }
  if (config.MAIL_API_URL && new URL(config.MAIL_API_URL).protocol !== 'https:') throw new Error('Mail API requires HTTPS.');
  return Object.freeze(config);
}
