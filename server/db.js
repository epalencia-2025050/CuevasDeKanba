import postgres from 'postgres';
import { serializeStore } from './runtime-secrets.js';
import { validateStore } from './data-errors.js';

// The only runtime SQL module. No Cloudflare imports or environment globals.
export function createDatabase(config, { connectionString = config.DATABASE_URL, managedTransport = false } = {}) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL URL required.');
  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode' && value === 'verify-full') continue;
    throw new Error('Connection URL options are not supported; configure TLS explicitly.');
  }
  url.search = '';
  const options = {
    max: 2, prepare: true, idle_timeout: 20, connect_timeout: 15,
    // Hyperdrive owns the TLS connection to the origin. Direct connections verify TLS.
    ssl: managedTransport ? false : {
      rejectUnauthorized: true, minVersion: 'TLSv1.2',
      ...(config.PG_TLS_CA ? { ca: config.PG_TLS_CA } : {}),
      ...(config.PG_TLS_SERVERNAME ? { servername: config.PG_TLS_SERVERNAME } : {})
    },
    onnotice: () => {}
  };
  const sql = postgres(url.toString(), options);
  // Independent counters/OAuth must commit even when the business transaction rolls back.
  // A separate pool prevents starvation when transactions hold all business connections.
  const controlSql = postgres(url.toString(), { ...options, max: 1 });
  return createRepository(sql, config.DB_SCHEMA, controlSql);
}

export function createRepository(sql, schema = 'public', controlSql = sql) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid DB_SCHEMA.');
  const table = name => sql(`${schema}.${name}`);
  const media = client => ({
    async saveUpload(name, mime, data) {
      await client`INSERT INTO ${table('kanba_media')} (name,mime,size,data) VALUES (${name},${mime},${data.length},${data})
        ON CONFLICT(name) DO UPDATE SET mime=EXCLUDED.mime,size=EXCLUDED.size,data=EXCLUDED.data`;
    },
    async readUpload(name) {
      const [row] = await client`SELECT mime,data FROM ${table('kanba_media')} WHERE name=${name}`;
      return row || null;
    },
    async deleteUpload(name) {
      await client`DELETE FROM ${table('kanba_media')} WHERE name=${name}`;
    }
  });
  return {
    ...media(sql),
    async transaction(work) {
      return sql.begin(async tx => {
        await tx`SET LOCAL lock_timeout = '10s'`;
        const [row] = await tx`SELECT doc FROM ${table('kanba_store')} WHERE id=1 FOR UPDATE`;
        validateStore(row?.doc);
        const unit = { document: row.doc, dirty: false, ...media(tx) };
        const result = await work(unit);
        if (unit.dirty) {
          validateStore(unit.document);
          await tx`UPDATE ${table('kanba_store')} SET doc=${tx.json(JSON.parse(serializeStore(unit.document)))}::jsonb,updated_at=now() WHERE id=1`;
        }
        return result;
      });
    },
    async rateLimit(key, windowMs) {
      const [row] = await controlSql`INSERT INTO ${table('kanba_rate_limits')} AS limits (key,window_start,count)
        VALUES (${key},now(),1) ON CONFLICT(key) DO UPDATE SET
        window_start=CASE WHEN limits.window_start <= now()-(${windowMs}::int * interval '1 millisecond') THEN now() ELSE limits.window_start END,
        count=CASE WHEN limits.window_start <= now()-(${windowMs}::int * interval '1 millisecond') THEN 1 ELSE limits.count+1 END RETURNING count`;
      return row.count;
    },
    async putOAuth(state, next, expiresAt, browserHash) {
      await controlSql`INSERT INTO ${table('kanba_oauth_states')} (state,next,expires_at,browser_hash)
        VALUES (${state},${next},${new Date(expiresAt)},${browserHash})`;
    },
    async takeOAuth(state, browserHash) {
      const [row] = await controlSql`DELETE FROM ${table('kanba_oauth_states')}
        WHERE state=${state} AND browser_hash=${browserHash} AND expires_at>now() RETURNING next,expires_at`;
      return row ? { next: row.next, expiresAt: new Date(row.expires_at).getTime() } : null;
    },
    async cleanup() {
      await sql`DELETE FROM ${table('kanba_oauth_states')} WHERE expires_at<now()`;
      await sql`DELETE FROM ${table('kanba_rate_limits')} WHERE window_start<now()-interval '2 days'`;
    },
    async health() { await sql`SELECT 1`; },
    async initialize(document) {
      if (document !== undefined) validateStore(document);
      await sql.begin(async tx => {
        await tx`CREATE SCHEMA IF NOT EXISTS ${sql(schema)}`;
        await tx`CREATE TABLE IF NOT EXISTS ${table('kanba_store')} (id smallint PRIMARY KEY CHECK(id=1),doc jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`;
        await tx`CREATE TABLE IF NOT EXISTS ${table('kanba_media')} (name text PRIMARY KEY,mime text NOT NULL,size integer NOT NULL,data bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`;
        await tx`CREATE TABLE IF NOT EXISTS ${table('kanba_rate_limits')} (key text PRIMARY KEY,window_start timestamptz NOT NULL,count integer NOT NULL)`;
        await tx`CREATE TABLE IF NOT EXISTS ${table('kanba_oauth_states')} (state text PRIMARY KEY,next text NOT NULL,expires_at timestamptz NOT NULL,browser_hash text NOT NULL)`;
        await tx`CREATE TABLE IF NOT EXISTS ${table('kanba_guide_group_bookings')} (
          id text PRIMARY KEY,
          reservation_code text NOT NULL UNIQUE,
          tour_id text NOT NULL,
          tour_name text NOT NULL,
          date date NOT NULL,
          time text NOT NULL,
          tourists_count integer NOT NULL CHECK(tourists_count > 0),
          guide_name text NOT NULL,
          guide_email text NOT NULL,
          guide_phone text DEFAULT '',
          agency_name text DEFAULT '',
          status text NOT NULL CHECK(status IN ('pending_payment', 'confirmed', 'cancelled', 'expired')),
          hold_expires_at timestamptz,
          notes text DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS idx_guide_groups_slot ON ${table('kanba_guide_group_bookings')} (tour_id, date, time, status)`;
        await tx`CREATE INDEX IF NOT EXISTS idx_guide_groups_code ON ${table('kanba_guide_group_bookings')} (reservation_code)`;
        await tx`CREATE INDEX IF NOT EXISTS idx_guide_groups_agency ON ${table('kanba_guide_group_bookings')} (lower(agency_name))`;
        if (document) await tx`INSERT INTO ${table('kanba_store')} (id,doc) VALUES (1,${tx.json(JSON.parse(serializeStore(document)))}::jsonb)`;
      });
    },
    async saveGuideGroupBooking(booking) {
      await sql`INSERT INTO ${table('kanba_guide_group_bookings')} (
        id, reservation_code, tour_id, tour_name, date, time, tourists_count,
        guide_name, guide_email, guide_phone, agency_name, status, hold_expires_at, notes, created_at, updated_at
      ) VALUES (
        ${booking.id}, ${booking.reservationCode}, ${booking.tourId}, ${booking.tourName},
        ${booking.date}, ${booking.time}, ${booking.touristsCount}, ${booking.guideName},
        ${booking.guideEmail}, ${booking.guidePhone || ''}, ${booking.agencyName || ''},
        ${booking.status}, ${booking.holdExpiresAt ? new Date(booking.holdExpiresAt) : null},
        ${booking.notes || ''}, ${booking.createdAt ? new Date(booking.createdAt) : new Date()},
        ${booking.updatedAt ? new Date(booking.updatedAt) : new Date()}
      ) ON CONFLICT (reservation_code) DO UPDATE SET
        status = EXCLUDED.status,
        tourists_count = EXCLUDED.tourists_count,
        agency_name = EXCLUDED.agency_name,
        notes = EXCLUDED.notes,
        updated_at = now()`;
    },
    async listGuideGroupBookings({ date, tourId, status } = {}) {
      return sql`SELECT * FROM ${table('kanba_guide_group_bookings')}
        WHERE (${date || null}::date IS NULL OR date = ${date})
          AND (${tourId || null}::text IS NULL OR tour_id = ${tourId})
          AND (${status || null}::text IS NULL OR status = ${status})
        ORDER BY date ASC, time ASC`;
    },
    async close() { await Promise.all([sql.end({ timeout: 5 }), ...(controlSql !== sql ? [controlSql.end({ timeout: 5 })] : [])]); }
  };
}
