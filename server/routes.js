import crypto from 'node:crypto';
import { exchangeGoogleCode, GoogleTokenError } from './google-token.js';
import { parseJsonObject } from './request-security.js';
import { getRuntime } from './runtime.js';
import { safeErrorMessage } from './safe-errors.js';
import { readWebBody } from './web-http.js';
import {
  validateBookingPolicy, rotateReservationToken, saveUploadToDb, deleteUploadFromDb,
  getDb, saveDb, publicSite, publicTour, buildAvailability, operatesOn, normalizeWeekday,
  createReservation, getReservation, findTour, closeExpiredHolds, seatsTaken,
  validateCustomer, dateToEpoch, formatDateLong, isoAddDays, todayISO, dayOfWeek,
  AppError, nextReceiptNumber, TZ,
  nextCafeOrderCode, prepareCafeOrder, chargeCafeCard,
  getCafeProducts, getCafeSupplies, nextCafeMovementCode, nextCafeExpenseId, deductCafeInventory,
  registerUser, loginUser, getUserSession, logoutUser, findUserByEmail, rateLimitShared,
  createUserSession, registerGoogleUser, linkGoogleAccount,
  getGuides, findGuide, saveGuide, deleteGuide, assignGuideToReservation,
  createInPersonTourSale, getTourExpenses, nextTourExpenseId
} from './store.js';
import { hashPassword, verifyPassword, randomToken, safeEqual } from './security.js';
import { paymentsEnabled, requireGateway, chargeAmount, refundLatePayment, refundReservation, verifiedEvent } from './gateway.js';

import { paymentSecrets, settingsWithoutSecrets, containsIncomingSecrets } from './runtime-secrets.js';
import {
  notifyPending, notifyConfirmed, notifyExpired, notifyCancellation, notifyRefund, resendMail,
  testSmtpConnection, getPublicSmtpStatus, processEmailRetryQueue
} from './mailer.js';


export function createHandlers(config) {
const NODE_ENV = config.NODE_ENV;
const SESSION_COOKIE = 'kanba_session';
const USER_COOKIE = 'kanba_user';
// Inicio de sesión con Google (OAuth 2.0). Configurar en Render o en .env.
const GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = config.GOOGLE_REDIRECT_URI || '';
const MAX_BODY = 64 * 1024;

function isSecureRequest(req) { return req.secure; }

function cookieBase(req, name, value, maxAge) {
  const secure = NODE_ENV === 'production' || isSecureRequest(req) ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Google Tag Manager / Google Analytics 4 (contenedor GTM-N8ZD2LM3) / Stripe
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://googleads.g.doubleclick.net https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https://*.googleusercontent.com data: blob: https://i.ytimg.com https://img.youtube.com https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://www.google.com https://www.google.co.uk https://*.stripe.com",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.googletagmanager.com https://td.doubleclick.net https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://stats.g.doubleclick.net https://*.g.doubleclick.net https://region1.google-analytics.com https://api.stripe.com https://checkout.stripe.com",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://checkout.stripe.com"
  ].join('; '));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', customHeaders = {}) {
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...customHeaders
  });
  res.end(body);
}

function sendError(res, status, message, code = 'error', fields = null) {
  sendJson(res, status, { error: { code, message, fields } });
}

function sendRedirect(res, location) {
  securityHeaders(res);
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req, limit = MAX_BODY) { return readWebBody(req, limit); }

async function readJson(req, limit = MAX_BODY) {
  const raw = await readBody(req, limit);
  return parseJsonObject(raw);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = Object.create(null);
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) { try { out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim()); } catch { /* Ignore malformed cookie. */ } }
  }
  return out;
}

function clientIp(req) { return req.ip; }

// Rate limiting: PostgreSQL compartido cuando está disponible; en memoria como respaldo.
const rateBuckets = new Map();
function memoryLimit(key, max, windowMs) {
  const now = Date.now();
  if (rateBuckets.size > 10000) { for (const [id, bucket] of rateBuckets) if (now - bucket.start > 3600000) rateBuckets.delete(id); }
  if (rateBuckets.size > 20000 && !rateBuckets.has(key)) throw new AppError('Servicio ocupado.', 503, 'busy');
  let entry = rateBuckets.get(key);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    rateBuckets.set(key, entry);
  }
  entry.count += 1;
  return entry.count;
}

async function rateLimit(key, max, windowMs) {
  let count = await rateLimitShared(key, max, windowMs);
  if (count === null) {
    if (NODE_ENV === 'production') throw new AppError('Servicio temporalmente no disponible.', 503, 'rate_limit_unavailable');
    count = memoryLimit(key, max, windowMs);
  }
  if (count > max) throw new AppError('Demasiados intentos. Espera unos minutos.', 429, 'rate_limited');
}

/* ------------------------------------------------------------------ */
/* Inicio de sesión con Google                                        */
/* ------------------------------------------------------------------ */

const GOOGLE_STATE_MS = 10 * 60 * 1000;


function googleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function requestOrigin(req) { return config.PUBLIC_URL; }

function googleCallbackUri(req) {
  return GOOGLE_REDIRECT_URI || `${requestOrigin(req)}/api/auth/google/callback`;
}

// Solo permite rutas internas como destino posterior al login.
function safeNextPath(value) {
  const next = String(value || '').trim();
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  try {
    const target = new URL(next, config.PUBLIC_URL);
    if (target.origin !== config.PUBLIC_URL || /^\/api(?:\/|$)/i.test(decodeURIComponent(target.pathname))) return '/';
    return target.pathname + target.search + target.hash;
  } catch { return '/'; }
}

function googleLoginError(code) {
  return `/login.html?error=${encodeURIComponent(code)}`;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

function getSession(req) {
  const session = getSessionUser(req);
  return session?.user.role === 'admin' ? session : null;
}

function requireAdmin(req) {
  const session = requireUser(req);
  if (session.user.role !== 'admin') throw new AppError('Acceso restringido.', 403, 'forbidden');
  return session;
}

function dashboardFor(user) { return user.role === 'admin' ? '/admin.html' : '/'; }

function getSessionUser(req) {
  const token = parseCookies(req)[USER_COOKIE];
  if (!token) return null;
  const session = getUserSession(token);
  if (!session) return null;
  return session;
}

function requireUser(req) {
  const session = getSessionUser(req);
  if (!session) throw new AppError('Debes iniciar sesión para reservar.', 401, 'login_required');
  return session;
}

function readReservation(req, code, token) {
  closeExpiredHolds();
  const reservation = getDb().reservations.find(item => item.code === code);
  const owner = getSessionUser(req);
  if (reservation && (getSession(req) || (owner && reservation.userId === owner.user.id))) return reservation;
  return getReservation(code, token);
}

function setUserCookie(res, req, token, expiresAt) {
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader('Set-Cookie', cookieBase(req, USER_COOKIE, token, maxAge));
}

/**
 * Respuesta administrativa de settings: nunca expone secretos.
 * Los campos sensibles se devuelven vacíos + indicador de "configurado".
 */
function publicAdminSettings(settings = {}) {
  const payments = settings.payments || {};
  const smtp = settings.smtp || {};
  const configured = (v) => Boolean(String(v || '').trim());
  return {
    business: settings.business || {},
    booking: settings.booking || {},
    payments: {
      provider: config.PAYMENTS_PROVIDER || '',
      mode: config.NODE_ENV === 'production' ? 'live' : 'test',
      merchantId: payments.merchantId || '',
      publicKey: payments.publicKey || '',
      statement: payments.statement || '',
      secretKey: '',
      secretKeyConfigured: configured(paymentSecrets().secretKey),
      webhookSecret: '',
      webhookSecretConfigured: configured(paymentSecrets().webhookSecret)
    },
    smtp: {
      host: smtp.host || '',
      port: Number(smtp.port) || 465,
      secure: smtp.secure !== false,
      user: smtp.user || '',
      fromEmail: smtp.fromEmail || '',
      fromName: smtp.fromName || '',
      pass: '',
      passConfigured: configured(config.SMTP_PASS)
    }
  };
}

/** Secret values are managed outside the admin API. Empty legacy fields are accepted. */
function mergeAdminSettings(base = {}, incoming = {}) {
  if (containsIncomingSecrets(incoming)) {
    throw new AppError('Configura las credenciales mediante variables de entorno.', 422, 'secrets_environment_only');
  }
  const merge = (a, b) => ({ ...(a || {}), ...(b || {}) });
  return settingsWithoutSecrets({
    business: merge(base.business, incoming.business),
    booking: merge(base.booking, incoming.booking),
    payments: merge(base.payments, incoming.payments),
    smtp: merge(base.smtp, incoming.smtp)
  });
}

function cleanupSessions() {
  const sessions = getDb().sessions;
  let changed = false;
  for (const [token, s] of Object.entries(sessions)) {
    if (new Date(s.expiresAt).getTime() <= Date.now()) {
      delete sessions[token];
      changed = true;
    }
  }
  if (changed) saveDb();
}

/* ------------------------------------------------------------------ */
/* Views                                                              */
/* ------------------------------------------------------------------ */

function reservationView(r, { admin = false } = {}) {
  const tour = getDb().tours.find((t) => t.id === r.tourId);
  return {
    code: r.code,
    token: admin ? r.token : undefined,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    holdExpiresAt: r.holdExpiresAt,
    paidAt: r.paidAt,
    date: r.date,
    dateLong: formatDateLong(r.date),
    time: r.time,
    participants: r.participants,
    unitPrice: r.unitPrice,
    total: r.total,
    currency: r.currency,
    guideId: r.guideId || null,
    guideName: r.guideName || '',
    channel: r.channel || 'web',
    tour: tour ? {
      id: tour.id,
      name: tour.name,
      duration: tour.duration,
      meetingPoint: tour.meetingPoint,
      image: tour.image,
      includes: tour.includes,
      minAge: tour.minAge,
      difficulty: tour.difficulty
    } : { id: r.tourId, name: r.tourName },
    customer: {
      name: r.customer.name,
      email: r.customer.email,
      phone: r.customer.phone,
      country: r.customer.country,
      document: admin ? r.customer.document : (r.customer.document ? '••••' + String(r.customer.document).slice(-4) : ''),
      notes: admin ? r.customer.notes : ''
    },
    payment: {
      intentId: r.payment?.intentId,
      provider: r.payment?.provider,
      status: r.payment?.status,
      brand: r.payment?.brand,
      last4: r.payment?.last4,
      reference: r.payment?.reference,
      paidAt: r.payment?.paidAt,
      attempts: r.payment?.attempts || 0
    },
    receipt: r.receipt || null,
    cancellation: r.cancellation || null,
    refund: r.refund || null,
    history: admin || r.status === 'confirmed' ? r.history : r.history.slice(-3),
    paymentsEnabled: paymentsEnabled(config),
    secondsLeft: r.status === 'pending_payment'
      ? Math.max(0, Math.floor((new Date(r.holdExpiresAt).getTime() - Date.now()) / 1000))
      : 0
  };
}

function receiptView(r) {
  const d = getDb();
  const tour = d.tours.find((t) => t.id === r.tourId);
  const total = Number(r.total);
  const net = Math.round((total / 1.12) * 100) / 100;
  return {
    receiptNumber: r.receipt?.number || '—',
    issuedAt: r.receipt?.issuedAt || r.paidAt,
    reservation: reservationView(r),
    tour: tour ? publicTour(tour) : null,
    business: d.settings.business,
    breakdown: {
      subtotal: net,
      tax: Math.round((total - net) * 100) / 100,
      total,
      currency: r.currency
    },
    payment: reservationView(r).payment,
    verifyUrl: `/verificar.html?code=${encodeURIComponent(r.code)}`
  };
}

/* ------------------------------------------------------------------ */
/* Business actions                                                   */
/* ------------------------------------------------------------------ */

function applyApprovedPayment(reservation, result) {
  const now = new Date().toISOString();
  if (reservation.status === 'confirmed') return reservation;
  reservation.status = 'confirmed';
  reservation.paidAt = now;
  reservation.updatedAt = now;
  reservation.payment = {
    ...reservation.payment,
    status: 'paid',
    brand: result.brand || 'Tarjeta',
    last4: null,
    reference: result.reference,
    paidAt: now,
    provider: result.provider || reservation.payment.provider,
    manual: false
  };
  if (!reservation.receipt) {
    reservation.receipt = { number: nextReceiptNumber(), issuedAt: now };
  }
  reservation.history.push({
    at: now,
    type: 'paid',
    label: `Pago aprobado · comprobante ${reservation.receipt.number}`
  });
  saveDb();
  return reservation;
}

function policyFor(reservation) {
  const hours = (dateToEpoch(reservation.date, reservation.time) - Date.now()) / 3600000;
  if (reservation.status === 'pending_payment') return { percent: 0, label: 'Reserva sin pago · sin cargo', hours };
  if (hours >= 72) return { percent: 100, label: '72 horas o más de anticipación · 100%', hours };
  if (hours >= 24) return { percent: 50, label: 'Entre 72 y 24 horas · 50%', hours };
  return { percent: 0, label: 'Menos de 24 horas · sin reembolso', hours };
}

function cancelReservation(reservation, { reason, by = 'customer', refundAmount = null, refundMethod = 'Medio de pago original' }) {
  if (!['pending_payment', 'confirmed'].includes(reservation.status)) {
    throw new AppError('Esta reserva ya no se puede cancelar.', 409, 'not_cancellable');
  }
  const policy = policyFor(reservation);
  let amount = refundAmount;
  if (amount === null || amount === undefined) {
    amount = reservation.paidAt ? Math.round(reservation.total * (policy.percent / 100) * 100) / 100 : 0;
  }
  amount = Math.max(0, Math.min(Number(amount) || 0, Number(reservation.total)));
  const now = new Date().toISOString();
  const percent = reservation.total > 0 ? Math.round((amount / reservation.total) * 100) : 0;

  reservation.status = 'cancelled';
  if (!reservation.paidAt) reservation.payment.status = 'cancelled';
  reservation.tokenRevokedAt = now;
  reservation.cancelledAt = now;
  reservation.updatedAt = now;
  reservation.cancellation = {
    reason: String(reason || 'No especificado').slice(0, 300),
    policy: policy.label,
    percent,
    refundAmount: amount,
    requestedAt: now,
    by
  };
  reservation.history.push({
    at: now,
    type: 'cancelled',
    label: `Cancelación (${by === 'admin' ? 'administración' : 'cliente'}) · reembolso ${reservation.currency} ${amount.toFixed(2)}`
  });
  if (reservation.payment?.status === 'paid') reservation.payment.status = amount > 0 ? 'refund_pending' : 'paid';

  let refund = null;
  if (amount > 0) {
    const d = getDb();
    refund = {
      id: `ref_${randomToken(6)}`,
      reservationCode: reservation.code,
      customerName: reservation.customer.name,
      customerEmail: reservation.customer.email,
      amount,
      currency: reservation.currency || d.settings.booking.currency,
      percent,
      method: refundMethod,
      status: 'pending',
      reason: reservation.cancellation.reason,
      requestedAt: now,
      processedAt: null,
      reference: null
    };
    d.refunds.unshift(refund);
    reservation.refund = { id: refund.id, amount, status: 'pending' };
  }
  saveDb();
  return { reservation, refund, policy };
}

function adminOverview() {
  closeExpiredHolds();
  const d = getDb();
  const now = Date.now();
  const confirmed = d.reservations.filter((r) => r.status === 'confirmed');
  const pending = d.reservations.filter((r) => r.status === 'pending_payment' && new Date(r.holdExpiresAt).getTime() > now);
  const cancelled = d.reservations.filter((r) => r.status === 'cancelled');
  const expired = d.reservations.filter((r) => r.status === 'expired');
  const revenue = confirmed.reduce((s, r) => s + Number(r.total), 0);
  const refundsPending = d.refunds.filter((r) => r.status === 'pending');
  const refundsProcessed = d.refunds.filter((r) => r.status === 'processed');

  const today = todayISO();
  const todaysTours = d.tours.filter((t) => t.active !== false && operatesOn(t, today));
  const capacityToday = todaysTours.reduce((s, t) => s + t.capacity * t.times.length, 0);
  const seatsToday = todaysTours.reduce((s, t) => s + t.times.reduce((x, time) => x + seatsTaken(t.id, today, time), 0), 0);

  const chart = [];
  for (let i = 6; i >= 0; i--) {
    const date = isoAddDays(-i);
    const created = d.reservations.filter((r) => {
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.createdAt));
      return local === date;
    });
    chart.push({
      date,
      label: new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')),
      count: created.length,
      revenue: created.filter((r) => r.status === 'confirmed').reduce((s, r) => s + Number(r.total), 0)
    });
  }

  const upcoming = confirmed
    .filter((r) => dateToEpoch(r.date, r.time) > now)
    .sort((a, b) => dateToEpoch(a.date, a.time) - dateToEpoch(b.date, b.time))
    .slice(0, 6)
    .map((r) => reservationView(r, { admin: true }));

  return {
    currency: d.settings.booking?.currency || 'GTQ',
    kpis: {
      revenue,
      confirmed: confirmed.length,
      pending: pending.length,
      pendingAmount: pending.reduce((s, r) => s + Number(r.total), 0),
      cancelled: cancelled.length,
      expired: expired.length,
      refundsPending: refundsPending.length,
      refundsPendingAmount: refundsPending.reduce((s, r) => s + Number(r.amount), 0),
      refundsProcessedAmount: refundsProcessed.reduce((s, r) => s + Number(r.amount), 0),
      emails: d.emails.length,
      seatsToday,
      capacityToday,
      occupancyToday: capacityToday ? Math.round((seatsToday / capacityToday) * 100) : 0,
      avgTicket: confirmed.length ? Math.round((revenue / confirmed.length) * 100) / 100 : 0
    },
    chart,
    upcoming,
    recent: d.reservations.slice(0, 6).map((r) => reservationView(r, { admin: true })),
    refunds: d.refunds.slice(0, 5),
    today,
    store: { tours: d.tours.length, gallery: d.content.gallery.length, videos: d.content.videos.length, emails: d.emails.length }
  };
}

/* ------------------------------------------------------------------ */
/* Admin validation                                                   */
/* ------------------------------------------------------------------ */

function cleanTour(input, existing = null) {
  const name = String(input.name || existing?.name || '').trim();
  if (name.length < 3) throw new AppError('El nombre del tour es obligatorio.', 422, 'validation');
  const id = String(input.id || existing?.id || name)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!id) throw new AppError('Identificador inválido.', 422, 'validation');
  const times = (Array.isArray(input.times) ? input.times : String(input.times || '').split(','))
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (!times.length) throw new AppError('Agrega al menos un horario válido (HH:MM).', 422, 'validation');
  const rawDays = input.days !== undefined ? input.days : (input.diasOperacion !== undefined ? input.diasOperacion : (input.dias !== undefined ? input.dias : existing?.days || existing?.diasOperacion || []));
  const days = (Array.isArray(rawDays) ? rawDays : [rawDays])
    .map(normalizeWeekday).filter((d) => d !== null);
  if (!days.length) throw new AppError('Selecciona al menos un día de operación.', 422, 'validation');
  const price = Number(input.price);
  if (!Number.isSafeInteger(Math.round(price * 100)) || price <= 0 || Math.round(price * 100) / 100 !== price) throw new AppError('El precio debe ser positivo y tener hasta dos decimales.', 422, 'validation');
  const capacity = Number(input.capacity);
  if (![capacity, Number(input.maxParticipants), Number(input.durationMinutes)].every(n => Number.isInteger(n) && n > 0)
      || Number(input.maxParticipants) > capacity) {
    throw new AppError('Revisa el cupo, los participantes y la duración.', 422, 'validation');
  }
  const startDate = String(input.startDate !== undefined ? input.startDate : (input.fechaInicio !== undefined ? input.fechaInicio : existing?.startDate || existing?.fechaInicio || '')).trim();
  const endDate = String(input.endDate !== undefined ? input.endDate : (input.fechaFin !== undefined ? input.fechaFin : existing?.endDate || existing?.fechaFin || '')).trim();
  const startTime = String(input.startTime !== undefined ? input.startTime : (input.horaInicio !== undefined ? input.horaInicio : existing?.startTime || existing?.horaInicio || '')).trim();
  const endTime = String(input.endTime !== undefined ? input.endTime : (input.horaFin !== undefined ? input.horaFin : existing?.endTime || existing?.horaFin || '')).trim();
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const reject = message => { throw new AppError(message, 422, 'validation'); };
  if (startDate && !validDate(startDate)) reject('Fecha de inicio inválida.');
  if (endDate && !validDate(endDate)) reject('Fecha de finalización inválida.');
  if (startDate && endDate && endDate < startDate) reject('La fecha final debe ser igual o posterior a la inicial.');
  if (startTime && !validTime(startTime)) reject('Hora de inicio inválida.');
  if (endTime && !validTime(endTime)) reject('Hora de finalización inválida.');
  if (startTime && endTime && endTime < startTime) reject('La hora final debe ser igual o posterior a la inicial.');
  for (const time of times) {
    if (!validTime(time)) reject('Horarios de salida: usa HH:MM para cada salida.');
    if (startTime && time < startTime) reject('Hay una salida anterior a la hora de inicio.');
    if (endTime && time > endTime) reject('Hay una salida posterior a la hora final.');
  }
  const { longDescription, minParticipants, ...previous } = existing || {};
  let normalizedDays = [...new Set(days)].sort((a, b) => a - b);
  if (startDate && endDate && validDate(startDate) && validDate(endDate) && startDate <= endDate) {
    const allowed = new Set();
    const [y1, m1, d1] = startDate.split('-').map(Number);
    const [y2, m2, d2] = endDate.split('-').map(Number);
    let cur = Date.UTC(y1, m1 - 1, d1, 12);
    const endMs = Date.UTC(y2, m2 - 1, d2, 12);
    while (cur <= endMs && allowed.size < 7) {
      allowed.add(new Date(cur).getUTCDay());
      cur += 86400000;
    }
    const inRange = normalizedDays.filter(d => allowed.has(d));
    if (inRange.length > 0) normalizedDays = inRange;
  }
  return {
    ...previous,
    startDate,
    endDate,
    startTime,
    endTime,
    fechaInicio: startDate,
    fechaFin: endDate,
    horaInicio: startTime,
    horaFin: endTime,
    id,
    name,
    badge: String(input.badge || '').trim().slice(0, 40),
    description: String(input.description || '').trim(),
    duration: String(input.duration || '').trim().slice(0, 40),
    durationMinutes: Number(input.durationMinutes),
    price: Math.round(price * 100) / 100,
    times: [...new Set(times)].sort(),
    days: normalizedDays,
    diasOperacion: normalizedDays,
    capacity,
    maxParticipants: Math.max(1, Math.min(capacity, Number(input.maxParticipants) || capacity)),
    difficulty: String(input.difficulty || '').trim().slice(0, 80),
    minAge: Math.max(0, Number(input.minAge) || 0),
    meetingPoint: String(input.meetingPoint || '').trim().slice(0, 160),
    includes: (Array.isArray(input.includes) ? input.includes : String(input.includes || '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
    image: String(input.image || '').trim(),
    active: input.active !== false && input.active !== 'false',
    featured: input.featured === true || input.featured === 'true',
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString()
  };
}

function cleanContent(input) {
  if (!input || typeof input !== 'object') throw new AppError('Contenido inválido.', 422, 'validation');
  const required = ['brand', 'hero', 'intro', 'contact'];
  for (const key of required) {
    if (!input[key] || typeof input[key] !== 'object') throw new AppError(`Falta la sección “${key}”.`, 422, 'validation');
  }
  const gallery = Array.isArray(input.gallery) ? input.gallery.filter((g) => g && g.src).map((g, i) => ({
    id: g.id || `img_${Date.now()}_${i}`,
    src: String(g.src),
    caption: String(g.caption || '').slice(0, 200),
    category: String(g.category || 'cueva').slice(0, 30),
    credit: String(g.credit || '').slice(0, 160)
  })) : [];
  const videos = Array.isArray(input.videos) ? input.videos.filter((v) => v && v.youtubeId).map((v, i) => ({
    id: v.id || `vid_${Date.now()}_${i}`,
    youtubeId: String(v.youtubeId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20),
    title: String(v.title || 'Video').slice(0, 140),
    description: String(v.description || '').slice(0, 400),
    category: String(v.category || 'Cueva').slice(0, 30)
  })) : [];
  return { ...input, gallery, videos };
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  const csvEscape = (val) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };

  /* ---------- Public ---------- */
  if (method === 'GET' && p === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'kanba', time: new Date().toISOString() });
  }

  if (method === 'GET' && p === '/api/site') {
    return sendJson(res, 200, publicSite());
  }

  /* ---------- Cafetería · Café The Hope ---------- */
  if (method === 'GET' && p === '/api/cafe/menu') {
    const products = getCafeProducts().filter(p => p.active !== false);
    const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
    return sendJson(res, 200, {
      ok: true,
      brand: 'Café The Hope',
      currency: 'GTQ',
      categories,
      items: products
    });
  }

  if (method === 'POST' && p === '/api/cafe/orders') {
    await rateLimit(`cafe-order:${clientIp(req)}`, 25, 10 * 60000);
    const body = await readJson(req);
    const session = getSessionUser(req);
    const prepared = prepareCafeOrder({
      ...body,
      customer: {
        name: body.customer?.name || body.name || session?.user?.name || '',
        email: body.customer?.email || body.email || session?.user?.email || '',
        phone: body.customer?.phone || body.phone || session?.user?.phone || '',
        serviceType: body.customer?.serviceType || body.serviceType || 'En mesa · Cafetería',
        notes: body.customer?.notes || body.notes || ''
      }
    });

    const paymentMethod = (body.paymentMethod === 'cash' || body.payment?.method === 'cash') ? 'cash' : 'card';
    const now = new Date().toISOString();
    const code = nextCafeOrderCode();
    const receiptNumber = nextReceiptNumber();
    const net = Math.round((prepared.total / 1.12) * 100) / 100;
    const tax = Math.round((prepared.total - net) * 100) / 100;

    let payment;
    if (paymentMethod === 'cash') {
      payment = {
        method: 'cash',
        provider: 'Efectivo en Caja',
        status: 'paid',
        brand: 'Efectivo',
        last4: '—',
        reference: `CASH-${randomToken(4).toUpperCase()}`,
        paidAt: now
      };
    } else {
      const result = chargeCafeCard(body.card || {}, prepared.total);
      if (!result.approved) {
        return sendJson(res, 402, {
          ok: false,
          code: result.code,
          message: result.message,
          fields: result.errors || null
        });
      }
      payment = {
        method: 'card',
        provider: result.provider || 'Pasarela KanbaPay',
        status: 'paid',
        brand: result.brand || 'Tarjeta',
        last4: result.last4 || '4242',
        reference: result.reference || `PAY-${randomToken(4).toUpperCase()}`,
        paidAt: now
      };
    }

    const cleanNotes = (prepared.customer.notes && prepared.customer.notes !== 'null') ? String(prepared.customer.notes).trim() : '';
    const cleanPhone = (prepared.customer.phone && prepared.customer.phone !== 'null') ? String(prepared.customer.phone).trim() : '';
    const cleanEmail = (prepared.customer.email && prepared.customer.email !== 'null') ? String(prepared.customer.email).trim() : '';

    const order = {
      id: `cfo_${randomToken(6)}`,
      code,
      status: 'paid',
      brand: 'Café The Hope',
      createdAt: now,
      paidAt: now,
      userId: session?.user?.id || null,
      customer: {
        name: prepared.customer.name || '',
        email: cleanEmail,
        phone: cleanPhone,
        serviceType: prepared.customer.serviceType || 'En mesa · Cafetería',
        notes: cleanNotes
      },
      items: prepared.items,
      subtotal: net,
      tax,
      total: prepared.total,
      currency: prepared.currency,
      payment,
      receipt: {
        number: receiptNumber,
        issuedAt: now
      }
    };

    const d = getDb();
    d.cafeOrders = d.cafeOrders || [];
    d.cafeOrders.unshift(order);
    deductCafeInventory(order, { user: session?.user || null, reason: `Venta web ${order.code} (${receiptNumber})` });
    saveDb();

    return sendJson(res, 201, {
      ok: true,
      order
    });
  }

  const cafeMatch = p.match(/^\/api\/cafe\/orders\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && cafeMatch) {
    const code = cafeMatch[1].toUpperCase();
    const order = (getDb().cafeOrders || []).find((o) => o.code === code);
    if (!order) throw new AppError('Pedido de cafetería no encontrado.', 404, 'not_found');
    return sendJson(res, 200, { ok: true, order });
  }

  /* ---------- Auth de usuarios (rol user) ---------- */
  if (method === 'GET' && p === '/api/auth/me') {
    const session = getSessionUser(req);
    return sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(session),
      user: session ? session.user : null, redirectTo: session ? dashboardFor(session.user) : null
    });
  }

  if (method === 'GET' && p === '/api/auth/dashboard') {
    const session = requireUser(req);
    return sendJson(res, 200, { user: session.user, redirectTo: dashboardFor(session.user),
      today: todayISO(), reservations: getDb().reservations.filter(r => r.userId === session.user.id)
        .map(r => ({ code: r.code, tourName: r.tourName, date: r.date, time: r.time, status: r.status, token: r.token })) });
  }

  /* ---------- Inicio de sesión con Google (OAuth 2.0) ---------- */
  if (method === 'GET' && p === '/api/auth/google') {
    await rateLimit(`google-start:${clientIp(req)}`, 20, 10 * 60000);
    if (!googleConfigured()) return sendRedirect(res, googleLoginError('google_unconfigured'));

    const state = randomToken(18);
    const browser = randomToken(24);
    await getRuntime().database.putOAuth(state, safeNextPath(url.searchParams.get('next')),
      Date.now() + GOOGLE_STATE_MS, crypto.createHash('sha256').update(browser).digest('hex'));
    res.setHeader('Set-Cookie', `kanba_oauth=${browser}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${isSecureRequest(req) ? '; Secure' : ''}`);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: googleCallbackUri(req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      access_type: 'online'
    });
    return sendRedirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  if (method === 'GET' && p === '/api/auth/google/callback') {
    const state = url.searchParams.get('state') || '';
    const browser = parseCookies(req).kanba_oauth || '';
    const entry = browser ? await getRuntime().database.takeOAuth(state,
      crypto.createHash('sha256').update(browser).digest('hex')) : null;
    res.setHeader('Set-Cookie', `kanba_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`);

    if (!entry || entry.expiresAt <= Date.now()) {
      return sendRedirect(res, googleLoginError('google_state'));
    }
    if (!googleConfigured()) return sendRedirect(res, googleLoginError('google_unconfigured'));
    if (url.searchParams.get('error')) {
      // El usuario canceló o rechazó el acceso en la pantalla de Google.
      return sendRedirect(res, googleLoginError('google_cancelled'));
    }

    const code = url.searchParams.get('code') || '';
    if (!code) return sendRedirect(res, googleLoginError('google_code_missing'));

    let failureCode = 'google_token_exchange_failed';
    let persisting = false;
    try {
      const fetcher = getRuntime().fetch;
      const accessToken = await exchangeGoogleCode(fetcher, {
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: googleCallbackUri(req),
          grant_type: 'authorization_code'
      });

      failureCode = 'google_profile_failed';
      const infoRes = await fetcher('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      const profile = await infoRes.json();
      if (!infoRes.ok || typeof profile?.email !== 'string' || !profile.email ||
          typeof profile?.sub !== 'string' || !profile.sub) throw new Error('OAuth profile invalid.');
      if (profile.email_verified !== true) {
        return sendRedirect(res, googleLoginError('google_email_unverified'));
      }

      const email = String(profile.email).trim().toLowerCase();
      const googleProfile = { googleId: String(profile.sub || ''), avatar: String(profile.picture || '') };
      // Persistence failures must escape so the outer transaction rolls back.
      persisting = true;
      const existing = findUserByEmail(email);
      const user = existing
        ? linkGoogleAccount(existing, googleProfile)
        : registerGoogleUser({ ...googleProfile, email, name: profile.name });

      const session = createUserSession(user);
      setUserCookie(res, req, session.token, session.expiresAt);
      return sendRedirect(res, dashboardFor(session.user));
    } catch (err) {
      if (persisting) throw err;
      if (err instanceof GoogleTokenError) failureCode = err.code;
      console.error('[auth/google] no se pudo completar el inicio de sesión:', safeErrorMessage(err));
      return sendRedirect(res, googleLoginError(failureCode));
    }
  }

  if (method === 'POST' && p === '/api/auth/register') {
    await rateLimit(`register:${clientIp(req)}`, 10, 10 * 60000);
    const body = await readJson(req);
    const user = registerUser(body);
    const login = loginUser(user.email, body.password);
    setUserCookie(res, req, login.token, login.expiresAt);
    return sendJson(res, 201, { ok: true, user: login.user, redirectTo: dashboardFor(login.user) });
  }

  if (method === 'POST' && p === '/api/auth/login') {
    await rateLimit(`userlogin:${clientIp(req)}`, 10, 10 * 60000);
    const body = await readJson(req);
    await rateLimit(`account:${crypto.createHash('sha256').update(String(body.email || '').trim().toLowerCase()).digest('hex')}`, 20, 10 * 60000);
    logoutUser(parseCookies(req)[USER_COOKIE] || '');
    const login = loginUser(String(body.email || ''), String(body.password || ''));
    setUserCookie(res, req, login.token, login.expiresAt);
    return sendJson(res, 200, { ok: true, user: login.user, redirectTo: dashboardFor(login.user) });
  }

  if (method === 'POST' && p === '/api/auth/logout') {
    const token = parseCookies(req)[USER_COOKIE] || '';
    logoutUser(token);
    const legacy = parseCookies(req)[SESSION_COOKIE];
    if (legacy && Object.hasOwn(getDb().sessions, legacy)) { delete getDb().sessions[legacy]; saveDb(); }
    res.setHeader('Set-Cookie', cookieBase(req, SESSION_COOKIE, '', 0));
    res.setHeader('Set-Cookie', cookieBase(req, USER_COOKIE, '', 0));
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && p === '/api/availability') {
    closeExpiredHolds();
    const tourId = url.searchParams.get('tour') || null;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : todayISO();
    const days = Math.max(1, Math.min(45, Number(url.searchParams.get('days')) || 21));
    return sendJson(res, 200, { from, days, daysList: buildAvailability({ tourId, from, days }) });
  }

  if (method === 'POST' && p === '/api/reservations') {
    const session = requireUser(req);
    await rateLimit(`reserve:${session.user.id}`, 10, 3600000);
    const body = await readJson(req);
    const reservation = createReservation(body, { user: session.user });
    try {
      if (!getDb().emails.some(mail => mail.reservationCode === reservation.code && mail.template === 'pending')) await notifyPending(reservation);
    } catch (err) {
      console.error('[reserva] no se pudo enviar correo pendiente:', safeErrorMessage(err));
    }
    return sendJson(res, 201, {
      ok: true,
      code: reservation.code,
      token: reservation.token,
      holdExpiresAt: reservation.holdExpiresAt,
      total: reservation.total,
      currency: reservation.currency,
      status: reservation.status,
      paymentUrl: `/pago.html?code=${encodeURIComponent(reservation.code)}&token=${encodeURIComponent(reservation.token)}`,
      confirmationUrl: `/confirmacion.html?code=${encodeURIComponent(reservation.code)}&token=${encodeURIComponent(reservation.token)}`
    });
  }

  if (method === 'POST' && p === '/api/reservations/lookup') {
    const owner = requireUser(req);
    await rateLimit(`lookup:${clientIp(req)}`, 20, 10 * 60000);
    const body = await readJson(req);
    const code = String(body.code || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase();
    const reservation = getDb().reservations.find((r) => {
      if (r.code !== code) return false;
      // Si la reserva pertenece al usuario autenticado, tiene acceso directo como titular
      if (r.userId && r.userId === owner.user.id) return true;
      // Si la reserva no tiene usuario asociado, validar correspondencia por correo
      if (!r.userId) {
        const customerEmail = String(r.customer?.email || '').trim().toLowerCase();
        const accountEmail = String(owner.user?.email || '').trim().toLowerCase();
        return (email && customerEmail === email) || (accountEmail && customerEmail === accountEmail);
      }
      return false;
    });
    if (!reservation) throw new AppError('No encontramos una reserva con ese código y correo.', 404, 'not_found');
    rotateReservationToken(reservation);
    return sendJson(res, 200, { ok: true, token: reservation.token, reservation: reservationView(reservation) });
  }

  let m = p.match(/^\/api\/reservations\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && m) {
    const token = url.searchParams.get('token') || '';
    const reservation = readReservation(req, m[1], token);
    return sendJson(res, 200, { ok: true, reservation: reservationView(reservation) });
  }

  m = p.match(/^\/api\/reservations\/([A-Za-z0-9-]+)\/cancel$/);
  if (method === 'POST' && m) {
    const body = await readJson(req);
    const owner = requireUser(req);
    const token = String(body.token || '');
    if (!token) throw new AppError('Token de reserva requerido.', 401, 'unauthorized');
    const reservation = getReservation(m[1], token);
    if (reservation.userId !== owner.user.id) throw new AppError('No tienes acceso a esta reserva.', 403, 'forbidden');
    // Factor adicional: el token por sí solo no basta para cancelar; se exige el correo del titular.
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !safeEqual(email, String(reservation.customer.email || '').toLowerCase())) {
      throw new AppError('El correo del titular no coincide con la reserva.', 403, 'forbidden');
    }
    const result = cancelReservation(reservation, { reason: body.reason, by: 'customer' });
    try {
      await notifyCancellation(reservation, {
        refund: result.refund?.amount || 0,
        policy: result.policy.label,
        reason: reservation.cancellation.reason
      });
    } catch (err) {
      console.error('[cancelación] correo falló:', safeErrorMessage(err));
    }
    return sendJson(res, 200, {
      ok: true,
      status: reservation.status,
      refund: result.refund,
      policy: result.policy,
      reservation: reservationView(reservation)
    });
  }

  m = p.match(/^\/api\/receipt\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && m) {
    const token = url.searchParams.get('token') || '';
    const reservation = readReservation(req, m[1], token);
    if (reservation.status !== 'confirmed') throw new AppError('El comprobante estará disponible cuando el pago sea aprobado.', 409, 'not_paid');
    return sendJson(res, 200, { ok: true, receipt: receiptView(reservation) });
  }

  m = p.match(/^\/api\/verify\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && m) {
    await rateLimit(`verify:${clientIp(req)}`, 30, 60000);
    const r = getDb().reservations.find((x) => x.code === m[1].toUpperCase());
    if (!r || r.status !== 'confirmed') {
      return sendJson(res, 200, { ok: true, valid: false });
    }
    return sendJson(res, 200, {
      ok: true,
      valid: true,
      code: r.code,
      status: 'confirmed'
    });
  }

  if (method === 'POST' && p === '/api/webhooks/payments') {
    requireGateway(config);
    const event = verifiedEvent(await readBody(req), req.headers['stripe-signature'], config);
    const session = event.data?.object;
    if (event.type === 'payment_intent.payment_failed' && session?.metadata?.booking_intent) {
      const r = getDb().reservations.find(item => item.payment?.intentId === session.metadata.booking_intent);
      if (r?.status === 'pending_payment' && !r.paidAt) {
        r.payment.status = 'failed';
        saveDb();
      }
    }
    if (['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) && session?.client_reference_id) {
      const r = getDb().reservations.find(item => item.payment?.intentId === session.client_reference_id);
      if (r && session.id === r.payment.sessionId && !r.paidAt && !r.payment.lateRefundId) {
        if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') {
          if (!session.payment_intent || session.amount_total !== chargeAmount(r) || session.currency !== r.currency.toLowerCase())
            throw new AppError('El pago requiere conciliación.', 409, 'payment_mismatch');
          if (r.status !== 'pending_payment' || Date.parse(r.holdExpiresAt) <= Date.now()) {
            r.payment.lateRefundId = await refundLatePayment(session.payment_intent, config, getRuntime().fetch);
            if (r.status === 'pending_payment') r.status = 'expired';
            r.payment.status = 'refund_initiated';
          } else {
            applyApprovedPayment(r, { reference: session.payment_intent, provider: 'Stripe' });
            await notifyConfirmed(r);
          }
        } else if (event.type !== 'checkout.session.completed' && r.status === 'pending_payment') {
          r.status = 'expired';
          r.payment.status = event.type === 'checkout.session.expired' ? 'cancelled' : 'failed';
        }
        saveDb();
      }
    }
    return sendJson(res, 200, { received: true });
  }

  /* ---------- Admin auth ---------- */
  if (p === '/api/admin/login') throw new AppError('Usa el acceso unificado.', 410, 'login_retired');
  if (p.startsWith('/api/admin/')) requireAdmin(req);
  if (method === 'GET' && p === '/api/admin/me') {
    const session = requireAdmin(req);
    return sendJson(res, 200, { ok: true, authenticated: true, admin: { name: session.user.name, expiresAt: session.expiresAt } });
  }

  if (method === 'GET' && p === '/api/admin/overview') {
    return sendJson(res, 200, adminOverview());
  }

  if (method === 'GET' && p === '/api/admin/reservations') {
    closeExpiredHolds();
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let list = [...getDb().reservations];
    if (status && status !== 'all') list = list.filter((r) => r.status === status);
    if (q) {
      list = list.filter((r) =>
        r.code.toLowerCase().includes(q) ||
        r.customer.name.toLowerCase().includes(q) ||
        r.customer.email.toLowerCase().includes(q) ||
        r.tourName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { ok: true, total: list.length, reservations: list.map((r) => reservationView(r, { admin: true })) });
  }

  m = p.match(/^\/api\/admin\/reservations\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && m) {
    const r = getDb().reservations.find((x) => x.code === m[1]);
    if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
    return sendJson(res, 200, { ok: true, reservation: reservationView(r, { admin: true }) });
  }

  m = p.match(/^\/api\/admin\/reservations\/([A-Za-z0-9-]+)\/cancel$/);
  if (method === 'POST' && m) {
    const body = await readJson(req);
    const r = getDb().reservations.find((x) => x.code === m[1]);
    if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
    const result = cancelReservation(r, {
      reason: body.reason || 'Cancelación administrativa',
      by: 'admin',
      refundAmount: body.refundAmount === '' || body.refundAmount === undefined || body.refundAmount === null ? null : Number(body.refundAmount),
      refundMethod: body.refundMethod || 'Medio de pago original'
    });
    try {
      await notifyCancellation(r, { refund: result.refund?.amount || 0, policy: result.policy.label, reason: r.cancellation.reason });
    } catch (err) { console.error(safeErrorMessage(err)); }
    return sendJson(res, 200, { ok: true, reservation: reservationView(r, { admin: true }), refund: result.refund });
  }

  m = p.match(/^\/api\/admin\/reservations\/([A-Za-z0-9-]+)\/resend$/);
  if (method === 'POST' && m) {
    const body = await readJson(req);
    const r = getDb().reservations.find((x) => x.code === m[1]);
    if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
    const allowed = ['pending', 'confirmation', 'receipt', 'expired', 'cancellation', 'refund'];
    const template = allowed.includes(body.template) ? body.template : 'confirmation';
    const record = await resendMail(r, template);
    return sendJson(res, 200, { ok: true, email: record });
  }

  if (method === 'GET' && p === '/api/admin/emails') {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
    return sendJson(res, 200, { ok: true, emails: getDb().emails.slice(0, limit) });
  }

  m = p.match(/^\/api\/admin\/emails\/([A-Za-z0-9_-]+)\/retry$/);
  if (method === 'POST' && m) {
    const id = m[1];
    const email = getDb().emails.find(item => item.id === id);
    if (!email) throw new AppError('Correo no encontrado.', 404, 'not_found');
    email.status = 'queued';
    email.attempts = 0;
    email.error = null;
    email.permanentFailed = false;
    delete email.claimId;
    delete email.leaseExpiresAt;
    email.nextAttemptAt = null;
    saveDb();
    await processEmailRetryQueue();
    return sendJson(res, 200, { ok: true, email });
  }

  if (method === 'GET' && p === '/api/admin/refunds') {
    return sendJson(res, 200, { ok: true, refunds: getDb().refunds });
  }

  m = p.match(/^\/api\/admin\/refunds\/([A-Za-z0-9_-]+)\/process$/);
  if (method === 'POST' && m) {
    requireGateway(config);
    const refund = getDb().refunds.find(x => x.id === m[1]);
    if (!refund) throw new AppError('Reembolso no encontrado.', 404, 'not_found');
    if (refund.status === 'processed') throw new AppError('Este reembolso ya fue procesado.', 409, 'already_processed');
    const r = getDb().reservations.find(x => x.code === refund.reservationCode);
    if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
    const result = await refundReservation(r, refund, config, getRuntime().fetch);
    refund.reference = result.id;
    if (result.status !== 'succeeded') {
      refund.status = 'pending';
      saveDb();
      return sendJson(res, 202, { ok: true, refund });
    }
    refund.status = 'processed';
    refund.processedAt = new Date().toISOString();
    if (r) {
      r.refund = { id: refund.id, amount: refund.amount, status: 'processed', reference: refund.reference, processedAt: refund.processedAt };
      if (r.payment) r.payment.status = 'refunded';
      r.history.push({ at: refund.processedAt, type: 'refunded', label: `Reembolso procesado · ${refund.reference} · ${refund.currency} ${Number(refund.amount).toFixed(2)}` });
      saveDb();
      try { await notifyRefund(r, refund); } catch (err) { console.error(safeErrorMessage(err)); }
    } else {
      saveDb();
    }
    return sendJson(res, 200, { ok: true, refund });
  }

  if (method === 'GET' && p === '/api/admin/tours') {
    return sendJson(res, 200, { ok: true, tours: getDb().tours });
  }

  if (method === 'POST' && p === '/api/admin/tours') {
    const body = await readJson(req);
    const d = getDb();
    if (d.tours.some((t) => t.id === String(body.id || '').toLowerCase())) {
      throw new AppError('Ya existe un tour con ese identificador.', 409, 'duplicate');
    }
    const tour = cleanTour(body);
    d.tours.push(tour);
    saveDb();
    return sendJson(res, 201, { ok: true, tour });
  }

  m = p.match(/^\/api\/admin\/tours\/([a-z0-9-]+)$/);
  if (m && method === 'PUT') {
    const body = await readJson(req);
    const d = getDb();
    const idx = d.tours.findIndex((t) => t.id === m[1]);
    if (idx < 0) throw new AppError('Tour no encontrado.', 404, 'not_found');
    const tour = cleanTour({ ...body, id: m[1] }, d.tours[idx]);
    d.tours[idx] = tour;
    saveDb();
    return sendJson(res, 200, { ok: true, tour });
  }
  if (m && method === 'DELETE') {
    const d = getDb();
    const idx = d.tours.findIndex((t) => t.id === m[1]);
    if (idx < 0) throw new AppError('Tour no encontrado.', 404, 'not_found');
    const hasReservations = d.reservations.some((r) => r.tourId === m[1]);
    if (hasReservations) {
      d.tours[idx].active = false;
      d.tours[idx].updatedAt = new Date().toISOString();
    } else {
      d.tours.splice(idx, 1);
    }
    saveDb();
    return sendJson(res, 200, { ok: true, archived: hasReservations });
  }

  if (method === 'GET' && p === '/api/admin/closures') {
    return sendJson(res, 200, { ok: true, closures: getDb().closures });
  }
  if (method === 'POST' && p === '/api/admin/closures') {
    const body = await readJson(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw new AppError('Fecha inválida.', 422, 'validation');
    const closure = {
      id: `clo_${randomToken(5)}`,
      date: body.date,
      tourId: body.tourId || 'all',
      reason: String(body.reason || 'Cierre administrativo').slice(0, 200),
      createdAt: new Date().toISOString()
    };
    getDb().closures.push(closure);
    saveDb();
    return sendJson(res, 201, { ok: true, closure });
  }
  m = p.match(/^\/api\/admin\/closures\/([A-Za-z0-9_-]+)$/);
  if (m && method === 'DELETE') {
    const d = getDb();
    const idx = d.closures.findIndex((c) => c.id === m[1]);
    if (idx < 0) throw new AppError('Cierre no encontrado.', 404, 'not_found');
    d.closures.splice(idx, 1);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && p === '/api/admin/availability') {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : todayISO();
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 14));
    const tourId = url.searchParams.get('tour') || null;
    const grid = buildAvailability({ tourId, from, days, calendarOnly: true })
      .map(day => ({
        date: day.date, dateLong: formatDateLong(day.date),
        occupancy: day.tours.map(({ departures, ...tour }) => ({ ...tour, times: departures })),
        closures: getDb().closures.filter(c => c.date === day.date)
      }));
    return sendJson(res, 200, { ok: true, grid });
  }

  /* ---------- Cueva y Tours · Asignación de Guías y Taquilla ---------- */

  // Asignar / Desasignar guía a reservación
  m = p.match(/^\/api\/admin\/reservations\/([A-Za-z0-9-]+)\/guide$/);
  if (method === 'PATCH' && m) {
    const body = await readJson(req);
    const code = m[1];
    const guideId = body.guideId ? String(body.guideId).trim() : null;
    const reservation = assignGuideToReservation(code, guideId);
    return sendJson(res, 200, { ok: true, reservation: reservationView(reservation, { admin: true }) });
  }

  // Boleto / Comprobante imprimible de tour
  m = p.match(/^\/api\/admin\/reservations\/([A-Za-z0-9-]+)\/ticket$/);
  if (method === 'GET' && m) {
    const r = getDb().reservations.find(x => x.code === m[1]);
    if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Boleto de Ingreso · ${r.code}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; padding: 20px; margin: 0; }
    .ticket-card { max-width: 420px; margin: 0 auto; background: #fff; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 20px; color: #0284c7; text-transform: uppercase; letter-spacing: 1px; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #64748b; }
    .code-badge { display: inline-block; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-weight: 700; font-size: 16px; padding: 6px 12px; border-radius: 6px; margin: 10px 0; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .row .label { color: #64748b; }
    .row .value { font-weight: 600; text-align: right; }
    .total-box { background: #f8fafc; border-radius: 8px; padding: 12px; margin: 16px 0; border: 1px solid #e2e8f0; }
    .total-box .row { margin: 0; font-size: 16px; font-weight: bold; color: #0f172a; }
    .instructions { font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 16px; line-height: 1.4; text-align: center; }
    .print-btn { display: block; width: 100%; margin-top: 16px; padding: 10px; background: #0284c7; color: #fff; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
    @media print { .print-btn { display: none; } body { padding: 0; background: #fff; } .ticket-card { box-shadow: none; border-color: #000; } }
  </style>
</head>
<body>
  <div class="ticket-card">
    <div class="header">
      <h1>K’anba Cuevas Vivas</h1>
      <p>Lanquín, Alta Verapaz · Boleto de Ingreso</p>
      <div class="code-badge">${r.code}</div>
      ${r.receipt?.number ? `<p style="font-size:12px;margin:2px 0;">Recibo Nº: <strong>${r.receipt.number}</strong></p>` : ''}
    </div>
    <div class="row"><span class="label">Tour:</span><span class="value">${r.tourName}</span></div>
    <div class="row"><span class="label">Fecha:</span><span class="value">${r.date}</span></div>
    <div class="row"><span class="label">Horario:</span><span class="value">${r.time}</span></div>
    <div class="row"><span class="label">Participantes:</span><span class="value">${r.participants} persona(s)</span></div>
    <div class="row"><span class="label">Titular:</span><span class="value">${r.customer.name}</span></div>
    ${r.guideName ? `<div class="row"><span class="label">Guía:</span><span class="value">${r.guideName}</span></div>` : ''}
    <div class="row"><span class="label">Canal:</span><span class="value">${r.channel === 'pos' ? 'Taquilla presencial' : 'Web en línea'}</span></div>
    <div class="row"><span class="label">Medio de pago:</span><span class="value">${r.payment?.method || 'Tarjeta'}</span></div>
    <div class="total-box">
      <div class="row"><span>Total Pagado:</span><span>Q ${Number(r.total).toFixed(2)}</span></div>
    </div>
    <div class="instructions">
      Presenta este comprobante al inicio del recorrido en la recepción de K’anba.<br>
      Equipo incluido según tour (linterna, casco, chaleco). ¡Disfruta la experiencia!
    </div>
    <button class="print-btn" onclick="window.print()">Imprimir Boleto</button>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    return res.end(html);
  }

  // Taquilla / POS: Venta presencial de tour
  if (method === 'POST' && p === '/api/admin/tours/pos/sale') {
    const body = await readJson(req);
    const session = requireAdmin(req);
    const reservation = createInPersonTourSale(body, { adminUser: session?.user });
    return sendJson(res, 201, {
      ok: true,
      reservation: reservationView(reservation, { admin: true }),
      receiptNumber: reservation.receipt?.number,
      ticketUrl: `/api/admin/reservations/${encodeURIComponent(reservation.code)}/ticket`
    });
  }

  // Guías Turísticos CRUD
  if (method === 'GET' && p === '/api/admin/guides') {
    return sendJson(res, 200, { ok: true, guides: getGuides() });
  }

  if (method === 'POST' && p === '/api/admin/guides') {
    const body = await readJson(req);
    const guide = saveGuide(body);
    return sendJson(res, 201, { ok: true, guide });
  }

  m = p.match(/^\/api\/admin\/guides\/([A-Za-z0-9_-]+)$/);
  if (method === 'PUT' && m) {
    const body = await readJson(req);
    const guide = saveGuide({ ...body, id: m[1] });
    return sendJson(res, 200, { ok: true, guide });
  }

  if (method === 'DELETE' && m) {
    const result = deleteGuide(m[1]);
    return sendJson(res, 200, { ok: true, ...result });
  }

  // Gastos de Cueva y Tours CRUD
  if (method === 'GET' && p === '/api/admin/tours/expenses') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const category = url.searchParams.get('category');
    let expenses = getTourExpenses();
    if (from) expenses = expenses.filter(e => (e.expenseDate || e.date) >= from);
    if (to) expenses = expenses.filter(e => (e.expenseDate || e.date) <= to);
    if (category && category !== 'all') expenses = expenses.filter(e => e.category === category);
    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return sendJson(res, 200, { ok: true, expenses, total: Math.round(total * 100) / 100 });
  }

  if (method === 'POST' && p === '/api/admin/tours/expenses') {
    const body = await readJson(req);
    const concept = String(body.concept || '').trim();
    const category = String(body.category || 'otros').trim().toLowerCase();
    const amount = Number(body.amount);
    const expenseDate = String(body.expenseDate || body.date || todayISO()).trim();
    const notes = String(body.notes || '').trim();

    if (concept.length < 2) throw new AppError('El concepto del gasto es requerido.', 422, 'validation');
    const validCats = ['equipo', 'guias', 'traslados', 'entradas', 'mantenimiento', 'otros'];
    if (!validCats.includes(category)) {
      throw new AppError(`Categoría de gasto no válida. Usa: ${validCats.join(', ')}.`, 422, 'validation');
    }
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('El monto debe ser un número positivo.', 422, 'validation');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) throw new AppError('Fecha inválida (YYYY-MM-DD).', 422, 'validation');

    const d = getDb();
    const id = nextTourExpenseId();
    const expense = {
      id,
      concept,
      category,
      amount: Math.round(amount * 100) / 100,
      expenseDate,
      notes,
      createdBy: 'admin',
      createdAt: new Date().toISOString()
    };
    d.tourExpenses = d.tourExpenses || [];
    d.tourExpenses.unshift(expense);
    saveDb();
    return sendJson(res, 201, { ok: true, expense });
  }

  m = p.match(/^\/api\/admin\/tours\/expenses\/([A-Za-z0-9_-]+)$/);
  if (method === 'DELETE' && m) {
    const d = getDb();
    d.tourExpenses = d.tourExpenses || [];
    const idx = d.tourExpenses.findIndex(e => e.id === m[1]);
    if (idx === -1) throw new AppError('Gasto no encontrado.', 404, 'not_found');
    d.tourExpenses.splice(idx, 1);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  // Reportes y Estadísticas de Cueva y Tours
  if (method === 'GET' && p === '/api/admin/tours/reports') {
    const d = getDb();
    const from = url.searchParams.get('from') || `${todayISO().slice(0, 7)}-01`;
    const to = url.searchParams.get('to') || todayISO();

    const confirmed = (d.reservations || []).filter(r => {
      const day = r.date || r.createdAt.slice(0, 10);
      return day >= from && day <= to && r.status === 'confirmed';
    });

    const expenses = (d.tourExpenses || []).filter(e => {
      const day = e.expenseDate || e.createdAt.slice(0, 10);
      return day >= from && day <= to;
    });

    let totalIncome = 0;
    let totalParticipants = 0;
    const salesByChannel = {
      pos: { count: 0, participants: 0, income: 0 },
      web: { count: 0, participants: 0, income: 0 }
    };
    const toursMap = new Map();

    for (const r of confirmed) {
      const tot = Number(r.total) || 0;
      const part = Number(r.participants) || 0;
      totalIncome = Math.round((totalIncome + tot) * 100) / 100;
      totalParticipants += part;

      const ch = r.channel === 'pos' ? 'pos' : 'web';
      salesByChannel[ch].count += 1;
      salesByChannel[ch].participants += part;
      salesByChannel[ch].income = Math.round((salesByChannel[ch].income + tot) * 100) / 100;

      const current = toursMap.get(r.tourId) || { tourId: r.tourId, tourName: r.tourName, reservationsCount: 0, participantsCount: 0, totalIncome: 0 };
      current.reservationsCount += 1;
      current.participantsCount += part;
      current.totalIncome = Math.round((current.totalIncome + tot) * 100) / 100;
      toursMap.set(r.tourId, current);
    }

    const toursRanking = Array.from(toursMap.values()).sort((a, b) => b.totalIncome - a.totalIncome);

    let totalExpenses = 0;
    const expensesByCategory = { equipo: 0, guias: 0, traslados: 0, entradas: 0, mantenimiento: 0, otros: 0 };
    for (const e of expenses) {
      const amt = Number(e.amount) || 0;
      totalExpenses = Math.round((totalExpenses + amt) * 100) / 100;
      const cat = expensesByCategory[e.category] !== undefined ? e.category : 'otros';
      expensesByCategory[cat] = Math.round((expensesByCategory[cat] + amt) * 100) / 100;
    }

    const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100;
    const profitMargin = totalIncome > 0 ? Math.round((netProfit / totalIncome) * 1000) / 10 : 0;

    return sendJson(res, 200, {
      ok: true,
      from,
      to,
      summary: {
        totalIncome,
        totalRevenue: totalIncome,
        totalParticipants,
        totalReservations: confirmed.length,
        totalBookings: confirmed.length,
        totalExpenses,
        expenseCount: expenses.length,
        netProfit,
        profitMargin
      },
      toursRanking,
      salesByChannel,
      channels: {
        web: { bookings: salesByChannel.web.count, participants: salesByChannel.web.participants, total: salesByChannel.web.income },
        pos: { bookings: salesByChannel.pos.count, participants: salesByChannel.pos.participants, total: salesByChannel.pos.income }
      },
      expensesByCategory
    });
  }

  // Exportación a Excel (CSV con UTF-8 BOM) y PDF (HTML Imprimible) de Cueva y Tours
  if (method === 'GET' && p === '/api/admin/tours/reports/export') {
    const d = getDb();
    const format = url.searchParams.get('format') === 'html' || url.searchParams.get('format') === 'pdf' ? 'html' : 'csv';
    const from = url.searchParams.get('from') || `${todayISO().slice(0, 7)}-01`;
    const to = url.searchParams.get('to') || todayISO();

    const confirmed = (d.reservations || []).filter(r => {
      const day = r.date || r.createdAt.slice(0, 10);
      return day >= from && day <= to && r.status === 'confirmed';
    });

    const expenses = (d.tourExpenses || []).filter(e => {
      const day = e.expenseDate || e.createdAt.slice(0, 10);
      return day >= from && day <= to;
    });

    let totalIncome = 0;
    let totalParticipants = 0;
    for (const r of confirmed) {
      totalIncome += (Number(r.total) || 0);
      totalParticipants += (Number(r.participants) || 0);
    }
    let totalExpenses = 0;
    for (const e of expenses) {
      totalExpenses += (Number(e.amount) || 0);
    }
    const netProfit = totalIncome - totalExpenses;

    if (format === 'csv') {
      let csv = '\uFEFF'; // UTF-8 BOM
      csv += 'K’ANBA CUEVAS VIVAS · REPORTE OPERATIVO Y COMERCIAL DE TOURS\r\n';
      csv += `Período: ${from} al ${to}\r\n\r\n`;

      csv += 'RESUMEN EJECUTIVO\r\n';
      csv += `Ingresos Totales por Tours (Q),${totalIncome.toFixed(2)}\r\n`;
      csv += `Total Pasajeros Atendidos,${totalParticipants}\r\n`;
      csv += `Reservas Confirmadas,${confirmed.length}\r\n`;
      csv += `Gastos Operativos de Tours (Q),${totalExpenses.toFixed(2)}\r\n`;
      csv += `Utilidad Neta del Período (Q),${netProfit.toFixed(2)}\r\n\r\n`;

      csv += 'VENTAS DETALLADAS DE TOURS\r\n';
      csv += 'Código,Fecha,Horario,Tour,Canal,Cliente,Teléfono,Participantes,Importe (Q),Comprobante,Guía\r\n';
      for (const r of confirmed) {
        csv += [
          csvEscape(r.code),
          csvEscape(r.date),
          csvEscape(r.time),
          csvEscape(r.tourName),
          csvEscape(r.channel === 'pos' ? 'Taquilla' : 'Web'),
          csvEscape(r.customer?.name || ''),
          csvEscape(r.customer?.phone || ''),
          csvEscape(r.participants),
          csvEscape(Number(r.total).toFixed(2)),
          csvEscape(r.receipt?.number || ''),
          csvEscape(r.guideName || 'Sin asignar')
        ].join(',') + '\r\n';
      }

      csv += '\r\nGASTOS OPERATIVOS DE TOURS\r\n';
      csv += 'Código,Fecha,Concepto,Categoría,Monto (Q),Notas\r\n';
      for (const e of expenses) {
        csv += [
          csvEscape(e.id),
          csvEscape(e.expenseDate),
          csvEscape(e.concept),
          csvEscape(e.category),
          csvEscape(Number(e.amount).toFixed(2)),
          csvEscape(e.notes || '')
        ].join(',') + '\r\n';
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-cueva-tours-${from}-${to}.csv"`);
      res.writeHead(200);
      return res.end(csv);
    } else {
      // PDF / HTML Imprimible
      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reporte Cueva y Tours · ${from} al ${to}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 0; padding: 24px; font-size: 13px; }
    .header { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header h1 { margin: 0 0 4px 0; font-size: 20px; color: #0f172a; }
    .header p { margin: 0; color: #64748b; font-size: 13px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; }
    .kpi .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .kpi .val { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    h2 { font-size: 15px; margin: 20px 0 8px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; color: #0369a1; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    .text-right { text-align: right; }
    .footer { margin-top: 30px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
    @media print {
      body { padding: 0; font-size: 11px; }
      .no-print { display: none; }
      th { background: #f8fafc !important; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 16px; text-align: right;">
    <button onclick="window.print()" style="padding: 8px 16px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Imprimir / Guardar como PDF</button>
  </div>
  <div class="header">
    <div>
      <h1>K’anba Cuevas Vivas</h1>
      <p>Reporte Operativo y Comercial de Cueva y Tours</p>
    </div>
    <div style="text-align: right;">
      <p><strong>Período:</strong> ${from} al ${to}</p>
      <p style="font-size: 11px;">Generado el ${new Date().toLocaleString('es-GT')}</p>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="label">Ingresos Tours</div><div class="val">Q ${totalIncome.toFixed(2)}</div></div>
    <div class="kpi"><div class="label">Pasajeros</div><div class="val">${totalParticipants}</div></div>
    <div class="kpi"><div class="label">Gastos Operativos</div><div class="val">Q ${totalExpenses.toFixed(2)}</div></div>
    <div class="kpi"><div class="label">Utilidad Neta</div><div class="val" style="color:${netProfit >= 0 ? '#166534' : '#991b1b'}">Q ${netProfit.toFixed(2)}</div></div>
  </div>

  <h2>Ventas y Reservas de Tours</h2>
  <table>
    <thead>
      <tr><th>Código</th><th>Fecha</th><th>Horario</th><th>Tour</th><th>Canal</th><th>Cliente</th><th>Pasajeros</th><th>Guía</th><th class="text-right">Total</th></tr>
    </thead>
    <tbody>
      ${confirmed.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:#94a3b8;">No se registraron ventas en este período.</td></tr>' : confirmed.map(r => `
        <tr>
          <td><strong>${r.code}</strong></td>
          <td>${r.date}</td>
          <td>${r.time}</td>
          <td>${r.tourName}</td>
          <td>${r.channel === 'pos' ? 'Taquilla' : 'Web'}</td>
          <td>${r.customer?.name || 'Cliente'}</td>
          <td>${r.participants}</td>
          <td>${r.guideName || '—'}</td>
          <td class="text-right">Q ${Number(r.total).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Gastos Operativos de Tours</h2>
  <table>
    <thead>
      <tr><th>Código</th><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="text-right">Monto</th><th>Notas</th></tr>
    </thead>
    <tbody>
      ${expenses.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No se registraron gastos en este período.</td></tr>' : expenses.map(e => `
        <tr>
          <td><strong>${e.id}</strong></td>
          <td>${e.expenseDate}</td>
          <td>${e.concept}</td>
          <td style="text-transform: capitalize;">${e.category}</td>
          <td class="text-right">Q ${Number(e.amount).toFixed(2)}</td>
          <td>${e.notes || '—'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    K’anba Cuevas Vivas · Sistema de Gestión Administrativa, Operativa y Comercial
  </div>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      return res.end(html);
    }
  }

  if (method === 'GET' && p === '/api/admin/report') {
    return sendJson(res, 200, adminOverview());
  }

  if (method === 'GET' && p === '/api/admin/content') {
    return sendJson(res, 200, { ok: true, content: getDb().content });
  }
  if (method === 'PUT' && p === '/api/admin/content') {
    const body = await readJson(req);
    const content = cleanContent(body.content);
    getDb().content = content;
    saveDb();
    return sendJson(res, 200, { ok: true, content });
  }

  if (method === 'GET' && p === '/api/admin/settings') {
    return sendJson(res, 200, {
      ok: true,
      settings: publicAdminSettings(getDb().settings),
      smtpStatus: getPublicSmtpStatus()
    });
  }
  if (method === 'POST' && p === '/api/admin/settings/test-smtp') {
    await rateLimit(`test-smtp:${clientIp(req)}`, 5, 5 * 60000); // Máximo 5 pruebas cada 5 minutos
    const body = await readJson(req);
    const to = String(body.to || '').trim();
    if (!to) throw new AppError('Ingresa un correo destinatario para la prueba.', 422, 'validation');
    const result = await testSmtpConnection(to);
    return sendJson(res, 200, { ok: true, result });
  }
  if (method === 'PUT' && p === '/api/admin/settings') {
    const body = await readJson(req);
    const d = getDb();
    const incoming = body.settings || body;
    d.settings = mergeAdminSettings(d.settings, incoming);
    validateBookingPolicy(d.settings.booking, 422);
    saveDb();
    return sendJson(res, 200, { ok: true, settings: publicAdminSettings(d.settings) });
  }

  if (method === 'POST' && p === '/api/admin/password') {
    const body = await readJson(req);
    const currentSession = getSession(req);
    const passwordOwner = currentSession?.userId ? getDb().users.find(user => user.id === currentSession.userId) : null;
    if (!passwordOwner || !verifyPassword(String(body.current || ''), passwordOwner.password)) {
      throw new AppError('La contraseña actual no es correcta.', 401, 'invalid_credentials');
    }
    const next = String(body.next || '');
    if (next.length < 12 || next.length > 256) throw new AppError('La nueva contraseña debe tener entre 12 y 256 caracteres.', 422, 'validation');
    passwordOwner.password = hashPassword(next);
    passwordOwner.passwordPolicyVersion = 2;
    passwordOwner.updatedAt = new Date().toISOString();
    if (currentSession?.userId) for (const [token, session] of Object.entries(getDb().userSessions)) if (session.userId === currentSession.userId) delete getDb().userSessions[token];
    // Legacy admin sessions are no longer accepted.
    res.setHeader('Set-Cookie', cookieBase(req, USER_COOKIE, '', 0));
    saveDb();
    return sendJson(res, 200, { ok: true, sessionsRevoked: true });
  }

  if (method === 'POST' && p === '/api/admin/media') {
    const body = await readJson(req, 12 * 1024 * 1024);
    const dataUrl = String(body.dataUrl || '');
    const match = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new AppError('Formato de imagen no admitido. Usa JPG, PNG, WEBP o GIF.', 422, 'validation');
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new AppError('La imagen supera los 8 MB.', 413, 'too_large');
    if (buffer.length < 100) throw new AppError('La imagen está vacía.', 422, 'validation');
    const validSignature = ext === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : ['jpg', 'jpeg'].includes(ext) ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : ext === 'gif' ? /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))
      : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!validSignature) throw new AppError('El archivo no corresponde al formato declarado.', 422, 'validation');
    const filename = `${Date.now().toString(36)}-${randomToken(5).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}.${ext}`;
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    await saveUploadToDb(filename, mime, buffer);
    return sendJson(res, 201, { ok: true, url: `/uploads/${filename}`, size: buffer.length });
  }

  /* ---------- Galería y Medios · Administración ---------- */

  if (method === 'POST' && p === '/api/admin/gallery') {
    const body = await readJson(req);
    const src = String(body.src || '').trim();
    if (!src) throw new AppError('La URL de la imagen es obligatoria.', 422, 'validation');
    const d = getDb();
    d.content = d.content || {};
    d.content.gallery = Array.isArray(d.content.gallery) ? d.content.gallery : [];
    const item = {
      id: body.id || `img_${Date.now()}_${d.content.gallery.length}`,
      src,
      caption: String(body.caption || '').slice(0, 200),
      category: String(body.category || 'cueva').slice(0, 30),
      credit: String(body.credit || '').slice(0, 160)
    };
    d.content.gallery.push(item);
    saveDb();
    return sendJson(res, 201, { ok: true, item, gallery: d.content.gallery });
  }

  if (method === 'DELETE' && p.startsWith('/api/admin/gallery/')) {
    const rawId = p.replace('/api/admin/gallery/', '');
    const id = decodeURIComponent(rawId).trim();
    const d = getDb();
    d.content = d.content || {};
    d.content.gallery = Array.isArray(d.content.gallery) ? d.content.gallery : [];
    const index = d.content.gallery.findIndex((item, i) => String(item.id || i) === id || String(item.src) === id);
    if (index === -1) throw new AppError('Imagen no encontrada en la galería.', 404, 'not_found');
    const [removed] = d.content.gallery.splice(index, 1);
    if (removed?.src?.startsWith('/uploads/')) {
      const filename = removed.src.replace(/^\/uploads\//, '');
      try { await deleteUploadFromDb(filename); } catch {}
    }
    saveDb();
    return sendJson(res, 200, { ok: true, gallery: d.content.gallery });
  }

  if (method === 'POST' && p === '/api/admin/videos') {
    const body = await readJson(req);
    const youtubeId = String(body.youtubeId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
    if (!youtubeId || youtubeId.length < 6) throw new AppError('ID de YouTube inválido.', 422, 'validation');
    const d = getDb();
    d.content = d.content || {};
    d.content.videos = Array.isArray(d.content.videos) ? d.content.videos : [];
    const item = {
      id: body.id || `vid_${Date.now()}_${d.content.videos.length}`,
      youtubeId,
      title: String(body.title || 'Video').slice(0, 140),
      description: String(body.description || '').slice(0, 400),
      category: String(body.category || 'Cueva').slice(0, 30)
    };
    const existingIndex = d.content.videos.findIndex(v => v.id === item.id);
    if (existingIndex >= 0) d.content.videos[existingIndex] = item;
    else d.content.videos.push(item);
    saveDb();
    return sendJson(res, 200, { ok: true, item, videos: d.content.videos });
  }

  if (method === 'DELETE' && p.startsWith('/api/admin/videos/')) {
    const rawId = p.replace('/api/admin/videos/', '');
    const id = decodeURIComponent(rawId).trim();
    const d = getDb();
    d.content = d.content || {};
    d.content.videos = Array.isArray(d.content.videos) ? d.content.videos : [];
    const index = d.content.videos.findIndex((v, i) => String(v.id || i) === id || String(v.youtubeId) === id);
    if (index === -1) throw new AppError('Video no encontrado en la videoteca.', 404, 'not_found');
    d.content.videos.splice(index, 1);
    saveDb();
    return sendJson(res, 200, { ok: true, videos: d.content.videos });
  }

  if (method === 'DELETE' && p.startsWith('/api/admin/media/')) {
    const name = decodeURIComponent(p.replace('/api/admin/media/', '')).trim();
    if (!name) throw new AppError('Nombre de archivo requerido.', 422, 'validation');
    await deleteUploadFromDb(name);
    const d = getDb();
    if (d.content && Array.isArray(d.content.gallery)) {
      d.content.gallery = d.content.gallery.filter(g => g.src !== `/uploads/${name}`);
    }
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- Cafetería · Administración ---------- */

  // 1. Catálogo de Productos
  if (method === 'GET' && p === '/api/admin/cafe/products') {
    return sendJson(res, 200, { ok: true, products: getCafeProducts() });
  }

  if (method === 'POST' && p === '/api/admin/cafe/products') {
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const category = String(body.category || '').trim();
    const price = Number(body.price);
    const cost = Number(body.cost ?? 0);
    const stock = Math.max(0, parseInt(body.stock ?? 0, 10) || 0);
    const minStock = Math.max(0, parseInt(body.minStock ?? 5, 10) || 5);
    const unit = String(body.unit || 'unidad').trim();
    const variants = Array.isArray(body.variants) ? body.variants.map(v => String(v).trim()).filter(Boolean) : [];

    if (name.length < 2) throw new AppError('El nombre del producto debe tener al menos 2 caracteres.', 422, 'validation');
    if (category.length < 2) throw new AppError('La categoría es requerida.', 422, 'validation');
    if (!Number.isFinite(price) || price < 0) throw new AppError('El precio debe ser un número mayor o igual a 0.', 422, 'validation');
    if (!Number.isFinite(cost) || cost < 0) throw new AppError('El costo debe ser un número mayor o igual a 0.', 422, 'validation');

    const baseSlug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const id = baseSlug || `prod-${randomToken(4)}`;

    const products = getCafeProducts();
    if (products.some(p => p.id === id)) {
      throw new AppError('Ya existe un producto con un identificador o nombre similar.', 409, 'conflict');
    }

    const now = new Date().toISOString();
    const product = {
      id,
      name,
      category,
      price: Math.round(price * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      stock,
      minStock,
      unit,
      variants,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now
    };

    products.push(product);

    if (stock > 0) {
      const d = getDb();
      d.cafeInventoryMovements = d.cafeInventoryMovements || [];
      d.cafeInventoryMovements.unshift({
        id: `mov_${randomToken(6)}`,
        code: nextCafeMovementCode(),
        itemType: 'product',
        itemId: product.id,
        itemName: product.name,
        movementType: 'in',
        quantity: stock,
        unitCost: product.cost,
        totalCost: Math.round(product.cost * stock * 100) / 100,
        reason: 'Inventario inicial',
        reference: product.id,
        createdBy: getSessionUser(req)?.user?.name || 'Administrador',
        createdAt: now
      });
    }

    saveDb();
    return sendJson(res, 201, { ok: true, product });
  }

  const cafeProdMatch = p.match(/^\/api\/admin\/cafe\/products\/([A-Za-z0-9-_]+)$/);
  if (cafeProdMatch) {
    const id = cafeProdMatch[1];
    const products = getCafeProducts();
    const product = products.find(prod => prod.id === id);
    if (!product) throw new AppError('Producto no encontrado.', 404, 'not_found');

    if (method === 'PUT') {
      const body = await readJson(req);
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 2) throw new AppError('Nombre inválido.', 422, 'validation');
        product.name = name;
      }
      if (body.category !== undefined) product.category = String(body.category).trim() || product.category;
      if (body.price !== undefined) {
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) throw new AppError('Precio inválido.', 422, 'validation');
        product.price = Math.round(price * 100) / 100;
      }
      if (body.cost !== undefined) {
        const cost = Number(body.cost);
        if (!Number.isFinite(cost) || cost < 0) throw new AppError('Costo inválido.', 422, 'validation');
        product.cost = Math.round(cost * 100) / 100;
      }
      if (body.minStock !== undefined) product.minStock = Math.max(0, parseInt(body.minStock, 10) || 0);
      if (body.unit !== undefined) product.unit = String(body.unit).trim() || product.unit;
      if (Array.isArray(body.variants)) product.variants = body.variants.map(v => String(v).trim()).filter(Boolean);
      if (body.active !== undefined) product.active = Boolean(body.active);

      if (body.stock !== undefined) {
        const newStock = Math.max(0, parseInt(body.stock, 10) || 0);
        const oldStock = Number(product.stock) || 0;
        if (newStock !== oldStock) {
          const diff = newStock - oldStock;
          product.stock = newStock;
          const d = getDb();
          d.cafeInventoryMovements = d.cafeInventoryMovements || [];
          d.cafeInventoryMovements.unshift({
            id: `mov_${randomToken(6)}`,
            code: nextCafeMovementCode(),
            itemType: 'product',
            itemId: product.id,
            itemName: product.name,
            movementType: 'adjustment',
            quantity: diff,
            unitCost: product.cost,
            totalCost: Math.round(product.cost * Math.abs(diff) * 100) / 100,
            reason: body.reason || 'Ajuste manual desde edición de producto',
            reference: product.id,
            createdBy: getSessionUser(req)?.user?.name || 'Administrador',
            createdAt: new Date().toISOString()
          });
        }
      }

      product.updatedAt = new Date().toISOString();
      saveDb();
      return sendJson(res, 200, { ok: true, product });
    }

    if (method === 'DELETE') {
      const d = getDb();
      const hasSales = (d.cafeOrders || []).some(o => (o.items || []).some(i => i.id === id));
      const hasMovements = (d.cafeInventoryMovements || []).some(m => m.itemId === id);

      if (hasSales || hasMovements) {
        product.active = false;
        product.updatedAt = new Date().toISOString();
        saveDb();
        return sendJson(res, 200, { ok: true, archived: true, message: 'Producto archivado (desactivado) para conservar el historial de ventas e inventario.' });
      }

      const idx = products.findIndex(p => p.id === id);
      if (idx !== -1) products.splice(idx, 1);
      saveDb();
      return sendJson(res, 200, { ok: true, deleted: true });
    }
  }

  // 2. Insumos (Supplies)
  if (method === 'GET' && p === '/api/admin/cafe/supplies') {
    return sendJson(res, 200, { ok: true, supplies: getCafeSupplies() });
  }

  if (method === 'POST' && p === '/api/admin/cafe/supplies') {
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const category = String(body.category || 'Insumos').trim();
    const stock = Math.max(0, Number(body.stock ?? 0) || 0);
    const minStock = Math.max(0, Number(body.minStock ?? 5) || 5);
    const unit = String(body.unit || 'unidad').trim();
    const cost = Math.max(0, Number(body.cost ?? 0) || 0);

    if (name.length < 2) throw new AppError('El nombre del insumo es requerido.', 422, 'validation');

    const supplies = getCafeSupplies();
    const id = `sup_${randomToken(6)}`;
    const now = new Date().toISOString();
    const supply = {
      id,
      name,
      category,
      stock,
      minStock,
      unit,
      cost: Math.round(cost * 100) / 100,
      active: true,
      createdAt: now,
      updatedAt: now
    };

    supplies.push(supply);

    if (stock > 0) {
      const d = getDb();
      d.cafeInventoryMovements = d.cafeInventoryMovements || [];
      d.cafeInventoryMovements.unshift({
        id: `mov_${randomToken(6)}`,
        code: nextCafeMovementCode(),
        itemType: 'supply',
        itemId: supply.id,
        itemName: supply.name,
        movementType: 'in',
        quantity: stock,
        unitCost: supply.cost,
        totalCost: Math.round(supply.cost * stock * 100) / 100,
        reason: 'Inventario inicial de insumo',
        reference: supply.id,
        createdBy: getSessionUser(req)?.user?.name || 'Administrador',
        createdAt: now
      });
    }

    saveDb();
    return sendJson(res, 201, { ok: true, supply });
  }

  const cafeSupMatch = p.match(/^\/api\/admin\/cafe\/supplies\/([A-Za-z0-9-_]+)$/);
  if (cafeSupMatch) {
    const id = cafeSupMatch[1];
    const supplies = getCafeSupplies();
    const supply = supplies.find(s => s.id === id);
    if (!supply) throw new AppError('Insumo no encontrado.', 404, 'not_found');

    if (method === 'PUT') {
      const body = await readJson(req);
      if (body.name !== undefined) supply.name = String(body.name).trim();
      if (body.category !== undefined) supply.category = String(body.category).trim() || supply.category;
      if (body.cost !== undefined) supply.cost = Math.max(0, Number(body.cost) || 0);
      if (body.minStock !== undefined) supply.minStock = Math.max(0, Number(body.minStock) || 0);
      if (body.unit !== undefined) supply.unit = String(body.unit).trim() || supply.unit;
      if (body.active !== undefined) supply.active = Boolean(body.active);
      supply.updatedAt = new Date().toISOString();
      saveDb();
      return sendJson(res, 200, { ok: true, supply });
    }

    if (method === 'DELETE') {
      supply.active = false;
      supply.updatedAt = new Date().toISOString();
      saveDb();
      return sendJson(res, 200, { ok: true, archived: true });
    }
  }

  // 3. Inventario y Kardex
  if (method === 'GET' && p === '/api/admin/cafe/inventory') {
    const products = getCafeProducts();
    const supplies = getCafeSupplies();
    const lowStockProducts = products.filter(p => p.active !== false && (Number(p.stock) || 0) <= (Number(p.minStock) || 0));
    const lowStockSupplies = supplies.filter(s => s.active !== false && (Number(s.stock) || 0) <= (Number(s.minStock) || 0));

    return sendJson(res, 200, {
      ok: true,
      products,
      supplies,
      alerts: {
        products: lowStockProducts,
        supplies: lowStockSupplies,
        totalLowStock: lowStockProducts.length + lowStockSupplies.length
      }
    });
  }

  if (method === 'POST' && p === '/api/admin/cafe/inventory/movements') {
    const body = await readJson(req);
    const itemType = body.itemType === 'supply' ? 'supply' : 'product';
    const itemId = String(body.itemId || '').trim();
    const movementType = ['in', 'out', 'adjustment'].includes(body.movementType) ? body.movementType : 'in';
    const quantity = Number(body.quantity);
    const reason = String(body.reason || '').trim();
    const reference = String(body.reference || '').trim();

    if (!itemId) throw new AppError('Identificador del ítem requerido.', 422, 'validation');
    if (!Number.isFinite(quantity) || (movementType !== 'adjustment' && quantity <= 0) || (movementType === 'adjustment' && quantity < 0)) {
      throw new AppError('Cantidad inválida.', 422, 'validation');
    }
    if (!reason) throw new AppError('Indica el motivo del movimiento.', 422, 'validation');

    const item = itemType === 'supply'
      ? getCafeSupplies().find(s => s.id === itemId)
      : getCafeProducts().find(p => p.id === itemId);

    if (!item) throw new AppError('Ítem no encontrado en el catálogo de cafetería.', 404, 'not_found');

    const currentStock = Number(item.stock) || 0;
    let qtyEffect = 0;

    if (movementType === 'in') {
      item.stock = currentStock + quantity;
      qtyEffect = quantity;
    } else if (movementType === 'out') {
      if (currentStock < quantity) {
        throw new AppError(`Stock insuficiente. Disponible: ${currentStock} ${item.unit || 'uds.'}`, 422, 'insufficient_stock');
      }
      item.stock = currentStock - quantity;
      qtyEffect = -quantity;
    } else if (movementType === 'adjustment') {
      qtyEffect = quantity - currentStock;
      item.stock = quantity;
    }

    item.updatedAt = new Date().toISOString();

    const unitCost = Number(body.unitCost ?? item.cost) || 0;
    const totalCost = Math.round(unitCost * Math.abs(qtyEffect) * 100) / 100;

    const movement = {
      id: `mov_${randomToken(6)}`,
      code: nextCafeMovementCode(),
      itemType,
      itemId: item.id,
      itemName: item.name,
      movementType,
      quantity: qtyEffect,
      unitCost,
      totalCost,
      reason,
      reference,
      createdBy: getSessionUser(req)?.user?.name || 'Administrador',
      createdAt: new Date().toISOString()
    };

    const d = getDb();
    d.cafeInventoryMovements = d.cafeInventoryMovements || [];
    d.cafeInventoryMovements.unshift(movement);
    saveDb();

    return sendJson(res, 201, { ok: true, movement, currentStock: item.stock });
  }

  if (method === 'GET' && p === '/api/admin/cafe/inventory/movements') {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const type = url.searchParams.get('type') || '';
    const itemId = url.searchParams.get('itemId') || '';
    const itemType = url.searchParams.get('itemType') || '';

    let movements = getDb().cafeInventoryMovements || [];
    if (from) movements = movements.filter(m => m.createdAt.slice(0, 10) >= from);
    if (to) movements = movements.filter(m => m.createdAt.slice(0, 10) <= to);
    if (type) movements = movements.filter(m => m.movementType === type);
    if (itemId) movements = movements.filter(m => m.itemId === itemId);
    if (itemType) movements = movements.filter(m => m.itemType === itemType);

    return sendJson(res, 200, { ok: true, movements });
  }

  // 4. Ventas y Comprobantes (POS)
  if (method === 'GET' && p === '/api/admin/cafe/sales') {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const paymentMethod = url.searchParams.get('paymentMethod') || '';
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();

    let sales = getDb().cafeOrders || [];
    if (from) sales = sales.filter(s => s.createdAt.slice(0, 10) >= from);
    if (to) sales = sales.filter(s => s.createdAt.slice(0, 10) <= to);
    if (paymentMethod) sales = sales.filter(s => (s.payment?.method || 'card') === paymentMethod);
    if (search) {
      sales = sales.filter(s =>
        (s.code && s.code.toLowerCase().includes(search)) ||
        (s.receipt?.number && s.receipt.number.toLowerCase().includes(search)) ||
        (s.customer?.name && s.customer.name.toLowerCase().includes(search))
      );
    }

    return sendJson(res, 200, { ok: true, sales });
  }

  if (method === 'POST' && p === '/api/admin/cafe/sales') {
    const body = await readJson(req);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw new AppError('Agrega al menos un producto a la venta.', 422, 'empty_cart');

    const products = getCafeProducts();
    const lines = [];
    let total = 0;

    for (const raw of rawItems) {
      const prodId = String(raw.id || '').trim();
      const prod = products.find(p => p.id === prodId);
      if (!prod) throw new AppError(`Producto no encontrado: ${prodId}`, 422, 'invalid_item');
      if (prod.active === false) throw new AppError(`El producto ${prod.name} se encuentra inactivo.`, 422, 'inactive_item');

      const qty = parseInt(raw.quantity ?? raw.qty ?? 1, 10);
      if (!Number.isInteger(qty) || qty < 1) throw new AppError(`Cantidad inválida para ${prod.name}.`, 422, 'invalid_quantity');

      const variant = String(raw.variant || '').trim();
      const displayName = variant ? `${prod.name} (${variant})` : prod.name;
      const unitPrice = Number(raw.unitPrice ?? prod.price) || 0;
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      total = Math.round((total + lineTotal) * 100) / 100;

      lines.push({
        id: prod.id,
        name: prod.name,
        displayName,
        variant: variant || null,
        category: prod.category,
        unitPrice,
        unitCost: Number(prod.cost) || 0,
        quantity: qty,
        subtotal: lineTotal
      });
    }

    const now = new Date().toISOString();
    const code = nextCafeOrderCode();
    const receiptNumber = nextReceiptNumber();
    const paymentMethod = ['cash', 'card', 'transfer', 'other'].includes(body.paymentMethod) ? body.paymentMethod : 'cash';
    const net = Math.round((total / 1.12) * 100) / 100;
    const tax = Math.round((total - net) * 100) / 100;
    const adminUser = getSessionUser(req)?.user;

    const order = {
      id: `cfo_${randomToken(6)}`,
      code,
      status: 'paid',
      brand: 'Café The Hope',
      createdAt: now,
      paidAt: now,
      createdByRole: 'admin',
      createdBy: adminUser?.name || 'Administración',
      customer: {
        name: String(body.customer?.name || body.name || 'Cliente en barra').trim().slice(0, 100),
        email: String(body.customer?.email || body.email || '').trim().toLowerCase().slice(0, 100),
        phone: String(body.customer?.phone || body.phone || '').trim().slice(0, 30),
        serviceType: String(body.customer?.serviceType || body.serviceType || 'En mesa · Cafetería').trim().slice(0, 80),
        notes: String(body.customer?.notes || body.notes || '').trim().slice(0, 300)
      },
      items: lines,
      subtotal: net,
      tax,
      total,
      currency: 'GTQ',
      payment: {
        method: paymentMethod,
        provider: paymentMethod === 'cash' ? 'Efectivo en Caja' : paymentMethod === 'transfer' ? 'Transferencia Bancaria' : paymentMethod === 'card' ? 'Terminal POS' : 'Otro',
        status: 'paid',
        brand: paymentMethod === 'cash' ? 'Efectivo' : paymentMethod === 'transfer' ? 'Transferencia' : 'Tarjeta',
        last4: String(body.payment?.last4 || body.last4 || '—').slice(0, 4),
        reference: String(body.payment?.reference || body.reference || code).slice(0, 60),
        paidAt: now
      },
      receipt: {
        number: receiptNumber,
        issuedAt: now
      }
    };

    const d = getDb();
    d.cafeOrders = d.cafeOrders || [];
    d.cafeOrders.unshift(order);
    deductCafeInventory(order, { user: adminUser, reason: `Venta POS ${code} (${receiptNumber})` });
    saveDb();

    return sendJson(res, 201, { ok: true, order });
  }

  const cafeSaleMatch = p.match(/^\/api\/admin\/cafe\/sales\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && cafeSaleMatch) {
    const code = cafeSaleMatch[1].toUpperCase();
    const order = (getDb().cafeOrders || []).find(o => o.code === code || o.id === cafeSaleMatch[1]);
    if (!order) throw new AppError('Venta no encontrada.', 404, 'not_found');
    return sendJson(res, 200, { ok: true, order });
  }

  // 5. Control de Gastos
  if (method === 'GET' && p === '/api/admin/cafe/expenses') {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const category = url.searchParams.get('category') || '';

    let expenses = getDb().cafeExpenses || [];
    if (from) expenses = expenses.filter(e => e.expenseDate >= from);
    if (to) expenses = expenses.filter(e => e.expenseDate <= to);
    if (category) expenses = expenses.filter(e => e.category === category);

    return sendJson(res, 200, { ok: true, expenses });
  }

  if (method === 'POST' && p === '/api/admin/cafe/expenses') {
    const body = await readJson(req);
    const concept = String(body.concept || '').trim();
    const category = String(body.category || 'otros').trim();
    const amount = Number(body.amount);
    const expenseDate = String(body.expenseDate || body.date || todayISO()).trim();
    const notes = String(body.notes || '').trim();

    if (concept.length < 2) throw new AppError('El concepto del gasto es requerido.', 422, 'validation');
    if (!['insumos', 'servicios', 'mantenimiento', 'personal', 'otros'].includes(category)) {
      throw new AppError('Categoría de gasto no válida. Usa: insumos, servicios, mantenimiento, personal u otros.', 422, 'validation');
    }
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('El monto debe ser mayor a 0.', 422, 'validation');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) throw new AppError('Fecha inválida (YYYY-MM-DD).', 422, 'validation');

    const id = nextCafeExpenseId();
    const now = new Date().toISOString();
    const expense = {
      id,
      concept,
      category,
      amount: Math.round(amount * 100) / 100,
      expenseDate,
      notes,
      createdBy: getSessionUser(req)?.user?.name || 'Administrador',
      createdAt: now
    };

    const d = getDb();
    d.cafeExpenses = d.cafeExpenses || [];
    d.cafeExpenses.unshift(expense);
    saveDb();

    return sendJson(res, 201, { ok: true, expense });
  }

  const cafeExpMatch = p.match(/^\/api\/admin\/cafe\/expenses\/([A-Za-z0-9-_]+)$/);
  if (method === 'DELETE' && cafeExpMatch) {
    const id = cafeExpMatch[1];
    const d = getDb();
    d.cafeExpenses = d.cafeExpenses || [];
    const idx = d.cafeExpenses.findIndex(e => e.id === id);
    if (idx === -1) throw new AppError('Gasto no encontrado.', 404, 'not_found');
    d.cafeExpenses.splice(idx, 1);
    saveDb();
    return sendJson(res, 200, { ok: true, deleted: true });
  }

  // 6. Estadísticas y Reportes
  if (method === 'GET' && p === '/api/admin/cafe/reports') {
    const d = getDb();
    const from = url.searchParams.get('from') || `${todayISO().slice(0, 7)}-01`;
    const to = url.searchParams.get('to') || todayISO();

    const sales = (d.cafeOrders || []).filter(s => {
      const day = s.createdAt.slice(0, 10);
      return day >= from && day <= to && s.status === 'paid';
    });

    const expenses = (d.cafeExpenses || []).filter(e => {
      const day = e.expenseDate || e.createdAt.slice(0, 10);
      return day >= from && day <= to;
    });

    let totalIncome = 0;
    const paymentCounts = { cash: 0, card: 0, transfer: 0, other: 0 };
    const paymentTotals = { cash: 0, card: 0, transfer: 0, other: 0 };
    const productStats = {};

    for (const s of sales) {
      const amt = Number(s.total) || 0;
      totalIncome = Math.round((totalIncome + amt) * 100) / 100;

      const m = s.payment?.method || 'card';
      const pmKey = ['cash', 'card', 'transfer', 'other'].includes(m) ? m : 'other';
      paymentCounts[pmKey] += 1;
      paymentTotals[pmKey] = Math.round((paymentTotals[pmKey] + amt) * 100) / 100;

      for (const item of (s.items || [])) {
        const id = item.id;
        if (!productStats[id]) {
          productStats[id] = { id, name: item.name, category: item.category, unitsSold: 0, totalRevenue: 0 };
        }
        productStats[id].unitsSold += (Number(item.quantity) || 1);
        productStats[id].totalRevenue = Math.round((productStats[id].totalRevenue + (Number(item.subtotal) || 0)) * 100) / 100;
      }
    }

    const topProducts = Object.values(productStats).sort((a, b) => b.unitsSold - a.unitsSold);

    let totalExpenses = 0;
    const expensesByCategory = { insumos: 0, servicios: 0, mantenimiento: 0, personal: 0, otros: 0 };
    for (const e of expenses) {
      const amt = Number(e.amount) || 0;
      totalExpenses = Math.round((totalExpenses + amt) * 100) / 100;
      const cat = expensesByCategory[e.category] !== undefined ? e.category : 'otros';
      expensesByCategory[cat] = Math.round((expensesByCategory[cat] + amt) * 100) / 100;
    }

    const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100;
    const profitMargin = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 1000) / 10 : 0;

    const products = getCafeProducts();
    const supplies = getCafeSupplies();
    const lowStockProducts = products.filter(p => p.active !== false && (Number(p.stock) || 0) <= (Number(p.minStock) || 0));
    const lowStockSupplies = supplies.filter(s => s.active !== false && (Number(s.stock) || 0) <= (Number(s.minStock) || 0));

    return sendJson(res, 200, {
      ok: true,
      period: { from, to },
      summary: {
        totalIncome,
        totalExpenses,
        netProfit,
        profitMargin,
        salesCount: sales.length,
        averageTicket: sales.length > 0 ? Math.round((totalIncome / sales.length) * 100) / 100 : 0
      },
      topProducts,
      payments: { counts: paymentCounts, totals: paymentTotals },
      expensesByCategory,
      inventorySummary: {
        totalProducts: products.length,
        totalSupplies: supplies.length,
        lowStockAlerts: lowStockProducts.length + lowStockSupplies.length
      }
    });
  }

  // 7. Exportación a Excel (CSV con UTF-8 BOM) y PDF (HTML Imprimible)
  if (method === 'GET' && p === '/api/admin/cafe/reports/export') {
    const d = getDb();
    const format = url.searchParams.get('format') === 'html' || url.searchParams.get('format') === 'pdf' ? 'html' : 'csv';
    const typeParam = url.searchParams.get('type') || 'summary';
    const type = ['sales', 'expenses', 'inventory', 'summary'].includes(typeParam) ? typeParam : 'summary';
    const from = url.searchParams.get('from') || `${todayISO().slice(0, 7)}-01`;
    const to = url.searchParams.get('to') || todayISO();

    const sales = (d.cafeOrders || []).filter(s => {
      const day = s.createdAt.slice(0, 10);
      return day >= from && day <= to && s.status === 'paid';
    });

    const expenses = (d.cafeExpenses || []).filter(e => {
      const day = e.expenseDate || e.createdAt.slice(0, 10);
      return day >= from && day <= to;
    });

    if (format === 'csv') {
      let csv = '\uFEFF'; // UTF-8 BOM para apertura nativa en Microsoft Excel

      if (type === 'sales') {
        csv += 'Código,Comprobante,Fecha y Hora,Cliente,Teléfono,Tipo de Servicio,Forma de Pago,Subtotal (Q),Total (Q)\r\n';
        for (const s of sales) {
          csv += [
            csvEscape(s.code),
            csvEscape(s.receipt?.number || '—'),
            csvEscape(s.createdAt),
            csvEscape(s.customer?.name || 'Cliente en barra'),
            csvEscape(s.customer?.phone || ''),
            csvEscape(s.customer?.serviceType || 'En mesa'),
            csvEscape(s.payment?.method || 'card'),
            csvEscape(s.subtotal || 0),
            csvEscape(s.total || 0)
          ].join(',') + '\r\n';
        }
      } else if (type === 'expenses') {
        csv += 'ID,Fecha,Concepto,Categoría,Monto (Q),Notas,Registrado Por\r\n';
        for (const e of expenses) {
          csv += [
            csvEscape(e.id),
            csvEscape(e.expenseDate),
            csvEscape(e.concept),
            csvEscape(e.category),
            csvEscape(e.amount),
            csvEscape(e.notes || ''),
            csvEscape(e.createdBy || 'Administrador')
          ].join(',') + '\r\n';
        }
      } else if (type === 'inventory') {
        csv += 'Tipo,ID,Nombre,Categoría,Stock Actual,Stock Mínimo,Unidad,Costo Unitario (Q),Precio Venta (Q),Estado\r\n';
        for (const prod of getCafeProducts()) {
          csv += [
            'Producto',
            csvEscape(prod.id),
            csvEscape(prod.name),
            csvEscape(prod.category),
            csvEscape(prod.stock),
            csvEscape(prod.minStock),
            csvEscape(prod.unit || 'unidad'),
            csvEscape(prod.cost || 0),
            csvEscape(prod.price || 0),
            prod.active !== false ? 'Activo' : 'Inactivo'
          ].join(',') + '\r\n';
        }
        for (const sup of getCafeSupplies()) {
          csv += [
            'Insumo',
            csvEscape(sup.id),
            csvEscape(sup.name),
            csvEscape(sup.category),
            csvEscape(sup.stock),
            csvEscape(sup.minStock),
            csvEscape(sup.unit || 'unidad'),
            csvEscape(sup.cost || 0),
            '—',
            sup.active !== false ? 'Activo' : 'Inactivo'
          ].join(',') + '\r\n';
        }
      } else {
        // Summary report
        let inc = 0; for (const s of sales) inc += (Number(s.total) || 0);
        let exp = 0; for (const e of expenses) exp += (Number(e.amount) || 0);
        const net = inc - exp;

        csv += 'REPORTE FINANCIERO Y OPERATIVO · CAFÉ THE HOPE\r\n';
        csv += `Período,${from} al ${to}\r\n`;
        csv += `Total Ingresos por Ventas (Q),${inc.toFixed(2)}\r\n`;
        csv += `Total Gastos Operativos (Q),${exp.toFixed(2)}\r\n`;
        csv += `Utilidad Neta (Q),${net.toFixed(2)}\r\n`;
        csv += `Total de Ventas Realizadas,${sales.length}\r\n\r\n`;

        csv += 'LISTADO DE VENTAS DEL PERÍODO\r\n';
        csv += 'Código,Comprobante,Fecha,Cliente,Forma de Pago,Total (Q)\r\n';
        for (const s of sales) {
          csv += [csvEscape(s.code), csvEscape(s.receipt?.number || '—'), csvEscape(s.createdAt.slice(0, 10)), csvEscape(s.customer?.name || ''), csvEscape(s.payment?.method || ''), csvEscape(s.total || 0)].join(',') + '\r\n';
        }
        csv += '\r\nLISTADO DE GASTOS DEL PERÍODO\r\n';
        csv += 'ID,Fecha,Concepto,Categoría,Monto (Q)\r\n';
        for (const e of expenses) {
          csv += [csvEscape(e.id), csvEscape(e.expenseDate), csvEscape(e.concept), csvEscape(e.category), csvEscape(e.amount)].join(',') + '\r\n';
        }
      }

      return sendText(res, 200, csv, 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="reporte-cafeteria-${type}-${from}-${to}.csv"`
      });
    }

    // PDF / HTML Print format
    let totalInc = 0; for (const s of sales) totalInc += (Number(s.total) || 0);
    let totalExp = 0; for (const e of expenses) totalExp += (Number(e.amount) || 0);
    const netProf = totalInc - totalExp;

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reporte Ejecutivo · Café The Hope</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; margin: 30px; font-size: 13px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px; }
    .brand h1 { margin: 0; font-size: 22px; color: #0b1a16; }
    .brand p { margin: 2px 0 0; color: #64748b; font-size: 13px; }
    .meta { text-align: right; font-size: 12px; color: #475569; }
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 25px; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
    .kpi .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .kpi .val { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .kpi.profit { border-color: #10b981; background: #ecfdf5; }
    .kpi.profit .val { color: #047857; }
    h2 { font-size: 15px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin: 24px 0 12px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th { text-align: left; background: #f1f5f9; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; font-weight: 600; color: #334155; }
    td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #fafafa; }
    .text-right { text-align: right; }
    .no-print { margin-bottom: 20px; }
    .btn-print { background: #0f172a; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    @media print {
      .no-print { display: none !important; }
      body { margin: 0; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
  </div>
  <div class="header">
    <div class="brand">
      <h1>Café The Hope · K’anba Cuevas Vivas</h1>
      <p>Reporte Oficial de Operación, Ventas y Gastos</p>
    </div>
    <div class="meta">
      <div><strong>Período:</strong> ${from} al ${to}</div>
      <div><strong>Generado:</strong> ${new Date().toLocaleDateString('es-GT', { timeZone: TZ })} ${new Date().toLocaleTimeString('es-GT', { timeZone: TZ })}</div>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi">
      <div class="label">Ingresos (Ventas)</div>
      <div class="val">Q ${totalInc.toFixed(2)}</div>
    </div>
    <div class="kpi">
      <div class="label">Gastos Operativos</div>
      <div class="val">Q ${totalExp.toFixed(2)}</div>
    </div>
    <div class="kpi profit">
      <div class="label">Utilidad Neta</div>
      <div class="val">Q ${netProf.toFixed(2)}</div>
    </div>
    <div class="kpi">
      <div class="label">Transacciones</div>
      <div class="val">${sales.length}</div>
    </div>
  </div>

  <h2>Ventas del Período</h2>
  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Comprobante</th>
        <th>Fecha</th>
        <th>Cliente</th>
        <th>Forma de Pago</th>
        <th class="text-right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${sales.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No se registraron ventas en este período.</td></tr>' : sales.map(s => `
        <tr>
          <td><strong>${s.code}</strong></td>
          <td>${s.receipt?.number || '—'}</td>
          <td>${s.createdAt.slice(0, 10)}</td>
          <td>${s.customer?.name || 'Cliente en barra'}</td>
          <td>${s.payment?.method === 'cash' ? 'Efectivo' : s.payment?.method === 'card' ? 'Tarjeta' : s.payment?.method === 'transfer' ? 'Transferencia' : 'Otro'}</td>
          <td class="text-right">Q ${(Number(s.total) || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Gastos Operativos del Período</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Fecha</th>
        <th>Concepto</th>
        <th>Categoría</th>
        <th>Notas</th>
        <th class="text-right">Monto</th>
      </tr>
    </thead>
    <tbody>
      ${expenses.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No se registraron gastos en este período.</td></tr>' : expenses.map(e => `
        <tr>
          <td>${e.id}</td>
          <td>${e.expenseDate}</td>
          <td><strong>${e.concept}</strong></td>
          <td style="text-transform:capitalize;">${e.category}</td>
          <td>${e.notes || '—'}</td>
          <td class="text-right">Q ${(Number(e.amount) || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Estado Actual de Inventario</h2>
  <table>
    <thead>
      <tr>
        <th>Tipo</th>
        <th>Nombre</th>
        <th>Categoría</th>
        <th class="text-right">Stock</th>
        <th class="text-right">Mínimo</th>
        <th>Unidad</th>
        <th class="text-right">Costo U.</th>
        <th class="text-right">Precio</th>
      </tr>
    </thead>
    <tbody>
      ${getCafeProducts().map(prod => `
        <tr>
          <td>Producto</td>
          <td><strong>${prod.name}</strong></td>
          <td>${prod.category}</td>
          <td class="text-right" style="${(Number(prod.stock) || 0) <= (Number(prod.minStock) || 0) ? 'color:#ef4444;font-weight:bold;' : ''}">${prod.stock}</td>
          <td class="text-right">${prod.minStock}</td>
          <td>${prod.unit || 'unidad'}</td>
          <td class="text-right">Q ${(Number(prod.cost) || 0).toFixed(2)}</td>
          <td class="text-right">Q ${(Number(prod.price) || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
      ${getCafeSupplies().map(sup => `
        <tr>
          <td>Insumo</td>
          <td><strong>${sup.name}</strong></td>
          <td>${sup.category}</td>
          <td class="text-right" style="${(Number(sup.stock) || 0) <= (Number(sup.minStock) || 0) ? 'color:#ef4444;font-weight:bold;' : ''}">${sup.stock}</td>
          <td class="text-right">${sup.minStock}</td>
          <td>${sup.unit || 'unidad'}</td>
          <td class="text-right">Q ${(Number(sup.cost) || 0).toFixed(2)}</td>
          <td class="text-right">—</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

    return sendText(res, 200, html, 'text/html; charset=utf-8');
  }

  throw new AppError('Ruta no encontrada.', 404, 'not_found');
}


return { handleApi, securityHeaders, cleanupSessions, getSessionUser, requireAdmin, dashboardFor };
}
