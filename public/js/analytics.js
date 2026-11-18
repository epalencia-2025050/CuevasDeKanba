/* ==========================================================================
   K’anba · Cuevas Vivas — analítica (Google Tag Manager / Google Analytics 4)
   Contenedor: GTM-N8ZD2LM3
   Empuja eventos al dataLayer para medir navegación y el embudo de reservas.
   ========================================================================== */
(() => {
  'use strict';

  window.dataLayer = window.dataLayer || [];

  const CURRENCY = 'GTQ';
  const INTERNAL_HOSTS = [window.location.hostname, 'cuevas-de-kanba.onrender.com'];

  /**
   * Envía un evento al dataLayer de Google Tag Manager.
   * @param {string} event Nombre del evento (snake_case, compatible con GA4).
   * @param {object} params Parámetros adicionales del evento.
   */
  function track(event, params = {}) {
    if (!event) return;
    window.dataLayer.push({ event, ...params });
  }

  window.kanbaTrack = track;

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function itemFromBooking(reservation = {}) {
    const tour = reservation.tour || {};
    return {
      item_id: String(reservation.tourId || tour.id || reservation.code || 'kanba-tour'),
      item_name: tour.name || reservation.tourName || 'Tour K’anba',
      item_category: 'tour',
      price: money(reservation.unitPrice || tour.price),
      quantity: Math.max(1, Number(reservation.participants) || 1)
    };
  }

  /**
   * Eventos del embudo de reserva.
   * event: 'begin_checkout' | 'add_payment_info' | 'purchase'
   */
  function trackBooking(event, reservation = {}) {
    const payload = {
      currency: CURRENCY,
      value: money(reservation.total),
      items: [itemFromBooking(reservation)]
    };
    if (reservation.code) payload.transaction_id = reservation.code;
    if (reservation.payment?.provider) payload.payment_type = reservation.payment.provider;
    track(event, payload);
  }

  window.kanbaTrackBooking = trackBooking;

  /* ------------------------------------------------------------------ */
  /* Eventos automáticos                                                */
  /* ------------------------------------------------------------------ */

  function isInternal(href) {
    try {
      const url = new URL(href, window.location.href);
      return INTERNAL_HOSTS.includes(url.hostname);
    } catch {
      return true;
    }
  }

  function labelOf(node) {
    return (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function onClick(event) {
    const node = event.target.closest('a, button');
    if (!node) return;
    const href = node.getAttribute('href') || '';

    if (/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com)/i.test(href)) {
      track('contact_whatsapp', { link_text: labelOf(node) });
      return;
    }
    if (href.startsWith('tel:')) {
      track('contact_phone', { phone: href.slice(4) });
      return;
    }
    if (href.startsWith('mailto:')) {
      track('contact_email', { email: href.slice(7) });
      return;
    }
    if (/google\.[a-z.]+\/maps|waze\.com/i.test(href)) {
      track('get_directions', { link_url: href });
      return;
    }
    if (href.startsWith('http') && !isInternal(href)) {
      track('outbound_click', { link_url: href, link_text: labelOf(node) });
    }
  }

  function setupScrollDepth() {
    const marks = [25, 50, 75, 90];
    const reached = new Set();
    let ticking = false;

    const measure = () => {
      ticking = false;
      const doc = document.documentElement;
      const height = Math.max(1, doc.scrollHeight - window.innerHeight);
      const percent = Math.min(100, Math.round((window.scrollY / height) * 100));
      marks.forEach((mark) => {
        if (percent >= mark && !reached.has(mark)) {
          reached.add(mark);
          track('scroll_depth', { percent_scrolled: mark });
        }
      });
    };

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(measure);
    }, { passive: true });
  }

  function init() {
    document.addEventListener('click', onClick, true);
    setupScrollDepth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
