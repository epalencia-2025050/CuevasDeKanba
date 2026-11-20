import postgres from 'postgres';
import { serializeStore } from './runtime-secrets.js';
import { validateStore } from './data-errors.js';

// The only runtime SQL module. No Cloudflare imports or environment globals.
export function createDatabase(config, { connectionString = config.DATABASE_URL, managedTransport = false, connectionSource = 'database_url' } = {}) {
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
  return createRepository(sql, config.DB_SCHEMA, controlSql, connectionSource);
}

export function createRepository(sql, schema = 'public', controlSql = sql, connectionSource = 'database_url') {
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
    }
  });
  return {
    ...media(sql),
    // TEMPORARY: protected route only; no writes, locks or document logging.
    async diagnoseStore() {
      const [row] = await sql`SELECT doc, jsonb_typeof(doc) = 'object' AS sql_doc_is_object
        FROM ${table('kanba_store')} WHERE id=1`;
      const doc = row?.doc;
      const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      return {
        connectionSource,
        schemaMatchesExpected: schema === 'kanba_rel',
        rowFound: Boolean(row),
        sqlDocIsObject: row?.sql_doc_is_object === true,
        jsDocType: doc === null ? 'null' : Array.isArray(doc) ? 'array' : typeof doc,
        usersIsArray: Array.isArray(doc?.users),
        metaIsObject: object(doc?.meta),
        sessionsIsObject: object(doc?.sessions),
        userSessionsIsObject: object(doc?.userSessions),
        invalidUserCount: Array.isArray(doc?.users)
          ? doc.users.filter(user => !object(user) || typeof user.email !== 'string').length : 0,
        validationStage: 'read'
      };
    },
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
        if (document) await tx`INSERT INTO ${table('kanba_store')} (id,doc) VALUES (1,${tx.json(JSON.parse(serializeStore(document)))}::jsonb)`;
      });
    },
    async close() { await Promise.all([sql.end({ timeout: 5 }), ...(controlSql !== sql ? [controlSql.end({ timeout: 5 })] : [])]); }
  };
}
