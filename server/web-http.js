import { RequestSecurityError } from './request-security.js';

export function webRequest(request, network) {
  return { raw: request, method: request.method, url: request.url,
    headers: Object.fromEntries(request.headers), secure: network.secure, ip: network.ip };
}
export function validateRequest(req, config) {
  if (config.NODE_ENV === 'production' && !req.secure) throw new RequestSecurityError('Se requiere HTTPS.', 426);
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (new URL(req.url).pathname === '/api/webhooks/payments') return;
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const contentLength = Number(req.headers['content-length']);
  const hasBody = !Number.isNaN(contentLength) && contentLength > 0;
  if (contentType !== 'application/json') {
    if (req.method === 'DELETE' && !contentType && !hasBody) {
      // DELETE sin cuerpo ni content-type es seguro y válido
    } else {
      throw new RequestSecurityError('Se requiere application/json.', 415);
    }
  }
  if (req.headers.origin !== config.PUBLIC_URL ||
      (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
    throw new RequestSecurityError('Origen no autorizado.', 403);
  }
}
export async function readWebBody(req, limit = 65536) {
  if (req.bodyText !== undefined) {
    if (new TextEncoder().encode(req.bodyText).length > limit) throw new RequestSecurityError('Contenido demasiado grande.', 413);
    return req.bodyText;
  }
  if (Number(req.headers['content-length']) > limit) throw new RequestSecurityError('Contenido demasiado grande.', 413);
  if (!req.raw.body) return req.bodyText = '';
  const reader = req.raw.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RequestSecurityError('Contenido demasiado grande.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return req.bodyText = new TextDecoder().decode(bytes);
}

// Preserve handler contracts; publish a Web Response only after transaction commit.
export function webReply() {
  const headers = new Headers();
  let status = 200, body;
  return {
    setHeader(name, value) {
      if (name.toLowerCase() === 'set-cookie') headers.append(name, String(value));
      else headers.set(name, String(value));
    },
    writeHead(code, values = {}) { status = code; for (const [key, value] of Object.entries(values)) this.setHeader(key, value); },
    end(value = '') { body = value; },
    response() {
      if (body === undefined) throw new Error('Missing response.');
      return new Response([204, 304].includes(status) ? null : body, { status, headers });
    }
  };
}
