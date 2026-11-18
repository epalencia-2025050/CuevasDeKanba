import { createConfig, withRuntime } from '../server/runtime.js';
import { createDatabase } from '../server/db.js';
import { withStoreTransaction, getDb, saveDb } from '../server/store.js';
import { hashPassword } from '../server/security.js';
import { safeErrorMessage } from '../server/safe-errors.js';

let database;
try {
  if (!process.argv.includes('--rotate-admin')) throw new Error('Explicit --rotate-admin required.');
  const config = createConfig(process.env);
  if (config.ADMIN_PASSWORD.length < 12 || config.ADMIN_PASSWORD.length > 256) throw new Error('Invalid password length.');
  database = createDatabase(config);
  await withRuntime({ config, database }, () => withStoreTransaction(() => {
    const d = getDb();
    d.admin.password = hashPassword(config.ADMIN_PASSWORD);
    d.admin.updatedAt = new Date().toISOString();
    d.admin.passwordPolicyVersion = 2;
    d.sessions = {};
    saveDb();
  }));
  console.log('Administrative credential rotated and admin sessions revoked.');
} catch (error) { console.error(safeErrorMessage(error)); process.exitCode = 1; }
finally { await database?.close(); }
