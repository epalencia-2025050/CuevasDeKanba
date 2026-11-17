// Never log driver messages, response bodies, connection strings or error objects.
const SAFE_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SMTP_SECURE_FAILURE', '23505', '23503', '23514']);
export function safeErrorMessage(error) {
  return `Operation failed (${SAFE_CODES.has(error?.code) ? error.code : 'INTERNAL_ERROR'}).`;
}
