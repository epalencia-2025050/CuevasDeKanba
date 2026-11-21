import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getConfig, getRuntime } from './runtime.js';
import { hashPassword, verifyPassword, randomToken, safeEqual } from './security.js';
import { settingsWithoutSecrets } from './runtime-secrets.js';
import { validateStore } from './data-errors.js';

export const TZ = 'America/Guatemala';

/* ------------------------------------------------------------------ */
/* Date helpers (Guatemala = UTC-6 all year, no DST)                   */
/* ------------------------------------------------------------------ */

export function todayISO(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

export function isoAddDays(days) {
  return todayISO(days);
}

export function dateToEpoch(date, time = '00:00') {
  return Date.parse(`${date}T${time}:00-06:00`);
}

export function nowMs() {
  return Date.now();
}

export const DAY_INDEX_MAP = Object.freeze({
  dom: 0, domingo: 0, sun: 0, sunday: 0,
  lun: 1, lunes: 1, mon: 1, monday: 1,
  mar: 2, martes: 2, tue: 2, tuesday: 2,
  mie: 3, mié: 3, miercoles: 3, miércoles: 3, wed: 3, wednesday: 3,
  jue: 4, jueves: 4, thu: 4, thursday: 4,
  vie: 5, viernes: 5, fri: 5, friday: 5,
  sab: 6, sáb: 6, sabado: 6, sábado: 6, sat: 6, saturday: 6
});

export function normalizeWeekday(val) {
  if (typeof val === 'number') {
    if (val === 7) return 0;
    if (Number.isInteger(val) && val >= 0 && val <= 6) return val;
    return null;
  }
  const str = String(val ?? '').trim().toLowerCase();
  if (/^[0-6]$/.test(str)) return Number(str);
  if (str === '7') return 0;
  const clean = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (clean in DAY_INDEX_MAP) return DAY_INDEX_MAP[clean];
  if (str in DAY_INDEX_MAP) return DAY_INDEX_MAP[str];
  return null;
}

export function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatDateLong(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-GT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function formatDateShort(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-GT', {
    day: '2-digit', month: 'short', timeZone: 'UTC'
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/* ------------------------------------------------------------------ */
/* Seed                                                               */
/* ------------------------------------------------------------------ */

function initialAdminPassword() {
  const password = getConfig().ADMIN_PASSWORD || '';
  if (password.length < 12 || password.length > 256) throw new Error('ADMIN_PASSWORD debe tener entre 12 y 256 caracteres.');
  return hashPassword(password);
}

const transactionContext = new AsyncLocalStorage();
export async function withStoreTransaction(work) {
  if (transactionContext.getStore()) return work();
  return getRuntime().database.transaction(unit => transactionContext.run(unit, async () => {
    validateStore(unit.document);
    unit.document.settings = settingsWithoutSecrets(unit.document.settings);
    return work();
  }));
}
export function getDb() {
  const unit = transactionContext.getStore();
  if (!unit) throw new Error('Store access requires a transaction.');
  return unit.document;
}
export function saveDb() {
  const unit = transactionContext.getStore();
  if (!unit) throw new Error('Store mutation requires a transaction.');
  validateStore(unit.document);
  unit.dirty = true;
  unit.document.meta.updatedAt = new Date().toISOString();
}
export function usesDatabase() { return true; }
export async function initStore() {
  return withStoreTransaction(() => {
    const db = getDb();
    if (getConfig().NODE_ENV === 'production' && db.admin?.passwordPolicyVersion !== 2) {
      throw new Error('Administrative password requires controlled rotation.');
    }
    return db;
  });
}
export async function flushDb() {}
export async function closeStore() { await getRuntime().database.close(); }
export function createInitialStore() {
  const now = new Date().toISOString();
  return {
    meta: { version: 1, createdAt: now, updatedAt: now },
    admin: { password: initialAdminPassword(), passwordPolicyVersion: 2 },
    users: [], sessions: {}, userSessions: {}, tours: [], content: { brand: {}, hero: {}, intro: {}, contact: {} },
    settings: { business: {}, booking: {}, payments: {}, smtp: {} },
    reservations: [], emails: [], closures: [], refunds: [], counters: { reservation: 0, receipt: 0 }
  };
}

const USER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, avatar: u.avatar || null, phone: u.phone, country: u.country, role: u.role, createdAt: u.createdAt };
}

export function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return getDb().users.find((u) => u.email.toLowerCase() === normalized) || null;
}

export function findUserById(id) {
  return getDb().users.find((u) => u.id === id) || null;
}

export function registerUser(input) {
  const d = getDb();
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const phone = String(input.phone || '').trim();
  const country = String(input.country || '').trim();

  if (name.length < 3 || name.length > 120) throw new AppError('El nombre es obligatorio (mínimo 3 caracteres).', 422, 'validation');
  if (email.length > 254 || !USER_EMAIL_RE.test(email)) throw new AppError('Correo electrónico inválido.', 422, 'validation');
  if (password.length < 12 || password.length > 256) throw new AppError('La contraseña debe tener entre 12 y 256 caracteres.', 422, 'validation');
  if (findUserByEmail(email)) throw new AppError('Ya existe una cuenta con ese correo.', 409, 'email_taken');

  const user = {
    id: `usr_${randomToken(6)}`,
    name,
    email,
    password: hashPassword(password),
    phone,
    country,
    role: 'user',
    createdAt: new Date().toISOString()
  };
  d.users.push(user);
  saveDb();
  return publicUser(user);
}

export function loginUser(email, password) {
  const user = findUserByEmail(email);
  if (String(password).length > 256 || !user || !verifyPassword(password, user.password)) {
    throw new AppError('Correo o contraseña incorrectos.', 401, 'invalid_credentials');
  }
  return createUserSession(user);
}

export function createUserSession(user) {
  const token = randomToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  getDb().userSessions[token] = { userId: user.id, createdAt, lastSeenAt: createdAt, expiresAt };
  saveDb();
  return { token, expiresAt, user: publicUser(user) };
}

/**
 * Crea una cuenta a partir del perfil verificado de Google (sin contraseña).
 * El usuario podrá definir una contraseña más adelante si lo necesita.
 */
export function registerGoogleUser({ name, email, googleId, avatar }) {
  const d = getDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!USER_EMAIL_RE.test(normalizedEmail)) {
    throw new AppError('Google no devolvió un correo válido.', 422, 'validation');
  }
  if (findUserByEmail(normalizedEmail)) {
    throw new AppError('Ya existe una cuenta con ese correo.', 409, 'email_taken');
  }
  const cleanName = String(name || '').trim() || normalizedEmail.split('@')[0];
  const user = {
    id: `usr_${randomToken(6)}`,
    name: cleanName,
    email: normalizedEmail,
    phone: '',
    country: '',
    role: 'user',
    provider: 'google',
    googleId: String(googleId || ''),
    avatar: String(avatar || ''),
    createdAt: new Date().toISOString()
  };
  d.users.push(user);
  saveDb();
  return publicUser(user);
}

/** Vincula una cuenta existente (creada con correo y contraseña) a Google. */
export function linkGoogleAccount(user, { googleId, avatar }) {
  if (!user) return null;
  let changed = false;
  if (googleId && user.googleId !== googleId) {
    user.googleId = String(googleId);
    changed = true;
  }
  if (avatar && user.avatar !== avatar) {
    user.avatar = String(avatar);
    changed = true;
  }
  if (changed) saveDb();
  return publicUser(user);
}

export function getUserSession(token) {
  if (!token) return null;
  const d = getDb();
  const session = d.userSessions?.[token];
  if (!Object.hasOwn(d.userSessions, token) || !session) return null;
  const user = findUserById(session.userId);
  if (!user || !['user', 'admin'].includes(user.role)) return null;
  const now = Date.now();
  if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now) {
    delete d.userSessions[token];
    saveDb();
    return null;
  }
  const configuredIdle = user.role === 'admin' ? getConfig().ADMIN_SESSION_IDLE_MS : getConfig().USER_SESSION_IDLE_MS;
  const idleMs = Number(configuredIdle) > 0
    ? Number(configuredIdle)
    : 30 * 60 * 1000;
  const lastSeen = Date.parse(session.lastSeenAt || session.createdAt);
  if (!Number.isFinite(lastSeen) || now - lastSeen > idleMs) {
    delete d.userSessions[token];
    saveDb();
    return null;
  }
  // Renovación de actividad (persistida con ahorro de escrituras).
  if (now - lastSeen > 60 * 1000) {
    session.lastSeenAt = new Date(now).toISOString();
    saveDb();
  }
  return { token, ...session, user: publicUser(user) };
}

export function logoutUser(token) {
  if (!token) return;
  const d = getDb();
  if (d.userSessions?.[token]) {
    delete d.userSessions[token];
    saveDb();
  }
}

/* ------------------------------------------------------------------ */
/* Uploaded media                                                     */
/* ------------------------------------------------------------------ */

export async function saveUploadToDb(name, mime, buffer) {
  return transactionContext.getStore().saveUpload(name, mime, buffer);
}
export async function readUploadFromDb(name) { return getRuntime().database.readUpload(name); }
export async function rateLimitShared(key, max, windowMs) {
  return getRuntime().database.rateLimit(key, Math.max(1, Math.floor(windowMs)));
}

export function publicSite() {
  const d = getDb();
  const c = d.content;
  return {
    brand: c.brand,
    hero: c.hero,
    intro: c.intro,
    values: c.values,
    timeline: c.timeline,
    toursIntro: c.toursIntro,
    bookingIntro: c.bookingIntro,
    galleryIntro: c.galleryIntro,
    videosIntro: c.videosIntro,
    mapIntro: c.mapIntro,
    infoIntro: c.infoIntro,
    requirements: c.requirements,
    recommendations: c.recommendations,
    restrictions: c.restrictions,
    policiesIntro: c.policiesIntro,
    policies: c.policies,
    faq: c.faq,
    contact: c.contact,
    footerNote: c.footerNote,
    gallery: c.gallery,
    videos: c.videos,
    tours: d.tours.filter((t) => t.active !== false).map(publicTour),
    settings: {
      booking: d.settings.booking,
      payments: { provider: getConfig().PAYMENTS_PROVIDER || null }
    },
    serverNow: new Date().toISOString(),
    today: todayISO()
  };
}

export function publicTour(t) {
  const { secret, minParticipants, ...rest } = t;
  const startDate = rest.startDate || rest.fechaInicio || '';
  const endDate = rest.endDate || rest.fechaFin || '';
  const startTime = rest.startTime || rest.horaInicio || '';
  const endTime = rest.endTime || rest.horaFin || '';
  const rawDays = rest.days ?? rest.diasOperacion ?? rest.dias ?? [];
  const days = (Array.isArray(rawDays) ? rawDays : [rawDays]).map(normalizeWeekday).filter(d => d !== null);
  return {
    ...rest,
    startDate,
    endDate,
    startTime,
    endTime,
    fechaInicio: startDate,
    fechaFin: endDate,
    horaInicio: startTime,
    horaFin: endTime,
    days,
    diasOperacion: days
  };
}

/* ------------------------------------------------------------------ */
/* Availability                                                      */
/* ------------------------------------------------------------------ */

function isClosed(date, tourId) {
  const d = getDb();
  return (d.closures || []).some((c) => c.date === date && (c.tourId === 'all' || c.tourId === tourId));
}

function activeHolds() {
  const d = getDb();
  const now = Date.now();
  return d.reservations.filter((r) =>
    (r.status === 'confirmed') ||
    (r.status === 'pending_payment' && dateToEpoch(r.date, r.time) > now && new Date(r.holdExpiresAt).getTime() > now)
  );
}

export function seatsTaken(tourId, date, time) {
  return activeHolds()
    .filter((r) => r.tourId === tourId && r.date === date && r.time === time)
    .reduce((sum, r) => sum + Number(r.participants || 0), 0);
}

export function validateBookingPolicy(policy, status = 503) {
  const valid = policy && /^[A-Z]{3}$/.test(policy.currency)
    && Number.isInteger(policy.pendingLimit) && policy.pendingLimit > 0
    && Number.isFinite(policy.lastSeatsPercent) && policy.lastSeatsPercent >= 0 && policy.lastSeatsPercent <= 100
    && Number.isFinite(policy.cutoffHours) && policy.cutoffHours >= 0
    && Number.isInteger(policy.advanceDays) && policy.advanceDays >= 0
    && Number.isFinite(policy.holdMinutes) && policy.holdMinutes > 0;
  if (!valid) throw new AppError(status === 503 ? 'Las reservas no están disponibles en este momento. Inténtalo más tarde.' : 'Revisa la moneda, los límites y los plazos en Configuración comercial.', status, 'booking_policy_invalid');
  return policy;
}

export function departureStatus(tour, date, time, taken) {
  const d = getDb();
  const left = Math.max(0, tour.capacity - taken);
  if (isClosed(date, tour.id)) return { left: 0, status: 'closed' };
  if (dateToEpoch(date, time) <= Date.now() + (d.settings.booking?.cutoffHours || 0) * 3600000) return { left: 0, status: 'past' };
  if (left <= 0) return { left: 0, status: 'soldout' };
  if (left <= tour.capacity * d.settings.booking?.lastSeatsPercent / 100) return { left, status: 'last' };
  return { left, status: 'open' };
}

export function operatesOn(tour, date, time) {
  if (!tour || typeof tour !== 'object') return false;
  const startDate = tour.startDate || tour.fechaInicio || null;
  const endDate = tour.endDate || tour.fechaFin || null;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;

  const weekday = dayOfWeek(date);
  const rawDays = Array.isArray(tour.days)
    ? tour.days
    : Array.isArray(tour.diasOperacion)
      ? tour.diasOperacion
      : Array.isArray(tour.dias)
        ? tour.dias
        : [];
  if (!rawDays.length) return false;

  const matches = rawDays.some(d => {
    const norm = normalizeWeekday(d);
    return norm !== null && norm === weekday;
  });
  if (!matches) return false;

  const startTime = tour.startTime || tour.horaInicio || null;
  const endTime = tour.endTime || tour.horaFin || null;
  if (time) {
    if (startTime && time < startTime) return false;
    if (endTime && time > endTime) return false;
  }
  return true;
}

export function buildAvailability({ tourId = null, from = todayISO(), days = 21, calendarOnly = false } = {}) {
  const d = getDb();
  const tours = d.tours.filter(t => t.active !== false && (!tourId || t.id === tourId));
  const advance = d.settings.booking?.advanceDays;
  const lastDate = !calendarOnly && /^\d+$/.test(String(advance)) ? isoAddDaysFrom(todayISO(), Number(advance)) : null;
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = isoAddDaysFrom(from, i);
    if (lastDate && date > lastDate) break;
    const dow = dayOfWeek(date);
    const tourDays = [];
    for (const tour of tours) {
      if (!operatesOn(tour,date)) continue;
      const departures = tour.times.filter(time => operatesOn(tour,date,time)).map((time) => {
        const taken = seatsTaken(tour.id, date, time);
        const info = departureStatus(tour, date, time, taken);
        return { time, capacity: tour.capacity, taken, ...info };
      });
      if (!departures.length) continue;
      tourDays.push({
        tourId: tour.id,
        tourName: tour.name,
        price: tour.price,
        capacity: tour.capacity,
        closed: isClosed(date, tour.id),
        departures
      });
    }
    if (tourDays.length) out.push({ date, dow, tours: tourDays });
  }
  return out;
}

export function isoAddDaysFrom(from, days) {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Validation + booking                                              */
/* ------------------------------------------------------------------ */

export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function nextReservationCode() {
  const d = getDb();
  d.counters.reservation += 1;
  return `KAN-${new Date().getFullYear()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

export function nextReceiptNumber() {
  const d = getDb();
  d.counters.receipt += 1;
  return `REC-${new Date().getFullYear()}-${String(d.counters.receipt).padStart(5, '0')}`;
}

export function validateCustomer(input = {}) {
  const customer = {
    name: String(input.name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: String(input.phone || '').trim(),
    country: String(input.country || '').trim(),
    document: String(input.document || '').trim(),
    notes: String(input.notes || '').trim().slice(0, 600)
  };
  const errors = {};
  if (customer.name.length < 3 || customer.name.length > 120) errors.name = 'Escribe tu nombre completo.';
  if (customer.email.length > 254 || !EMAIL_RE.test(customer.email)) errors.email = 'Correo electrónico inválido.';
  if (!/^\+?[\d ()-]{7,25}$/.test(customer.phone) || !/^\d{7,15}$/.test(customer.phone.replace(/\D/g, ''))) errors.phone = 'Teléfono inválido.';
  if (customer.country.length < 2 || customer.country.length > 100) errors.country = 'Indica tu país.';
  if (input.acceptPolicies !== true) errors.acceptPolicies = 'Debes aceptar las políticas de reserva.';
  if (input.acceptTerms !== true) errors.acceptTerms = 'Debes aceptar los términos y la carta de responsabilidad.';
  if (Object.keys(errors).length) {
    throw new AppError('Revisa los datos del viajero.', 422, 'validation');
  }
  return customer;
}

export function findTour(id) {
  const t = getDb().tours.find((x) => x.id === id);
  if (!t || t.active === false) throw new AppError('Tour no disponible.', 404, 'tour_not_found');
  return t;
}

export function getReservation(code, token = null) {
  const d = getDb();
  const r = d.reservations.find((x) => x.code === code);
  if (!r) throw new AppError('Reserva no encontrada.', 404, 'not_found');
  if (!token) throw new AppError('Enlace privado de reserva requerido.', 401, 'unauthorized');
  if (r.tokenRevokedAt || !Number.isFinite(Date.parse(r.tokenExpiresAt || r.createdAt)) || Date.now() >= (r.tokenExpiresAt ? Date.parse(r.tokenExpiresAt) : Date.parse(r.createdAt) + 7 * 86400000)) throw new AppError('El enlace expiró. Inicia sesión para recuperarlo.', 403, 'token_expired');
  if (!safeEqual(r.token, token)) throw new AppError('Enlace de reserva inválido.', 403, 'forbidden');
  return r;
}

export function rotateReservationToken(reservation) {
  reservation.token = randomToken();
  reservation.tokenExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  reservation.tokenRevokedAt = null;
  saveDb();
  return reservation.token;
}

export function createReservation(input, { user = null } = {}) {
  const d = getDb();
  if (!user?.id) throw new AppError('Inicia sesión para reservar.', 401, 'login_required');
  const requestId = String(input.requestId || '');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new AppError('Identificador de solicitud inválido.', 422, 'request_id_required');
  const requestDigest = crypto.createHash('sha256').update(JSON.stringify({ tourId: input.tourId, date: input.date, time: input.time, participants: Number(input.participants), customer: input.customer, participantNames: input.participantNames })).digest('hex');
  const previous = d.reservations.find(r => r.userId === user.id && r.requestId === requestId);
  if (previous) {
    if (previous.requestDigest !== requestDigest) throw new AppError('La solicitud ya se usó con otros datos.', 409, 'idempotency_conflict');
    return previous;
  }
  const policy = validateBookingPolicy(d.settings.booking);
  if (d.reservations.filter(r => r.userId === user.id && r.status === 'pending_payment' && Date.parse(r.holdExpiresAt) > Date.now()).length >= policy.pendingLimit) throw new AppError('Alcanzaste el límite de reservas pendientes.', 429, 'pending_limit');
  const tour = findTour(input.tourId);
  const date = String(input.date || '');
  const time = String(input.time || '');
  const participants = input.participants;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new AppError('Fecha inválida.', 422, 'validation');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !tour.times.includes(time)) throw new AppError('Horario no válido para este tour.', 422, 'validation');
  if (!Number.isInteger(participants) || participants < 1 || participants > tour.maxParticipants) {
    throw new AppError(`Este tour admite entre 1 y ${tour.maxParticipants} participantes.`, 422, 'validation');
  }
  const participantNames = input.participantNames ?? (participants === 1 ? [input.customer?.name] : []);
  if (!Array.isArray(participantNames) || participantNames.length !== participants ||
      participantNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 120)) {
    throw new AppError('Indica el nombre de cada participante.', 422, 'validation');
  }
  if (!operatesOn(tour,date,time)) throw new AppError('El tour no opera en esa fecha.', 422, 'unavailable');
  if (isClosed(date, tour.id)) throw new AppError('La cueva está cerrada en esa fecha por mantenimiento o clima.', 409, 'closed');
  if (dateToEpoch(date, time) <= Date.now() + d.settings.booking.cutoffHours * 3600000) throw new AppError('Ese horario ya pasó. Elige otro.', 409, 'past');

  const maxAdvance = policy.advanceDays;
  if (date > isoAddDaysFrom(todayISO(), maxAdvance)) {
    throw new AppError(`Solo se puede reservar con ${maxAdvance} días de anticipación.`, 409, 'too_far');
  }

  const taken = seatsTaken(tour.id, date, time);
  const left = tour.capacity - taken;
  if (left < participants) {
    throw new AppError(left <= 0 ? 'Ese horario se agotó. Elige otro.' : `Solo quedan ${left} cupos en ese horario.`, 409, 'sold_out');
  }

  const customer = validateCustomer(input.customer || {});
  const holdMinutes = policy.holdMinutes;
  const cents = Math.round(tour.price * 100);
  if (!Number.isSafeInteger(cents * participants) || cents <= 0 || cents / 100 !== tour.price)
    throw new AppError('Precio del tour no disponible.', 409, 'invalid_price');
  const total = cents * participants / 100;
  const now = Date.now();
  const code = nextReservationCode();
  const token = randomToken();
  const intentId = `pi_${randomToken(8)}`;

  const reservation = {
    id: `res_${randomToken(6)}`,
    requestId,
    requestDigest,
    code,
    token,
    tokenExpiresAt: new Date(now + 7 * 86400000).toISOString(),
    tourId: tour.id,
    tourName: tour.name,
    date,
    time,
    participants,
    unitPrice: tour.price,
    total,
    currency: policy.currency,
    customer,
    participantNames: participantNames.map(name => name.trim()),
    status: 'pending_payment',
    userId: user ? user.id : null,
    createdByRole: user ? user.role : null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    holdExpiresAt: new Date(now + holdMinutes * 60000).toISOString(),
    paidAt: null,
    payment: {
      intentId,
      provider: getConfig().PAYMENTS_PROVIDER || null,
      status: 'requires_payment',
      amount: total,
      currency: policy.currency,
      last4: null,
      brand: null,
      reference: null,
      paidAt: null
    },
    receipt: null,
    history: [{ at: new Date(now).toISOString(), type: 'created', label: `Reserva creada · cupos bloqueados por ${holdMinutes} minutos` }]
  };

  d.reservations.unshift(reservation);
  saveDb();
  return reservation;
}

/* ------------------------------------------------------------------ */
/* Availability guards for admin                                     */
/* ------------------------------------------------------------------ */

export function closeExpiredHolds() {
  const d = getDb();
  const now = Date.now();
  const expired = [];
  for (const r of d.reservations) {
    if (r.status === 'pending_payment' && new Date(r.holdExpiresAt).getTime() <= now) {
      r.status = 'expired';
      r.updatedAt = new Date(now).toISOString();
      r.payment = { ...r.payment, status: 'expired' };
      r.history.push({ at: new Date(now).toISOString(), type: 'expired', label: 'Plazo de pago vencido · cupos liberados automáticamente' });
      expired.push(r);
    }
  }
  if (expired.length) saveDb();
  return expired;
}
