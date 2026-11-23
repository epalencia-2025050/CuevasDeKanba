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

/**
 * Expresión regular canónica estricta para hostnames internos de PostgreSQL en Render:
 * Formato oficial exacto del nodo de base de datos generado por Render:
 *   dpg-[a-z0-9]{8,32}-[a-z0-9]+  (ej. dpg-ck107k7dorps738bnga0-a)
 * No admite subdominios genéricos ni arbitrarios de render.internal, dominios públicos (ej. .com, .local),
 * cadenas malformadas ni comodines.
 */
const RENDER_INTERNAL_HOST_RE = /^dpg-[a-z0-9]{8,32}-[a-z0-9]+$/i;

/**
 * Configura las opciones de conexión para PostgreSQL según el entorno y modo de conexión.
 *
 * Soporta dos modalidades seguras y explícitas:
 * 1. Modalidad estricta ("verify-full"): Por defecto para conexiones externas, servicios en la nube y
 *    servidores empresariales con CA o certificados públicos válidos.
 * 2. Modalidad interna de Render ("require" / canal cifrado no verificado por CA):
 *    Activa EXCLUSIVAMENTE cuando se cumplen AMBAS condiciones de contención:
 *    - La variable explícita PGSSLMODE es 'require' (o query param sslmode=require).
 *    - El host cumple estrictamente la estructura de nombres de la red interna privada de Render (RENDER_INTERNAL_HOST_RE).
 *    Esta modalidad utiliza TLS >= 1.2 pero omite la validación de CA (rejectUnauthorized: false),
 *    permitiendo los certificados autofirmados que Render utiliza en su red privada interna.
 *    Bajo ninguna circunstancia se permite 'require' para hostnames externos o genéricos.
 */
export function postgresConnectionOptions(connectionString, env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw configurationError();

  let url;
  try { url = new URL(connectionString); } catch { throw configurationError(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw configurationError();

  let querySslMode = null;
  // pg can replace the ssl object with URL options. Inspect and reject overrides before parsing in pg.
  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode') {
      if (['verify-full', 'require'].includes(value)) {
        querySslMode = value;
        continue;
      }
      throw configurationError();
    }
    if (key !== 'application_name') throw configurationError();
  }

  // Si se especificó en query o en env, deben coincidir si ambos existen
  const requestedMode = env.PGSSLMODE || querySslMode || 'verify-full';

  if (!['verify-full', 'require'].includes(requestedMode)) throw configurationError();
  if (querySslMode && env.PGSSLMODE && querySslMode !== env.PGSSLMODE) throw configurationError();

  url.searchParams.delete('sslmode');
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (requestedMode === 'require') {
    // Restricción estricta de contención: solo se permite para hostnames internos de PostgreSQL en Render
    if (!RENDER_INTERNAL_HOST_RE.test(host)) {
      throw new Error('La modalidad sslmode=require solo est\u00e1 permitida para el hostname interno de PostgreSQL en Render (dpg-...-a con formato v\u00e1lido).');
    }
    // Conexión cifrada sin validación de CA (autofirmado interno de Render en red privada)
    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      }
    };
  }

  // Modalidad por defecto: verify-full con CA y validación estricta de identidad
  return {
    connectionString: url.toString(),
    ssl: verifiedTlsOptions('PG', host, env)
  };
}
