# Plan de seguridad para producción — K’anba Cuevas Vivas

**Versión:** 1.0 · **Fecha:** 18 de noviembre de 2026 · **Estado:** propuesta técnica para revisión y ejecución.

**Destinatarios:** cliente, responsable de desarrollo, administrador de infraestructura y responsable de operaciones.

## 1. Decisión ejecutiva y alcance

La recepción de pagos reales debe permanecer deshabilitada hasta completar los requisitos de salida de este documento. El proyecto contiene defensas útiles, pero una revisión de archivos no acredita la seguridad del servicio desplegado. Cloudflare protege parte del tráfico; la autorización de usuarios, integridad de cobros, protección de datos y recuperación dependen también de la aplicación y de sus proveedores.

El alcance comprende sitio público, cuentas, reservas, panel administrativo, API, cobros y reembolsos, PostgreSQL, correo, analítica, repositorio, despliegue, respaldos y Cloudflare. La referencia de verificación propuesta es **OWASP ASVS 5.0, nivel 2**, documentando requisitos aplicables, evidencia y excepciones. No se declara cumplimiento ni certificación. [Referencia OWASP](https://asvs.owasp.org/downloads/).

Se inspeccionaron archivos locales y documentación técnica oficial. No se accedió a Cloudflare, al servidor productivo, a la base real ni al procesador de pagos; tampoco se ejecutaron pruebas de penetración ni la suite de pruebas durante esta planificación. Los informes previos se consideran antecedentes, no evidencia actual del despliegue.

### Información por confirmar

| Información | Responsable de aportarla | Impacto |
| --- | --- | --- |
| Dominio, cuenta y modalidad de Cloudflare; plan contratado | Infraestructura | Determina reglas disponibles y superficie pública |
| Ubicación de API y base, proxies intermedios y dominios alternativos | Infraestructura | Determina cierre del origen, TLS y confianza en cabeceras |
| Procesador, adquirente, monedas, países y método de integración | Cliente / finanzas | Determina integración, conciliación y alcance PCI |
| Volumen esperado, horarios de soporte y disponibilidad requerida | Cliente | Determina capacidad, alertas y recuperación |
| Datos realmente necesarios, mercados atendidos y obligaciones de conservación | Cliente / asesoría jurídica | Determina privacidad, retención y contratos |

Mientras se confirma, se asume Cloudflare delante de una API Node.js y PostgreSQL. El repositorio contiene `render.yaml`, pero eso no demuestra que Render siga siendo el origen. Si se usa Pages/Workers, inventariar por separado frontend y API y validar su arquitectura; este plan no presupone que publicar archivos estáticos ejecute el servidor existente.

## 2. Situación observada y riesgos

| ID | Prioridad | Evidencia local y límite | Acción requerida |
| --- | --- | --- | --- |
| SEG-01 | P0, antes de cobros | `server/payment-policy.js` bloquea producción, modo live y webhooks. `server/gateway.js` solo simula cobros | Conservar bloqueo hasta integrar y verificar el procesador; no resolverlo eliminando la protección |
| SEG-02 | P0 | `public/js/checkout.js` muestra campos de tarjeta y construye `tok_demo_*` localmente; eso no es tokenización de proveedor | Retirar captura simulada del flujo productivo y usar checkout alojado o campos del proveedor |
| SEG-03 | P0, verificación pendiente | `docs/P0-REMEDIACION.md` reporta secretos en datos e historial de una revisión anterior; no se verificó vigencia ni exposición actual | Inventariar y escanear árbol, historial y artefactos sin imprimir valores; revocar cualquier secreto válido expuesto |
| SEG-04 | P0, despliegue desconocido | No se inspeccionó la cuenta de Cloudflare ni el origen | Probar TLS, protección del administrador, ausencia de caché privada y bloqueo del acceso alternativo |
| SEG-05 | P1, antes de datos reales | `server/tls-config.js` permite `rejectUnauthorized: false` para ciertos nombres internos de Render con `require` | Usar verificación de CA e identidad para producción. El formato del nombre no prueba una red confiable; eliminar esa dependencia o documentar una solución de transporte autenticado validada |
| SEG-06 | P1 | CSP en `server/index.js` admite scripts inline y proveedores de analítica | Reducir scripts; aplicar nonces/hashes y política específica para páginas sensibles |
| SEG-07 | P1, validación pendiente | Ya existen `StoreTransaction`, bloqueo `FOR UPDATE` y limitación compartida en PostgreSQL | Validar concurrencia real y fallos; no repetir como hecho actual la ausencia de transacciones descrita en informes anteriores |
| SEG-08 | P1 | Hay tokens privados de reserva en URLs del checkout | Evitar filtración a analítica, registros, historial y Referer; reemplazarlos por canje de un solo uso y sesión limitada |
| SEG-09 | P1 | README e informes anteriores describen comportamientos distintos del código actual | Actualizar manuales, variables y procedimientos antes de entregar |

P0 bloquea cobros; P1 debe cerrarse antes de operar con datos personales reales, salvo excepción justificada con control compensatorio, responsable y vencimiento. Riesgos críticos o altos sobre autorización, credenciales y pagos no deben aceptarse solo para cumplir una fecha comercial.

Defensas observadas: validación de origen y proxies en `request-security.js`, respuestas JSON con `no-store`, controles de rol, carga de secretos desde entorno y transacciones. Su existencia no demuestra cobertura completa de rutas ni configuración correcta en producción.

## 3. Arquitectura objetivo y límites de confianza

```text
Visitante → HTTPS → Cloudflare → canal autenticado → API Node.js
                                                    ├→ PostgreSQL privado
                                                    ├→ proveedor de correo
                                                    └→ API del procesador
Visitante → checkout alojado del procesador
Procesador → webhook firmado → Cloudflare → API → registro transaccional
Administrador → Access + MFA → panel/API administrativa + autorización local
```

Todos los datos del navegador son no confiables: precio, moneda, cantidad, identidad, rol y estado de pago se verifican en servidor. Un retorno de navegador a “pago exitoso” no confirma un cobro. Toda consulta o modificación de reserva debe comprobar titularidad o una autorización limitada explícita.

Separar desarrollo, pruebas y producción: bases, credenciales, dominios y cuentas de proveedor diferentes. Usar datos sintéticos en pruebas. Cuenta Cloudflare, dominio y procesador deben pertenecer al cliente, con acceso delegado nominal para el equipo.

## 4. Configuración de Cloudflare y del origen

1. **Cuentas y DNS:** MFA para administradores, cuentas individuales, mínimo privilegio, recuperación custodiada y tokens API restringidos. Activar DNSSEC después de validar coordinación con el registrador. Registrar y revisar cambios de DNS y reglas.
2. **HTTPS:** para un origen externo, Full (strict), certificado vigente con identidad correcta, redirección HTTPS y TLS mínimo 1.2. Activar HSTS gradualmente tras validar todos los servicios; `includeSubDomains` y preload requieren revisión específica. [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).
3. **Origen:** impedir acceso público que eluda Cloudflare, incluidos dominios del proveedor y previews. Evaluar Tunnel o restricciones de red y autenticación del origen según soporte real. Una lista de IP de Cloudflare por sí sola no identifica nuestra zona. Probar que peticiones directas no accedan a rutas privadas. En Pages/Workers, comprobar también dominios alternativos y despliegues de prueba.
4. **Proxies:** configurar `PUBLIC_URL` y `TRUSTED_PROXY_CIDRS` según la cadena real. Confiar únicamente en proxies administrados que saneen cabeceras. Probar falsificación de `X-Forwarded-For` y `X-Forwarded-Proto` y comprobar IP y cookie segura detrás de todos los saltos.
5. **Administración:** proteger `/admin.html` y todas las rutas `/api/admin/*`, incluido login, con Cloudflare Access y MFA del proveedor de identidad. Mantener autenticación y roles en la aplicación. Probar que el origen no permita omitir Access. [Aplicaciones Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/).
6. **WAF:** activar las reglas administradas disponibles y ajustar falsos positivos en pruebas. Crear controles para abuso de login, registros, consulta de reservas, creación de reservas y pagos. Mantener limitación de tasa también en backend; no bloquear a todos los usuarios detrás de una misma red por una política excesivamente restrictiva. Las capacidades y cuotas dependen del plan; inventariarlas antes de contratar. [Rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/).
7. **Bots:** considerar Turnstile en registro y ante abuso de login o reservas. Validar el token en servidor, incluido hostname y acción esperados; rechazar validaciones fallidas. El widget aislado no es una defensa. No exigir retos interactivos al webhook. [Validación Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
8. **Caché:** configurar bypass explícito para `/api/*`, panel, login, reserva, pago, confirmación, comprobante, consulta y verificación de reservas, además de solicitudes con credenciales o tokens. Conservar `Cache-Control: no-store` en respuestas privadas. Revisar Workers, Cache API y reglas que puedan anularlo. Solo cachear recursos públicos. [Reglas por cookie](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/).
9. **Webhook:** cualquier excepción debe limitarse a la ruta y controles necesarios. No omitir firma, límites de cuerpo ni validación de mensajes. La IP del remitente puede complementar la firma, no sustituirla.

**Aceptación:** dos usuarios distintos nunca reciben datos cruzados; respuestas privadas no aparecen como `HIT`; acceso directo al origen denegado; administrador exige MFA; webhook válido funciona sin reto y el inválido se rechaza. Guardar configuración exportada, fecha y resultados sin secretos.

## 5. Pagos y prevención de fraude

Preferir redirección a un checkout alojado por un procesador que admita al comercio, su país y moneda. Como alternativa, campos alojados del proveedor con revisión del alcance. PAN y CVV no deben pasar por formularios propios, API, logs, analítica, correos ni respaldos. No almacenar CVV.

Externalizar el cobro reduce exposición, pero no elimina responsabilidades. Confirmar con adquirente/procesador la elegibilidad del SAQ aplicable y conservar su evidencia PCI. Para formularios embebidos, revisar también el criterio de protección frente a ataques mediante scripts. No afirmar que usar Cloudflare o un checkout externo equivale a cumplir PCI DSS. [PCI SSC: elegibilidad y scripts](https://www.pcisecuritystandards.org/faqs/1588/).

Requisitos de implementación:

- Crear órdenes desde el servidor con importe calculado, moneda, reserva, comercio y entorno correctos; usar unidades monetarias enteras cuando corresponda al proveedor.
- Usar identificadores únicos e idempotencia persistente por intento, evento y reembolso. Repetir una petición nunca debe duplicar un efecto económico.
- Verificar webhook mediante el protocolo oficial sobre el cuerpo original, autenticidad y controles de antigüedad/repetición previstos por el proveedor. Comprobar ID, importe, moneda, comercio y estado; consultar la API cuando sea necesario.
- Persistir evento y cambio de estado en una transacción antes de confirmar recepción. Ejecutar correo y otras tareas con cola/outbox durable y reintentos seguros. No mantener bloqueos largos mientras se espera una API externa.
- Manejar eventos duplicados, fuera de orden, retrasados y cobros cuyo resultado quedó incierto por timeout. Antes de reintentar un cobro incierto, consultar su resultado.
- Definir qué ocurre cuando un pago llega después del vencimiento del cupo: revisión y reembolso o reasignación autorizada; nunca sobreventa silenciosa.
- Conciliar diariamente órdenes, cobros, devoluciones y liquidaciones del proveedor; alertar discrepancias. Tratar contracargos como proceso separado.
- Aplicar autenticación adicional/3DS y reglas antifraude según capacidades y obligaciones del proveedor. Limitar intentos por cuenta, reserva e IP.
- Separar permisos de consulta, confirmación operativa y reembolso; exigir reautenticación y doble aprobación para importes que el cliente determine. No marcar “reembolsado” por pulsar un botón sin confirmación persistida del proveedor.

## 6. Aplicación, identidad y datos

### Autenticación y autorización

- Cuentas administrativas nominales; retirar credenciales compartidas y accesos de demostración. MFA para acceso privilegiado y procedimiento seguro de recuperación.
- Revisar hashing de contraseñas, parámetros y límites de entrada; permitir contraseñas largas. Bloquear credenciales comunes/comprometidas y limitar intentos sin facilitar denegación de servicio por bloqueo de cuentas.
- Cookies `Secure`, `HttpOnly`, alcance mínimo y `SameSite` compatible con el flujo verificado. Rotar sesión al autenticar o cambiar privilegios; revocar al cerrar sesión, recuperar cuenta o cambiar contraseña. Objetivo propuesto para administración: 15 minutos de inactividad y 8 horas máximas.
- Probar autorización en cada endpoint con usuario A, usuario B, anónimo y administrador. Incluir comprobantes, exportaciones, archivos y reembolsos. El correo del titular no constituye un segundo factor secreto.
- En OAuth, verificar state de un solo uso, vinculación segura, correo verificado y redirecciones permitidas. Revisar continuidad del state ante reinicios y múltiples instancias; actualmente se observa un mapa en memoria.
- Revisar recuperación/verificación de correo si se habilitan: tokens aleatorios, uso único, vencimiento, almacenamiento protegido y respuestas que no enumeren cuentas.

### Entrada, navegador y archivos

- Validar esquema, tipo, longitud, rangos, estado y campos admitidos en backend; SQL parametrizado y límites de tamaño/tiempo en peticiones.
- Conservar protección CSRF en operaciones con cookies; CORS limitado a orígenes necesarios. Probar también peticiones sin Origin y desde subdominios no confiables.
- Eliminar scripts inline inseguros progresivamente con CSP inicialmente en reporte y luego aplicada; usar nonces o hashes. Restringir `frame-ancestors`, destinos de conexión y formularios según integración. Mantener `nosniff` y política de Referer restrictiva en páginas sensibles.
- Retirar GTM y analítica innecesaria de páginas con credenciales, enlaces privados o pagos. Prohibir correo, nombre, teléfono, tokens y URLs privadas en eventos. Revisar permisos de publicación de etiquetas.
- Canjear enlaces privados por autorización temporal y retirar el token de la URL antes de cargar terceros; aplicar expiración, revocación y redacción en todos los registros, incluido el perímetro.
- Subidas: comprobar contenido real, tamaño y dimensiones, recodificar imágenes, evitar HTML/SVG activos, usar nombres generados y limitar acceso. Restringir destinos externos configurables para evitar SSRF, en particular funciones de correo/pruebas administrativas.

### Base, secretos y privacidad

- PostgreSQL privado con usuario exclusivo de mínimo privilegio; separar credenciales de migración y ejecución. Un esquema separado de un CRM no equivale a aislamiento si comparten usuario con permisos amplios.
- Verificar cifrado de discos y respaldos con el proveedor; claves y acceso administrados. TLS autenticado para base y correo.
- Guardar secretos en el gestor del entorno, sin retornarlos al frontend ni guardarlos en el documento JSONB. Rotar al detectar exposición o cambio de personal; inventariar propietario y uso.
- Validar transacciones contra PostgreSQL real. El documento JSONB con bloqueo global puede limitar capacidad; medir contención. Para pagos, preferir registros de órdenes, eventos y reembolsos con restricciones únicas e integridad explícita.
- Inventariar datos, finalidad, acceso y plazo de conservación. Recoger solo lo necesario. Tratar bandeja de correo, adjuntos y copias como datos personales.
- Aprobar aviso de privacidad, términos de reserva/reembolso, contratos de encargados y procedimiento de acceso/corrección/eliminación. Asesoría jurídica debe determinar obligaciones por país, clientes y tratamiento; este documento no fija plazos legales.
- Definir retención por categoría y eliminación verificable, incluyendo caducidad de copias y reaplicación de bajas tras restaurar. Separar conservación contable exigible de datos opcionales de marketing.

## 7. Operación, continuidad e incidentes

| Control | Objetivo propuesto / evidencia | Responsable |
| --- | --- | --- |
| Auditoría | Actor, acción, recurso, fecha UTC, resultado y correlación; cambios de roles, reservas, precios, pagos, reembolsos y secretos. Destino separado con acceso restringido y protección contra alteración | Desarrollo + infraestructura |
| Minimización de logs | No registrar cuerpos completos, cookies, tokens, claves, PAN/CVV ni URLs privadas; probar redacción también ante errores | Desarrollo |
| Alertas | Detectar abuso, acceso privilegiado anómalo, firmas inválidas, fallos de persistencia, discrepancias monetarias, caída del servicio y backup fallido | Operaciones |
| Parches | Evaluar críticas explotadas en 24 h; objetivo de corrección/mitigación 48 h, altas 7 días y medias 30 días, ajustado al riesgo | Mantenimiento |
| Cadena de suministro | Lockfile revisado, instalación reproducible, runtime con soporte, análisis de dependencias y secretos, revisión antes de producción | Desarrollo |
| Recuperación | RPO objetivo ≤15 min y RTO ≤4 h, sujetos a aprobación y prueba; requieren capacidad de recuperación acorde, no solo copia diaria | Infraestructura |
| Respaldos | Cifrados, automáticos, copia aislada y credenciales separadas; propuesta de 30 días de retención operativa sujeta a política. Incluir base, medios y configuración recuperable | Infraestructura |
| Restauración | Prueba inicial y trimestral en entorno aislado; medir tiempos, integridad y conciliación de pagos posteriores al punto restaurado | Infraestructura + finanzas |
| Accesos | Revisión trimestral y revocación inmediata al terminar relación laboral/contractual | Cliente |

RPO es la pérdida temporal máxima de datos tolerable; RTO, el tiempo máximo de recuperación. Estos valores son objetivos de diseño, no garantías del servicio actual. Si la infraestructura no los sostiene, presupuestar otra capacidad o acordar objetivos distintos antes de la entrega.

**Procedimiento de incidente:**

1. Registrar alerta y asignar coordinador; objetivo propuesto de acuse: 30 minutos dentro de la cobertura contratada. El cliente debe definir guardia fuera de horario.
2. Contener: suspender cobros o ruta afectada, revocar sesiones/credenciales comprometidas y preservar registros con integridad. Evitar borrar evidencia.
3. Determinar alcance: usuarios, datos, movimientos económicos, inicio y vector. Coordinar con proveedor de pagos si hay posible fraude.
4. Corregir causa, rotar secretos necesarios, restaurar desde punto confiable y conciliar movimientos antes de reabrir.
5. Cliente y asesoría jurídica deciden comunicaciones y notificaciones conforme a obligaciones aplicables. Mantener contactos del proveedor y responsables en un registro privado.
6. Emitir informe posterior con causa, impacto, evidencias, acciones y responsables. Simular el procedimiento antes de producción y al menos anualmente.

## 8. Ejecución y presupuesto

Estimación inicial: **4–6 semanas** para un desarrollador con apoyo de infraestructura y revisión de seguridad. Es una estimación de planificación, condicionada al alcance final, calidad del despliegue y contratación de la pasarela; no incluye esperas del adquirente. Las fases pueden solaparse una vez resueltas sus dependencias.

| Fase | Ventana orientativa | Entregable y dependencia | Responsable |
| --- | --- | --- | --- |
| 0. Inventario y contención | Días 1–3 | Arquitectura real, secretos revisados, pagos bloqueados, riesgos priorizados | Desarrollo + infraestructura |
| 1. Perímetro e identidad | Semana 1 | TLS/origen/caché/Access, MFA y pruebas de aislamiento | Infraestructura + desarrollo |
| 2. Aplicación y datos | Semanas 2–3 | Autorización, CSP, privacidad, respaldo restaurado y concurrencia probada | Desarrollo + infraestructura |
| 3. Pagos | Semanas 3–4 | Checkout, webhook, idempotencia, devoluciones y conciliación; requiere proveedor contratado | Desarrollo + finanzas |
| 4. Validación y entrega | Semanas 5–6 | Revisión independiente, correcciones, acta de salida y manual operativo | Seguridad + cliente |

Cotizar por separado: controles Cloudflare necesarios, alojamiento y base con respaldo/recuperación, monitorización y logs, correo, comisiones del procesador, prueba de penetración y mantenimiento con cobertura de incidentes. No elegir plan únicamente por su nombre o precio: comparar controles, límites, retención y soporte necesarios. El cliente designa responsables nominales y aprueba costos recurrentes antes de operar.

## 9. Pruebas obligatorias y criterio de salida

Ejecutar en entorno aislado representativo, con datos sintéticos y pasarela de pruebas. Guardar versión desplegada, fecha, responsable, resultado esperado/obtenido y evidencia saneada. Las pruebas existentes `test:p0` y `test` son punto de partida; no sustituyen integración real ni revisión independiente.

| Prueba | Resultado requerido |
| --- | --- |
| Usuario A consulta/modifica reserva de B | Denegación sin datos privados ni cambio de estado |
| Escalada de privilegios / rutas admin / origen alternativo | Denegación y MFA exigida donde corresponde |
| CSRF, XSS y entradas malformadas | Sin ejecución, mutaciones no autorizadas ni datos sensibles en errores |
| Precio/moneda/total manipulados | Servidor rechaza o usa valores autorizados; nunca cobra el importe del navegador |
| Webhook inválido, repetido y fuera de orden | Firma inválida rechazada; cada evento produce como máximo un efecto; estados coherentes |
| Doble clic, timeout y reintento de pago/reembolso | Sin doble cargo ni devolución; resultado conciliable |
| Pago tardío y reservas concurrentes del último cupo | Sin sobreventa; política de pago tardío aplicada |
| Caída antes/después de commit y reinicio de instancia | Sin éxito ficticio, pérdida silenciosa ni correo contradictorio |
| Dos sesiones y reglas de caché reales | Ninguna respuesta privada compartida o almacenada en CDN |
| Token privado y datos personales | Ausentes de analítica, logs no autorizados y solicitudes a terceros |
| TLS inválido, proxy falsificado, origen directo | Rechazo seguro sin degradación del transporte |
| Restauración y conciliación | RPO/RTO medidos, integridad demostrada y movimientos reconciliados |

**Acta de autorización de producción:**

- [ ] Arquitectura y proveedores confirmados; responsables y soporte asignados.
- [ ] P0 cerrados; sin vulnerabilidades críticas/altas abiertas en pagos, identidad o datos.
- [ ] Resto de excepciones documentadas con compensación y fecha de vencimiento.
- [ ] Revisión ASVS aplicable y prueba independiente completadas; hallazgos corregidos y reprobados.
- [ ] Pasarela validada, alcance PCI acordado con adquirente y evidencias archivadas.
- [ ] Credenciales de prueba retiradas; secretos expuestos revocados y distribución saneada.
- [ ] Accesos, TLS, origen, WAF, caché y alertas verificados en configuración real.
- [ ] Copia restaurada, continuidad probada y procedimiento de incidentes ensayado.
- [ ] Privacidad, retención y políticas comerciales aprobadas por el cliente.
- [ ] Manuales actualizados; plan de reversión y apagado de cobros probado.
- [ ] Cliente y responsables técnicos firman aceptación de evidencia y riesgos residuales.

Entregar al cliente este plan, inventario, matriz de riesgos, resultados de pruebas, configuración saneada, manual de operación, calendario de mantenimiento y acta. Las credenciales se transfieren por canal seguro separado. La firma del acta autoriza operar bajo los controles demostrados; no constituye garantía absoluta ni certificación PCI.
