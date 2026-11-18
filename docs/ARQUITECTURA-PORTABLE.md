# Hono + PostgreSQL: Workers y Node.js

Fecha: 18 de noviembre de 2026.

## Alcance y estructura

Se sustituyó el servidor HTTP nativo de Node por una aplicación Hono común. El proyecto original no utilizaba Express. No se introduce D1: PostgreSQL es la base tanto en Cloudflare como en infraestructura privada.

```text
server/
  index.js             createApp(services): middleware y rutas Hono; sin listen()
  routes.js            contratos HTTP y lógica de las rutas existentes
  store.js             reservas, sesiones, usuarios y proyecciones del dominio
  db.js                repositorio SQL exclusivo con Postgres.js
  runtime.js           configuración explícita y contexto por petición
  worker.js            entrada Workers: fetch/scheduled, ASSETS e Hyperdrive
  node.js              entrada Node: @hono/node-server, disco estático y señales
  mailer.js            plantillas y outbox transaccional compartidos
  mail-transport.js    transporte HTTPS portable, inyectado
  smtp.js              transporte SMTP utilizado solo por el adaptador Node
  security.js          hashes scrypt existentes y tokens
  payment-policy.js    bloqueo de pagos no validados, sin cambios de alcance
scripts/
  initialize-database.mjs   esquema / inicialización / importación explícitos
  rotate-admin.mjs          rotación administrativa explícita
wrangler.toml          configuración Workers sin credenciales
.env.example           variables Node / mantenimiento
.dev.vars.example      variables de desarrollo Workers
```

Las rutas no ejecutan SQL ni importan bindings de Cloudflare. Los adaptadores construyen `services` con `config`, `database`, `assets`, `network`, `fetch`, `sendMail` y `mailConfigured`. `AsyncLocalStorage` delimita las dependencias y el estado transaccional por petición; no se escribe en `process.env` ni se mantiene un documento mutable global. `process.env` se lee en el arranque Node y en comandos de mantenimiento; Workers recibe sus bindings y los transforma en el mismo contrato.

La aplicación Hono conserva el despachador de rutas de negocio mediante un adaptador pequeño de Request/Response. No emula un servidor HTTP Node dentro de Workers: se reciben Web Requests y se devuelven Web Responses. La respuesta, incluidas cookies, solo se publica después del commit.

Se usa `nodejs_compat` para criptografía y contexto asíncrono en Workers. Postgres.js utiliza PostgreSQL sobre TCP; no convierte cualquier PostgreSQL en una API Fetch. Su distribución para Workers usa sockets de Cloudflare internamente; esa dependencia queda dentro del controlador y del adaptador de despliegue, fuera del dominio. [Postgres.js](https://github.com/porsager/postgres), [compatibilidad crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

## Persistencia y concurrencia

Se conserva el documento de negocio en `kanba_store.doc` (JSONB), evitando transformar simultáneamente todo el modelo de reservas. El almacenamiento operativo ya no lee ni escribe `data/db.json`.

- `kanba_store`: estado de negocio; `SELECT ... FOR UPDATE` dentro de `sql.begin()` y escritura antes del commit.
- `kanba_media`: imágenes subidas, almacenadas como `bytea`.
- `kanba_rate_limits`: contadores compartidos entre instancias.
- `kanba_oauth_states`: state de Google con expiración y vínculo al navegador.

Las consultas están parametrizadas y los nombres de esquema se validan. Se emplean pools separados para negocio (máximo dos conexiones) y contadores/OAuth (una conexión), para que un contador no espere una conexión ocupada por su propia transacción. Los contadores y el consumo de state se confirman independientemente del éxito del login. Node mantiene los pools; Workers crea los clientes dentro del evento y los cierra con `waitUntil`.

El bloqueo de un único documento conserva la consistencia, pero serializa operaciones y limita escalabilidad. Google y la prueba administrativa de correo todavía pueden mantener una transacción abierta durante llamadas externas, con tiempos de espera acotados. La separación en repositorio permite una futura normalización de tablas sin cambiar los contratos del frontend, pero no se declara resuelto el escalado de alto volumen. Medir carga antes de operar.

`server/migrations.js`, `server/store-transaction.js` y utilidades antiguas se conservan como antecedentes/pruebas y no forman parte del grafo de ejecución de Workers ni Node. No ejecutar la migración relacional antigua como sustituto de la inicialización descrita aquí.

## Configuración común

| Variable | Uso |
| --- | --- |
| `NODE_ENV` | `production` por defecto; `development`/`test` permiten sandbox |
| `PUBLIC_URL` | Origen público canónico; HTTPS obligatorio en producción |
| `DATABASE_URL` | PostgreSQL directo en Node o Workers sin Hyperdrive |
| `DB_SCHEMA` | Esquema; ejemplo: `kanba` |
| `PG_TLS_CA`, `PG_TLS_SERVERNAME` | CA PEM / identidad opcional para conexión directa desde Node |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth; nunca se retornan al frontend |
| `GOOGLE_REDIRECT_URI` | Opcional; debe coincidir con `PUBLIC_URL + /api/auth/google/callback` |
| `PAYMENTS_SECRET_KEY`, `PAYMENTS_WEBHOOK_SECRET` | Secretos existentes; no habilitan cobros reales |
| `ADMIN_PASSWORD` | Inicialización o rotación explícita; no cambia contraseñas al arrancar |
| `TRUSTED_PROXY_CIDRS` | Solo Node: proxies inmediatos autorizados a aportar cabeceras |
| `MAIL_API_URL`, `MAIL_API_TOKEN` | Pasarela corporativa de correo HTTPS, disponible en ambos entornos |
| `SMTP_*` | Alternativa de transporte solo para Node; ver `.env.example` |
| `ADMIN_SESSION_IDLE_MS`, `USER_SESSION_IDLE_MS` | Plazos de inactividad, conservando valores predeterminados |

No se acepta `sslmode=disable`, `require`, `prefer` ni opciones arbitrarias en la URL directa. TLS verifica certificados. En Workers directo, el controlador depende del almacén de confianza del runtime: requiere certificado público para el hostname de la base; la configuración rechaza CA/identidad personalizadas que el controlador no aplica allí. En Node sí se admite CA privada mediante `PG_TLS_CA`.

`PGSSLMODE`, `PG_TLS_CA_FILE`, `DATA_DIR`, `UPLOADS_DIR` y `FORCE_ADMIN_PASSWORD` dejan de controlar esta arquitectura. Actualizar los secretos/configuración antiguos; no desactivar la validación TLS para resolver un fallo.

## Preparar PostgreSQL sin tocar producción automáticamente

1. Crear una base de pruebas y un usuario de mantenimiento con permisos para crear el esquema. Obtener un respaldo verificado antes de importar datos existentes.
2. Copiar `.env.example` a `.env` y completar valores locales. Para desarrollo, usar `NODE_ENV=development` y `PUBLIC_URL=http://localhost:3000`.
3. Instalar con `npm ci`.
4. Elegir **una** operación:

```sh
# Base nueva: contenido/tours iniciales, sin clientes ni reservas de demostración.
npm run db:init -- --initialize-empty

# Base PostgreSQL existente con kanba_store: agrega las tablas auxiliares faltantes.
npm run db:init -- --schema-only

# Importación única desde archivo, exclusivamente a una base aún sin estado.
npm run db:init -- --import-json /ruta/segura/db.json
```

La inicialización no sobrescribe un documento existente: la clave primaria provoca rollback. La importación conserva usuarios, hashes, reservas e historial; revoca sesiones anteriores y elimina secretos de settings al serializar. No importa medios del disco: si existían en `public/uploads`, copiarlos de forma controlada a `kanba_media` y validar sus URLs antes del cambio. Los medios que ya estén en PostgreSQL permanecen allí.

El arranque no crea tablas ni ejecuta importaciones. `--schema-only` es necesario antes de usar Google con una base anterior sin `kanba_oauth_states`. Tras preparar la base, usar credenciales de ejecución restringidas al esquema; mantener las de mantenimiento fuera del servicio.

Para rotación administrativa, definir temporalmente `ADMIN_PASSWORD` y ejecutar:

```sh
npm run db:rotate-admin -- --rotate-admin
```

Se actualiza el hash y se revocan sesiones administrativas, sin borrar usuarios o reservas. Retirar la contraseña en claro del entorno de mantenimiento después de custodiarla.

## Ejecutar en Node.js privado

```sh
npm ci
npm run start:local
# Con variables inyectadas por systemd/contenedor/gestor corporativo:
npm start
```

Entrada: `server/node.js`, puerto `PORT` (3000 por defecto), dirección `HOST` (127.0.0.1 por defecto). Configurar `HOST=0.0.0.0` si el contenedor/plataforma lo requiere. Terminar HTTPS en un proxy administrado y configurar exclusivamente sus CIDR reales. No confiar por defecto en `X-Forwarded-*` enviados desde Internet.

Node sirve `public/` mediante su adaptador, verifica rutas reales para impedir escape por enlaces simbólicos y ejecuta mantenimiento cada 15 segundos. SIGTERM/SIGINT detienen nuevas conexiones, esperan mantenimiento y cierran los pools. Puede usar SMTP con TLS verificado o el mismo servicio de correo HTTPS utilizado en Workers.

## Ejecutar en Workers

1. Cambiar `PUBLIC_URL` en `wrangler.toml` al dominio real. La URL `.invalid` es un marcador, no un dominio desplegado.
2. Preparar PostgreSQL mediante el procedimiento anterior desde un equipo de mantenimiento.
3. Elegir conexión:
   - **Hyperdrive:** crear su configuración hacia PostgreSQL, establecer TLS al origen, desactivar query caching para sesiones/reservas y activar el bloque `[[hyperdrive]]` con el ID real. El adaptador usa `env.HYPERDRIVE.connectionString`; el transporte local del driver no negocia TLS porque Hyperdrive administra el canal hacia el origen. Verificar la configuración TLS real de Hyperdrive antes de operar.
   - **Directa:** guardar `DATABASE_URL` como secret; requiere acceso de red desde Workers y certificado confiable. No se inventa un ID de Hyperdrive ni una contraseña.
4. Cargar secretos con Wrangler en el entorno correspondiente:

```sh
npx wrangler secret put DATABASE_URL
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Si se usa la pasarela de correo:
npx wrangler secret put MAIL_API_URL
npx wrangler secret put MAIL_API_TOKEN
```

No hace falta `DATABASE_URL` en el Worker si se usa Hyperdrive. La CLI de mantenimiento sí requiere una conexión directa. Para desarrollo, copiar `.dev.vars.example` a `.dev.vars`; usar una base de pruebas y `PUBLIC_URL` correspondiente al puerto de Wrangler. Los archivos con secretos están ignorados por Git.

```sh
npm run dev:worker
npm run build:worker      # Compila con --dry-run; no publica.
# Solo cuando se haya validado la configuración y se decida publicar:
npm run deploy:worker
```

Los estáticos usan `ASSETS`, con paso por el Worker para aplicar cabeceras y `no-store` a HTML/API. Se mantiene la URL `.html` sin redirecciones automáticas que puedan afectar al frontend. El cron ejecuta expiración y reintentos cada minuto; los controles de cupo siguen comprobando sus fechas al operar, aunque el correo de expiración espere al cron.

Cloudflare requiere conectividad al PostgreSQL elegido; Hyperdrive no convierte una base privada inaccesible en una base pública. La red corporativa futura se configura en el adaptador Node, no en el dominio. [Postgres.js con Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/), [ASSETS](https://developers.cloudflare.com/workers/static-assets/binding/).

## Google, pagos y correo

**Google:** permanecen `/api/auth/google` y `/api/auth/google/callback`, creación/vinculación de cuenta y cookie `kanba_user`. El redirect sale de `PUBLIC_URL`, nunca de Host/Forwarded enviados por el cliente. El state vive en PostgreSQL durante 10 minutos, se consume atómicamente una vez y se vincula a cookie `HttpOnly`, `SameSite=Lax`, `Secure` bajo HTTPS. Se exige `sub` y correo explícitamente verificado. Registrar en Google la callback exacta de cada entorno. Las sesiones existentes mantienen formato y hashes compatibles.

**Pagos:** se conservan rutas, autorización y contrato del gateway. Producción, `live` y webhooks siguen bloqueados hasta integrar un procesador validado; cambiar hosting no habilita cargos. Los tokens de demostración funcionan exclusivamente en desarrollo/pruebas. No se hicieron cargos reales.

**Correo:** las plantillas y el outbox son comunes. El envío ocurre después del commit mediante reclamación con lease persistido y reintentos. Node conserva el adaptador SMTP. Workers usa el contrato de una pasarela HTTPS propia, que debe implementarse/configurarse o sustituirse por un adaptador del proveedor real:

```json
{
  "from": { "email": "reservas@example.com", "name": "K’anba" },
  "to": "cliente@example.com",
  "subject": "Confirmación",
  "html": "...",
  "text": "...",
  "messageId": "mail_uuid"
}
```

Se envía `Authorization: Bearer ...` e `Idempotency-Key: messageId` cuando exista. El servicio debe devolver 2xx solo al aceptar el envío y debe respetar idempotencia si se necesita evitar duplicados. Este contrato **no es automáticamente compatible con cualquier API comercial**. Sin transporte configurado, los mensajes permanecen en outbox y no se anuncian como entregados. La entrega es al menos una vez; un fallo después del envío puede provocar reintento. No se enviaron correos reales durante las pruebas.

## Verificación y límites

Resultado local de esta refactorización: **29 pruebas aprobadas, 0 fallidas**; compilación de producción con `wrangler deploy --dry-run` aprobada. Se verificó también la carga del entrypoint Workers con Postgres.js y el binding de estáticos, sin abrir conexiones externas.

```sh
npm test
npm run build:worker
```

La suite cubre contratos HTTP bajo `@hono/node-server`, sesiones/CSRF, reservas, permisos, sandbox, cancelación, aislamiento entre instancias, rollback antes de publicar cookies, estado de Google entre instancias, repetición de callback, secretos, TLS y SMTP simulado. Una prueba arranca `workerd` con Miniflare y ejecuta registro con scrypt, sesión, CSRF y entrega estática en el runtime real local de Workers. El repositorio y Google se sustituyen por dobles de prueba; los tests SQL verifican parámetros y flujo de transacción, no conectividad externa.

Antes de producción quedan por verificar con los servicios reales: certificados y conectividad PostgreSQL/Hyperdrive, concurrencia y recuperación ante fallos en PostgreSQL real, configuración de OAuth, entrega de correo, límites de CPU/conexiones del plan y políticas de Cloudflare. El documento JSONB y llamadas externas dentro de algunas transacciones requieren pruebas de carga. La suite no constituye una auditoría ni validación de un procesador real.

No se desplegó, no se creó un recurso de Cloudflare y no se ejecutaron migraciones sobre bases reales durante esta refactorización. Para pasar a infraestructura privada, migrar PostgreSQL con herramientas estándar, configurar los mismos valores de negocio, arrancar `server/node.js`, validar tráfico y cambiar DNS. Las rutas, dominio y controlador SQL permanecen iguales; cambian transporte/red, secretos y punto de entrada. Mantener el sistema anterior en modo sin escrituras durante el corte y conservar respaldo antes de cualquier reversión para evitar dos escritores divergentes.
