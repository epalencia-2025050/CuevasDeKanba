import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifiedEvent, hostedCheckout, refundLatePayment } from '../server/gateway.js';
import { createHttpMailTransport } from '../server/mail-transport.js';

const config = { PUBLIC_URL: 'https://site.invalid', PAYMENTS_WEBHOOK_SECRET: 'fixture', NODE_ENV: 'test' };
test('checkout uses server price, quantity and repeatable provider request; no private access token leaves the app', async () => {
  const booking = { unitPrice: 12.35, participants: 2, total: 24.70, currency: 'GTQ', token: 'private_fixture', tourName: 'Tour', payment: { intentId: 'intent_fixture' } };
  await hostedCheckout(booking, config, async (url, opts) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(opts.body.get('line_items[0][price_data][unit_amount]'), '1235');
    assert.equal(opts.body.get('line_items[0][quantity]'), '2');
    assert.equal(opts.headers['Idempotency-Key'], 'checkout-intent_fixture');
    assert(!opts.body.toString().includes(booking.token));
    return Response.json({ id: 'cs_fixture', url: 'https://checkout.stripe.com/test' });
  });
});
test('signed webhooks reject stale timestamps and wrong payment environment', () => {
  const raw = JSON.stringify({ livemode: true });
  function header(t) { return 't=' + t + ',v1=' + createHmac('sha256', config.PAYMENTS_WEBHOOK_SECRET).update(t + '.' + raw).digest('hex'); }
  assert.throws(() => verifiedEvent(raw, header(0), config), /Firma/);
  assert.throws(() => verifiedEvent(raw, header(Math.floor(Date.now()/1000)), config), /Entorno/);
});
test('late checkout requests full refund using a repeatable key', async () => {
  assert.equal(await refundLatePayment('pi_fixture', config, async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/refunds');
    assert.equal(options.body.get('payment_intent'), 'pi_fixture');
    assert.equal(options.headers['Idempotency-Key'], 'late-pi_fixture');
    return Response.json({ id: 're_fixture', status: 'pending' });
  }), 're_fixture');
});
test('Resend receives verified sender, recipient and stable message key', async () => {
  const transport = createHttpMailTransport({ MAIL_API_URL: 'https://api.resend.com/emails', MAIL_API_TOKEN: 'fixture' }, async (_, opts) => {
    const data = JSON.parse(opts.body);
    assert.deepEqual(data.to, ['guest@example.invalid']);
    assert.equal(data.from, 'sender@example.invalid');
    assert.equal(opts.headers['Idempotency-Key'], 'mail_fixture');
    return Response.json({ id: 'provider_fixture' });
  });
  await transport({ messageId: 'mail_fixture', to: 'guest@example.invalid', fromEmail: 'sender@example.invalid', subject: 'Confirmation', text: 'Test' });
});
