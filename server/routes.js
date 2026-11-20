import crypto from 'node:crypto';
import { parseJsonObject } from './request-security.js';
import { getRuntime } from './runtime.js';
import { safeErrorMessage } from './safe-errors.js';
import { readWebBody } from './web-http.js';
import {
  rotateReservationToken, saveUploadToDb,
  getDb, saveDb, publicSite, publicTour, buildAvailability, occupancyFor,
  createReservation, getReservation, findTour, closeExpiredHolds, seatsTaken,
  validateCustomer, dateToEpoch, formatDateLong, isoAddDays, todayISO, dayOfWeek,
  AppError, nextReceiptNumber, TZ,
  registerUser, loginUser, getUserSession, logoutUser, findUserByEmail, rateLimitShared,
  createUserSession, registerGoogleUser, linkGoogleAccount
} from './store.js';
import { hashPassword, verifyPassword, randomToken, signPayload, verifySignature, safeEqual } from './security.js';
import { charge } from './gateway.js';
import { PaymentPolicyError, requirePaymentPermission } from './payment-policy.js';
import { paymentSecrets, settingsWithoutSecrets, containsIncomingSecrets } from './runtime-secrets.js';
import {
  notifyPending, notifyConfirmed, notifyExpired, notifyCancellation, notifyRefund, resendMail,
  testSmtpConnection, getPublicSmtpStatus, processEmailRetryQueue
} from './mailer.js';


export function createHandlers(config) {
const NODE_ENV = config.NODE_ENV;
const SESSION_COOKIE = 'kanba_session';
const USER_COOKIE = 'kanba_user';
const SESSION_MS = 8 * 3600 * 1000;
// Inicio de sesión con Google (OAuth 2.0). Configurar en Render o en .env.
const GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = config.GOOGLE_REDIRECT_URI || '';
const ADMIN_IDLE_MS = Number(config.ADMIN_SESSION_IDLE_MS) > 0
  ? Number(config.ADMIN_SESSION_IDLE_MS)
  : 30 * 60 * 1000;
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
    // Google Tag Manager / Google Analytics 4 (contenedor GTM-N8ZD2LM3)
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://googleads.g.doubleclick.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://www.google.com https://www.google.co.uk",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.googletagmanager.com https://td.doubleclick.net",
    "connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://stats.g.doubleclick.net https://*.g.doubleclick.net https://region1.google-analytics.com",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'"
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
  return next;
}

function googleLoginError(code) {
  return `/login.html?error=${encodeURIComponent(code)}`;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const d = getDb();
  const session = d.sessions[token];
  if (!Object.hasOwn(d.sessions, token) || !session || session.role !== 'admin') return null;
  if (session.userId && !d.users.some(user => user.id === session.userId && user.role === 'admin')) return null;
  const now = Date.now();
  if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now) {
    delete d.sessions[token];
    saveDb();
    return null;
  }
  const lastSeen = Date.parse(session.lastSeenAt || session.createdAt);
  if (!Number.isFinite(lastSeen) || now - lastSeen > ADMIN_IDLE_MS) {
    delete d.sessions[token];
    saveDb();
    return null;
  }
  if (now - lastSeen > 60 * 1000) {
    session.lastSeenAt = new Date(now).toISOString();
    saveDb();
  }
  return { token, ...session };
}

function requireAdmin(req) {
  const session = getSession(req);
  if (!session) throw new AppError('Inicia sesión para continuar.', 401, 'unauthorized');
  return session;
}

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
      provider: payments.provider || '',
      mode: payments.mode || 'sandbox',
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
    paymentsEnabled: ['development', 'test'].includes(NODE_ENV) && getDb().settings.payments.mode === 'sandbox',
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
    payment: r.payment,
    verifyUrl: `/verificar.html?code=${encodeURIComponent(r.code)}`
  };
}

/* ------------------------------------------------------------------ */
/* Business actions                                                   */
/* ------------------------------------------------------------------ */

function applyApprovedPayment(reservation, result, { manual = false } = {}) {
  requirePaymentPermission(getDb().settings.payments.mode, manual ? 'manual' : 'charge');
  const now = new Date().toISOString();
  if (reservation.status === 'confirmed') return reservation;
  reservation.status = 'confirmed';
  reservation.paidAt = now;
  reservation.updatedAt = now;
  reservation.payment = {
    ...reservation.payment,
    status: 'paid',
    brand: result.brand || (manual ? 'Manual' : 'Tarjeta'),
    last4: result.last4 || '—',
    reference: result.reference,
    paidAt: now,
    provider: result.provider || reservation.payment.provider,
    manual
  };
  if (!reservation.receipt) {
    reservation.receipt = { number: nextReceiptNumber(), issuedAt: now };
  }
  reservation.history.push({
    at: now,
    type: 'paid',
    label: manual
      ? `Pago confirmado manualmente · comprobante ${reservation.receipt.number}`
      : `Pago aprobado · comprobante ${reservation.receipt.number}`
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
    label: `Cancelación (${by === 'admin' ? 'administración' : 'cliente'}) · reembolso Q${amount.toFixed(2)}`
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
      currency: reservation.currency || 'GTQ',
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
  const todaysTours = d.tours.filter((t) => t.active !== false && t.days.includes(dayOfWeek(today)));
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
    .filter((t) => /^\d{2}:\d{2}$/.test(t));
  if (!times.length) throw new AppError('Agrega al menos un horario válido (HH:MM).', 422, 'validation');
  const days = (Array.isArray(input.days) ? input.days : [0, 1, 2, 3, 4, 5, 6])
    .map(Number).filter((d) => d >= 0 && d <= 6);
  if (!days.length) throw new AppError('Selecciona al menos un día de operación.', 422, 'validation');
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) throw new AppError('El precio debe ser mayor a cero.', 422, 'validation');
  const capacity = Math.max(1, Math.min(60, Number(input.capacity) || 12));
  return {
    ...(existing || {}),
    id,
    name,
    badge: String(input.badge || '').trim().slice(0, 40),
    description: String(input.description || '').trim().slice(0, 600),
    longDescription: String(input.longDescription || '').trim().slice(0, 2000),
    duration: String(input.duration || '2 horas').trim().slice(0, 40),
    durationMinutes: Number(input.durationMinutes) || 120,
    price: Math.round(price * 100) / 100,
    times: [...new Set(times)].sort(),
    days: [...new Set(days)].sort(),
    capacity,
    minParticipants: Math.max(1, Math.min(capacity, Number(input.minParticipants) || 1)),
    maxParticipants: Math.max(1, Math.min(capacity, Number(input.maxParticipants) || capacity)),
    difficulty: String(input.difficulty || '').trim().slice(0, 80),
    minAge: Math.max(0, Number(input.minAge) || 0),
    meetingPoint: String(input.meetingPoint || '').trim().slice(0, 160),
    includes: (Array.isArray(input.includes) ? input.includes : String(input.includes || '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
    notIncludes: (Array.isArray(input.notIncludes) ? input.notIncludes : String(input.notIncludes || '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
    image: String(input.image || '/assets/img/kanba-cave-01.jpg').trim(),
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
      user: session ? session.user : null
    });
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
    if (!code) return sendRedirect(res, googleLoginError('google_failed'));

    try {
      const tokenRes = await getRuntime().fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: googleCallbackUri(req),
          grant_type: 'authorization_code'
        }),
        signal: AbortSignal.timeout(10000)
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.access_token) {
        throw new Error(tokens.error_description || tokens.error || 'token_exchange_failed');
      }

      const infoRes = await getRuntime().fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      const profile = await infoRes.json();
      if (!infoRes.ok || !profile.email) throw new Error(profile.error_description || 'userinfo_failed');
      if (!profile.sub || profile.email_verified !== true) {
        return sendRedirect(res, googleLoginError('google_email_unverified'));
      }

      const email = String(profile.email).trim().toLowerCase();
      const googleProfile = { googleId: String(profile.sub || ''), avatar: String(profile.picture || '') };
      const existing = findUserByEmail(email);
      const user = existing
        ? linkGoogleAccount(existing, googleProfile)
        : registerGoogleUser({ ...googleProfile, email, name: profile.name });

      const session = createUserSession(user);
      setUserCookie(res, req, session.token, session.expiresAt);
      return sendRedirect(res, entry.next);
    } catch (err) {
      console.error('[auth/google] no se pudo completar el inicio de sesión:', safeErrorMessage(err));
      return sendRedirect(res, googleLoginError('google_failed'));
    }
  }

  if (method === 'POST' && p === '/api/auth/register') {
    await rateLimit(`register:${clientIp(req)}`, 10, 10 * 60000);
    const body = await readJson(req);
    const user = registerUser(body);
    const login = loginUser(user.email, body.password);
    setUserCookie(res, req, login.token, login.expiresAt);
    return sendJson(res, 201, { ok: true, user: login.user });
  }

  if (method === 'POST' && p === '/api/auth/login') {
    await rateLimit(`userlogin:${clientIp(req)}`, 10, 10 * 60000);
    const body = await readJson(req);
    await rateLimit(`account:${crypto.createHash('sha256').update(String(body.email || '').trim().toLowerCase()).digest('hex')}`, 20, 10 * 60000);
    logoutUser(parseCookies(req)[USER_COOKIE] || '');
    const login = loginUser(String(body.email || ''), String(body.password || ''));
    setUserCookie(res, req, login.token, login.expiresAt);
    return sendJson(res, 200, { ok: true, user: login.user });
  }

  if (method === 'POST' && p === '/api/auth/logout') {
    const token = parseCookies(req)[USER_COOKIE] || '';
    logoutUser(token);
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

  m = p.match(/^\/api\/payments\/([A-Za-z0-9_-]+)\/pay$/);
  if (method === 'POST' && m) {
    requirePaymentPermission(getDb().settings.payments.mode);
    const body = await readJson(req);
    const d = getDb();
    const reservation = d.reservations.find((r) => r.payment?.intentId === m[1]);
    if (!reservation) throw new AppError('Intento de pago no encontrado.', 404, 'not_found');
    if (!safeEqual(String(body.token || ''), reservation.token)) throw new AppError('Enlace de pago inválido.', 403, 'forbidden');
    getReservation(reservation.code, body.token);
    if (reservation.status === 'confirmed') {
      return sendJson(res, 200, { ok: true, alreadyPaid: true, status: 'confirmed', code: reservation.code });
    }
    if (reservation.status !== 'pending_payment') {
      throw new AppError('Esta reserva ya no admite pagos.', 409, 'not_payable');
    }
    if (new Date(reservation.holdExpiresAt).getTime() <= Date.now()) {
      reservation.status = 'expired';
      reservation.payment.status = 'expired';
      reservation.updatedAt = new Date().toISOString();
      reservation.history.push({ at: new Date().toISOString(), type: 'expired', label: 'Intento de pago después del plazo · cupos liberados' });
      saveDb();
      try { await notifyExpired(reservation); } catch { /* noop */ }
      throw new AppError('El plazo de pago venció y los cupos fueron liberados. Vuelve a reservar.', 410, 'expired');
    }

    // Defensa en profundidad: este servidor nunca procesa PAN/CVV.
    if (body.card && (body.card.number || body.card.cvc || body.card.expiry)) {
      throw new AppError('Este servidor no procesa datos de tarjeta. Usa un token de pago emitido por la pasarela.', 400, 'card_data_not_accepted');
    }
    const paymentToken = String(body.paymentToken || '').trim();
    if (!paymentToken) {
      throw new AppError('Se requiere un token de pago válido.', 422, 'payment_token_required');
    }
    const result = charge({
      reservation,
      paymentToken,
      provider: d.settings.payments.provider,
      mode: d.settings.payments.mode
    });
    if (!result.approved) {
      reservation.payment.attempts = (reservation.payment.attempts || 0) + 1;
      reservation.updatedAt = new Date().toISOString();
      reservation.history.push({
        at: new Date().toISOString(),
        type: 'payment_declined',
        label: `Pago rechazado (${result.code}) · intento ${reservation.payment.attempts}`
      });
      saveDb();
      return sendJson(res, 402, {
        ok: false,
        code: result.code,
        message: result.message,
        fields: result.errors || null,
        attempts: reservation.payment.attempts,
        secondsLeft: Math.max(0, Math.floor((new Date(reservation.holdExpiresAt).getTime() - Date.now()) / 1000))
      });
    }

    applyApprovedPayment(reservation, result);
    try {
      await notifyConfirmed(reservation);
    } catch (err) {
      console.error('[pago] correos de confirmación fallaron:', safeErrorMessage(err));
    }
    return sendJson(res, 200, {
      ok: true,
      status: 'confirmed',
      code: reservation.code,
      receipt: reservation.receipt,
      reference: result.reference,
      redirect: `/confirmacion.html?code=${encodeURIComponent(reservation.code)}&token=${encodeURIComponent(reservation.token)}`
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
    requirePaymentPermission(getDb().settings.payments.mode, 'webhook');
    const raw = await readBody(req);
    const signature = req.headers['x-kanba-signature'] || '';
    const secret = paymentSecrets().webhookSecret;
    if (!secret || !verifySignature(secret, raw, signature)) {
      return sendJson(res, 401, { ok: false, message: 'Firma inválida o webhook sin configurar.' });
    }
    let event;
    try { event = JSON.parse(raw); } catch { return sendJson(res, 400, { ok: false }); }
    if (event.type === 'payment.approved' && event.intentId) {
      const reservation = getDb().reservations.find((r) => r.payment?.intentId === event.intentId);
      if (reservation) {
        // Idempotencia / anti-replay: un mismo evento no puede aplicarse dos veces.
        const eventKey = String(event.id || event.eventId || '').trim() || signPayload(secret, raw);
        const seen = reservation.payment?.eventIds || [];
        if (seen.includes(eventKey)) {
          return sendJson(res, 200, { ok: true, received: true, duplicate: true });
        }
        if (reservation.status === 'pending_payment') {
          reservation.payment.eventIds = [...seen.slice(-19), eventKey];
          applyApprovedPayment(reservation, {
            brand: event.brand || 'Tarjeta',
            last4: event.last4 || '—',
            reference: event.reference || `WH-${Date.now()}`,
            provider: event.provider || getDb().settings.payments.provider
          });
          try { await notifyConfirmed(reservation); } catch { /* noop */ }
        }
      }
    }
    return sendJson(res, 200, { ok: true, received: true });
  }

  /* ---------- Admin auth ---------- */
  if (method === 'POST' && p === '/api/admin/login') {
    await rateLimit(`login:${clientIp(req)}`, 8, 10 * 60000);
    const body = await readJson(req);
    const password = String(body.password || '');
    if (password.length > 256) throw new AppError('Credenciales incorrectas.', 401, 'invalid_credentials');
    await rateLimit('admin-account-login', 30, 10 * 60000);
    const email = String(body.email || '').trim().toLowerCase();
    const adminUser = email ? findUserByEmail(email) : null;
    const ok = adminUser
      ? adminUser.role === 'admin' && verifyPassword(password, adminUser.password)
      : verifyPassword(password, getDb().admin.password);
    if (!ok) {
      throw new AppError('Credenciales de administración incorrectas.', 401, 'invalid_credentials');
    }
    const previousToken = parseCookies(req)[SESSION_COOKIE];
    if (previousToken && Object.hasOwn(getDb().sessions, previousToken)) delete getDb().sessions[previousToken];
    const token = randomToken();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
    getDb().sessions[token] = {
      createdAt,
      lastSeenAt: createdAt,
      expiresAt,
      ip: clientIp(req),
      role: 'admin',
      userId: adminUser ? adminUser.id : null
    };
    saveDb();
    res.setHeader('Set-Cookie', cookieBase(req, SESSION_COOKIE, token, Math.floor(SESSION_MS / 1000)));
    return sendJson(res, 200, { ok: true, expiresAt });
  }

  if (method === 'POST' && p === '/api/admin/logout') {
    const session = getSession(req);
    if (session) {
      delete getDb().sessions[session.token];
      saveDb();
    }
    res.setHeader('Set-Cookie', cookieBase(req, SESSION_COOKIE, '', 0));
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && p === '/api/admin/me') {
    const session = getSession(req);
    return sendJson(res, 200, { ok: true, authenticated: Boolean(session), admin: session ? { name: 'Administración K’anba', expiresAt: session.expiresAt } : null });
  }

  /* ---------- Admin (protected) ---------- */
  if (p.startsWith('/api/admin/')) requireAdmin(req);

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

  m = p.match(/^\/api\/admin\/reservations\/([A-Za-z0-9-]+)\/confirm$/);
  if (method === 'POST' && m) {
    const r = getDb().reservations.find((x) => x.code === m[1]);
    if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
    if (r.status !== 'pending_payment') throw new AppError('Solo se pueden confirmar reservas pendientes de pago.', 409, 'invalid_status');
    applyApprovedPayment(r, { brand: 'Manual', last4: '—', reference: `MANUAL-${Date.now().toString(36).toUpperCase()}`, provider: 'Confirmación manual' }, { manual: true });
    try { await notifyConfirmed(r); } catch (err) { console.error(safeErrorMessage(err)); }
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
    requirePaymentPermission(getDb().settings.payments.mode, 'refund');
    const body = await readJson(req);
    const refund = getDb().refunds.find((x) => x.id === m[1]);
    if (!refund) throw new AppError('Reembolso no encontrado.', 404, 'not_found');
    if (refund.status === 'processed') throw new AppError('Este reembolso ya fue procesado.', 409, 'already_processed');
    refund.status = 'processed';
    refund.processedAt = new Date().toISOString();
    refund.reference = String(body.reference || `RF-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000 + 10000))}`).slice(0, 60);
    refund.method = String(body.method || refund.method).slice(0, 120);
    const r = getDb().reservations.find((x) => x.code === refund.reservationCode);
    if (r) {
      r.refund = { id: refund.id, amount: refund.amount, status: 'processed', reference: refund.reference, processedAt: refund.processedAt };
      if (r.payment) r.payment.status = 'refunded';
      r.history.push({ at: refund.processedAt, type: 'refunded', label: `Reembolso procesado · ${refund.reference} · Q${Number(refund.amount).toFixed(2)}` });
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
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 14));
    const grid = [];
    for (let i = 0; i < days; i++) {
      const date = isoAddDays(i);
      grid.push({ date, dateLong: formatDateLong(date), occupancy: occupancyFor(date), closures: getDb().closures.filter((c) => c.date === date) });
    }
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
    d.settings.booking.holdMinutes = Math.max(5, Math.min(120, Number(d.settings.booking.holdMinutes) || 20));
    d.settings.booking.advanceDays = Math.max(7, Math.min(365, Number(d.settings.booking.advanceDays) || 120));
    d.settings.booking.cutoffHours = Math.max(0, Number(d.settings.booking.cutoffHours) || 0);
    d.settings.booking.exchangeRate = Math.max(1, Number(d.settings.booking.exchangeRate) || 7.8);
    saveDb();
    return sendJson(res, 200, { ok: true, settings: publicAdminSettings(d.settings) });
  }

  if (method === 'POST' && p === '/api/admin/password') {
    const body = await readJson(req);
    const currentSession = getSession(req);
    const passwordOwner = currentSession?.userId ? getDb().users.find(user => user.id === currentSession.userId) : getDb().admin;
    if (!passwordOwner || !verifyPassword(String(body.current || ''), passwordOwner.password)) {
      throw new AppError('La contraseña actual no es correcta.', 401, 'invalid_credentials');
    }
    const next = String(body.next || '');
    if (next.length < 12 || next.length > 256) throw new AppError('La nueva contraseña debe tener entre 12 y 256 caracteres.', 422, 'validation');
    passwordOwner.password = hashPassword(next);
    passwordOwner.passwordPolicyVersion = 2;
    passwordOwner.updatedAt = new Date().toISOString();
    if (currentSession?.userId) for (const [token, session] of Object.entries(getDb().userSessions)) if (session.userId === currentSession.userId) delete getDb().userSessions[token];
    getDb().sessions = {};
    res.setHeader('Set-Cookie', cookieBase(req, SESSION_COOKIE, '', 0));
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


return { handleApi, securityHeaders, cleanupSessions };
}
