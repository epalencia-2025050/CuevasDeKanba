import fs from 'node:fs/promises';
import { createDatabase } from '../server/db.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { safeErrorMessage } from '../server/safe-errors.js';

// Explicit maintenance; never called at startup. INSERT refuses existing data.
const args = process.argv.slice(2);
const empty = args.includes('--initialize-empty');
const importAt = args.indexOf('--import-json');
const schemaOnly = args.includes('--schema-only');
let database;
try {
  if ([empty, importAt >= 0, schemaOnly].filter(Boolean).length !== 1) {
    throw new Error('Use exactly one: --initialize-empty, --import-json FILE or --schema-only.');
  }
  const config = createConfig(process.env);
  database = createDatabase(config);
  let document;
  if (empty) document = withRuntime({ config }, createInitialStore);
  if (importAt >= 0) {
    document = JSON.parse(await fs.readFile(args[importAt + 1], 'utf8'));
    if (!document.meta || !document.settings || !document.admin?.password || !Array.isArray(document.reservations) || !Array.isArray(document.tours)) {
      throw new Error('Invalid import document.');
    }
    // Preserve users, password hashes, reservations and history; revoke old sessions.
    document.sessions = {};
    document.userSessions = {};
  }
  await database.initialize(document);
  console.log(schemaOnly ? 'Schema updated; existing records preserved.' : 'Operational store initialized.');
} catch (error) {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
} finally { await database?.close(); }
