import { getConfig, getRuntime } from './runtime.js';
// No production payment adapter has been validated. No configuration can enable it.
export class PaymentPolicyError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'PaymentPolicyError';
    this.code = code;
    this.status = status;
  }
}

export function requirePaymentPermission(mode, channel = 'charge') {
  if (!['sandbox', 'live'].includes(mode)) {
    throw new PaymentPolicyError('invalid_payment_mode', 'Modo de pago no admitido.', 422);
  }
  if (!['development', 'test'].includes(getConfig().NODE_ENV || 'development') || mode === 'live' || channel === 'webhook') {
    throw new PaymentPolicyError('gateway_not_configured', 'Los pagos y sus confirmaciones est\u00e1n deshabilitados hasta integrar una pasarela validada.');
  }
}
