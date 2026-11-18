# Remediación P0 — K’anba Cuevas Vivas

Fecha: 17 de noviembre de 2026. Alcance: V01, V06 y contención de V07.

## Resultado

V01 queda bloqueada en el código con pruebas aisladas de rutas y funciones. Producción no puede confirmar pagos por checkout, webhook ni confirmación manual. No existe una opción de configuración que habilite pagos reales; requiere una integración futura validada. Fuera de `development` y `test` se aplica el mismo bloqueo. `live` siempre se rechaza. El sandbox solo funciona en desarrollo/pruebas.

V06 queda corregida en la construcción de conexiones y el flujo SMTP probado con sockets simulados. PostgreSQL y SMTP exigen TLS >= 1.2, certificado válido e identidad del servidor. SMTP no autentica ni entrega mensajes sin TLS verificado. La interoperabilidad con proveedores reales NO ESTÁ VERIFICADA: no se hicieron conexiones externas, pagos ni envíos de correo, y `pg` no está instalado en este checkout.

V07 NO queda cerrada: se implementó carga exclusivamente desde el entorno, rechazo de secretos mediante la API administrativa y eliminación de esos campos de nuevos snapshots. Los archivos de datos existentes, sus respaldos y el historial Git se conservaron intactos. Aún contienen secretos y requieren rotación y retirada controlada antes de distribuir el proyecto. `.gitignore` no desversiona archivos existentes.

La arquitectura de snapshots JSONB, sus riesgos de concurrencia y las migraciones existentes no se sustituyeron. No se certifica PCI DSS ni se autoriza habilitar pagos reales.

## Protección del trabajo previo

- Rama inicial: `main`; commit inicial: `dcbc80e`.
- Existían nueve archivos modificados y dos archivos sin seguimiento. Se trabajó sobre ese estado sin revertirlo.
- Respaldo: `C:/Users/paser/Videos/CuevasDeKanba-backups/p0-20261117-160914`.
- Se copiaron 126 archivos, excluyendo `node_modules` y `.git`; se comparó SHA-256 de cada origen y copia. `backup-manifest.json` conserva rutas y hashes.
- `repository.bundle`, creado con `git bundle create --all`, pasó `git bundle verify` y contiene el historial recuperable. Incluye referencias adicionales existentes.
- El respaldo contiene material sensible. Mantenerlo local, con acceso restringido, y no adjuntarlo a tickets o repositorios.
- Restauración: verificar los hashes del manifiesto antes de copiar exclusivamente los archivos deseados; comparar con cambios posteriores para no sobrescribirlos. El bundle permite reconstruir Git por separado. No se ejecutó una restauración.

## Archivos y funciones

| Archivo | Cambio / evidencia |
| --- | --- |
| `server/payment-policy.js` (nuevo) | `requirePaymentPermission`: lista cerrada de modos, bloqueo de producción, `live` y webhooks. |
| `server/gateway.js` | `charge`: aplica la política incluso cuando se invoca fuera del router. |
| `server/index.js` | `handleApi`: bloquea checkout y webhooks antes de leer el cuerpo o mutar reservas. `applyApprovedPayment`: defensa central que incluye confirmación manual. `mergeAdminSettings`: rechaza secretos no vacíos; `publicAdminSettings`: indicadores basados en entorno. Error de inicialización saneado. |
| `server/tls-config.js` (nuevo) | `verifiedTlsOptions`: verificación de CA e identidad, TLS mínimo, CA configurable. `postgresConnectionOptions`: impide que parámetros de URL sustituyan las opciones TLS. |
| `server/store.js` | `initStore`: conexión PostgreSQL estricta. `loadDb` e inicialización: descartan secretos persistidos de settings en memoria. `saveDb`: serializa sin secretos. Se elimina la impresión de la contraseña temporal. |
| `server/smtp.js` | `sendSmtpMail`: parser multilínea acotado, cola de respuestas, STARTTLS obligatorio, espera de `secureConnect` y autorización antes de AUTH, errores sin texto del servidor. También corrige la espera de la respuesta final a DATA. |
| `server/runtime-secrets.js` (nuevo) | `paymentSecrets`, `settingsWithoutSecrets`, `serializeStore`, `containsIncomingSecrets`. No inserta secretos del entorno en el documento. |
| `server/safe-errors.js` (nuevo) | `safeErrorMessage`: logs con códigos permitidos, nunca mensajes/objetos originales del driver. |
| `server/mailer.js` | `getEffectiveSmtpConfig`: SMTP_PASS exclusivamente del entorno; logs operativos saneados. |
| `public/js/admin.js` | Campos secretos deshabilitados para evitar una edición que el backend ya no permite; sin cambio de diseño/CSS. |
| `.gitignore` | Previene nuevas incorporaciones accidentales de datos, cookies, entornos y archivos de claves. No elimina archivos del índice. |
| `.env.example` (nuevo) | Variables documentadas sin valores de credenciales. No se carga automáticamente. |
| `package.json` | Comando `test:p0`; ninguna dependencia añadida. |
| `tests/p0-security.test.mjs` (nuevo) | Pruebas sin servidor, base de datos o red real. |
| `docs/P0-REMEDIACION.md` (nuevo) | Este informe, configuración y plan de rotación. |

`server/migrations.js`, `data/db.json`, su respaldo previo y los restantes cambios de frontend se conservaron sin modificación por esta remediación.

## Pruebas

Comando: `npm run test:p0` (equivalente a `node --experimental-vm-modules --test tests/p0-security.test.mjs`). Usa exclusivamente Node y sus módulos integrados. La advertencia de VM Modules es esperada.

Resultado: 12 pruebas aprobadas, 0 fallidas. En Windows se ejecutó `npm.cmd run test:p0`: PowerShell bloqueó el lanzador npm.ps1 y no se cambió su política. También pasaron 13 verificaciones `node --check` y `git diff --check` sobre los archivos de esta remediación. Se compararon los 126 archivos originales contra el manifiesto del respaldo: solo cambiaron los ocho archivos existentes enumerados en este informe; datos, migración y cambios ajenos quedaron intactos.

1. Producción rechaza sandbox/live/modos desconocidos, tokens demo/test y confirmación manual sin mutar reservas ni guardar.
2. Sandbox funciona en desarrollo; modo enviado por navegador no sustituye al del servidor; webhook permanece bloqueado.
3. PostgreSQL verifica certificados/nombre y rechaza opciones que podrían degradar o sustituir TLS.
4. Configuración de identidad y CA inválida falla sin revelar valores.
5. API rechaza secretos, proyección no los expone, snapshots los omiten y SMTP no recupera contraseña antigua desde settings.
6. Sin STARTTLS no se envían credenciales ni correo.
7. Fallo de handshake directo/STARTTLS no causa fallback ni filtración en errores.
8. `secureConnect` sin autorización del certificado no habilita AUTH.
9. Respuestas SMTP fragmentadas/multilínea se procesan y DATA termina correctamente en transporte simulado.
10. Un error remoto de autenticación no se copia a logs o excepciones.
11. Errores operativos no serializan contraseñas, mensajes de driver ni cadenas de conexión; no se imprime la contraseña temporal.
12. `initStore`, con un driver pg ficticio que falla, conserva TLS estricto y no crea un segundo pool ni reintenta en texto plano.

Las pruebas de rutas extraen funciones reales sin ejecutar el arranque, que actualmente tiene efectos de escritura. Las pruebas SMTP sustituyen sockets por EventEmitter; ninguna entrega real ocurre. La prueba de store sustituye pg y prohíbe el acceso al filesystem y a migraciones. No demuestran disponibilidad, certificados o configuración reales del proveedor.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `NODE_ENV` | `production` bloquea todas las confirmaciones. Solo `development`/`test` permiten sandbox. |
| `DATABASE_URL` | URI PostgreSQL del proveedor. No incluir opciones TLS ni overrides de host en la query. Se permite `sslmode=verify-full`, que se retira antes de pasar la URI a pg, y `application_name`. Los demás parámetros de query se rechazan. |
| `PGSSLMODE` | Omitida o `verify-full`. `disable`, `prefer`, `require` y demás valores se rechazan. |
| `PG_TLS_CA` / `PG_TLS_CA_FILE` | Nuevas, opcionales y excluyentes: PEM de la CA o ruta al archivo. Sin ellas se usan las CA confiables de Node. |
| `PG_TLS_SERVERNAME` | Nueva, opcional: identidad certificada que el administrador indique; por defecto se verifica el host de DATABASE_URL. No es una opción para desactivar verificación. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` | Configuración SMTP existente; no se inventan valores del futuro proveedor. |
| `SMTP_PASS` | Única fuente de la contraseña SMTP. Ya no hay fallback al documento JSONB. |
| `SMTP_SECURE` | `true`: TLS directo. `false`: conexión inicial seguida de STARTTLS obligatorio. No habilita envío en texto plano. |
| `SMTP_TLS_CA` / `SMTP_TLS_CA_FILE` | Nuevas, opcionales y excluyentes, equivalentes a las opciones PostgreSQL. |
| `SMTP_TLS_SERVERNAME` | Nueva, opcional; por defecto SMTP_HOST. |
| `PAYMENTS_SECRET_KEY`, `PAYMENTS_WEBHOOK_SECRET` | Única fuente para esos secretos; no habilitan una pasarela ni desbloquean webhooks. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | El valor `0` causa rechazo de configuración. No usarlo. |

Un gestor de secretos puede inyectar las variables en el proceso. No se añadió una dependencia de dotenv ni una integración con un gestor específico.

## Rotación y retirada de secretos: pendientes

Inventario confirmado sin valores: `data/db.json` versionado contiene secreto de pago y de webhook; el respaldo pre-migración también. El nuevo respaldo completo conserva ambos y el historial. No se verificó vigencia, proveedor real ni publicación remota. Scripts auxiliares también contienen literales de autenticación para pruebas; no se asume que sean credenciales activas.

1. El responsable debe identificar en el proveedor de pagos contratado la clave API y el secreto de firma correspondientes. El código actual solo identifica una pasarela sandbox ficticia: no permite atribuirlos a Stripe u otro proveedor real.
2. Si son credenciales válidas, crear reemplazos y revocar los expuestos desde ese proveedor. Un secreto de webhook puede rotarse en la configuración del endpoint del proveedor. Mantener pagos/webhooks deshabilitados durante el proceso.
3. Si SMTP o contraseñas administrativas reales se compartieron/versionaron, rotarlas respectivamente en el proveedor de correo y en la administración de la aplicación. No se observaron contraseñas SMTP no vacías en los dos JSON inspeccionados, lo que no verifica la totalidad del historial.
4. Cargar los reemplazos en variables del servidor/gestor de secretos; no introducirlos en settings, archivos de datos o tickets. No copiar las credenciales antiguas a `.env.example`.
5. Preparar un cambio revisable que deje de versionar `data/`, outbox y archivos de cookies sin eliminar sus copias locales, y usar fixtures sintéticos para distribución. `.gitignore` ya prepara exclusiones pero los archivos previamente versionados siguen incluidos. No publicar el árbol actual como saneado.
6. Evaluar limpieza del historial y copias en clones, artefactos, CI y backups. Requiere una operación coordinada independiente; no se reescribió Git ni se borraron datos aquí. La limpieza no sustituye la revocación.
7. Verificar que los secretos viejos estén revocados y documentar la confirmación del proveedor sin registrar valores. Solo entonces evaluar cierre de V07.

## Riesgos de activación y pendientes

- No se desplegó ni arrancó el servicio. Antes de hacerlo, el operador debe configurar CA/identidad válidas, SMTP_PASS y demás variables necesarias. Certificados autofirmados no confiables, nombres incorrectos o URLs con parámetros incompatibles ahora fallarán; no hay degradación insegura.
- Los botones de confirmación/pago pueden seguir visibles, pero el backend los rechazará en producción. La confirmación manual también queda bloqueada expresamente por el alcance P0. No hay adaptador de pagos reales.
- Los secretos guardados en settings dejan de funcionar. Cargar credenciales nuevas en el entorno antes de habilitar el correo. Los próximos guardados omitirán los campos secretos; no se ejecutaron esos guardados contra datos reales durante este trabajo.
- `initStore` conserva las migraciones automáticas preexistentes: arrancar el servicio podría ejecutarlas. Este trabajo no autoriza su ejecución y no las ejecutó. Revisar/separar ese arranque antes de cualquier despliegue.
- JSONB completo sigue siendo vulnerable a sobrescrituras, pérdida de persistencia y revocaciones inconsistentes entre instancias. No se habilitan pagos reales sobre esta arquitectura.
- La reducción de logs evita exposición a costa de detalle de diagnóstico; investigar con códigos permitidos y herramientas que no recopilen credenciales.
- Para validar interoperabilidad se necesitan los endpoints, CA oficiales e identidad certificada de PostgreSQL y SMTP, y la documentación/contrato de la pasarela elegida. Esa validación externa sigue NO VERIFICADA.
- No se modificó PostgreSQL, no se ejecutaron migraciones reales, no se instalaron dependencias, no se hizo commit/push ni se inició la migración arquitectónica.

Referencias técnicas consultadas: https://node-postgres.com/features/ssl (los parámetros SSL de la URI pueden sustituir el objeto ssl) y https://nodejs.org/api/tls.html (verificación TLS e identidad).
