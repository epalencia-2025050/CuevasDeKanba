import net from 'node:net';

export class RequestSecurityError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.code = 'request_rejected'; }
}
const normalizeIp = value => String(value || '').replace(/^::ffff:/, '');
export function createRequestSecurity(env = process.env) {
  const proxies = new net.BlockList();
  for (const item of String(env.TRUSTED_PROXY_CIDRS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [address, prefix, extra] = item.split('/');
    const family = net.isIP(address);
    if (!family || extra !== undefined) throw new Error('TRUSTED_PROXY_CIDRS inválido.');
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) proxies.addAddress(address, type);
    else {
      if (!/^\d+$/.test(prefix) || Number(prefix) === 0 || Number(prefix) > (family === 4 ? 32 : 128)) throw new Error('TRUSTED_PROXY_CIDRS inválido.');
      proxies.addSubnet(address, Number(prefix), type);
    }
  }
  const trusted = address => {
    address = normalizeIp(address);
    const family = net.isIP(address);
    return family !== 0 && proxies.check(address, family === 4 ? 'ipv4' : 'ipv6');
  };
  let publicOrigin;
  if (env.PUBLIC_URL) {
    const url = new URL(env.PUBLIC_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_URL inválida.');
    publicOrigin = url.origin;
  }
  if (env.NODE_ENV === 'production' && (!publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('Producción requiere PUBLIC_URL con HTTPS.');
  return {
    secure(req) {
      return Boolean(req.socket?.encrypted) || (trusted(req.socket?.remoteAddress) && req.headers['x-forwarded-proto'] === 'https');
    },
    ip(req) {
      let peer = normalizeIp(req.socket?.remoteAddress);
      if (!trusted(peer)) return peer || 'unknown';
      const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(s => normalizeIp(s.trim())).filter(Boolean);
      for (let i = chain.length - 1; i >= 0 && trusted(peer); i--) {
        if (!net.isIP(chain[i])) throw new RequestSecurityError('Dirección de red inválida.');
        peer = chain[i];
      }
      return peer;
    },
    validate(req) {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new RequestSecurityError('Ruta inválida.');
      if (env.NODE_ENV === 'production' && !this.secure(req)) throw new RequestSecurityError('Se requiere HTTPS.', 426);
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
      if (req.url.split('?')[0] === '/api/webhooks/payments') return; // Separate authenticated protocol; currently disabled.
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new RequestSecurityError('Se requiere application/json.', 415);
      let origin = publicOrigin;
      if (!origin) {
        try { origin = new URL(`${this.secure(req) ? 'https' : 'http'}://${req.headers.host}`).origin; }
        catch { throw new RequestSecurityError('Host inválido.'); }
      }
      if (req.headers.origin !== origin) throw new RequestSecurityError('Origen no autorizado.', 403);
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none') throw new RequestSecurityError('Origen no autorizado.', 403);
    }
  };
}

export function parseJsonObject(raw) {
  let value;
  try {
    value = JSON.parse(raw || '{}', (key, item) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error();
      return item;
    });
  } catch { throw new RequestSecurityError('JSON inválido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestSecurityError('Se requiere un objeto JSON.');
  return value;
}
