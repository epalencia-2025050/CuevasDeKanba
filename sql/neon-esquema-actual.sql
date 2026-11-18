-- Compatibilidad con server/db.js ACTUAL. No es el modelo relacional objetivo.
-- Usa DB_SCHEMA=kanba. Si ya utilizas otro esquema, conserva ese nombre.
-- No borra ni sobrescribe datos y no crea el documento inicial del negocio.
BEGIN;
CREATE SCHEMA IF NOT EXISTS kanba;
CREATE TABLE IF NOT EXISTS kanba.kanba_store (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  doc JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kanba.kanba_media (
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kanba.kanba_rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kanba.kanba_oauth_states (
  state TEXT PRIMARY KEY,
  next TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  browser_hash TEXT NOT NULL
);
COMMIT;
-- En una base nueva, despues de configurar .env con DATABASE_URL y DB_SCHEMA=kanba:
-- npm run db:init -- --initialize-empty
-- No insertar un doc vacio '{}' ni credenciales de demostracion desde SQL.
-- En una base ya inicializada, no repetir initialize-empty.
