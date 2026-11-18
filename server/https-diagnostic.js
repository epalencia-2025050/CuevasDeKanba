import crypto from 'node:crypto';
import net from 'node:net';
import { RequestSecurityError } from './request-security.js';

// Límite de seguridad para evitar inundación de logs (máximo 5 capturas por ciclo de proceso)
const MAX_CAPTURES = 5;
let captureCount = 0;

function normalizeAddress(value) {
  const address = String(value || '').trim();
  if (net.isIP(address) === 4) return address;
  if (address.startsWith('::ffff:')) return address.slice(7);
  return address;
}

function countHeaderOccurrences(rawHeaders, name) {
  const target = String(name).toLowerCase();
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === target) count++;
  }
  return count;
}

function sanitizeForwardedProto(value) {
  if (value === undefined || value === null) return 'missing';
  const proto = String(value).trim().toLowerCase();
  if (proto === 'https') return 'https';
  if (proto === 'http') return 'http';
  return 'other';
}

/**
 * Registra metadatos de red para diagnóstico exclusivo del error HTTP 426 en staging.
 * No registra cookies, tokens, credenciales, cabeceras de usuario ni cuerpos HTTP.
 */
export function logHttpsRejection(error, req, {
  enabled = process.env.HTTPS_DIAGNOSTICS === '1',
  warn = console.warn
} = {}) {
  if (!enabled || !(error instanceof RequestSecurityError) || error.status !== 426) {
    return;
  }
  if (captureCount >= MAX_CAPTURES) {
    if (captureCount === MAX_CAPTURES) {
      captureCount++;
      try {
        warn('[diagnostico-https] Límite de capturas alcanzado (5/5). Silenciando registros adicionales.');
      } catch {
        /* Fail-safe: las fallas de logging nunca deben propagarse */
      }
    }
    return;
  }
  try {
    const rawHeaders = req.rawHeaders || [];
    const protoCount = countHeaderOccurrences(rawHeaders, 'x-forwarded-proto');
    const forwardedProto = req.headers ? req.headers['x-forwarded-proto'] : undefined;
    const remote = req.socket?.remoteAddress;
    const normalizedRemote = normalizeAddress(remote);
    const encrypted = Boolean(req.socket?.encrypted);
    const hasTrustedConfig = Boolean(process.env.TRUSTED_PROXY_CIDRS);

    captureCount++;
    warn('[diagnostico-https]', JSON.stringify({
      captureIndex: captureCount,
      correlationId: crypto.randomBytes(6).toString('hex'),
      remoteAddress: normalizedRemote || 'unknown',
      encrypted,
      forwardedProto: sanitizeForwardedProto(forwardedProto),
      forwardedProtoCount: protoCount,
      hasTrustedProxiesConfigured: hasTrustedConfig
    }));
  } catch {
    /* El diagnóstico nunca debe interrumpir el flujo ni lanzar excepciones */
  }
}
