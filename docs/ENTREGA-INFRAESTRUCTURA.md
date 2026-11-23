# Guía Técnica de Entrega a Infraestructura Empresarial
## Proyecto: K’anba Cuevas Vivas
**Estado de Entrega:** Listo con Condiciones (Dictamen B)  
**Paquete Oficial:** `dist/kanba-source-VCTn1r.zip`  
**Fecha:** Noviembre 2026  

---

## 1. Resumen y Propósito del Documento

Este documento define las especificaciones, requerimientos técnicos, matriz de responsabilidades y procedimientos de despliegue para el equipo de Infraestructura, Sistemas y Operaciones encargado de poner en marcha la aplicación **K’anba Cuevas Vivas** en servidores empresariales propios, reemplazando la infraestructura temporal previa (Render).

---

## 2. Requisitos de la Plataforma

### 2.1 Servidor de Aplicación (Host Node.js)
- **Sistema Operativo**: Linux (Ubuntu 22.04 LTS / 24.04 LTS, Debian 12, RHEL 9 o similar) o Windows Server 2022.
- **Entorno de Ejecución**: **Node.js `>= 20.11.0 LTS`** (se recomienda Node.js 20 o 22 LTS).
- **Herramienta de Paquetes**: `npm` versión `>= 10.0.0`.
- **Gestor de Procesos**: `systemd` (Linux) o Windows Service Manager / NSSM (Windows).
- **Acceso de Red Saliente**: Acceso HTTPS saliente a registro npm (`registry.npmjs.org` o mirror privado empresarial) para la instalación inicial de dependencias.

### 2.2 Motor de Base de Datos (PostgreSQL)
- **Versión**: **PostgreSQL `>= 13`** (recomendado PostgreSQL 15 o 16).
- **Extensiones requeridas**: Soporte nativo para transacciones ACID y tipos de datos `JSONB`.
- **Cifrado en Tránsito**: Conexiones forzadas con **TLS `>= 1.2`** (`verify-full`).

### 2.3 Servidor de Correo (MTA / SMTP)
- Servidor corporativo local (Postfix, Exim, Exchange) o proveedor SMTP empresarial.
- Soporte para **TLS implícito** (puerto `465`) o **STARTTLS obligatorio** (puerto `587`).
- *Nota*: La aplicación rechaza cualquier envío o autenticación en texto plano sin cifrar.

### 2.4 Proxy Inverso y Terminación Web
- Nginx, Caddy, HAProxy, F5 o Cloudflare.
- Certificado SSL/TLS corporativo válido emitido para el dominio de producción.

---

## 3. Matriz de Responsabilidades (RACI Operativo)

| Tarea / Componente | Desarrollador / Entrega | Administrador de Infraestructura |
|---|:---:|:---:|
| Suministro del paquete de código limpio (`.zip`) | **Responsable** | Receptor / Consulta |
| Provisión del servidor y sistema operativo | No interviene | **Responsable** |
| Instalación de Node.js 20 LTS en el servidor | No interviene | **Responsable** |
| Creación y configuración de la base de datos PostgreSQL | No interviene | **Responsable** |
| Generación de certificados TLS (PostgreSQL, HTTPS, SMTP) | No interviene | **Responsable** |
| Suministro de credenciales en Secret Manager / Env | No interviene | **Responsable** |
| Ejecución de `npm ci --omit=dev` en el servidor | Guía técnica | **Responsable** |
| Ejecución de inicialización única (`initialize-database.mjs`) | Guía técnica | **Responsable** |
| Configuración de servicio systemd y reinicio automático | Guía técnica | **Responsable** |
| Configuración del proxy inverso y cabeceras de red | Guía técnica | **Responsable** |
| Política y automatización de respaldos periódicos | Asesoría | **Responsable** |
| Validación y certificación futura de pasarela de pagos | **Responsable** | Colabora (red/puertos) |

---

## 4. Procedimiento de Instalación Paso a Paso

### Paso 1: Descompresión del Paquete
Extraer el paquete `dist/kanba-source-VCTn1r.zip` en el directorio de aplicaciones empresarial (ej. `/opt/kanba`):
```bash
sudo mkdir -p /opt/kanba
sudo unzip kanba-source-VCTn1r.zip -d /opt/kanba
cd /opt/kanba
sudo chown -R kanba:kanba /opt/kanba
```

### Paso 2: Instalación Determinista de Dependencias
Ejecutar la instalación limpia sin dependencias de desarrollo (`devDependencies`):
```bash
npm ci --omit=dev
```
*Este comando instalará exclusivamente el driver PostgreSQL oficial `pg` fijado en `package-lock.json`.*

### Paso 3: Configuración de Variables de Entorno
Crear un archivo protegido para las variables del servicio (ej. `/etc/kanba/kanba.env` con permisos `0600`, propietario `kanba:kanba`):

```ini
# --- ENTORNO Y SEGURIDAD BÁSICA ---
NODE_ENV=production
ADMIN_PASSWORD=Generar_Password_Complejo_Min_12_Caracteres!
PUBLIC_URL=https://cuevasdekanba.com

# --- BASE DE DATOS POSTGRESQL ---
DATABASE_URL=postgres://kanba_user:PasswordPostgresSeguro@pg-host.empresa.local:5432/kanba_db
# En servidores empresariales y proveedores externos: verify-full (valida CA y certificado)
# En entorno de staging interno de Render (Internal Database URL): require (cifrado TLS en red privada)
PGSSLMODE=verify-full
# Si la empresa usa una CA privada interna:
PG_TLS_CA_FILE=/etc/ssl/certs/ca-corporativa.crt
# Nombre de host esperado en el certificado de PostgreSQL:
PG_TLS_SERVERNAME=pg-host.empresa.local
# Esquema de base de datos aislado (opcional, recomendado si la BD es compartida):
DB_SCHEMA=kanba

# --- RED Y PROXY INVERSO ---
# Lista obligatoria de CIDRs exactos del proxy inverso o balanceador inmediato.
# Use 127.0.0.1/32 si Nginx/Caddy está en el mismo host, o la IP fija del balanceador corporativo.
# Evite rangos amplios genéricos como 10.0.0.0/8 en redes multi-tenant.
TRUSTED_PROXY_CIDRS=127.0.0.1/32

# --- SERVIDOR DE CORREO SMTP ---
SMTP_HOST=smtp.empresa.local
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=reservas@cuevasdekanba.com
SMTP_PASS=PasswordSmtpCorporativoSeguro
SMTP_FROM=reservas@cuevasdekanba.com
SMTP_FROM_NAME="K'anba Cuevas Vivas"
# Si SMTP usa CA corporativa:
# SMTP_TLS_CA_FILE=/etc/ssl/certs/ca-corporativa.crt

# --- VOLÚMENES PERSISTENTES (OPCIONAL) ---
UPLOADS_DIR=/var/lib/kanba/uploads
```

---

## 5. Inicialización de la Base de Datos (Regla de Ejecución Única)

> [!CAUTION]
> **ATENCIÓN: EJECUCIÓN ÚNICA EN BASE NUEVA Y VACÍA**:
> El script de inicialización crea las tablas base (`kanba_store`, `kanba_media`, `kanba_rate_limits`) e inserta la configuración inicial limpia.
> Si la base ya contiene datos, el script aborta inmediatamente con:
> `Error: Database already initialized; no overwrite allowed.`
> Nunca intente forzar ni modificar este comportamiento.

Para inicializar la base de datos vacía por primera vez:
```bash
# Exportar las credenciales requeridas en la sesión temporal:
export DATABASE_URL="postgres://kanba_user:PasswordPostgresSeguro@pg-host.empresa.local:5432/kanba_db"
export DB_SCHEMA="kanba"
export ADMIN_PASSWORD="Generar_Password_Complejo_Min_12_Caracteres!"

# Ejecutar el script oficial:
node scripts/initialize-database.mjs --initialize-empty
```

---

## 6. Configuración del Servicio del Sistema (`systemd`)

Crear la unidad `/etc/systemd/system/kanba.service`:
```ini
[Unit]
Description=Servicio Web K'anba Cuevas Vivas
After=network.target postgresql.service

[Service]
Type=simple
User=kanba
Group=kanba
WorkingDirectory=/opt/kanba
EnvironmentFile=/etc/kanba/kanba.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

# Endurecimiento de proceso en Linux
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Habilitar e iniciar:
```bash
sudo systemctl daemon-reload
sudo systemctl enable kanba
sudo systemctl start kanba
sudo systemctl status kanba
```

---

## 7. Configuración de Proxy Inverso (Nginx)

Ejemplo de bloque de servidor Nginx con terminación TLS:
```nginx
server {
    listen 80;
    server_name cuevasdekanba.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name cuevasdekanba.com;

    ssl_certificate /etc/letsencrypt/live/cuevasdekanba.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cuevasdekanba.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Cabeceras de seguridad
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

---

## 8. Verificación de Funcionamiento Sin Render

Para validar que la aplicación opera de forma totalmente independiente del entorno original de Render:

1. **Sin variables ni metadatos de Render**:
   - Confirmar que variables como `RENDER`, `RENDER_SERVICE_ID`, `RENDER_INSTANCE_ID` no existen en el entorno.
2. **Persistencia 100% en PostgreSQL**:
   - Detener el servicio `kanba`.
   - Modificar un ajuste menor desde el panel administrativo una vez reiniciado.
   - Consultar la base de datos PostgreSQL corporativa:
     ```sql
     SELECT updated_at FROM kanba_store WHERE id = 1;
     ```
   - La marca de tiempo reflejará el cambio de inmediato.
3. **Imágenes en Volumen Persistente**:
   - Verificar que `UPLOADS_DIR` apunta a un directorio con permisos de lectura/escritura para el usuario del servicio.

---

## 9. Lista de Verificaciones para Entorno de Staging (Checklist de Pre-Producción)

Antes de abrir el tráfico al público general, el equipo de infraestructura debe validar en un entorno de staging:

- [ ] **Node.js**: `node -v` devuelve `>= 20.11.0`.
- [ ] **Instalación de paquetes**: `npm ci --omit=dev` completado sin errores.
- [ ] **Conexión PostgreSQL**:
  - Handshake TLS exitoso con el certificado corporativo.
  - Validación de que `sslmode=verify-full` es respetado.
- [ ] **Inicialización**:
  - `node scripts/initialize-database.mjs --initialize-empty` ejecutado con éxito.
  - Confirmar que la tabla `kanba_store` contiene exactamente una fila (`id = 1`).
- [ ] **Arranque del servicio**:
  - El proceso inicia y responde en `http://127.0.0.1:3000/`.
  - Verificación de que `journalctl -u kanba` no reporta advertencias ni fuga de credenciales.
- [ ] **Acceso Administrativo**:
  - Acceso exitoso a `/admin` con la contraseña configurada en `ADMIN_PASSWORD`.
  - Prueba de inactividad de sesión (expiración tras 30 minutos sin interacción).
- [ ] **Prueba SMTP**:
  - Enviar un correo de prueba transaccional desde el panel administrativo.
  - Comprobar que el log de correo se procesa sin errores y el receptor recibe el mensaje con remitente corporativo.
- [ ] **Proxy Inverso e IP Real**:
  - Comprobar en los registros administrativos que la IP registrada corresponde a la IP pública del cliente y no a la IP interna del balanceador.
- [ ] **Comportamiento ante Caídas**:
  - Simular reinicio del servicio con `systemctl restart kanba` y verificar recuperación inmediata.

---

## 10. Política de Pagos y Requisitos Pendientes Antes de Producción

> [!IMPORTANT]
> **ESTADO DE LOS PAGOS: ESTRICTAMENTE DESHABILITADOS**:
> La aplicación cuenta con una política de seguridad activa (`server/payment-policy.js`).
> En modo `NODE_ENV=production`:
> - Los cobros por checkout web están **bloqueados** (HTTP 503).
> - Los webhooks de confirmación están **bloqueados** (HTTP 503).
> - Las confirmaciones manuales de pago están **bloqueadas**.
>
> Esta medida de contención impide cualquier procesamiento accidental o fraudulento hasta que la empresa contrate formalmente un procesador de pagos certificado (ej. Stripe, Cybersource, VisaNet/Qpay) y se desarrolle el conector oficial respectivo.

### Requisitos Pendientes Antes del Lanzamiento Final:
1. **Revocación de Credenciales Previas**:
   - Confirmar que las claves API de prueba y contraseñas temporales usadas en etapas anteriores fueron dadas de baja en sus proveedores respectivos.
2. **Definición de Pasarela Definitiva**:
   - Formalizar contrato con el adquirente/pasarela de pagos para el cobro en Quetzales (GTQ).
3. **Certificación de Dominio y DNS**:
   - Apuntar los registros DNS `A`/`CNAME` hacia la IP del proxy inverso empresarial.
