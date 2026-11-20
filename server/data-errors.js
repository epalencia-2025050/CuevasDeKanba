export class StoreInvalidError extends Error {
  constructor() {
    super('El almacenamiento requiere revisión.');
    this.code = 'store_invalid';
    this.status = 503;
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateStore(doc) {
  if (!object(doc) || !Array.isArray(doc.users) ||
      !object(doc.meta) || !object(doc.sessions) || !object(doc.userSessions) ||
      doc.users.some(user => !object(user) || typeof user.email !== 'string')) {
    throw new StoreInvalidError();
  }
  return doc;
}

// Only availability failures: schema, permissions and programming errors remain 500.
const unavailable = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  '08000', '08001', '08003', '08004', '08006', '08007',
  '53300', '57P01', '57P02', '57P03', '55P03'
]);
export function isDatabaseUnavailable(error) {
  return unavailable.has(error?.code);
}
