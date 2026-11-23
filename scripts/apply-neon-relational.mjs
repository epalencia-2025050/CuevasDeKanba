import fs from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[error] DATABASE_URL no está definida en el entorno ni en .env');
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

try {
  console.log('[migración] Leyendo sql/neon-modelo-relacional.sql...');
  const script = await fs.readFile(new URL('../sql/neon-modelo-relacional.sql', import.meta.url), 'utf8');

  console.log('[migración] Ejecutando DDL idempotente en Neon (esquema kanba_rel)...');
  await sql.unsafe(script);
  console.log('[migración] DDL ejecutado exitosamente.');

  console.log('[verificación] Consultando tablas de cafetería creadas en kanba_rel...');
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'kanba_rel' AND table_name LIKE 'kanba_cafe_%'
    ORDER BY table_name;
  `;

  console.log(`[resultado] Tablas encontradas (${tables.length}):`);
  for (const row of tables) {
    console.log(`  ✓ ${row.table_name}`);
  }

  if (tables.length === 5) {
    console.log('\n[éxito] Las 5 tablas de cafetería existen y están listas en Neon.');
  } else {
    console.warn(`\n[aviso] Se esperaban 5 tablas pero se encontraron ${tables.length}.`);
  }
} catch (error) {
  console.error('[error] Falló la ejecución de la migración:', error.message || error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
