# Guía de Operación Segura — K’anba Cuevas Vivas

Este documento establece los requerimientos, procedimientos operativos, configuración de seguridad, respaldos y contingencias para el despliegue y mantenimiento de la aplicación **K’anba Cuevas Vivas** en infraestructura empresarial.

---

## 1. Requisitos de Plataforma

- **Node.js**: Versión `>= 20.11.0 LTS` (soporte activo para módulos ESM nativos y suite de pruebas `node:test`).
- **PostgreSQL**: Versión `>= 13` (se recomienda `>= 15`). Requiere soporte de tipo `JSONB` y transacciones ACID.
- **Red y TLS**: Conectividad cifrada obligatoria con TLS `>= 1.2` tanto para la base de datos como para el servidor de correo SMTP.
- **Arquitectura de proceso**: Monoproceso Node.js detrás de un proxy inverso seguro (ej. Nginx, HAProxy, Cloudflare o Caddy) encargado de la terminación TLS pública.

---

## 2. Variables de Entorno

La aplicación no incluye cargadores automáticos tipo `dotenv` en producción. Todas las variables deben inyectarse directamente a través del gestor de servicios del sistema operativo (systemd, Windows Services, Docker o el Secret Manager corporativo).

| Variable | Tipo / Valores | Obligatoria | Descripción |
|---|---|---|---|
| `NODE_ENV` | `production` \| `development` \| `test` | **Sí** | En `production` se bloquean pagos sandbox/live y se activan todas las validaciones estrictas de seguridad. |
| `ADMIN_PASSWORD` | Cadena (12-256 caracteres) | **Sí** (en prod) | Contraseña maestra del administrador. Debe cumplir política de robustez (versión 2: mayúsculas, minúsculas, números y símbolos). |
| `DATABASE_URL` | URI PostgreSQL | **Sí** | Cadena de conexión al servidor PostgreSQL (ej. `postgres://usuario:pass@pg.empresa.local:5432/kanba_db`). |
| `PGSSLMODE` | `verify-full` | Recomendada | Modo TLS de PostgreSQL. Valores no estrictos como `disable` o `require` sin validación son rechazados. |
| `PG_TLS_CA` | Texto PEM | Opcional | Certificado de la Autoridad Certificadora (CA) para PostgreSQL en texto PEM. |
| `PG_TLS_CA_FILE` | Ruta de archivo | Opcional | Ruta absoluta al certificado CA en formato PEM. Mutuamente excluyente con `PG_TLS_CA`. |
| `PG_TLS_SERVERNAME` | Nombre de host | Opcional | Nombre del servidor (SNI) esperado en el certificado de PostgreSQL. Por defecto usa el host de `DATABASE_URL`. |
| `PUBLIC_URL` | URL HTTPS | **Sí** (en prod) | Origen canónico público exacto de la aplicación (ej. `https://cuevasdekanba.com`). Requerido para mitigación de CSRF y Host Header Injection. |
| `TRUSTED_PROXY_CIDRS` | Lista CIDR separada por comas | **Sí** (en prod) | Rangos IP confiables del proxy inverso (ej. `127.0.0.1/32,10.0.0.0/8`). Solo se confía en cabeceras `X-Forwarded-*` provenientes de estas IPs. |
| `DB_SCHEMA` | Identificador SQL | Opcional | Esquema de base de datos a utilizar (por defecto `kanba` o `public`). |
| `SMTP_HOST` | Nombre de host / IP | **Sí** (correos) | Servidor SMTP corporativo o MTA local (ej. `smtp.empresa.local`). |
| `SMTP_PORT` | Número (`465`, `587`, etc.) | **Sí** (correos) | Puerto del servicio SMTP (`465` para TLS implícito, `587` para STARTTLS). |
| `SMTP_SECURE` | `true` \| `false` | **Sí** (correos) | `true`: conexión directa cifrada por TLS. `false`: conexión con negociación `STARTTLS` obligatoria. **El texto plano sin cifrar está estrictamente bloqueado**. |
| `SMTP_USER` | Cadena | Opcional | Usuario de autenticación SMTP. |
| `SMTP_PASS` | Cadena | Opcional | Contraseña de autenticación SMTP. **Única fuente válida**: no se lee del archivo de datos ni de la base de datos. |
| `SMTP_FROM` | Dirección de correo | **Sí** (correos) | Dirección de correo del remitente (ej. `reservas@cuevasdekanba.com`). |
| `SMTP_FROM_NAME` | Cadena | Opcional | Nombre legible del remitente (ej. `K’anba Cuevas Vivas`). |
| `SMTP_TLS_CA` / `SMTP_TLS_CA_FILE` | PEM / Ruta | Opcional | Certificado CA específico para validar el servidor SMTP. |
| `SMTP_TLS_SERVERNAME` | Nombre de host | Opcional | Nombre SNI esperado para el certificado SMTP. |
| `PAYMENTS_SECRET_KEY` | Cadena secreta | Opcional | Clave privada del procesador de pagos. |
| `PAYMENTS_WEBHOOK_SECRET` | Cadena secreta | Opcional | Clave secreta para validación de firma de webhooks de pago. |
| `FORCE_ADMIN_PASSWORD` | `1` \| `0` | Temporal | Forzar reinicio de contraseña administrativa si se ha bloqueado el acceso. Debe retirarse inmediatamente después de usarlo. |

> [!CAUTION]
> **Bloqueo de Pagos en Producción**:
> En esta versión, la pasarela de pagos en producción está bloqueada por diseño de contención (`server/payment-policy.js`). Las variables `PAYMENTS_*` no activan cobros reales ni abren webhooks hasta que una integración formal validada y certificada sea desplegada.

---

## 3. Configuración Criptográfica y TLS

### 3.1 Conexión con PostgreSQL
- Se requiere TLS `>= 1.2`.
- Si PostgreSQL utiliza un certificado firmado por una CA privada corporativa, configure `PG_TLS_CA_FILE=/ruta/ca-empresa.crt`.
- Quedan prohibidas opciones en la cadena de conexión que intenten omitir la validación de certificados (`sslmode=disable`, `sslmode=no-verify` o parámetros espurios).

### 3.2 Conexión con SMTP
- En puerto `465`: configure `SMTP_SECURE=true` (TLS implícito directo).
- En puerto `587` o `25`: configure `SMTP_SECURE=false`. El cliente ejecuta `STARTTLS` de manera obligatoria y aborta la conexión antes del envío de credenciales (`AUTH`) si el servidor no soporta cifrado o si el certificado no es válido.

---

## 4. Inicialización y Migración de Base de Datos

### 4.1 Inicialización de Base de Datos Limpia
Para un despliegue inicial en una base de datos nueva vacía:
```bash
# 1. Asegúrese de tener configuradas las variables de entorno DATABASE_URL y DB_SCHEMA
export DATABASE_URL="postgres://usuario:password@localhost:5432/kanba_db"
export DB_SCHEMA="kanba"

# 2. Ejecutar el script oficial de inicialización controlada
node scripts/initialize-database.mjs --initialize-empty
```
*Este comando crea el esquema, la tabla `kanba_store` y una estructura inicial limpia sin usuarios demo ni reservas ficticias.*

### 4.2 Verificación de Migraciones
La aplicación gestiona automáticamente las migraciones estructurales requeridas al arrancar mediante `server/migrations.js` utilizando transacciones seguras con bloqueos a nivel de fila (`SELECT ... FOR UPDATE`).

---

## 5. Respaldos y Restauración

### 5.1 Respaldo en Línea (PostgreSQL)
Ejecutar periódicamente mediante cron o tarea programada:
```bash
# Respaldo completo en formato binario comprimido
pg_dump -h localhost -U kanba_user -d kanba_db -F c -b -v -f /var/backups/kanba_$(date +%Y%m%d_%H%M%S).dump
```

### 5.2 Restauración de Base de Datos
```bash
# Restaurar un respaldo en una base de datos de contingencia
pg_restore -h localhost -U kanba_user -d kanba_db -v --clean --if-exists /var/backups/kanba_YYYYMMDD_HHMMSS.dump
```

### 5.3 Respaldo de Archivos Locales
En caso de operar en modo local transitorio:
- El archivo `data/db.json` debe respaldarse únicamente en almacenamientos cifrados fuera del árbol del repositorio.

---

## 6. Operación del Proceso (Inicio y Detención)

### 6.1 Ejecución mediante Gestor de Procesos (systemd)
Ejemplo de unidad de servicio `/etc/systemd/system/kanba.service`:
```ini
[Unit]
Description=K'anba Cuevas Vivas - Application Server
After=network.target postgresql.service

[Service]
Type=simple
User=kanba
WorkingDirectory=/opt/kanba
EnvironmentFile=/etc/kanba/kanba.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Comandos de control:
```bash
sudo systemctl daemon-reload
sudo systemctl start kanba
sudo systemctl status kanba
sudo systemctl stop kanba
```

---

## 7. Diagnóstico, Logs y Tratamiento de Errores

- **Filtrado de Secretos**: Los errores operativos y excepciones del sistema son procesados a través de `server/safe-errors.js`. Nunca imprimen cadenas de conexión completas, contraseñas, claves API ni el contenido de las solicitudes HTTP en los logs.
- **Auditoría de Acciones**: Todas las operaciones administrativas (inicio de sesión, cambio de configuraciones, confirmaciones) quedan registradas con marca de tiempo e IP saneada.

---

## 8. Arquitectura de Proxy Inverso y Terminación HTTPS

La aplicación debe ubicarse detrás de un proxy inverso que provea:
1. Terminación TLS (HTTPS con certificados válidos).
2. Cabeceras de seguridad estrictas:
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
   - `X-Frame-Options: SAMEORIGIN`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
3. Paso seguro de cabeceras cliente:
   - `X-Forwarded-For`
   - `X-Forwarded-Proto: https`
   - `X-Forwarded-Host`

*Nota*: La aplicación verifica `TRUSTED_PROXY_CIDRS` para descartar solicitudes con cabeceras `X-Forwarded-*` forjadas provenientes de clientes directos.

---

## 9. Plan de Recuperación ante Desastres (Disaster Recovery)

1. **Fallo de Conexión a Base de Datos**:
   - La aplicación responderá con código de estado `500` con mensaje seguro predeterminado `Internal server error` sin filtrar trazas de PostgreSQL.
   - El servicio se reiniciará automáticamente vía systemd.
2. **Bloqueo Administrativo / Olvido de Contraseña**:
   - Inyectar la variable `FORCE_ADMIN_PASSWORD=1` y reiniciar el servicio una sola vez.
   - Acceder al panel con la contraseña configurada en `ADMIN_PASSWORD`.
   - Retirar la variable `FORCE_ADMIN_PASSWORD` y reiniciar el servicio.
3. **Compromiso o Exposición de Secretos**:
   - Proceder inmediatamente con la revocación en los proveedores respectivos (correo, pasarela de pago).
   - Generar nuevas credenciales y actualizar las variables de entorno en el servidor.
   - Reiniciar el proceso para purgar cualquier valor en memoria.
