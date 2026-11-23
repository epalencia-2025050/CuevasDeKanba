import { settingsWithoutSecrets } from './runtime-secrets.js';

export const RELATIONAL_SCHEMA = `
  -- 1. Tabla de Usuarios
  CREATE TABLE IF NOT EXISTS kanba_users (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    phone text DEFAULT '',
    country text DEFAULT 'Guatemala',
    password_salt text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  -- 2. Tabla de Tours y Experiencias
  CREATE TABLE IF NOT EXISTS kanba_tours (
    id text PRIMARY KEY,
    name text NOT NULL,
    short_name text NOT NULL,
    tagline text NOT NULL,
    description text NOT NULL,
    price numeric(10, 2) NOT NULL CHECK (price >= 0),
    capacity integer NOT NULL CHECK (capacity > 0),
    duration text NOT NULL,
    difficulty text NOT NULL,
    min_age integer DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    featured boolean NOT NULL DEFAULT false,
    image text NOT NULL,
    times text[] NOT NULL,
    days integer[] NOT NULL,
    includes text[] NOT NULL DEFAULT '{}',
    not_includes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- 3. Tabla de Reservas
  CREATE TABLE IF NOT EXISTS kanba_reservations (
    code text PRIMARY KEY,
    tour_id text NOT NULL REFERENCES kanba_tours(id) ON UPDATE CASCADE,
    tour_name text NOT NULL,
    user_id text REFERENCES kanba_users(id) ON DELETE SET NULL,
    date date NOT NULL,
    time text NOT NULL,
    participants integer NOT NULL CHECK (participants > 0),
    unit_price numeric(10, 2) NOT NULL,
    total numeric(10, 2) NOT NULL CHECK (total >= 0),
    currency text NOT NULL DEFAULT 'GTQ',
    status text NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'expired')),
    token text NOT NULL,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text NOT NULL,
    customer_country text DEFAULT 'Guatemala',
    customer_document text DEFAULT '',
    customer_notes text DEFAULT '',
    hold_expires_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_reservations_slot ON kanba_reservations (tour_id, date, time, status);
  CREATE INDEX IF NOT EXISTS idx_reservations_customer_email ON kanba_reservations (lower(customer_email));
  CREATE INDEX IF NOT EXISTS idx_reservations_status_expires ON kanba_reservations (status, hold_expires_at);

  -- 4. Tabla de Pagos
  CREATE TABLE IF NOT EXISTS kanba_payments (
    id text PRIMARY KEY,
    reservation_code text NOT NULL UNIQUE REFERENCES kanba_reservations(code) ON DELETE CASCADE,
    intent_id text NOT NULL UNIQUE,
    provider text NOT NULL DEFAULT 'KanbaPay Sandbox',
    status text NOT NULL CHECK (status IN ('pending', 'requires_payment', 'paid', 'declined', 'expired', 'refund_pending', 'refunded')),
    amount numeric(10, 2) NOT NULL,
    currency text NOT NULL DEFAULT 'GTQ',
    brand text DEFAULT 'Tarjeta',
    last4 text DEFAULT '—',
    reference text DEFAULT '—',
    receipt_number text UNIQUE,
    receipt_issued_at timestamptz,
    paid_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- 5. Tabla de Historial de Eventos de Reserva
  CREATE TABLE IF NOT EXISTS kanba_reservation_history (
    id bigserial PRIMARY KEY,
    reservation_code text NOT NULL REFERENCES kanba_reservations(code) ON DELETE CASCADE,
    event_type text NOT NULL,
    label text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- 6. Tabla de Logs de Correo
  CREATE TABLE IF NOT EXISTS kanba_email_logs (
    id text PRIMARY KEY,
    recipient text NOT NULL,
    subject text NOT NULL,
    template text NOT NULL,
    reservation_code text,
    status text NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
    provider text NOT NULL DEFAULT 'outbox',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    sent_at timestamptz,
    last_error text,
    permanent_failed boolean NOT NULL DEFAULT false,
    html text NOT NULL,
    text_body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- 7. Tabla de Ajustes del Sistema
  CREATE TABLE IF NOT EXISTS kanba_settings (
    section text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

/**
 * Migra los datos de la estructura JSON en memoria / doc a las tablas relacionales.
 * Operación idempotente (ON CONFLICT DO NOTHING / UPDATE).
 */
async function importDocument(client, d) {
  if (!d) return { migrated: false, reason: 'No db loaded' };

  console.log('[migración] Iniciando migración de datos a tablas relacionales...');

  // 1. Tours
  if (Array.isArray(d.tours)) {
    for (const t of d.tours) {
      await client.query(
        `INSERT INTO kanba_tours (id, name, short_name, tagline, description, price, capacity, duration, difficulty, min_age, active, featured, image, times, days, includes, not_includes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           capacity = EXCLUDED.capacity,
           times = EXCLUDED.times,
           days = EXCLUDED.days`,
        [
          t.id, t.name, t.shortName || t.name, t.tagline || '', t.description || '',
          t.price || 0, t.capacity || 15, t.duration || '2h', t.difficulty || 'Moderada',
          t.minAge || 0, t.active !== false, Boolean(t.featured), t.image || '',
          t.times || [], t.days || [0,1,2,3,4,5,6], t.includes || [], t.notIncludes || []
        ]
      );
    }
  }

  // 2. Usuarios
  if (Array.isArray(d.users)) {
    for (const u of d.users) {
      await client.query(
        `INSERT INTO kanba_users (id, name, email, phone, country, password_salt, password_hash, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          u.id, u.name, u.email.toLowerCase(), u.phone || '', u.country || 'Guatemala',
          u.password?.salt || '', u.password?.hash || '', u.role || 'user',
          u.createdAt || new Date().toISOString(), u.updatedAt || new Date().toISOString()
        ]
      );
    }
  }

  // 3. Reservas, pagos e historial
  if (Array.isArray(d.reservations)) {
    for (const r of d.reservations) {
      await client.query(
        `INSERT INTO kanba_reservations (
           code, tour_id, tour_name, user_id, date, time, participants,
           unit_price, total, currency, status, token,
           customer_name, customer_email, customer_phone, customer_country,
           customer_document, customer_notes, hold_expires_at, paid_at,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         ON CONFLICT (code) DO NOTHING`,
        [
          r.code, r.tourId, r.tourName, r.userId || null, r.date, r.time, r.participants,
          r.unitPrice || (r.total / r.participants), r.total, r.currency || 'GTQ', r.status, r.token,
          r.customer?.name || '', r.customer?.email || '', r.customer?.phone || '', r.customer?.country || 'Guatemala',
          r.customer?.document || '', r.customer?.notes || '', r.holdExpiresAt || null, r.paidAt || null,
          r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()
        ]
      );

      // Pagos
      if (r.payment && r.payment.intentId) {
        await client.query(
          `INSERT INTO kanba_payments (
             id, reservation_code, intent_id, provider, status, amount, currency,
             brand, last4, reference, receipt_number, receipt_issued_at, paid_at, attempts
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (reservation_code) DO NOTHING`,
          [
            `pay_${r.code}`, r.code, r.payment.intentId, r.payment.provider || 'KanbaPay Sandbox',
            r.payment.status || 'pending', r.total, r.currency || 'GTQ',
            r.payment.brand || 'Tarjeta', r.payment.last4 || '—', r.payment.reference || '—',
            r.receipt?.number || null, r.receipt?.issuedAt || null, r.paidAt || null,
            r.payment.attempts || 0
          ]
        );
      }

      // Historial
      if (Array.isArray(r.history)) {
        for (const h of r.history) {
          await client.query(
            `INSERT INTO kanba_reservation_history (reservation_code, event_type, label, created_at)
             VALUES ($1, $2, $3, $4)`,
            [r.code, h.type || 'info', h.label || '', h.at || new Date().toISOString()]
          );
        }
      }
    }
  }

  // 4. Correos
  if (Array.isArray(d.emails)) {
    for (const m of d.emails) {
      await client.query(
        `INSERT INTO kanba_email_logs (
           id, recipient, subject, template, reservation_code, status, provider,
           attempts, next_attempt_at, sent_at, last_error, permanent_failed,
           html, text_body, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING`,
        [
          m.id, m.to, m.subject || '(Sin asunto)', m.template || 'unknown', m.reservationCode || null,
          m.status || 'queued', m.provider || 'outbox', m.attempts || 0,
          m.nextAttemptAt || null, m.sentAt || null, m.error || null, Boolean(m.permanentFailed),
          m.html || '', m.text || '', m.createdAt || new Date().toISOString()
        ]
      );
    }
  }

  // 5. Ajustes
  if (d.settings) {
    for (const [section, data] of Object.entries(settingsWithoutSecrets(d.settings))) {
      await client.query(
        `INSERT INTO kanba_settings (section, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (section) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [section, JSON.stringify(data)]
      );
    }
  }

  console.log('[migración] Migración relacional completada exitosamente.');
  return { migrated: true };
}

// Explicit one-time legacy export; this is not the operational backend.
// Acquire one dedicated connection for the whole migration, including its marker.
export async function migrateJsonToRelational(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(19861117, 1)");
    await client.query('CREATE TABLE IF NOT EXISTS kanba_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const version = 'legacy-relational-export-v1';
    const previous = await client.query('SELECT version FROM kanba_schema_migrations WHERE version = $1', [version]);
    if (previous.rows.length) {
      await client.query('COMMIT');
      return { migrated: false, reason: 'already_applied' };
    }
    const document = await client.query('SELECT doc FROM kanba_store WHERE id = 1 FOR UPDATE');
    if (!document.rows.length) throw new Error('Store not initialized.');
    await client.query(RELATIONAL_SCHEMA);
    await client.query("ALTER TABLE kanba_payments DROP CONSTRAINT IF EXISTS kanba_payments_status_check");
    await client.query("ALTER TABLE kanba_payments ADD CONSTRAINT kanba_payments_status_check CHECK (status IN ('pending', 'requires_payment', 'paid', 'declined', 'expired', 'refund_pending', 'refunded'))");
    const result = await importDocument(client, document.rows[0].doc);
    await client.query('INSERT INTO kanba_schema_migrations (version) VALUES ($1)', [version]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* caller handles connection failure */ }
    throw error;
  } finally { client.release(); }
}
