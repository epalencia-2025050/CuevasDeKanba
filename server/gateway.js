import { requirePaymentPermission } from './payment-policy.js';

/**
 * Pasarela de pagos K’anbaPay.
 *
 * IMPORTANTE (PCI DSS / seguridad):
 * Este servidor NO recibe, valida ni almacena el número completo de tarjeta (PAN),
 * la fecha de vencimiento ni el CVV. Esos datos deben tokenizarse en la pasarela
 * (campos alojados / tokenización) y llegar aquí únicamente como `paymentToken`.
 *
 * Contrato:
 *   createIntent(reservation, provider) -> { intentId, provider, status, amount, currency }
 *   charge({ reservation, paymentToken, provider, mode }) -> { approved, brand, last4, reference, message, code }
 *
 * Estado actual: sin una pasarela real validada. En modo `live` el cobro se rechaza.
 */

export function createIntent(reservation, provider = 'KanbaPay Sandbox') {
  return {
    intentId: reservation.payment?.intentId || `pi_${Math.random().toString(36).slice(2, 12)}`,
    provider,
    status: 'requires_payment',
    amount: reservation.total,
    currency: reservation.currency
  };
}

/**
 * Cobro basado en token.
 * - Sandbox: acepta tokens de demostración `tok_demo_*` / `tok_test_*`.
 *   Los sufijos 0002, 0003 y 0069 reproducen los casos de rechazo de prueba.
 * - Producción: rechaza el cobro hasta que exista una integración tokenizada real.
 */
export function charge({ reservation, paymentToken, provider = 'KanbaPay Sandbox', mode = 'sandbox' } = {}) {
  try { requirePaymentPermission(mode); } catch (error) {
    return { approved: false, code: error.code, message: error.message, brand: null, last4: null };
  }
  const token = String(paymentToken || '').trim();
  if (!token) {
    return {
      approved: false,
      code: 'payment_token_required',
      message: 'Se requiere un token de pago emitido por la pasarela.',
      brand: null,
      last4: null
    };
  }

  if (String(mode || 'sandbox').toLowerCase() === 'live') {
    return {
      approved: false,
      code: 'gateway_not_configured',
      message: 'La pasarela de producción no está configurada. El pago con tarjeta permanece deshabilitado hasta integrar una pasarela con tokenización.',
      brand: null,
      last4: null
    };
  }

  // Solo tokens de demostración. Un token real lo emitirá la pasarela cuando se integre.
  if (!/^tok_(demo|test)_/.test(token)) {
    return {
      approved: false,
      code: 'invalid_payment_token',
      message: 'El token de pago no es válido.',
      brand: null,
      last4: null
    };
  }

  const suffix = (token.match(/4242|0002|0003|1881|0069/) || [])[0] || '4242';
  if (suffix === '0002') {
    return {
      approved: false,
      code: 'insufficient_funds',
      message: 'La pasarela rechazó el pago: fondos insuficientes. Prueba otra tarjeta.',
      brand: 'Tarjeta',
      last4: '0002'
    };
  }
  if (suffix === '0003') {
    return {
      approved: false,
      code: 'authentication_required',
      message: 'La pasarela solicita autenticación adicional.',
      brand: 'Tarjeta',
      last4: '0003'
    };
  }
  if (suffix === '0069') {
    return {
      approved: false,
      code: 'expired_card',
      message: 'La pasarela indica que la tarjeta está vencida.',
      brand: 'Tarjeta',
      last4: '0069'
    };
  }

  return {
    approved: true,
    code: 'approved',
    message: 'Pago aprobado',
    brand: 'Tarjeta',
    last4: suffix,
    reference: `PAY-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
    provider,
    amount: reservation.total,
    currency: reservation.currency
  };
}
