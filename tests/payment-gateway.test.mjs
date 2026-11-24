import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifiedEvent, hostedCheckout, refundLatePayment } from '../server/gateway.js';
import { createHttpMailTransport } from '../server/mail-transport.js';
import { safeErrorMessage } from '../server/safe-errors.js';
import { createApp, runMaintenance } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore, closeExpiredHolds, seatsTaken } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

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

test('HTTP mail transport categorizes status codes with safe error codes instead of INTERNAL_ERROR', async () => {
  const unconfigured = createHttpMailTransport({});
  await assert.rejects(() => unconfigured({ to: 'guest@example.invalid' }), err => {
    assert.equal(err.code, 'MAIL_CONFIG_ERROR');
    assert.equal(safeErrorMessage(err), 'Operation failed (MAIL_CONFIG_ERROR).');
    return true;
  });

  const authFail = createHttpMailTransport({ MAIL_API_URL: 'https://api.resend.com/emails', MAIL_API_TOKEN: 'bad_token' }, async () => {
    return new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 });
  });
  await assert.rejects(() => authFail({ to: 'guest@example.invalid', fromEmail: 'info@kanba.gt' }), err => {
    assert.equal(err.code, 'MAIL_AUTH_FAILED');
    assert.equal(safeErrorMessage(err), 'Operation failed (MAIL_AUTH_FAILED).');
    return true;
  });

  const domainFail = createHttpMailTransport({ MAIL_API_URL: 'https://api.resend.com/emails', MAIL_API_TOKEN: 'valid' }, async () => {
    return new Response(JSON.stringify({ message: 'The domain kanba.gt is not verified' }), { status: 422 });
  });
  await assert.rejects(() => domainFail({ to: 'guest@example.invalid', fromEmail: 'info@kanba.gt' }), err => {
    assert.equal(err.code, 'MAIL_DOMAIN_UNVERIFIED');
    assert.equal(safeErrorMessage(err), 'Operation failed (MAIL_DOMAIN_UNVERIFIED).');
    return true;
  });

  const rateLimitFail = createHttpMailTransport({ MAIL_API_URL: 'https://api.resend.com/emails', MAIL_API_TOKEN: 'valid' }, async () => {
    return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), { status: 429 });
  });
  await assert.rejects(() => rateLimitFail({ to: 'guest@example.invalid', fromEmail: 'info@kanba.gt' }), err => {
    assert.equal(err.code, 'MAIL_RATE_LIMITED');
    assert.equal(safeErrorMessage(err), 'Operation failed (MAIL_RATE_LIMITED).');
    return true;
  });
});

test('expired reservation holds automatically release seats and update status on demand', async () => {
  const testConfig = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password'
  });
  const initial = withRuntime({ config: testConfig }, createInitialStore);
  initial.tours = [{
    id: 'cueva-rio-sagrado',
    name: 'Cueva Río Sagrado',
    price: 150,
    capacity: 10,
    maxParticipants: 10,
    durationMinutes: 120,
    days: [0, 1, 2, 3, 4, 5, 6],
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    times: ['09:00'],
    active: true
  }];
  // Create an expired hold (holdExpiresAt in the past)
  initial.reservations = [{
    id: 'res_expired_1',
    code: 'KB-EXP01',
    token: 'tok_expired_1',
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-01',
    time: '09:00',
    participants: 4,
    total: 600,
    currency: 'GTQ',
    status: 'pending_payment',
    holdExpiresAt: new Date(Date.now() - 60000).toISOString(),
    createdAt: new Date(Date.now() - 1200000).toISOString(),
    updatedAt: new Date(Date.now() - 1200000).toISOString(),
    customer: { name: 'Juan Perez', email: 'juan@example.invalid' },
    payment: { status: 'requires_payment' },
    history: []
  }];
  initial.users.push({
    id: 'admin',
    name: 'admin',
    role: 'admin',
    email: 'admin@example.invalid',
    password: initial.admin.password
  });

  const database = memoryRepository(initial);
  const services = {
    config: testConfig,
    database,
    network: () => ({ secure: true, ip: '192.0.2.1' }),
    assets: async () => new Response('protected HTML')
  };
  const app = createApp(services);

  // Calling availability API should automatically expire the hold and return full capacity available
  const availRes = await app.request('https://kanba.test/api/availability?tour=cueva-rio-sagrado&from=2026-12-01&days=1');
  assert.equal(availRes.status, 200);
  const availData = await availRes.json();
  const dep = availData.daysList?.[0]?.tours?.[0]?.departures?.[0];
  assert.equal(dep?.left, 10, 'full capacity should be available after expired hold is released');

  const snap = database.snapshot();
  const expiredRes = snap.reservations.find(r => r.code === 'KB-EXP01');
  assert.equal(expiredRes.status, 'expired', 'status should transition to expired');
  assert.equal(expiredRes.payment.status, 'expired', 'payment status should transition to expired');
  assert(expiredRes.history.some(h => h.type === 'expired'), 'history should record expiration');

  // Calling maintenance should notify the expired reservation
  await runMaintenance(services);
  assert(database.snapshot().emails.some(e => e.reservationCode === 'KB-EXP01' && e.template === 'expired'),
    'maintenance should queue expired notification email');
});

test('outbox failed emails can be retried via admin API', async () => {
  const testConfig = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password'
  });
  const initial = withRuntime({ config: testConfig }, createInitialStore);
  initial.users.push({
    id: 'admin',
    name: 'admin',
    role: 'admin',
    email: 'admin@example.invalid',
    password: initial.admin.password
  });
  initial.emails = [{
    id: 'mail_failed_1',
    to: 'customer@example.invalid',
    subject: 'Tu reserva expiró',
    template: 'expired',
    reservationCode: 'KB-TEST01',
    status: 'failed',
    provider: 'https',
    attempts: 1,
    permanentFailed: true,
    error: 'Operation failed (MAIL_AUTH_FAILED).',
    createdAt: new Date().toISOString()
  }];

  const database = memoryRepository(initial);
  const services = {
    config: testConfig,
    database,
    network: () => ({ secure: true, ip: '192.0.2.1' }),
    assets: async () => new Response('protected HTML')
  };
  const app = createApp(services);

  const loginRes = await app.request('https://kanba.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://kanba.test' },
    body: JSON.stringify({ email: 'admin@example.invalid', password: 'synthetic-password' })
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie') || '';

  const retryRes = await app.request('https://kanba.test/api/admin/emails/mail_failed_1/retry', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(retryRes.status, 200);
  const body = await retryRes.json();
  assert.equal(body.ok, true);
  assert.equal(body.email.status, 'queued');
  assert.equal(body.email.attempts, 0);
  assert.equal(body.email.permanentFailed, false);

  const snap = database.snapshot();
  const updated = snap.emails.find(e => e.id === 'mail_failed_1');
  assert.equal(updated.status, 'queued');
  assert.equal(updated.attempts, 0);
  assert.equal(updated.permanentFailed, false);
});
