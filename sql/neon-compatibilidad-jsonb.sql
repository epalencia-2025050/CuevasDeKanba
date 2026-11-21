-- Puente para el backend JSONB actual; NO migra el modelo relacional.
-- No modifica users, sessions, tours, reservations ni otras tablas existentes.
-- Usuarios/catalogo/reservas del modelo relacional NO seran visibles en este store.
-- Administrador deshabilitado (password null), sin credenciales predeterminadas.
-- Rotacion explicita posterior: scripts/rotate-admin.mjs --rotate-admin.
-- No habilita pagos reales. Revisar datos comerciales antes de operar.
BEGIN;
CREATE SCHEMA IF NOT EXISTS kanba_rel;

CREATE TABLE IF NOT EXISTS kanba_rel.kanba_store (
  id smallint PRIMARY KEY CHECK (id = 1),
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_oauth_states (
  state text PRIMARY KEY,
  next text NOT NULL,
  expires_at timestamptz NOT NULL,
  browser_hash text NOT NULL
);
-- Tambien requerida por server/db.js para archivos subidos.
CREATE TABLE IF NOT EXISTS kanba_rel.kanba_media (
  name text PRIMARY KEY,
  mime text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO kanba_rel.kanba_store (id, doc)
VALUES (1, jsonb_build_object(
  'meta', jsonb_build_object('version', 1, 'createdAt', now(), 'updatedAt', now()),
  'admin', jsonb_build_object('password', NULL, 'passwordPolicyVersion', 2, 'updatedAt', now()),
  'users', '[]'::jsonb,
  'sessions', '{}'::jsonb,
  'userSessions', '{}'::jsonb,
  'counters', '{"reservation":0,"receipt":0}'::jsonb,
  'content', '{"brand":{},"hero":{},"intro":{},"contact":{}}'::jsonb,
  'tours', '[]'::jsonb,
  'reservations', '[]'::jsonb,
  'closures', '[]'::jsonb,
  'refunds', '[]'::jsonb,
  'emails', '[]'::jsonb,
  'settings', '{"business":{},"booking":{},"payments":{},"smtp":{}}'::jsonb
))
ON CONFLICT (id) DO NOTHING;
COMMIT;
