import { getConfig, getRuntime } from './runtime.js';
import { safeErrorMessage } from './safe-errors.js';
import crypto from 'node:crypto';
import { getDb, saveDb, withStoreTransaction, formatDateLong, dateToEpoch } from './store.js';
const sendSmtpMail = message => getRuntime().sendMail(message);

const money = (n, currency = getDb().settings.booking.currency) =>
  new Intl.NumberFormat('es-GT', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n || 0));

function baseUrl() {
  const d = getDb();
  return (
    getConfig().PUBLIC_URL ||
    d.settings.business.siteUrl ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function layout({ preheader, title, body, cta, ctaUrl, ctaSecondary, ctaSecondaryUrl, note }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f2ede2;font-family:Georgia,'Times New Roman',serif;color:#16211d;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2ede2;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#fffdf7;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(14,36,32,.14);">
  <tr><td style="background:#0e2420;padding:26px 34px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#b8d98c;">K’anba · Cuevas Vivas</div>
    <div style="font-family:Georgia,serif;font-size:27px;color:#f6f1e6;margin-top:6px;line-height:1.1;">Donde el río se esconde</div>
  </td></tr>
  <tr><td style="padding:34px 34px 10px;">
    <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin:0 0 14px;color:#0e2420;font-weight:normal;">${esc(title)}</h1>
    ${body}
    ${(cta || ctaSecondary) ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px;"><tr>
      ${cta ? `<td style="border-radius:999px;background:#2f6b57;padding-right:12px;">
        <a href="${esc(ctaUrl)}" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#fffdf7;text-decoration:none;border-radius:999px;">${esc(cta)}</a>
      </td>` : ''}
      ${ctaSecondary ? `<td style="border-radius:999px;background:#0e2420;">
        <a href="${esc(ctaSecondaryUrl)}" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#b8d98c;text-decoration:none;border-radius:999px;border:1px solid rgba(184,217,140,.4);">${esc(ctaSecondary)}</a>
      </td>` : ''}
    </tr></table>` : ''}
  </td></tr>
  <tr><td style="padding:16px 34px 30px;">
    ${note ? `<div style="background:#f2ede2;border-radius:12px;padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#4a5b53;">${note}</div>` : ''}
  </td></tr>
  <tr><td style="background:#0e2420;padding:22px 34px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#a9bdb3;">
    <strong style="color:#f6f1e6;">K’anba Cuevas Vivas</strong><br>
    Lanquín, Alta Verapaz, Guatemala · +502 4000 2026<br>
    <a href="${baseUrl()}" style="color:#b8d98c;text-decoration:none;">kanba.gt</a> · Este es un correo transaccional generado automáticamente.
  </td></tr>
</table>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#8a9a92;padding:16px 8px;">Sitio y sistema demostrativos. No es el sitio oficial de las Cuevas de K’anba.</div>
</td></tr></table></body></html>`;
}

function receiptEmailCard(r) {
  const total = Number(r.total || 0);
  const net = Math.round((total / 1.12) * 100) / 100;
  const iva = Math.round((total - net) * 100) / 100;
  const issuedDate = new Date(r.receipt?.issuedAt || r.paidAt || Date.now()).toLocaleDateString('es-GT', {
    timeZone: 'America/Guatemala',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  const paymentMethod = r.payment?.brand ? `${r.payment.brand} ****${r.payment.last4 || '4242'}` : 'Tarjeta ****4242';
  const paymentRef = r.payment?.reference || 'PAY-JR5JFD59';
  const provider = r.payment?.provider || 'KanbaPay Sandbox';

  return `
    <div style="background:#ffffff;border:1px solid #e5ded0;border-radius:12px;padding:26px 28px;margin:24px 0;box-shadow:0 8px 30px rgba(14,36,32,.08);position:relative;overflow:hidden;">
      <div style="height:4px;background:linear-gradient(90deg,#123c32,#b8d98c,#e8b56a);position:absolute;top:0;left:0;right:0;"></div>
      
      <!-- Encabezado comprobante -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-bottom:2px solid #0e2420;padding-bottom:18px;margin-bottom:20px;">
        <tr>
          <td valign="top" style="width:55%;">
            <div style="font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#0e2420;line-height:1;">K’anba</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.28em;text-transform:uppercase;color:#2f6b57;font-weight:bold;margin-top:3px;">Cuevas Vivas · Lanquín</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#6b7c73;margin-top:6px;">K’anba Cuevas Vivas · Operadora local</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#6b7c73;">Lanquín, Alta Verapaz, Guatemala · NIT 1234567-8</div>
          </td>
          <td valign="top" align="right" style="width:45%;">
            <div style="font-family:Georgia,serif;font-size:19px;font-weight:bold;color:#0e2420;text-transform:uppercase;letter-spacing:.05em;">COMPROBANTE</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;font-weight:bold;color:#0e2420;margin-top:3px;">${esc(r.receipt?.number || 'REC-2026-00488')}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#7b8c83;margin-top:3px;">Emitido: ${esc(issuedDate)}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#2f6b57;font-weight:bold;margin-top:3px;">Pago aprobado</div>
          </td>
        </tr>
      </table>

      <!-- Partes / Facturado a y Reserva -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
        <tr>
          <td valign="top" style="width:50%;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.15em;text-transform:uppercase;color:#7b8c83;font-weight:bold;margin-bottom:4px;">FACTURADO A</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;font-weight:bold;color:#0e2420;">${esc(r.customer?.name || '')}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#55685f;margin-top:2px;">${esc(r.customer?.email || '')}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#55685f;">${esc(r.customer?.phone || '')}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#55685f;">${esc(r.customer?.country || 'Guatemala')}</div>
          </td>
          <td valign="top" style="width:50%;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.15em;text-transform:uppercase;color:#7b8c83;font-weight:bold;margin-bottom:4px;">RESERVA</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;font-weight:bold;color:#0e2420;">${esc(r.code)}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#55685f;margin-top:2px;">${esc(r.tourName)}</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#55685f;">${esc(formatDateLong(r.date))} · ${esc(r.time)} h</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#55685f;">${esc(r.participants)} ${r.participants === 1 ? 'participante' : 'participantes'}</div>
          </td>
        </tr>
      </table>

      <!-- Tabla de conceptos -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-bottom:18px;">
        <thead>
          <tr style="border-bottom:1px solid #0e2420;">
            <th align="left" style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">DESCRIPCIÓN</th>
            <th align="center" style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">CANT.</th>
            <th align="right" style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">PRECIO UNIT.</th>
            <th align="right" style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">IMPORTE</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #e5ded0;">
            <td style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#0e2420;font-weight:600;">
              ${esc(r.tourName)}
              <div style="font-size:9.5px;color:#7b8c83;font-weight:normal;margin-top:2px;">Guía local, casco, chaleco salvavidas y entrada</div>
            </td>
            <td align="center" style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#0e2420;">${esc(r.participants)}</td>
            <td align="right" style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#0e2420;">${money(r.unitPrice || (r.total / r.participants), r.currency)}</td>
            <td align="right" style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#0e2420;font-weight:600;">${money(r.total, r.currency)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Totales -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:18px;">
        <tr>
          <td style="width:55%;"></td>
          <td style="width:45%;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#7b8c83;">Subtotal</td>
                <td align="right" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#0e2420;font-weight:600;">${money(net, r.currency)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#7b8c83;">IVA incluido (12%)</td>
                <td align="right" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#0e2420;font-weight:600;">${money(iva, r.currency)}</td>
              </tr>
              <tr style="border-top:2px solid #0e2420;">
                <td style="padding:9px 0 0;font-family:Georgia,serif;font-size:14px;font-weight:bold;color:#0e2420;">Total pagado</td>
                <td align="right" style="padding:9px 0 0;font-family:Georgia,serif;font-size:19px;font-weight:bold;color:#0e2420;">${money(total, r.currency)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Franja inferior de datos de pago -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f3ea;border-radius:8px;padding:12px 16px;border:1px solid #e5ded0;">
        <tr>
          <td style="font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">
            MÉTODO DE PAGO<br>
            <strong style="font-size:11px;color:#0e2420;">${esc(paymentMethod)}</strong>
          </td>
          <td style="font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">
            REFERENCIA<br>
            <strong style="font-size:11px;color:#0e2420;">${esc(paymentRef)}</strong>
          </td>
          <td style="font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">
            PASARELA<br>
            <strong style="font-size:11px;color:#0e2420;">${esc(provider)}</strong>
          </td>
          <td style="font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#7b8c83;font-weight:bold;">
            FECHA DE PAGO<br>
            <strong style="font-size:11px;color:#0e2420;">${esc(issuedDate)}</strong>
          </td>
        </tr>
      </table>

      <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #d6cebe;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;line-height:1.6;color:#85968d;">
        <strong>Notas:</strong> Los precios se expresan en ${esc(r.currency)} e incluyen impuestos. Este documento es un comprobante de pago demostrativo. Para cualquier gestión o consulta escribe a reservas@kanba.gt con el número de reserva.
      </div>
    </div>
  `;
}

function reservationTable(r, { showPayment = false } = {}) {
  const rows = [
    ['Reserva', r.code],
    ['Tour', r.tourName],
    ['Fecha', formatDateLong(r.date)],
    ['Horario', `${r.time} h (GMT-6)`],
    ['Participantes', String(r.participants)],
    ['Punto de encuentro', r.meetingPoint || 'Recepción K’anba · desvío antes del puente']
  ];
  if (showPayment) {
    rows.push(['Método de pago', r.payment?.brand ? `${r.payment.brand} ····${r.payment.last4}` : 'Pasarela en línea']);
    rows.push(['Referencia', r.payment?.reference || '—']);
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;border-top:1px solid #e4ddcd;border-bottom:1px solid #e4ddcd;">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:9px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7b8c83;width:42%;">${esc(k)}</td>
      <td style="padding:9px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#16211d;text-align:right;">${esc(v)}</td>
    </tr>`).join('')}
    <tr>
      <td style="padding:14px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7b8c83;">Total</td>
      <td style="padding:14px 0 8px;text-align:right;font-family:Georgia,serif;font-size:24px;color:#0e2420;">${money(r.total, r.currency)}</td>
    </tr>
  </table>`;
}

const p = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#33443c;margin:0 0 14px;';

function templates(r, extra = {}) {
  const url = baseUrl();
  const receiptUrl = `${url}/comprobante.html?code=${encodeURIComponent(r.code)}&token=${encodeURIComponent(r.token)}`;
  const confirmUrl = `${url}/confirmacion.html?code=${encodeURIComponent(r.code)}&token=${encodeURIComponent(r.token)}`;
  const payUrl = `${url}/pago.html?code=${encodeURIComponent(r.code)}&token=${encodeURIComponent(r.token)}`;
  const manageUrl = `${url}/mi-reserva.html?code=${encodeURIComponent(r.code)}&email=${encodeURIComponent(r.customer.email)}`;
  const minutes = extra.holdMinutes || 20;

  return {
    pending: {
      subject: `Completa tu pago · ${r.code} · K’anba`,
      preheader: `Tus cupos están bloqueados por ${minutes} minutos.`,
      title: 'Tus cupos están apartados',
      body: `<p style="${p}">Hola ${esc(r.customer.name)},</p>
        <p style="${p}">Recibimos tu solicitud para <strong>${esc(r.tourName)}</strong>. Bloqueamos tus cupos durante <strong>${minutes} minutos</strong>. La reserva se confirma únicamente cuando la pasarela aprueba el pago.</p>
        ${reservationTable(r)}
        <p style="${p}">Si el plazo vence, los cupos se liberan automáticamente y la reserva expira. Puedes intentarlo de nuevo desde la página.</p>`,
      cta: 'Completar el pago',
      ctaUrl: payUrl,
      note: `<strong>Importante:</strong> el bloqueo vence el ${esc(new Date(r.holdExpiresAt).toLocaleString('es-GT', { timeZone: 'America/Guatemala' }))}. Lleva calzado que se pueda mojar y ropa de cambio.`
    },
    confirmation: {
      subject: `Reserva confirmada · ${r.code} · K’anba`,
      preheader: 'Tu pago fue aprobado. Comprobante digital y gestión de tu tour.',
      title: '¡Tu tour está confirmado!',
      body: `<p style="${p}">Hola ${esc(r.customer.name)},</p>
        <p style="${p}">Tu pago fue aprobado exitosamente y tus cupos en <strong>${esc(r.tourName)}</strong> ya están asegurados. Guarda este correo con tu comprobante digital y código de reserva <strong>${esc(r.code)}</strong>.</p>
        ${receiptEmailCard(r)}
        <p style="${p}"><strong>Información para tu visita:</strong> Llega con 20 minutos de anticipación a la recepción de K’anba (antes del puente de Semuc Champey). Te recomendamos llevar calzado cerrado que se pueda mojar, traje de baño puesto y ropa seca de cambio.</p>`,
      cta: 'Gestionar tour',
      ctaUrl: manageUrl,
      ctaSecondary: 'Ver comprobante imprimible',
      ctaSecondaryUrl: receiptUrl,
      note: `¿Necesitas hacer cambios? Puedes consultar o gestionar tu tour directamente desde el botón superior o escribiéndonos a reservas@kanba.gt indicando tu código <strong>${esc(r.code)}</strong>.`
    },
    receipt: {
      subject: `Comprobante ${r.receipt?.number || ''} · ${r.code} · K’anba`,
      preheader: 'Tu comprobante de pago digital oficial.',
      title: 'Comprobante de pago',
      body: `<p style="${p}">Hola ${esc(r.customer.name)},</p>
        <p style="${p}">Adjuntamos tu comprobante oficial por la reserva <strong>${esc(r.code)}</strong> en Cuevas de K'anba.</p>
        ${receiptEmailCard(r)}`,
      cta: 'Gestionar tour',
      ctaUrl: manageUrl,
      ctaSecondary: 'Abrir comprobante imprimible',
      ctaSecondaryUrl: receiptUrl,
      note: 'Documento no fiscal para fines demostrativos. Conserva el comprobante y preséntalo en recepción junto con tu documento de identidad.'
    },
    expired: {
      subject: `Tu reserva expiró · ${r.code} · K’anba`,
      preheader: 'El plazo de pago venció y los cupos fueron liberados.',
      title: 'El río siguió su curso',
      body: `<p style="${p}">Hola ${esc(r.customer.name)},</p>
        <p style="${p}">El plazo para completar el pago de la reserva <strong>${esc(r.code)}</strong> venció. Los cupos fueron liberados automáticamente para otros visitantes.</p>
        <p style="${p}">No se realizó ningún cargo. Si aún quieres venir, puedes reservar de nuevo y elegir otro horario disponible.</p>`,
      cta: 'Reservar de nuevo',
      ctaUrl: `${url}/#reservar`,
      note: 'Si crees que esto es un error o el pago se cobró, escríbenos a reservas@kanba.gt con el número de reserva.'
    },
    cancellation: {
      subject: `Cancelación registrada · ${r.code} · K’anba`,
      preheader: extra.refund > 0 ? 'Tu solicitud de reembolso fue registrada.' : 'Tu reserva fue cancelada.',
      title: 'Cancelación registrada',
      body: `<p style="${p}">Hola ${esc(r.customer.name)},</p>
        <p style="${p}">Registramos la cancelación de tu reserva <strong>${esc(r.code)}</strong> para <strong>${esc(r.tourName)}</strong> del ${esc(formatDateLong(r.date))}.</p>
        ${reservationTable(r)}
        <p style="${p}"><strong>Política aplicada:</strong> ${esc(extra.policy || '—')}.<br>
        <strong>Importe de reembolso:</strong> ${money(extra.refund || 0, r.currency)}.</p>
        ${extra.refund > 0
          ? `<p style="${p}">El reembolso quedó registrado con estado <strong>pendiente</strong> y se procesará al medio de pago original en un plazo de 5 a 10 días hábiles. Te enviaremos otro correo cuando esté procesado.</p>`
          : `<p style="${p}">Según la política vigente, esta cancelación no genera reembolso. Si fue por una emergencia, responde a este correo y revisaremos tu caso.</p>`}`,
      cta: 'Ver políticas',
      ctaUrl: `${url}/#politicas`,
      note: 'Motivo registrado: ' + esc(extra.reason || 'No especificado') + '.'
    },
    refund: {
      subject: `Reembolso procesado · ${r.code} · K’anba`,
      preheader: 'Tu reembolso fue procesado.',
      title: 'Reembolso procesado',
      body: `<p style="${p}">Hola ${esc(r.customer.name)},</p>
        <p style="${p}">Procesamos el reembolso de tu reserva <strong>${esc(r.code)}</strong> por <strong>${money(extra.amount || 0, r.currency)}</strong>.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;border-top:1px solid #e4ddcd;border-bottom:1px solid #e4ddcd;">
          <tr><td style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7b8c83;">Referencia</td><td style="padding:10px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:13px;">${esc(extra.reference || '—')}</td></tr>
          <tr><td style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7b8c83;">Método</td><td style="padding:10px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:13px;">${esc(extra.method || 'Medio de pago original')}</td></tr>
          <tr><td style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7b8c83;">Importe</td><td style="padding:10px 0;text-align:right;font-family:Georgia,serif;font-size:21px;">${money(extra.amount || 0, r.currency)}</td></tr>
        </table>
        <p style="${p}">El abono puede tardar de 5 a 10 días hábiles en reflejarse, según tu banco o emisor de tarjeta.</p>`,
      cta: 'Contactar soporte',
      ctaUrl: `mailto:reservas@kanba.gt?subject=${encodeURIComponent('Reembolso ' + r.code)}`,
      note: 'Gracias por viajar con guías locales. Esperamos verte en otra temporada.'
    }
  };
}

function plainText({ title, body }) {
  return `${title}\n\n${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n\nK’anba Cuevas Vivas · Lanquín, Alta Verapaz, Guatemala\n`;
}

function isPermanentSmtpError(errMsg = '') {
  const msg = String(errMsg).toLowerCase();
  // Códigos 5xx típicos de error permanente (535 credenciales, 550 usuario inexistente, 501 sintaxis, etc.)
  if (/smtp (500|501|502|503|504|530|535|550|551|552|553|554)/.test(msg)) return true;
  if (msg.includes('bad credentials') || msg.includes('authentication failed') || msg.includes('auth fail')) return true;
  if (msg.includes('recipient rejected') || msg.includes('user not found') || msg.includes('mailbox unavailable')) return true;
  return false;
}

export function getEffectiveSmtpConfig() {
  const d = getDb();
  // Production transport endpoints are operator-managed, never selected through the panel.
  const dbSmtp = getConfig().NODE_ENV === 'production' ? {} : (d.settings.smtp || {});

  const envHost = getConfig().SMTP_HOST;
  const envPort = getConfig().SMTP_PORT;
  const envSecure = getConfig().SMTP_SECURE;
  const envUser = getConfig().SMTP_USER;
  const envPass = getConfig().SMTP_PASS;
  const envFrom = getConfig().SMTP_FROM;
  const envFromName = getConfig().SMTP_FROM_NAME;

  const hasEnvHost = Boolean(envHost && envHost.trim());
  const hasEnvUser = Boolean(envUser && envUser.trim());
  const hasEnvConfig = hasEnvHost || hasEnvUser;

  const host = (hasEnvHost ? envHost : dbSmtp.host) || '';
  const port = Number((envPort !== undefined ? envPort : dbSmtp.port) || 465);
  const secure = envSecure !== undefined ? envSecure === 'true' : dbSmtp.secure !== false;
  const user = (hasEnvUser ? envUser : dbSmtp.user) || '';
  const pass = envPass || ''; // Never load a credential from persisted settings.
  const fromEmail = (envFrom !== undefined ? envFrom : (dbSmtp.fromEmail || user)) || 'reservas@kanba.gt';
  const fromName = (envFromName !== undefined ? envFromName : (dbSmtp.fromName || 'K’anba Cuevas Vivas')) || 'K’anba Cuevas Vivas';

  let source = 'none';
  if (hasEnvConfig) {
    source = 'env';
  } else if (dbSmtp.host && dbSmtp.host.trim()) {
    source = 'database';
  }

  const isConfigured = getRuntime().mailConfigured ?? Boolean(host && user && pass);

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromEmail,
    fromName,
    source,
    isConfigured,
    hasEnvOverrides: {
      host: Boolean(envHost),
      port: Boolean(envPort),
      secure: Boolean(envSecure),
      user: Boolean(envUser),
      pass: true, // This field is always environment-managed.
      fromEmail: Boolean(envFrom),
      fromName: Boolean(envFromName)
    }
  };
}

export function maskUser(user = '') {
  if (!user) return '—';
  if (user.includes('@')) {
    const [name, domain] = user.split('@');
    const masked = name.length <= 2 ? name[0] + '***' : name.slice(0, 2) + '***' + name.slice(-1);
    return `${masked}@${domain}`;
  }
  if (user.length <= 4) return '***';
  return user.slice(0, 2) + '***' + user.slice(-2);
}

export function getPublicSmtpStatus() {
  const cfg = getEffectiveSmtpConfig();
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    userMasked: maskUser(cfg.user),
    fromEmail: cfg.fromEmail,
    fromName: cfg.fromName,
    source: cfg.source, // 'env' | 'database' | 'none'
    isConfigured: cfg.isConfigured,
    hasEnvOverrides: cfg.hasEnvOverrides
  };
}

export async function testSmtpConnection(testRecipient) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!testRecipient || !emailRegex.test(String(testRecipient).trim())) {
    throw new Error('Dirección de correo de prueba inválida.');
  }
  const cleanTo = String(testRecipient).trim();
  const cfg = getEffectiveSmtpConfig();
  if (!cfg.isConfigured) {
    throw new Error('El servicio SMTP no está configurado (falta host o usuario en variables de entorno o base de datos).');
  }

  const testSubject = `Prueba de conexión SMTP · K’anba (${new Date().toLocaleTimeString('es-GT', { timeZone: 'America/Guatemala' })})`;
  const testHtml = layout({
    preheader: 'Comprobación de envío exitosa',
    title: 'Conexión SMTP exitosa',
    body: `<p style="${p}">Este es un correo de prueba enviado desde el Panel de Administración de <strong>K’anba Cuevas Vivas</strong>.</p>
           <p style="${p}">La conexión con el servidor <code>${esc(cfg.host)}:${cfg.port}</code> se estableció y autenticó correctamente.</p>`,
    note: `Origen de la configuración: <strong>${cfg.source === 'env' ? 'Variables de entorno (Render)' : 'Base de datos (Panel Admin)'}</strong>.`
  });
  const testText = plainText({
    title: 'Conexión SMTP exitosa',
    body: `Este es un correo de prueba enviado desde el Panel de Administración de K’anba Cuevas Vivas. Servidor: ${cfg.host}:${cfg.port}.`
  });

  await sendSmtpMail({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    pass: cfg.pass,
    fromEmail: cfg.fromEmail,
    fromName: cfg.fromName,
    to: cleanTo,
    subject: testSubject,
    html: testHtml,
    text: testText
  });

  return { ok: true, recipient: cleanTo, host: cfg.host, source: cfg.source };
}

// Claim a committed outbox record, send outside the transaction, then acknowledge.
// SMTP delivery is at-least-once; a crash after delivery can cause a retry.
export async function processEmailRetryQueue(shouldContinue = () => true) {
  try {
    for (let index = 0; index < 20 && shouldContinue(); index++) {
      const claim = await withStoreTransaction(() => {
        const cfg = getEffectiveSmtpConfig();
        if (!cfg.isConfigured) return null;
        const now = Date.now();
        for (const mail of getDb().emails) {
          if (mail.attempts >= 5 && (mail.status === 'queued' || (mail.status === 'sending' && (!mail.leaseExpiresAt || Date.parse(mail.leaseExpiresAt) <= now)))) {
            mail.status = 'failed';
            delete mail.claimId;
            delete mail.leaseExpiresAt;
            saveDb();
          }
        }
        const record = getDb().emails.find(mail => !mail.permanentFailed && mail.attempts < 5 &&
          ((mail.status === 'queued' && (!mail.nextAttemptAt || Date.parse(mail.nextAttemptAt) <= now)) ||
           (mail.status === 'sending' && (!mail.leaseExpiresAt || Date.parse(mail.leaseExpiresAt) <= now))));
        if (!record) return null;
        record.status = 'sending';
        record.attempts = (record.attempts || 0) + 1;
        record.claimId = crypto.randomUUID();
        record.leaseExpiresAt = new Date(now + 120000).toISOString();
        saveDb();
        return { cfg, record: structuredClone(record) };
      });
      if (!claim) break;
      let failure;
      try {
        await sendSmtpMail({ ...claim.cfg, to: claim.record.to, subject: claim.record.subject,
          html: claim.record.html, text: claim.record.text, messageId: claim.record.id });
      } catch (error) { failure = error; }
      await withStoreTransaction(() => {
        const record = getDb().emails.find(mail => mail.id === claim.record.id);
        if (!record || record.claimId !== claim.record.claimId) return;
        delete record.leaseExpiresAt;
        delete record.claimId;
        if (!failure) {
          record.status = 'sent';
          record.provider = getConfig().MAIL_API_URL ? 'https' : 'smtp';
          record.error = null;
          record.sentAt = new Date().toISOString();
        } else {
          record.error = safeErrorMessage(failure);
          record.permanentFailed = isPermanentSmtpError(failure.message);
          record.status = record.permanentFailed || record.attempts >= 5 ? 'failed' : 'queued';
          record.nextAttemptAt = new Date(Date.now() + record.attempts ** 2 * 60000).toISOString();
        }
        saveDb();
      });
    }
  } finally { /* Leases are persisted in PostgreSQL. */ }
}

export async function sendMail({ to, template, reservation, extra = {} }) {
  const d = getDb();
  const tpl = templates(reservation, extra)[template];
  if (!tpl) throw new Error(`Plantilla de correo desconocida: ${template}`);

  const html = layout({
    preheader: tpl.preheader,
    title: tpl.title,
    body: tpl.body,
    cta: tpl.cta,
    ctaUrl: tpl.ctaUrl,
    ctaSecondary: tpl.ctaSecondary,
    ctaSecondaryUrl: tpl.ctaSecondaryUrl,
    note: tpl.note
  });
  const text = plainText(tpl);
  const record = {
    id: `mail_${crypto.randomUUID()}`,
    to,
    subject: tpl.subject,
    template,
    reservationCode: reservation.code,
    status: 'queued',
    provider: 'outbox',
    attempts: 0,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
    html,
    text,
    error: null
  };
  d.emails.unshift(record);
  // Persist in the same transaction as the reservation. Worker sends only after commit.
  saveDb();
  return record;
}

export function resendMail(reservation, template) {
  const extra = {
    holdMinutes: getDb().settings.booking.holdMinutes,
    refund: reservation.cancellation?.refundAmount || 0,
    policy: reservation.cancellation?.policy,
    reason: reservation.cancellation?.reason,
    amount: reservation.cancellation?.refundAmount || 0,
    reference: reservation.refund?.reference,
    method: reservation.refund?.method
  };
  return sendMail({ to: reservation.customer.email, template, reservation, extra });
}

export async function notifyPending(r) {
  return sendMail({
    to: r.customer.email,
    template: 'pending',
    reservation: r,
    extra: { holdMinutes: getDb().settings.booking.holdMinutes }
  });
}

export async function notifyConfirmed(r) {
  await sendMail({ to: r.customer.email, template: 'confirmation', reservation: r });
  await sendMail({ to: r.customer.email, template: 'receipt', reservation: r });
}

export async function notifyExpired(r) {
  return sendMail({ to: r.customer.email, template: 'expired', reservation: r });
}

export async function notifyCancellation(r, extra) {
  return sendMail({ to: r.customer.email, template: 'cancellation', reservation: r, extra });
}

export async function notifyRefund(r, refund) {
  return sendMail({
    to: r.customer.email,
    template: 'refund',
    reservation: r,
    extra: {
      amount: refund.amount,
      reference: refund.reference,
      method: refund.method
    }
  });
}

export function reminderWindow(r) {
  const hours = (dateToEpoch(r.date, r.time) - Date.now()) / 3600000;
  return hours;
}
