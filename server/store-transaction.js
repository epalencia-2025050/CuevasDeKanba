import { AsyncLocalStorage } from 'node:async_hooks';

// Serialize work in one process and lock the authoritative row across processes.
// Responses and side effects must only be released after run() resolves.
export class StoreTransaction {
  constructor({ pool = null, read, replace, serialize, persistLocal }) {
    Object.assign(this, { pool, read, replace, serialize, persistLocal });
    this.context = new AsyncLocalStorage();
    this.tail = Promise.resolve();
  }
  markDirty() {
    const current = this.context.getStore();
    if (!current) throw new Error('Store mutation requires a transaction.');
    current.dirty = true;
  }
  async run(work) {
    if (this.context.getStore()) return work();
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    let client, before, brokenConnection;
    try {
      before = structuredClone(this.read());
      if (this.pool) {
        client = await this.pool.connect();
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        const { rows } = await client.query('SELECT doc FROM kanba_store WHERE id = 1 FOR UPDATE');
        if (!rows.length) throw new Error('Store not initialized.');
        this.replace(rows[0].doc);
        before = structuredClone(this.read());
      }
      const transaction = { dirty: false };
      const result = await this.context.run(transaction, work);
      if (transaction.dirty) {
        const snapshot = this.serialize(this.read());
        if (client) await client.query('UPDATE kanba_store SET doc = $1::jsonb, updated_at = now() WHERE id = 1', [snapshot]);
        else await this.persistLocal(snapshot);
      }
      if (client) await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) try { await client.query('ROLLBACK'); } catch (rollbackError) { brokenConnection = rollbackError; }
      if (before) this.replace(before);
      throw error;
    } finally {
      client?.release(brokenConnection);
      release();
    }
  }
  async drain() { await this.tail; }
}

export function bufferedResponse() {
  const headers = new Map();
  let status = 200, body;
  return {
    headersSent: false,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    writeHead(code, values = {}) { status = code; for (const [key, value] of Object.entries(values)) this.setHeader(key, value); },
    end(value = '') { body = value; },
    publish(response) {
      if (body === undefined) throw new Error('Missing API response.');
      for (const [key, value] of headers) response.setHeader(key, value);
      response.writeHead(status);
      response.end(body);
    }
  };
}
