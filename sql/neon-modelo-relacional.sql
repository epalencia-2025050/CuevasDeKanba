-- K'anba: modelo relacional objetivo, PostgreSQL 14+ / Neon.
-- NO sustituye automaticamente el repositorio JSONB actual de server/db.js.
-- Ejecutar en la rama/base seleccionada del SQL Editor de Neon.
-- Crea un esquema independiente; no borra ni migra datos de kanba/public.
-- Script idempotente con IF NOT EXISTS: seguro para aplicar o reejecutar sobre la base de Neon.
-- Sin PAN, CVV, vencimientos, cuentas bancarias, tokens de tarjeta ni payloads de pasarela.
BEGIN;
CREATE SCHEMA IF NOT EXISTS kanba_rel;

CREATE TABLE IF NOT EXISTS kanba_rel.users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  phone VARCHAR(40),
  country VARCHAR(100),
  password_salt TEXT,
  password_hash TEXT,
  password_algorithm VARCHAR(30) NOT NULL DEFAULT 'scrypt',
  password_policy_version SMALLINT NOT NULL DEFAULT 2,
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  avatar_url TEXT,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((password_salt IS NULL AND password_hash IS NULL) OR
         (password_salt IS NOT NULL AND password_hash IS NOT NULL AND length(password_salt)>0 AND length(password_hash)>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON kanba_rel.users (lower(email));
COMMENT ON TABLE kanba_rel.users IS 'Clientes y administradores nominales; password nullable para cuentas Google. No guarda contrasenas en claro.';

CREATE TABLE IF NOT EXISTS kanba_rel.oauth_accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES kanba_rel.users(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL CHECK (provider = 'google'),
  provider_subject VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);
COMMENT ON TABLE kanba_rel.oauth_accounts IS 'Identidad externa verificada de Google; no almacena access_token ni refresh_token.';

CREATE TABLE IF NOT EXISTS kanba_rel.sessions (
  token_hash VARCHAR(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id TEXT NOT NULL REFERENCES kanba_rel.users(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('user','admin')),
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON kanba_rel.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON kanba_rel.sessions(expires_at);
COMMENT ON TABLE kanba_rel.sessions IS 'Sesiones de usuario y administrador; guardar SHA-256 del token aleatorio, no la cookie original.';

CREATE TABLE IF NOT EXISTS kanba_rel.oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  browser_hash VARCHAR(64) NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  next_path TEXT NOT NULL DEFAULT '/' CHECK (left(next_path,1)='/' AND left(next_path,2)<>'//'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON kanba_rel.oauth_states(expires_at);
COMMENT ON TABLE kanba_rel.oauth_states IS 'Desafio de OAuth temporal y de un solo uso; consumir con DELETE RETURNING.';

CREATE TABLE IF NOT EXISTS kanba_rel.tours (
  id TEXT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  badge VARCHAR(40),
  description TEXT NOT NULL DEFAULT '',
  long_description TEXT NOT NULL DEFAULT '',
  duration_label VARCHAR(40) NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price NUMERIC(12,2) NOT NULL CHECK (price > 0 AND price < 10000000000),
  currency VARCHAR(3) NOT NULL DEFAULT 'GTQ' CHECK (currency ~ '^[A-Z]{3}$'),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  min_participants INTEGER NOT NULL DEFAULT 1,
  max_participants INTEGER NOT NULL,
  difficulty VARCHAR(80) NOT NULL DEFAULT '',
  min_age SMALLINT NOT NULL DEFAULT 0 CHECK (min_age BETWEEN 0 AND 120),
  meeting_point TEXT NOT NULL DEFAULT '',
  includes TEXT[] NOT NULL DEFAULT '{}',
  not_includes TEXT[] NOT NULL DEFAULT '{}',
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_participants >= 1 AND max_participants >= min_participants AND max_participants <= capacity)
);
COMMENT ON TABLE kanba_rel.tours IS 'Catalogo de experiencias; precio por participante. Archivar con active=false si tiene reservas.';

CREATE TABLE IF NOT EXISTS kanba_rel.tour_schedules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tour_id TEXT NOT NULL REFERENCES kanba_rel.tours(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  local_time TIME WITHOUT TIME ZONE NOT NULL CHECK (local_time < TIME '24:00'),
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tour_id, weekday, local_time)
);
COMMENT ON TABLE kanba_rel.tour_schedules IS 'Horarios semanales: 0 domingo, 6 sabado; horas locales America/Guatemala. Expande tours.days x tours.times.';

CREATE TABLE IF NOT EXISTS kanba_rel.departures (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tour_id TEXT NOT NULL REFERENCES kanba_rel.tours(id) ON DELETE RESTRICT,
  local_date DATE NOT NULL,
  local_time TIME WITHOUT TIME ZONE NOT NULL CHECK (local_time < TIME '24:00'),
  time_zone VARCHAR(64) NOT NULL DEFAULT 'America/Guatemala' CHECK (time_zone='America/Guatemala'),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tour_id, local_date, local_time)
);
COMMENT ON TABLE kanba_rel.departures IS 'Salida concreta por fecha/hora. Fila de bloqueo para evitar sobreventa entre reservas concurrentes.';

CREATE TABLE IF NOT EXISTS kanba_rel.closures (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tour_id TEXT REFERENCES kanba_rel.tours(id) ON DELETE RESTRICT,
  local_date DATE NOT NULL,
  reason VARCHAR(300) NOT NULL,
  created_by TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS closures_tour_date_unique ON kanba_rel.closures(tour_id,local_date) WHERE tour_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS closures_all_date_unique ON kanba_rel.closures(local_date) WHERE tour_id IS NULL;
COMMENT ON TABLE kanba_rel.closures IS 'Cierre por mantenimiento/clima; tour_id NULL equivale al valor actual all: cierra todos los tours ese dia.';

CREATE TABLE IF NOT EXISTS kanba_rel.reservations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code VARCHAR(40) NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES kanba_rel.users(id) ON DELETE RESTRICT,
  departure_id BIGINT NOT NULL REFERENCES kanba_rel.departures(id) ON DELETE RESTRICT,
  request_id VARCHAR(80) NOT NULL CHECK (length(request_id) BETWEEN 16 AND 80),
  request_digest VARCHAR(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  tour_name_snapshot VARCHAR(160) NOT NULL,
  participants INTEGER NOT NULL CHECK (participants > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price > 0 AND unit_price < 10000000000),
  total NUMERIC(12,2) NOT NULL CHECK (total > 0 AND total < 10000000000),
  currency VARCHAR(3) NOT NULL DEFAULT 'GTQ' CHECK (currency ~ '^[A-Z]{3}$'),
  status VARCHAR(24) NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','confirmed','cancelled','expired')),
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL,
  customer_country VARCHAR(100) NOT NULL,
  customer_document TEXT,
  customer_notes VARCHAR(600),
  created_by_role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (created_by_role IN ('user','admin')),
  access_token_hash VARCHAR(64) NOT NULL CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
  token_expires_at TIMESTAMPTZ NOT NULL,
  token_revoked_at TIMESTAMPTZ,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  policies_version VARCHAR(80),
  terms_version VARCHAR(80),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id,request_id),
  UNIQUE (id,total,currency),
  CHECK (total = unit_price * participants),
  CHECK (hold_expires_at > created_at AND token_expires_at > created_at),
  CHECK (status <> 'confirmed' OR paid_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reservations_departure_status_idx ON kanba_rel.reservations(departure_id,status,hold_expires_at);
CREATE INDEX IF NOT EXISTS reservations_user_created_idx ON kanba_rel.reservations(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS reservations_pending_expiry_idx ON kanba_rel.reservations(hold_expires_at) WHERE status='pending_payment';
CREATE INDEX IF NOT EXISTS reservations_customer_email_idx ON kanba_rel.reservations(lower(customer_email));
COMMENT ON TABLE kanba_rel.reservations IS 'Compra de un tour para N participantes; conserva precio/contacto al reservar y deduplica reintentos del navegador.';
COMMENT ON COLUMN kanba_rel.reservations.customer_document IS 'Campo opcional heredado del formulario; no recopilar identificacion si el negocio no la necesita.';
COMMENT ON COLUMN kanba_rel.reservations.access_token_hash IS 'SHA-256 del enlace privado; requiere adaptar el repositorio actual, que guarda el token original.';
COMMENT ON COLUMN kanba_rel.reservations.accepted_at IS 'Evidencia nueva: el codigo actual valida casillas pero no persiste fecha/version. No inventar valores al importar historicos.';

CREATE TABLE IF NOT EXISTS kanba_rel.payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reservation_id TEXT NOT NULL,
  provider VARCHAR(80) NOT NULL,
  environment VARCHAR(12) NOT NULL CHECK (environment IN ('sandbox','live')),
  merchant_id VARCHAR(255) NOT NULL,
  provider_intent_id VARCHAR(255),
  provider_payment_id VARCHAR(255),
  idempotency_key VARCHAR(128) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0 AND amount < 10000000000),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status VARCHAR(24) NOT NULL DEFAULT 'requires_payment' CHECK (status IN ('requires_payment','requires_action','processing','declined','paid','expired','cancelled','refund_pending','refunded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  failure_code VARCHAR(100),
  manual BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (reservation_id,amount,currency) REFERENCES kanba_rel.reservations(id,total,currency) ON DELETE RESTRICT,
  UNIQUE (provider,environment,merchant_id,idempotency_key),
  UNIQUE (provider,environment,merchant_id,provider_intent_id),
  UNIQUE (provider,environment,merchant_id,provider_payment_id),
  UNIQUE (id,provider,environment,merchant_id),
  UNIQUE (id,reservation_id,currency),
  UNIQUE (id,reservation_id,amount,currency),
  CHECK (status NOT IN ('paid','refund_pending','refunded') OR paid_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS payments_reservation_idx ON kanba_rel.payments(reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_settled_per_reservation ON kanba_rel.payments(reservation_id) WHERE status IN ('paid','refund_pending','refunded');
COMMENT ON TABLE kanba_rel.payments IS 'Intentos/ordenes del procesador, importe y estado. Un cobro completo confirmado por reserva; no guarda datos de tarjeta ni tokens de cargo.';

CREATE TABLE IF NOT EXISTS kanba_rel.payment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id TEXT,
  provider VARCHAR(80) NOT NULL,
  environment VARCHAR(12) NOT NULL CHECK (environment IN ('sandbox','live')),
  merchant_id VARCHAR(255) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  provider_object_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  provider_created_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error_code VARCHAR(100),
  UNIQUE (provider,environment,merchant_id,provider_event_id),
  FOREIGN KEY (payment_id,provider,environment,merchant_id) REFERENCES kanba_rel.payments(id,provider,environment,merchant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS payment_events_pending_idx ON kanba_rel.payment_events(status,received_at);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON kanba_rel.payment_events(payment_id);
COMMENT ON TABLE kanba_rel.payment_events IS 'Deduplicacion de webhooks autenticados. Solo resumen permitido; nunca guardar cuerpo completo, firma secreta o datos bancarios.';

CREATE TABLE IF NOT EXISTS kanba_rel.receipts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  number VARCHAR(40) NOT NULL UNIQUE,
  reservation_id TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0 AND amount < 10000000000),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  issuer_name VARCHAR(160) NOT NULL,
  issuer_tax_id VARCHAR(60),
  issuer_address TEXT,
  tour_name VARCHAR(160) NOT NULL,
  local_date DATE NOT NULL,
  local_time TIME WITHOUT TIME ZONE NOT NULL,
  participants INTEGER NOT NULL CHECK (participants > 0),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (payment_id,reservation_id,amount,currency) REFERENCES kanba_rel.payments(id,reservation_id,amount,currency) ON DELETE RESTRICT,
  UNIQUE (id,reservation_id)
);
COMMENT ON TABLE kanba_rel.receipts IS 'Comprobante comercial del pago; conserva datos de emision. No supone integracion de factura fiscal. No borrar al cancelar.';

CREATE TABLE IF NOT EXISTS kanba_rel.cancellations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reservation_id TEXT NOT NULL UNIQUE,
  actor_user_id TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  actor_kind VARCHAR(20) NOT NULL CHECK (actor_kind IN ('customer','admin','system')),
  reason VARCHAR(300) NOT NULL,
  policy_label TEXT NOT NULL,
  refund_percent NUMERIC(5,2) NOT NULL CHECK (refund_percent BETWEEN 0 AND 100),
  original_total NUMERIC(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount >= 0 AND refund_amount < 10000000000),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (reservation_id,original_total,currency) REFERENCES kanba_rel.reservations(id,total,currency) ON DELETE RESTRICT,
  UNIQUE (id,reservation_id),
  CHECK (refund_amount <= original_total)
);
COMMENT ON TABLE kanba_rel.cancellations IS 'Motivo y politica aplicada al cancelar; cancelar no significa que el procesador ya haya devuelto dinero.';

CREATE TABLE IF NOT EXISTS kanba_rel.refunds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  payment_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  cancellation_id TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0 AND amount < 10000000000),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  percent NUMERIC(5,2) CHECK (percent BETWEEN 0 AND 100),
  method VARCHAR(30) NOT NULL DEFAULT 'original_provider' CHECK (method IN ('original_provider','manual_external')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','cancelled')),
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  provider_refund_id VARCHAR(255),
  reason VARCHAR(300) NOT NULL,
  requested_by TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_code VARCHAR(100),
  FOREIGN KEY (payment_id,reservation_id,currency) REFERENCES kanba_rel.payments(id,reservation_id,currency) ON DELETE RESTRICT,
  FOREIGN KEY (cancellation_id,reservation_id) REFERENCES kanba_rel.cancellations(id,reservation_id) ON DELETE RESTRICT,
  UNIQUE (payment_id,provider_refund_id),
  CHECK (status <> 'processed' OR processed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS refunds_payment_status_idx ON kanba_rel.refunds(payment_id,status);
CREATE INDEX IF NOT EXISTS refunds_reservation_idx ON kanba_rel.refunds(reservation_id);
CREATE INDEX IF NOT EXISTS refunds_cancellation_idx ON kanba_rel.refunds(cancellation_id);
CREATE INDEX IF NOT EXISTS refunds_pending_idx ON kanba_rel.refunds(status,requested_at);
COMMENT ON TABLE kanba_rel.refunds IS 'Devoluciones al procesador original: referencia e importe, sin datos de destino bancario. Limite agregado requiere transaccion de negocio.';

CREATE TABLE IF NOT EXISTS kanba_rel.reservation_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES kanba_rel.reservations(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservation_events_timeline_idx ON kanba_rel.reservation_events(reservation_id,created_at,id);
COMMENT ON TABLE kanba_rel.reservation_events IS 'Historial de creacion, pago, expiracion, cancelacion y devolucion; no incluir secretos en label.';

CREATE TABLE IF NOT EXISTS kanba_rel.email_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reservation_id TEXT NOT NULL REFERENCES kanba_rel.reservations(id) ON DELETE RESTRICT,
  receipt_id TEXT,
  dedupe_key VARCHAR(200) NOT NULL UNIQUE,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(300) NOT NULL,
  template VARCHAR(40) NOT NULL CHECK (template IN ('pending','confirmation','receipt','expired','cancellation','refund')),
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  provider VARCHAR(80) NOT NULL DEFAULT 'outbox',
  provider_message_id VARCHAR(255),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  claim_id UUID,
  lease_expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  permanent_failed BOOLEAN NOT NULL DEFAULT false,
  error_code VARCHAR(100),
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (receipt_id,reservation_id) REFERENCES kanba_rel.receipts(id,reservation_id) ON DELETE RESTRICT,
  CHECK (template <> 'receipt' OR receipt_id IS NOT NULL),
  CHECK (status <> 'sending' OR (claim_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS email_outbox_queue_idx ON kanba_rel.email_outbox(status,next_attempt_at,lease_expires_at) WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS email_outbox_reservation_idx ON kanba_rel.email_outbox(reservation_id);
COMMENT ON TABLE kanba_rel.email_outbox IS 'Cola durable de correos creada en la transaccion de negocio; envio despues del commit y reintentos con lease.';

CREATE TABLE IF NOT EXISTS kanba_rel.site_content (
  section VARCHAR(80) PRIMARY KEY,
  data JSONB NOT NULL,
  updated_by TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(data) IN ('object','array'))
);
COMMENT ON TABLE kanba_rel.site_content IS 'Contenido editorial por seccion: portada, contacto, galeria, videos, cafeteria. JSONB deliberado para estructura variable.';

CREATE TABLE IF NOT EXISTS kanba_rel.settings (
  section VARCHAR(40) PRIMARY KEY CHECK (section IN ('business','booking','payments','smtp')),
  data JSONB NOT NULL CHECK (jsonb_typeof(data)='object'),
  updated_by TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (data ?| ARRAY['secretKey','webhookSecret','pass','password','apiKey','secret']))
);
COMMENT ON TABLE kanba_rel.settings IS 'Configuracion no secreta; el backend debe aplicar whitelist tambien a claves anidadas. Credenciales en gestor de secretos.';

CREATE TABLE IF NOT EXISTS kanba_rel.media (
  name TEXT PRIMARY KEY,
  mime VARCHAR(100) NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','image/gif')),
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 8388608),
  data BYTEA NOT NULL,
  uploaded_by TEXT REFERENCES kanba_rel.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (octet_length(data)=size)
);
COMMENT ON TABLE kanba_rel.media IS 'Imagenes del administrador, como kanba_media actual. No comprobantes bancarios ni documentos de identidad.';

CREATE TABLE IF NOT EXISTS kanba_rel.rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON kanba_rel.rate_limits(window_start);
COMMENT ON TABLE kanba_rel.rate_limits IS 'Limitacion distribuida de intentos por accion/cuenta/IP; aplicar retencion corta.';

CREATE TABLE IF NOT EXISTS kanba_rel.counters (
  name VARCHAR(30) PRIMARY KEY CHECK (name IN ('reservation','receipt','cafeOrder','cafeMovement','cafeExpense')),
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0)
);
INSERT INTO kanba_rel.counters(name,value) VALUES ('reservation',0),('receipt',0),('cafeOrder',100),('cafeMovement',0),('cafeExpense',0)
ON CONFLICT (name) DO NOTHING;
COMMENT ON TABLE kanba_rel.counters IS 'Folios correlativos comerciales. Incrementar con UPDATE RETURNING, nunca SELECT + UPDATE separado; no reiniciar al migrar.';

-- Cafetería: Productos del menú
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_cafe_products (
  id TEXT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  unit VARCHAR(40) NOT NULL DEFAULT 'unidad',
  variants TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cafetería: Insumos de operación
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_cafe_supplies (
  id TEXT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Insumos',
  stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(10,2) NOT NULL DEFAULT 5,
  unit VARCHAR(40) NOT NULL DEFAULT 'unidad',
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cafetería: Kardex / Movimientos de inventario
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_cafe_inventory_movements (
  id TEXT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('product','supply')),
  item_id TEXT NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('in','out','adjustment','sale')),
  quantity NUMERIC(10,2) NOT NULL,
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  reference TEXT DEFAULT '',
  created_by TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cafetería: Ventas y comandas
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_cafe_sales (
  id TEXT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  receipt_number VARCHAR(40),
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) DEFAULT '',
  customer_phone VARCHAR(40) DEFAULT '',
  service_type VARCHAR(80) NOT NULL DEFAULT 'En mesa · Cafetería',
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card','transfer','other')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','cancelled')),
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cafetería: Gastos operativos
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_cafe_expenses (
  id TEXT PRIMARY KEY,
  concept VARCHAR(200) NOT NULL,
  category VARCHAR(40) NOT NULL CHECK (category IN ('insumos','servicios','mantenimiento','personal','otros')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at es responsabilidad del motor para las tablas que lo incluyen.
CREATE OR REPLACE FUNCTION kanba_rel.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','tours','departures','reservations','payments','site_content','settings','kanba_cafe_products','kanba_cafe_supplies'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON kanba_rel.%I', table_name);
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON kanba_rel.%I FOR EACH ROW EXECUTE FUNCTION kanba_rel.touch_updated_at()', table_name);
  END LOOP;
END;
$$;

-- No se crean usuarios/roles de PostgreSQL ni GRANT a PUBLIC.
-- Conceder solo al backend permisos necesarios; nunca exponer DATABASE_URL al navegador.
COMMIT;
