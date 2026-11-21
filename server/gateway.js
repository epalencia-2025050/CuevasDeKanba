import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, getDb, getReservation, saveDb, withStoreTransaction } from './store.js';

export function paymentsEnabled(config) {
  const key = config.PAYMENTS_SECRET_KEY || '';
  return Boolean(config.PAYMENTS_PROVIDER === 'stripe' && config.PAYMENTS_WEBHOOK_SECRET &&
    (config.NODE_ENV === 'production' ? /^(sk|rk)_live_/.test(key) : /^(sk|rk)_test_/.test(key)));
}

export function requireGateway(config) {
  if (!paymentsEnabled(config)) throw new AppError('Los pagos en línea no están disponibles.', 503, 'gateway_not_configured');
}

export function chargeAmount(reservation) {
  // The booking ledger currently records prices to two decimal places.
  if (!['GTQ', 'USD', 'EUR'].includes(reservation.currency)) throw new AppError('Moneda no habilitada para pagos.', 422, 'unsupported_currency');
  const amount = Math.round(reservation.total * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== Math.round(reservation.unitPrice * 100) * reservation.participants)
    throw new AppError('Revisa el importe de la reserva.', 409, 'invalid_amount');
  return amount;
}

async function stripePost(path, params, key, config, fetcher) {
  try {
    const response = await fetcher('https://api.stripe.com/v1/' + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + config.PAYMENTS_SECRET_KEY, 'Idempotency-Key': key },
      body: new URLSearchParams(params)
    });
    if (response.ok) return await response.json();
  } catch { /* Public errors exclude provider responses and credentials. */ }
  throw new AppError('La pasarela no está disponible. Inténtalo de nuevo.', 503, 'gateway_unavailable');
}

export async function hostedCheckout(r, config, fetcher) {
  const session = await stripePost('checkout/sessions', {
    mode: 'payment', 'payment_method_types[0]': 'card',
    'payment_intent_data[metadata][booking_intent]': r.payment.intentId,
    client_reference_id: r.payment.intentId, success_url: config.PUBLIC_URL + '/cuenta.html',
    cancel_url: config.PUBLIC_URL + '/cuenta.html',
    'line_items[0][price_data][currency]': r.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(chargeAmount(r) / r.participants),
    'line_items[0][price_data][product_data][name]': r.tourName,
    'line_items[0][quantity]': String(r.participants)
  }, 'checkout-' + r.payment.intentId, config, fetcher);
  if (!session.id || !session.url || new URL(session.url).origin !== 'https://checkout.stripe.com')
    throw new AppError('Respuesta de pago no disponible.', 502, 'gateway_unavailable');
  return { id: session.id, url: session.url };
}

export async function startCheckout(intentId, body, config, fetcher) {
  requireGateway(config);
  if (Object.keys(body).some(key => key !== 'token')) throw new AppError('Solicitud de pago inválida.', 422, 'invalid_payment_request');
  function payable() {
    const r = getDb().reservations.find(item => item.payment?.intentId === intentId);
    if (!r) throw new AppError('Enlace inválido.', 403, 'forbidden');
    getReservation(r.code, body.token);
    if (r.status !== 'pending_payment' || !(Date.parse(r.holdExpiresAt) > Date.now()))
      throw new AppError('Esta reserva ya no admite pagos.', 409, 'not_payable');
    return r;
  }
  const reservation = await withStoreTransaction(() => structuredClone(payable()));
  if (reservation.payment.checkoutUrl) return reservation.payment.checkoutUrl;
  const session = await hostedCheckout(reservation, config, fetcher);
  return withStoreTransaction(() => {
    const r = payable();
    r.payment.sessionId = session.id;
    r.payment.checkoutUrl = session.url;
    r.payment.provider = 'Stripe';
    saveDb();
    return session.url;
  });
}

export async function refundReservation(r, refund, config, fetcher) {
  if (r.payment?.provider !== 'Stripe' || !r.payment.reference?.startsWith('pi_')) throw new AppError('Reembolso requiere conciliación.', 409, 'refund_unavailable');
  const amount = Math.round(refund.amount * 100);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > chargeAmount(r)) throw new AppError('Importe inválido.', 409, 'invalid_refund');
  if (refund.reference?.startsWith('re_')) {
    let current;
    try {
      const res = await fetcher('https://api.stripe.com/v1/refunds/' + encodeURIComponent(refund.reference), {
        headers: { Authorization: 'Bearer ' + config.PAYMENTS_SECRET_KEY }, redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (res.ok) current = await res.json();
    } catch { /* keep the recorded reference for reconciliation */ }
    if (current?.status !== 'succeeded' || current.amount !== amount || current.payment_intent !== r.payment.reference)
      throw new AppError('El reembolso requiere conciliación en la pasarela.', 409, 'refund_review');
    return current;
  }
  const result = await stripePost('refunds', { payment_intent: r.payment.reference, amount: String(amount) }, refund.id, config, fetcher);
  if (!result.id || !result.status) throw new AppError('Revisa el estado del reembolso en la pasarela.', 409, 'refund_review');
  return result;
}

export async function refundLatePayment(paymentId, config, fetcher) {
  const refund = await stripePost('refunds', { payment_intent: paymentId }, 'late-' + paymentId, config, fetcher);
  if (!refund.id || !['pending','succeeded'].includes(refund.status)) throw new AppError('Reembolso pendiente de revisión.', 503, 'refund_unavailable');
  return refund.id;
}

export function verifiedEvent(raw, header, config) {
  const parts = String(header || '').split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const digest = createHmac('sha256', config.PAYMENTS_WEBHOOK_SECRET).update(timestamp + '.' + raw).digest();
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !parts.some(p => /^v1=[a-f0-9]{64}$/.test(p) && timingSafeEqual(digest, Buffer.from(p.slice(3), 'hex'))))
    throw new AppError('Firma de pago inválida.', 401, 'invalid_signature');
  const event = JSON.parse(raw);
  if (event.livemode !== (config.NODE_ENV === 'production')) throw new AppError('Entorno de pago inválido.', 400, 'invalid_event');
  return event;
}
