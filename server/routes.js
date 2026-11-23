import crypto from 'node:crypto';
import { exchangeGoogleCode, GoogleTokenError } from './google-token.js';
import { parseJsonObject } from './request-security.js';
import { getRuntime } from './runtime.js';
import { safeErrorMessage } from './safe-errors.js';
import { readWebBody } from './web-http.js';
import {
  validateBookingPolicy, rotateReservationToken, saveUploadToDb,
  getDb, saveDb, publicSite, publicTour, buildAvailability, operatesOn, normalizeWeekday,
  createReservation, getReservation, findTour, closeExpiredHolds, seatsTaken,
  validateCustomer, dateToEpoch, formatDateLong, isoAddDays, todayISO, dayOfWeek,
  AppError, nextReceiptNumber, TZ,
  registerUser, loginUser, getUserSession, logoutUser, findUserByEmail, rateLimitShared,
  createUserSession, registerGoogleUser, linkGoogleAccount
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

  /* ---------- Public ---------- */
  if (method === 'GET' && p === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'kanba', time: new Date().toISOString() });
  }

  if (method === 'GET' && p === '/api/site') {
    return sendJson(res, 200, publicSite());
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
        .map(r => ({ code: r.code, tourName: r.tourName, date: r.date, time: r.time, status: r.status })) });
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
    const reservation = getDb().reservations.find((r) => r.code === code && r.userId === owner.user.id && r.customer.email.toLowerCase() === email);
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

  throw new AppError('Ruta no encontrada.', 404, 'not_found');
}


return { handleApi, securityHeaders, cleanupSessions, getSessionUser, requireAdmin, dashboardFor };
}
