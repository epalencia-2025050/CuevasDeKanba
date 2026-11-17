import fs from 'node:fs';
import path from 'node:path';
import { getDb, saveDb, ensureOutbox, formatDateLong, dateToEpoch } from './store.js';
import { sendSmtpMail } from './smtp.js';

const money = (n, currency = 'GTQ') =>
  new Intl.NumberFormat('es-GT', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n || 0));

function baseUrl() {
  const d = getDb();
  return (
    d.settings.business.siteUrl ||
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
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
        <strong>Notas:</strong> Los precios se expresan en quetzales guatemaltecos (GTQ) e incluyen impuestos. Este documento es un comprobante de pago demostrativo. Para cualquier gestión o consulta escribe a reservas@kanba.gt con el número de reserva.
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
  const dbSmtp = d.settings.smtp || {};

  const envHost = process.env.SMTP_HOST;
  const envPort = process.env.SMTP_PORT;
  const envSecure = process.env.SMTP_SECURE;
  const envUser = process.env.SMTP_USER;
  const envPass = process.env.SMTP_PASS;
  const envFrom = process.env.SMTP_FROM;
  const envFromName = process.env.SMTP_FROM_NAME;

  const hasEnvHost = Boolean(envHost && envHost.trim());
  const hasEnvUser = Boolean(envUser && envUser.trim());
  const hasEnvConfig = hasEnvHost || hasEnvUser;

  const host = (hasEnvHost ? envHost : dbSmtp.host) || '';
  const port = Number((envPort !== undefined ? envPort : dbSmtp.port) || 465);
  const secure = envSecure !== undefined ? envSecure === 'true' : dbSmtp.secure !== false;
  const user = (hasEnvUser ? envUser : dbSmtp.user) || '';
  const pass = (envPass !== undefined ? envPass : dbSmtp.pass) || '';
  const fromEmail = (envFrom !== undefined ? envFrom : (dbSmtp.fromEmail || user)) || 'reservas@kanba.gt';
  const fromName = (envFromName !== undefined ? envFromName : (dbSmtp.fromName || 'K’anba Cuevas Vivas')) || 'K’anba Cuevas Vivas';

  let source = 'none';
  if (hasEnvConfig) {
    source = 'env';
  } else if (dbSmtp.host && dbSmtp.host.trim()) {
    source = 'database';
  }

  const isConfigured = Boolean(host && user && pass);

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
      pass: Boolean(envPass),
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
  if (!cfg.host || !cfg.user) {
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

// Bandera para evitar carreras durante el procesamiento de la cola de reintentos
let isProcessingQueue = false;

export async function processEmailRetryQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  try {
    const d = getDb();
    if (!Array.isArray(d.emails)) return;

    const cfg = getEffectiveSmtpConfig();
    if (!cfg.host || !cfg.user) return; // No hay SMTP para enviar

    const now = Date.now();
    // Buscar correos pendientes de reintento
    for (const record of d.emails) {
      if (record.status !== 'queued') continue;
      if (record.permanentFailed) continue;
      if (record.attempts >= 5) {
        record.status = 'failed';
        continue;
      }
      if (record.nextAttemptAt && Date.parse(record.nextAttemptAt) > now) {
        continue;
      }

      // Procesar reintento
      record.status = 'sending';
      record.attempts = (record.attempts || 0) + 1;
      saveDb();

      try {
        await sendSmtpMail({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          user: cfg.user,
          pass: cfg.pass,
          fromEmail: cfg.fromEmail || cfg.user,
          fromName: cfg.fromName || 'K’anba Cuevas Vivas',
          to: record.to,
          subject: record.subject,
          html: record.html,
          text: record.text
        });
        record.status = 'sent';
        record.provider = 'smtp';
        record.error = null;
        record.sentAt = new Date().toISOString();
        saveDb();
        console.log(`[smtp-queue] Correo ${record.id} entregado con éxito (intento ${record.attempts})`);
      } catch (err) {
        record.error = err.message;
        const permanent = isPermanentSmtpError(err.message);
        if (permanent || record.attempts >= 5) {
          record.status = 'failed';
          record.permanentFailed = permanent;
          console.error(`[smtp-queue] Correo ${record.id} falló de forma permanente o alcanzó 5 intentos:`, err.message);
        } else {
          record.status = 'queued';
          // Backoff exponencial: 1 min, 4 min, 9 min, 16 min...
          const delayMinutes = Math.pow(record.attempts, 2);
          record.nextAttemptAt = new Date(Date.now() + delayMinutes * 60000).toISOString();
          console.warn(`[smtp-queue] Correo ${record.id} falló temporalmente (intento ${record.attempts}), próximo reintento en ${delayMinutes}m`);
        }
        saveDb();
      }
    }
  } catch (globalErr) {
    console.error('[smtp-queue] Error procesando cola:', globalErr.message);
  } finally {
    isProcessingQueue = false;
  }
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
    id: `mail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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
  if (d.emails.length > 500) d.emails.length = 500;
  saveDb();

  const smtp = getEffectiveSmtpConfig();

  if (smtp.host && smtp.user) {
    record.status = 'sending';
    record.attempts = 1;
    saveDb();
    try {
      await sendSmtpMail({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user,
        pass: smtp.pass,
        fromEmail: smtp.fromEmail || smtp.user,
        fromName: smtp.fromName || 'K’anba Cuevas Vivas',
        to,
        subject: tpl.subject,
        html,
        text
      });
      record.status = 'sent';
      record.provider = 'smtp';
      record.sentAt = new Date().toISOString();
      saveDb();
      return record;
    } catch (err) {
      record.error = err.message;
      const permanent = isPermanentSmtpError(err.message);
      if (permanent) {
        record.status = 'failed';
        record.permanentFailed = true;
      } else {
        record.status = 'queued';
        // Primer reintento en 1 minuto
        record.nextAttemptAt = new Date(Date.now() + 60000).toISOString();
      }
      console.error('[smtp] error enviando correo:', err.message);
    }
  }

  // Si no hay SMTP configurado o falló, se guarda copia en el buzón local (disco).
  try {
    const dir = ensureOutbox();
    const safe = `${record.reservationCode}_${record.template}_${record.id}`;
    const eml = [
      `From: "K’anba Cuevas Vivas" <${smtp.fromEmail || 'reservas@kanba.gt'}>`,
      `To: ${to}`,
      `Subject: ${tpl.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="kanba-${safe}"`,
      '',
      `--kanba-${safe}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      '',
      `--kanba-${safe}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '',
      `--kanba-${safe}--`,
      ''
    ].join('\r\n');
    fs.writeFileSync(path.join(dir, `${safe}.eml`), eml, 'utf8');
  } catch (err) {
    console.error('[mail] no se pudo escribir el .eml:', err.message);
  }

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
