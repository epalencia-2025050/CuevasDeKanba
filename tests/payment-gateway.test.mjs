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

test('tour capacity: holding 2 of 20 seats leaves 18, 20-min expiration restores 20 and blocks payment, payment confirms and keeps 18', async () => {
  const testConfig = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password',
    PAYMENTS_PROVIDER: 'stripe',
    PAYMENTS_SECRET_KEY: 'sk_live_fixture',
    PAYMENTS_WEBHOOK_SECRET: 'whsec_fixture'
  });
  const initial = withRuntime({ config: testConfig }, createInitialStore);

  initial.tours = [{
    id: 'tour-20-cupos',
    name: 'Tour de Prueba 20 Cupos',
    duration: '3h',
    durationMinutes: 120,
    difficulty: 'Fácil',
    price: 150,
    capacity: 20,
    maxParticipants: 20,
    days: [0, 1, 2, 3, 4, 5, 6],
    dates: { mode: 'all' },
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    times: ['10:00'],
    active: true
  }];

  initial.users.push({
    id: 'user_tester',
    name: 'Tester Kanba',
    email: 'tester@example.invalid',
    role: 'user',
    password: initial.admin.password
  });

  const database = memoryRepository(initial);
  const fakeStripeFetch = async () => {
    return Response.json({ id: 'cs_test_session', url: 'https://checkout.stripe.com/pay/test' });
  };
  const services = {
    config: testConfig,
    database,
    network: () => ({ secure: true, ip: '192.0.2.1' }),
    assets: async () => new Response('protected HTML'),
    fetch: fakeStripeFetch
  };
  const app = createApp(services);

  const loginRes = await app.request('https://kanba.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://kanba.test' },
    body: JSON.stringify({ email: 'tester@example.invalid', password: 'synthetic-password' })
  });
  assert.equal(loginRes.status, 200);
  const rawSetCookie = loginRes.headers.get('set-cookie') || '';
  const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [rawSetCookie];
  const userCookie = setCookies.find(c => c.includes('kanba_user=')) || setCookies[0] || '';
  const cookie = userCookie.split(';')[0];

  // 1. Disponibilidad inicial: 20 cupos libres, 0 ocupados
  const availRes1 = await app.request('https://kanba.test/api/availability?tour=tour-20-cupos&from=2026-12-10&days=1');
  assert.equal(availRes1.status, 200);
  const dep1 = (await availRes1.json()).daysList?.[0]?.tours?.[0]?.departures?.[0];
  assert.equal(dep1.left, 20, 'Inicialmente debe haber 20 cupos disponibles');
  assert.equal(dep1.taken, 0, 'Inicialmente ocupados debe ser 0');

  // 2. Apartar 2 cupos en reserva pendiente (retención de 20 minutos)
  const reqId1 = 'req_hold_test_1234567890123456';
  const reserveRes1 = await app.request('https://kanba.test/api/reservations', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: reqId1,
      tourId: 'tour-20-cupos',
      date: '2026-12-10',
      time: '10:00',
      participants: 2,
      participantNames: ['Tester Uno', 'Tester Dos'],
      customer: { name: 'Tester Kanba', email: 'tester@example.invalid', phone: '55555555', country: 'Guatemala', acceptPolicies: true, acceptTerms: true }
    })
  });
  assert.equal(reserveRes1.status, 201);
  const reserveData1 = await reserveRes1.json();
  assert.equal(reserveData1.code.startsWith('KAN-'), true);
  assert(Date.parse(reserveData1.holdExpiresAt) > Date.now(), 'Hold expira en el futuro');
  const holdMinutes = Math.round((Date.parse(reserveData1.holdExpiresAt) - Date.now()) / 60000);
  assert.equal(holdMinutes, 20, 'Retención debe ser de 20 minutos exactos');
  const token1 = reserveData1.token;
  const resObj1 = database.snapshot().reservations.find(r => r.code === reserveData1.code);
  const intent1 = resObj1.payment.intentId;

  // 3. Verificación de cupos tras apartar: baja de 20 a 18 cupos libres
  const availRes2 = await app.request('https://kanba.test/api/availability?tour=tour-20-cupos&from=2026-12-10&days=1');
  const dep2 = (await availRes2.json()).daysList?.[0]?.tours?.[0]?.departures?.[0];
  assert.equal(dep2.left, 18, 'Los cupos disponibles deben bajar de 20 a 18');
  assert.equal(dep2.taken, 2, 'Los cupos apartados deben ser 2');

  // 4. Intento de sobrecupo: pedir 19 cupos adicionales es rechazado (18 disponibles < 19)
  const reqIdOver = 'req_overbooking_12345678901234';
  const overbookRes = await app.request('https://kanba.test/api/reservations', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: reqIdOver,
      tourId: 'tour-20-cupos',
      date: '2026-12-10',
      time: '10:00',
      participants: 19,
      participantNames: Array.from({ length: 19 }, (_, i) => `Persona ${i + 1}`),
      customer: { name: 'Tester Kanba', email: 'tester@example.invalid', phone: '55555555', country: 'Guatemala', acceptPolicies: true, acceptTerms: true }
    })
  });
  assert.equal(overbookRes.status, 409, 'Pedir 19 cupos con solo 18 disponibles debe responder 409 conflicto');

  // 5. Expiración de 20 minutos sin pago: libera los 2 cupos y vuelven a estar 20 disponibles
  await database.transaction(unit => {
    const r = unit.document.reservations.find(item => item.code === reserveData1.code);
    r.holdExpiresAt = new Date(Date.now() - 5000).toISOString(); // Pasaron los 20 min
    unit.dirty = true;
  });

  const availRes3 = await app.request('https://kanba.test/api/availability?tour=tour-20-cupos&from=2026-12-10&days=1');
  const dep3 = (await availRes3.json()).daysList?.[0]?.tours?.[0]?.departures?.[0];
  assert.equal(dep3.left, 20, 'Al expirar los 20 minutos, los cupos deben volver a 20 libres');
  assert.equal(dep3.taken, 0, 'Ocupados debe regresar a 0');
  assert.equal(database.snapshot().reservations.find(r => r.code === reserveData1.code).status, 'expired');

  // 6. Intento de pago en reserva expirada: rechazado con HTTP 409 not_payable
  const payExpiredRes = await app.request(`https://kanba.test/api/payments/${intent1}/pay`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token1 })
  });
  assert.equal(payExpiredRes.status, 409, 'Pagar reserva expirada debe dar 409');
  const payExpiredBody = await payExpiredRes.json();
  assert((payExpiredBody.error?.message || '').includes('ya no admite pagos') || payExpiredBody.error?.code === 'not_payable');

  // 7. Pago completado dentro de los 20 minutos: confirma la reserva y retiene permanentemente los 18 cupos
  const reqId2 = 'req_confirm_test_1234567890123';
  const reserveRes2 = await app.request('https://kanba.test/api/reservations', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: reqId2,
      tourId: 'tour-20-cupos',
      date: '2026-12-10',
      time: '10:00',
      participants: 2,
      participantNames: ['Confirmado Uno', 'Confirmado Dos'],
      customer: { name: 'Tester Kanba', email: 'tester@example.invalid', phone: '55555555', country: 'Guatemala', acceptPolicies: true, acceptTerms: true }
    })
  });
  assert.equal(reserveRes2.status, 201);
  const reserveData2 = await reserveRes2.json();
  const token2 = reserveData2.token;
  const resObj2 = database.snapshot().reservations.find(r => r.code === reserveData2.code);
  const intent2 = resObj2.payment.intentId;

  // Iniciar checkout dentro del plazo vigente (200 OK con url de pago)
  const payActiveRes = await app.request(`https://kanba.test/api/payments/${intent2}/pay`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://kanba.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token2 })
  });
  assert.equal(payActiveRes.status, 200);
  const payActiveBody = await payActiveRes.json();
  assert.equal(payActiveBody.redirect, 'https://checkout.stripe.com/pay/test');

  // Simular webhook de pago aprobado recibido dentro del plazo
  const rawWebhook = JSON.stringify({
    type: 'checkout.session.completed',
    livemode: true,
    data: {
      object: {
        id: 'cs_test_session',
        client_reference_id: intent2,
        payment_intent: 'pi_test_completed',
        payment_status: 'paid',
        amount_total: resObj2.total * 100,
        currency: 'gtq'
      }
    }
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = `t=${timestamp},v1=${createHmac('sha256', 'whsec_fixture').update(`${timestamp}.${rawWebhook}`).digest('hex')}`;
  const webhookRes = await app.request('https://kanba.test/api/webhooks/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
    body: rawWebhook
  });
  assert.equal(webhookRes.status, 200);

  // Reserva confirmada permanentemente y cupos se mantienen en 18 disponibles
  const finalReservation = database.snapshot().reservations.find(r => r.code === reserveData2.code);
  assert.equal(finalReservation.status, 'confirmed');

  const availResFinal = await app.request('https://kanba.test/api/availability?tour=tour-20-cupos&from=2026-12-10&days=1');
  const depFinal = (await availResFinal.json()).daysList?.[0]?.tours?.[0]?.departures?.[0];
  assert.equal(depFinal.left, 18, 'La reserva confirmada descuenta permanentemente 2 cupos (quedan 18)');
  assert.equal(depFinal.taken, 2, 'Ocupados se mantiene en 2');
});
