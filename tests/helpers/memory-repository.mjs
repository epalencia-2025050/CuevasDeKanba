// Test double only: production has no memory/file persistence fallback.
export function memoryRepository(initial, onCommit = () => {}) {
  let document = structuredClone(initial), tail = Promise.resolve();
  const buckets = new Map(), oauth = new Map(), files = new Map();
  return {
    failCommit: false,
    snapshot: () => structuredClone(document),
    async transaction(work) {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      const pendingFiles = new Map(files);
      try {
        const unit = { document: structuredClone(document), dirty: false,
          async saveUpload(name, mime, data) { pendingFiles.set(name, { mime, data }); },
          async deleteUpload(name) { pendingFiles.delete(name); files.delete(name); } };
        const result = await work(unit);
        if (this.failCommit) throw new Error('Synthetic commit failure');
        if (unit.dirty) { document = structuredClone(unit.document); await onCommit(document); }
        for (const [key, value] of pendingFiles) files.set(key, value);
        return result;
      } finally { release(); }
    },
    async rateLimit(key, windowMs) {
      let entry = buckets.get(key);
      if (!entry || Date.now() - entry.start >= windowMs) entry = { count: 0, start: Date.now() };
      entry.count++; buckets.set(key, entry); return entry.count;
    },
    async putOAuth(state, next, expiresAt, browserHash) { oauth.set(state, { next, expiresAt, browserHash }); },
    async takeOAuth(state, browserHash) {
      const entry = oauth.get(state);
      if (!entry || entry.browserHash !== browserHash || entry.expiresAt <= Date.now()) return null;
      oauth.delete(state); return entry;
    },
    async readUpload(name) { return files.get(name) || null; },
    async deleteUpload(name) { files.delete(name); },
    async cleanup() {}, async close() {}, async health() {}
  };
}
