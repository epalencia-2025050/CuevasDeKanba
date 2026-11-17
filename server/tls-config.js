import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

function configurationError() {
  return new Error('Configuraci\u00f3n TLS inv\u00e1lida. Revisa el host, la CA y las opciones de transporte seguro.');
}

export function verifiedTlsOptions(prefix, host, env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw configurationError();
  const identity = String(env[`${prefix}_TLS_SERVERNAME`] || host || '');
  if (!identity || /[\s/\\@]/.test(identity)) throw configurationError();
  const pem = env[`${prefix}_TLS_CA`];
  const file = env[`${prefix}_TLS_CA_FILE`];
  if (pem && file) throw configurationError();
  let ca;
  try {
    ca = file ? fs.readFileSync(file, 'utf8') : pem;
    if ((file || pem) && !ca?.includes('-----BEGIN CERTIFICATE-----')) throw configurationError();
    if (ca) tls.createSecureContext({ ca });
  } catch { throw configurationError(); }
  return {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ...(net.isIP(identity) ? {} : { servername: identity }),
    ...(ca ? { ca } : {}),
    checkServerIdentity: (_host, cert) => {
      if (tls.checkServerIdentity(identity, cert)) return new Error('Identidad TLS del servidor no v\u00e1lida.');
    }
  };
}

export function postgresConnectionOptions(connectionString, env = process.env) {
  let url;
  try { url = new URL(connectionString); } catch { throw configurationError(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw configurationError();
  // pg can replace the ssl object with URL options. Reject overrides before parsing in pg.
  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode' && value === 'verify-full') continue;
    if (key !== 'application_name') throw configurationError();
  }
  if (env.PGSSLMODE && env.PGSSLMODE !== 'verify-full') throw configurationError();
  url.searchParams.delete('sslmode');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return { connectionString: url.toString(), ssl: verifiedTlsOptions('PG', host, env) };
}
