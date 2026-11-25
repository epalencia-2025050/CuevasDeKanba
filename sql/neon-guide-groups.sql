-- ============================================================================
-- K'anba: Tabla dedicada para reservas y registros de Guías con Grupo
-- Compatible con PostgreSQL 14+ y Neon Serverless PostgreSQL
-- Idempotente: CREATE TABLE IF NOT EXISTS e índices seguros
-- ============================================================================
--
-- INSTRUCCIONES PARA APLICAR EN NEON:
-- 1. Inicia sesión en la consola de Neon (https://console.neon.tech).
-- 2. Selecciona tu proyecto y rama activa (por ejemplo, 'main' o 'production').
-- 3. Abre el "SQL Editor" en el menú de navegación lateral.
-- 4. Pega el contenido completo de este archivo y haz clic en "Run" (o presiona Ctrl+Enter).
-- 5. Verifica que la salida confirme: "CREATE TABLE" y "CREATE INDEX".
--
-- Nota: Si el esquema utilizado es distinto a 'public', puedes prefijar el nombre
-- de la tabla o asegurarte de que search_path esté configurado correctamente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS kanba_guide_group_bookings (
  id text PRIMARY KEY,
  reservation_code text NOT NULL UNIQUE,
  tour_id text NOT NULL,
  tour_name text NOT NULL,
  date date NOT NULL,
  time text NOT NULL,
  tourists_count integer NOT NULL CHECK (tourists_count > 0),
  guide_name text NOT NULL,
  guide_email text NOT NULL,
  guide_phone text DEFAULT '',
  agency_name text DEFAULT '',
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Índices de alto rendimiento para validación de cupos, horarios y búsquedas administrativas
CREATE INDEX IF NOT EXISTS idx_guide_group_bookings_slot
  ON kanba_guide_group_bookings (tour_id, date, time, status);

CREATE INDEX IF NOT EXISTS idx_guide_group_bookings_code
  ON kanba_guide_group_bookings (reservation_code);

CREATE INDEX IF NOT EXISTS idx_guide_group_bookings_agency
  ON kanba_guide_group_bookings (lower(agency_name));

CREATE INDEX IF NOT EXISTS idx_guide_group_bookings_date
  ON kanba_guide_group_bookings (date, time);

COMMENT ON TABLE kanba_guide_group_bookings IS 'Registro dedicado de reservas de tours realizadas por guías con grupo de turistas a su cargo.';
COMMENT ON COLUMN kanba_guide_group_bookings.tourists_count IS 'Cantidad de turistas asignados al horario por el guía (descontados de la capacidad del tour).';
COMMENT ON COLUMN kanba_guide_group_bookings.agency_name IS 'Nombre de la agencia de viajes, touroperador o acreditación del guía independiente.';
COMMENT ON COLUMN kanba_guide_group_bookings.status IS 'Estado operativo del cupo del grupo: pending_payment (bloqueo 20m), confirmed, cancelled o expired.';

COMMIT;
