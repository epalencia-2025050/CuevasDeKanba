# Compatibilidad temporal con el backend actual

El backend de `plebes` consulta `kanba_store`, `kanba_rate_limits`,
`kanba_oauth_states` y `kanba_media` mediante `server/db.js`. El esquema
`sql/neon-modelo-relacional.sql` no es una migración del repositorio de datos.
Las referencias locales y remotas disponibles y el historial revisado no
contienen una implementación relacional alternativa. No se hizo fetch remoto.

## Aplicación

Ejecutar completo `sql/neon-compatibilidad-jsonb.sql` en el SQL Editor de Neon,
en la base de datos usada por el Worker. Crea cuatro tablas adicionales en una
transacción; no modifica tablas relacionales. Repetirlo conserva el documento
existente mediante `ON CONFLICT (id) DO NOTHING`. Si ya hay tablas de
compatibilidad con una estructura diferente, `IF NOT EXISTS` no las corrige.
El rol del Worker necesita acceso al esquema y operaciones sobre las tablas;
el script no cambia propietarios ni concede permisos indiscriminadamente.

`wrangler.toml` queda con `DB_SCHEMA=kanba_rel` y el origen HTTPS workers.dev
solicitado. Desplegar posteriormente con el procedimiento habitual. No se
modificaron secrets. La URI PostgreSQL debe seguir cumpliendo las restricciones
de `server/db.js`; este parche no corrige otros fallos de conexión.

## Alcance y límites

- El nuevo documento tiene usuarios, sesiones, tours y operaciones vacíos.
  Incluye contenido de presentación predeterminado y configuración estructural,
  pero los datos comerciales deben revisarse antes de operar.
- Los usuarios y reservas de las tablas relacionales se conservan, pero el
  backend NO los lee ni sincroniza. Las credenciales existentes únicamente en
  `users` no funcionarán con este parche. No es una migración de esos datos.
- `admin.passwordPolicyVersion=2` permite pasar la comprobación global del
  backend. `admin.password=null` hace que la verificación administrativa falle
  de forma segura. No hay contraseña conocida, hash inventado ni secret incluido.
  Para habilitar al administrador se requiere la rotación explícita existente
  (`scripts/rotate-admin.mjs --rotate-admin`) con configuración segura; no se
  ejecutó como parte de este cambio.
- El catálogo permanece vacío para no ofrecer tours con disponibilidad que
  ignore las reservas relacionales. Los pagos reales siguen bloqueados.
- No ejecutar `db:init --initialize-empty` encima de este documento.

## Migración relacional definitiva

Requiere sustituir la unidad de trabajo JSONB de `server/db.js` y las mutaciones
de `server/store.js`, `server/routes.js` y `server/mailer.js` por repositorios
relacionales. También deben adaptarse `server/index.js` (comprobación de admin
y transacciones), mantenimiento, inicialización, rotación administrativa y
pruebas. Deben preservarse contraseñas, asociaciones OAuth, reservas, importes,
idempotencia y capacidad; cambiar solo auth dejaría dos fuentes de datos.

## Validación realizada

SQL ejecutado localmente con PGlite sobre el esquema relacional y un usuario
sintético: repetición idempotente, conservación del usuario y de cambios
posteriores al documento. El documento SQL se probó con Hono y el repositorio
de pruebas: registro, login, sesión autenticada, consulta anónima, redirección
inicial Google y rechazo administrativo sin contraseña. Esto no sustituye una
prueba de conexión real Worker-Neon ni el intercambio completo con Google.
