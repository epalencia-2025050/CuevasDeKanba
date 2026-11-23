/* ==========================================================================
   K’anba · panel administrativo
   Sin dependencias. Trabaja contra /api/admin/*.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    view: 'overview',
    overview: null,
    reservations: [],
    reservationSeq: 0,
    tours: [],
    content: null,
    settings: null,
    emails: [],
    refunds: [],
    closures: [],
    contentTab: 'brand',
    charts: []
  };

  const VIEW_META = {
    overview: ['Operación', 'Resumen'],
    reservations: ['Operación', 'Reservas'],
    availability: ['Operación', 'Disponibilidad'],
    tours: ['Operación', 'Tours'],
    'cafe-sales': ['Cafetería', 'Ventas y POS'],
    'cafe-products': ['Cafetería', 'Menú y Precios'],
    'cafe-inventory': ['Cafetería', 'Inventario y Kardex'],
    'cafe-expenses': ['Cafetería', 'Control de Gastos'],
    'cafe-reports': ['Cafetería', 'Estadísticas y Reportes'],
    content: ['Sitio', 'Contenido'],
    gallery: ['Sitio', 'Galería'],
    videos: ['Sitio', 'Videos'],
    emails: ['Control', 'Correos'],
    refunds: ['Control', 'Reembolsos'],
    settings: ['Control', 'Configuración']
  };

  const STATUS_LABEL = {
    pending_payment: 'Pago pendiente',
    confirmed: 'Confirmada',
    cancelled: 'Cancelada',
    expired: 'Expirada',
    pending: 'Pendiente',
    processed: 'Procesado',
    sent: 'Enviado',
    sending: 'Enviando…',
    queued: 'En cola',
    failed: 'Falló',
    paid: 'Pagado',
    refund_pending: 'Reembolso pendiente',
    refunded: 'Reembolsado'
  };

  const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const DAY_INDEX_MAP = {
    dom: 0, domingo: 0, sun: 0, sunday: 0,
    lun: 1, lunes: 1, mon: 1, monday: 1,
    mar: 2, martes: 2, tue: 2, tuesday: 2,
    mie: 3, mié: 3, miercoles: 3, miércoles: 3, wed: 3, wednesday: 3,
    jue: 4, jueves: 4, thu: 4, thursday: 4,
    vie: 5, viernes: 5, fri: 5, friday: 5,
    sab: 6, sáb: 6, sabado: 6, sábado: 6, sat: 6, saturday: 6
  };
  function normalizeWeekday(val) {
    if (typeof val === 'number') {
      if (val === 7) return 0;
      if (Number.isInteger(val) && val >= 0 && val <= 6) return val;
      return null;
    }
    const str = String(val ?? '').trim().toLowerCase();
    if (/^[0-6]$/.test(str)) return Number(str);
    if (str === '7') return 0;
    const clean = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (clean in DAY_INDEX_MAP) return DAY_INDEX_MAP[clean];
    if (str in DAY_INDEX_MAP) return DAY_INDEX_MAP[str];
    return null;
  }

  function formatUtcLong(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('es-GT', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  }
  const CATEGORY_OPTIONS = [
    ['cueva', 'Cueva'],
    ['rio', 'Río'],
    ['selva', 'Selva'],
    ['semuc', 'Semuc'],
    ['otro', 'Otro']
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const money = (value, currency = state.settings?.booking?.currency || state.overview?.currency) => currency ? new Intl.NumberFormat('es-GT', { style: 'currency', currency }).format(value) : Number(value).toFixed(2);
  const getPath = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  const setPath = (obj, path, value) => {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cursor[parts[i]] == null || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function statusBadge(status, label) {
    const node = el('span', `status-badge ${status || ''}`, label || STATUS_LABEL[status] || status || '—');
    return node;
  }

  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => node.classList.remove('show'), 3800);
  }

  function setSync(on) {
    const pill = $('#syncPill');
    if (pill) pill.classList.toggle('busy', Boolean(on));
  }

  function busy(button, on) {
    if (!button) return;
    button.classList.toggle('is-loading', Boolean(on));
    button.disabled = Boolean(on);
  }

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(isMutation || options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: isMutation && options.body === undefined && method === 'DELETE' ? '{}' : options.body
    });
    let data = null;
    try { data = await res.json(); } catch { /* respuesta vacía */ }
    if (!res.ok) {
      const error = new Error(data?.error?.message || data?.message || 'No pudimos completar la solicitud.');
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function handleError(error) {
    if (error?.status === 401 || error?.status === 403) {
      showLogin();
      return;
    }
    console.error(error);
    toast(error.message || 'Ocurrió un error inesperado.');
  }

  /* ====================================================================
     Sesión
     ==================================================================== */

  function showLogin() { window.location.replace('/login.html'); }

  function showShell() {
    const shell = $('#adminShell');
    if (shell) shell.hidden = false;
    const status = $('#adminLoadStatus');
    if (status) status.hidden = true;
  }

  async function boot() {
    try {
      const me = await api('/api/admin/me');
      if (me.authenticated) {
        showShell();
        const info = $('#sessionInfo');
        if (info && me.admin?.expiresAt) {
          info.textContent = `Sesión hasta ${new Date(me.admin.expiresAt).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}`;
        }
        navigate('overview');
      } else {
        showLogin();
      }
    } catch (error) {
      if (error.status === 401) { showLogin(); return; }
      if (error.status === 403) { window.location.replace('/cuenta.html'); return; }
      const box = $('#adminLoadStatus');
      if (box) {
        box.hidden = false;
        box.textContent = 'No pudimos conectar con el servidor. Verifica que el servicio esté activo.';
      }
    }
  }

  async function logout() {
    const button = $('#logoutButton');
    if (button?.disabled) return;
    busy(button, true);
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      showLogin();
    } catch (err) {
      toast(err.message || 'No se pudo cerrar la sesión. Intenta de nuevo.');
    } finally {
      busy(button, false);
    }
  }

  /* ====================================================================
     Navegación y modal
     ==================================================================== */

  function closeSidebar() {
    $('#adminSidebar')?.classList.remove('open');
    const scrim = $('#sidebarScrim');
    if (scrim) scrim.hidden = true;
  }

  function openSidebar() {
    $('#adminSidebar')?.classList.add('open');
    const scrim = $('#sidebarScrim');
    if (scrim) scrim.hidden = false;
  }

  function navigate(view) {
    if (!VIEW_META[view]) view = 'overview';
    state.view = view;
    $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
    $$('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    const meta = VIEW_META[view];
    const kicker = $('#viewKicker');
    const title = $('#viewTitle');
    if (kicker) kicker.textContent = meta[0];
    if (title) title.textContent = meta[1];
    closeSidebar();
    loadView(view);
  }

  function loadView(view) {
    const loaders = {
      overview: loadOverview,
      reservations: loadReservations,
      availability: loadAvailability,
      tours: loadTours,
      'cafe-sales': loadCafeSales,
      'cafe-products': loadCafeProducts,
      'cafe-inventory': loadCafeInventory,
      'cafe-expenses': loadCafeExpenses,
      'cafe-reports': loadCafeReports,
      content: loadContent,
      gallery: loadGallery,
      videos: loadVideos,
      emails: loadEmails,
      refunds: loadRefunds,
      settings: loadSettings
    };
    const fn = loaders[view];
    if (fn) fn();
  }

  function openModal(title, body, { kicker = 'Detalle', wide = false } = {}) {
    const root = $('#modalRoot');
    const panel = $('#modalPanel');
    const bodyNode = $('#modalBody');
    const titleNode = $('#modalTitle');
    const kickerNode = $('#modalKicker');
    if (!root || !panel || !bodyNode) return;
    if (titleNode) titleNode.textContent = title;
    if (kickerNode) kickerNode.textContent = kicker;
    bodyNode.replaceChildren();
    if (body) bodyNode.append(body);
    panel.classList.toggle('wide', Boolean(wide));
    root.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const root = $('#modalRoot');
    const bodyNode = $('#modalBody');
    if (bodyNode) bodyNode.replaceChildren();
    if (root) root.hidden = true;
    document.body.style.overflow = '';
  }

  /* ====================================================================
     Resumen
     ==================================================================== */

  async function loadOverview() {
    setSync(true);
    try {
      const data = await api('/api/admin/overview');
      state.overview = data;
      renderOverview(data);
      updateBadges(data.kpis);
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function updateBadges(kpis) {
    const emails = $('#emailBadge');
    const refunds = $('#refundBadge');
    if (emails) {
      emails.hidden = !(kpis?.emails > 0);
      emails.textContent = kpis?.emails > 99 ? '99+' : String(kpis?.emails || 0);
    }
    if (refunds) {
      refunds.hidden = !(kpis?.refundsPending > 0);
      refunds.textContent = String(kpis?.refundsPending || 0);
    }
  }

  function kpiCard(label, value, sub, tone = '') {
    const card = el('div', `kpi ${tone}`.trim());
    card.append(el('span', '', label), el('strong', '', value));
    if (sub) {
      const small = el('small');
      small.append(sub);
      card.append(small);
    }
    return card;
  }

  function renderOverview(data) {
    const k = data.kpis;
    const wrap = $('#overviewKpis');
    if (wrap) {
      wrap.replaceChildren();
      wrap.append(
        kpiCard('Ingresos confirmados', money(k.revenue), `Ticket promedio ${money(k.avgTicket)}`, 'lime'),
        kpiCard('Reservas confirmadas', String(k.confirmed), `${k.pending} pendientes · ${money(k.pendingAmount)} en espera`),
        kpiCard('Ocupación de hoy', `${k.occupancyToday}%`, `${k.seatsToday} de ${k.capacityToday} cupos vendidos`, 'amber'),
        kpiCard('Reembolsos pendientes', String(k.refundsPending), `${money(k.refundsPendingAmount)} por procesar`, k.refundsPending ? 'rust' : '')
      );
    }

    renderChart(data.chart);
    renderOccupancy(data);
    renderOverviewTables(data);
    renderRefundItems($('#overviewRefunds'), data.refunds, { compact: true });
  }

  function renderChart(chart) {
    const wrap = $('#overviewChart');
    const total = $('#chartTotal');
    if (!wrap) return;
    wrap.parentElement?.querySelectorAll('.chart-legend').forEach((node) => node.remove());
    wrap.replaceChildren();
    const list = Array.isArray(chart) ? chart : [];
    const maxCount = Math.max(1, ...list.map((d) => Number(d.count) || 0));
    const maxRevenue = Math.max(1, ...list.map((d) => Number(d.revenue) || 0));
    const sum = list.reduce((s, d) => s + (Number(d.count) || 0), 0);
    if (total) total.textContent = `${sum} reservas nuevas`;
    list.forEach((day) => {
      const item = el('div', 'bar-item');
      const stack = el('div', 'bar-stack');
      const bar = el('div', 'bar');
      const barRevenue = el('div', 'bar revenue');
      const height = Math.max(2, Math.round(((Number(day.count) || 0) / maxCount) * 100));
      const heightRevenue = Math.max(2, Math.round(((Number(day.revenue) || 0) / maxRevenue) * 100));
      bar.style.height = `${height}%`;
      barRevenue.style.height = `${heightRevenue}%`;
      const tip = el('span', '', `${day.count || 0}`);
      const tipRevenue = el('span', '', money(day.revenue));
      bar.append(tip);
      barRevenue.append(tipRevenue);
      stack.append(bar, barRevenue);
      const label = el('span', 'bar-label', day.label || day.date || '');
      item.append(stack, label);
      wrap.append(item);
    });
    const legend = el('div', 'chart-legend');
    const l1 = el('span');
    l1.append(el('i', ''), document.createTextNode('Reservas creadas'));
    const l2 = el('span');
    l2.append(el('i', ''), document.createTextNode('Ingresos confirmados'));
    l2.querySelector('i').style.background = 'var(--amber-deep)';
    legend.append(l1, l2);
    wrap.after(legend);
  }

  function renderOccupancy(data) {
    const ringWrap = $('#occupancyRing');
    const stats = $('#storageStats');
    if (!ringWrap) return;
    ringWrap.replaceChildren();
    const k = data.kpis;
    const pct = Math.max(0, Math.min(100, Number(k.occupancyToday) || 0));
    const ring = el('div', 'occupancy-ring');
    ring.style.background = `conic-gradient(var(--moss) ${pct * 3.6}deg, rgba(14,36,32,.09) 0)`;
    const inner = el('div');
    inner.append(el('strong', '', `${pct}%`), el('span', '', 'ocupación'));
    ring.append(inner);
    const copy = el('div', 'ring-copy');
    copy.append(
      el('strong', '', 'Cupos de hoy'),
      el('p', '', k.capacityToday
        ? `${k.seatsToday} de ${k.capacityToday} lugares reservados en las salidas de hoy.`
        : 'No hay salidas programadas para hoy.')
    );
    ringWrap.append(ring, copy);

    if (stats) {
      stats.replaceChildren();
      const values = [
        ['Tours', String(data.store?.tours ?? '—')],
        ['Fotos', String(data.store?.gallery ?? '—')],
        ['Videos', String(data.store?.videos ?? '—')],
        ['Correos', String(data.store?.emails ?? '—')]
      ];
      values.forEach(([label, value]) => {
        const cell = el('div');
        cell.append(el('span', '', label), el('strong', '', value));
        stats.append(cell);
      });
    }
  }

  function overviewTable(container, rows, columns) {
    if (!container) return;
    container.replaceChildren();
    const thead = el('thead');
    const tr = el('tr');
    columns.forEach((col) => tr.append(el('th', '', col.label)));
    thead.append(tr);
    const tbody = el('tbody');
    if (!rows.length) {
      const empty = el('tr');
      const td = el('td', 'table-empty', 'Sin datos por ahora.');
      td.colSpan = columns.length;
      empty.append(td);
      tbody.append(empty);
    } else {
      rows.forEach((row) => {
        const trr = el('tr', 'clickable');
        trr.addEventListener('click', () => openReservation(row.code));
        columns.forEach((col) => {
          const td = el('td', col.className || '');
          const value = col.value(row);
          if (value instanceof Node) td.append(value);
          else td.textContent = value == null ? '—' : String(value);
          trr.append(td);
        });
        tbody.append(trr);
      });
    }
    container.append(thead, tbody);
  }

  function renderOverviewTables(data) {
    overviewTable($('#upcomingTable'), data.upcoming || [], [
      { label: 'Reserva', value: (r) => r.code, className: 'cell-code' },
      { label: 'Cliente', value: (r) => r.customer?.name || '—' },
      { label: 'Fecha', value: (r) => `${r.dateLong || r.date} · ${r.time}` },
      { label: 'Pax', value: (r) => String(r.participants) },
      { label: 'Total', value: (r) => money(r.total), className: 'cell-right' }
    ]);
    overviewTable($('#recentTable'), data.recent || [], [
      { label: 'Reserva', value: (r) => r.code, className: 'cell-code' },
      { label: 'Estado', value: (r) => statusBadge(r.status) },
      { label: 'Total', value: (r) => money(r.total), className: 'cell-right' },
      { label: 'Creada', value: (r) => shortDate(r.createdAt), className: 'cell-right' }
    ]);
  }

  function shortDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-GT', { day: '2-digit', month: 'short' });
  }

  function longDateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ====================================================================
     Reservas
     ==================================================================== */

  function loadReservations() {
    const seq = ++state.reservationSeq;
    const q = $('#reservationSearch')?.value.trim() || '';
    const status = $('#reservationStatus')?.value || 'all';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    setSync(true);
    api(`/api/admin/reservations${params.toString() ? '?' + params : ''}`)
      .then((data) => {
        if (seq !== state.reservationSeq) return;
        state.reservations = data.reservations || [];
        renderReservations();
      })
      .catch(handleError)
      .finally(() => setSync(false));
  }

  function renderReservations() {
    const container = $('#reservationsTable');
    const count = $('#reservationCount');
    if (count) count.textContent = `${state.reservations.length} ${state.reservations.length === 1 ? 'reserva' : 'reservas'}`;
    if (!container) return;
    container.replaceChildren();
    const thead = el('thead');
    const headRow = el('tr');
    ['Reserva', 'Cliente', 'Tour', 'Fecha y hora', 'Pax', 'Total', 'Estado'].forEach((label) => headRow.append(el('th', '', label)));
    thead.append(headRow);
    const tbody = el('tbody');
    if (!state.reservations.length) {
      const row = el('tr');
      const td = el('td', 'table-empty');
      td.colSpan = 7;
      const strong = el('strong', '', 'No hay reservas con ese filtro');
      td.append(strong, document.createTextNode('Prueba con otro estado o limpia la búsqueda.'));
      row.append(td);
      tbody.append(row);
    } else {
      state.reservations.forEach((r) => {
        const row = el('tr', 'clickable');
        row.addEventListener('click', () => openReservation(r.code));

        const codeCell = el('td', 'cell-code');
        codeCell.append(el('span', '', r.code), el('span', 'cell-sub', shortDate(r.createdAt)));
        row.append(codeCell);

        const customer = el('td');
        customer.append(el('span', 'cell-strong', r.customer?.name || '—'), el('span', 'cell-sub', r.customer?.email || '—'));
        row.append(customer);

        row.append(el('td', '', r.tour?.name || '—'));

        const dateCell = el('td', 'cell-nowrap');
        dateCell.append(el('span', '', r.dateLong || r.date), el('span', 'cell-sub', `${r.time} · ${r.participants} ${r.participants === 1 ? 'persona' : 'personas'}`));
        row.append(dateCell);

        row.append(el('td', 'cell-right', String(r.participants)));
        row.append(el('td', 'cell-right', money(r.total)));
        const statusCell = el('td');
        statusCell.append(statusBadge(r.status));
        row.append(statusCell);
        tbody.append(row);
      });
    }
    container.append(thead, tbody);
  }

  function detailList(rows) {
    const list = el('div', 'detail-list');
    rows.forEach(([label, value, full]) => {
      const cell = el('div', full ? 'full' : '');
      cell.append(el('span', '', label), el('strong', '', value == null || value === '' ? '—' : String(value)));
      list.append(cell);
    });
    return list;
  }

  function section(title, nodes) {
    const wrap = el('div', 'modal-section');
    if (title) wrap.append(el('h3', '', title));
    nodes.forEach((node) => wrap.append(node));
    return wrap;
  }

  async function openReservation(code) {
    setSync(true);
    try {
      const data = await api(`/api/admin/reservations/${encodeURIComponent(code)}`);
      const r = data.reservation;
      const body = el('div');

      const summary = el('div');
      const statusRow = el('div', 'row');
      statusRow.append(statusBadge(r.status));
      if (r.payment?.status) statusRow.append(statusBadge(r.payment.status, `Pago: ${STATUS_LABEL[r.payment.status] || r.payment.status}`));
      summary.append(statusRow);
      summary.append(el('div', 'mt'));
      summary.append(detailList([
        ['Experiencia', r.tour?.name || r.tourId],
        ['Fecha', r.dateLong || r.date],
        ['Horario', r.time],
        ['Participantes', `${r.participants}`],
        ['Precio unitario', money(r.unitPrice)],
        ['Total', money(r.total)],
        ['Titular', r.customer?.name],
        ['Correo', r.customer?.email],
        ['Teléfono', r.customer?.phone],
        ['País', r.customer?.country],
        ['Documento', r.customer?.document],
        ['Creada', longDateTime(r.createdAt)],
        ['Pago', r.payment ? `${r.payment.provider || '—'} · ${r.payment.brand || '—'} •••• ${r.payment.last4 || '—'}` : '—'],
        ['Referencia', r.payment?.reference],
        ['Pagada el', longDateTime(r.paidAt)],
        ['Comprobante', r.receipt?.number || '—'],
        ['Notas del cliente', r.customer?.notes, true]
      ]));
      if (r.cancellation) {
        const note = el('div', 'modal-note danger');
        note.textContent = `Cancelada el ${longDateTime(r.cancelledAt)} por ${r.cancellation.by === 'admin' ? 'administración' : 'el cliente'} · ${r.cancellation.reason} · reembolso ${money(r.cancellation.refundAmount)}`;
        summary.append(note);
      }
      body.append(section('Resumen de la reserva', [summary]));

      const actions = el('div', 'modal-actions');
      const token = r.token ? `&token=${encodeURIComponent(r.token)}` : '';
      if (r.status === 'pending_payment') {
        const pay = el('a', 'btn btn-primary btn-compact', 'Abrir pago');
        pay.href = `/pago.html?code=${encodeURIComponent(r.code)}${token}`;
        pay.target = '_blank';
        pay.rel = 'noopener';
        actions.append(pay);

      }
      if (r.status === 'confirmed') {
        const receipt = el('a', 'btn btn-primary btn-compact', 'Ver comprobante');
        receipt.href = `/comprobante.html?code=${encodeURIComponent(r.code)}${token}`;
        receipt.target = '_blank';
        receipt.rel = 'noopener';
        actions.append(receipt);
      }
      const confirmation = el('a', 'btn btn-outline btn-compact', 'Ver confirmación');
      confirmation.href = `/confirmacion.html?code=${encodeURIComponent(r.code)}${token}`;
      confirmation.target = '_blank';
      confirmation.rel = 'noopener';
      actions.append(confirmation);
      const verify = el('a', 'btn btn-outline btn-compact', 'Verificar');
      verify.href = `/verificar.html?code=${encodeURIComponent(r.code)}`;
      verify.target = '_blank';
      verify.rel = 'noopener';
      actions.append(verify);
      body.append(section('Enlaces del cliente', [actions]));

      /* Reenviar correos */
      const mailSection = el('div', 'modal-section');
      mailSection.append(el('h3', '', 'Reenviar correo'));
      const mailRow = el('div', 'row');
      const templateSelect = el('select', 'select-compact');
      const templates = [
        ['pending', 'Pago pendiente'],
        ['confirmation', 'Confirmación'],
        ['receipt', 'Comprobante'],
        ['expired', 'Reserva expirada'],
        ['cancellation', 'Cancelación'],
        ['refund', 'Reembolso procesado']
      ];
      templates.forEach(([value, label]) => {
        const option = el('option', '', label);
        option.value = value;
        templateSelect.append(option);
      });
      if (r.status === 'confirmed') templateSelect.value = 'confirmation';
      else if (r.status === 'cancelled') templateSelect.value = 'cancellation';
      else if (r.status === 'expired') templateSelect.value = 'expired';
      const send = el('button', 'btn btn-outline btn-compact', 'Enviar correo');
      send.type = 'button';
      send.addEventListener('click', async () => {
        busy(send, true);
        try {
          await api(`/api/admin/reservations/${encodeURIComponent(r.code)}/resend`, {
            method: 'POST',
            body: JSON.stringify({ template: templateSelect.value })
          });
          toast(`Correo “${templateSelect.options[templateSelect.selectedIndex].text}” generado para ${r.customer?.email}.`);
        } catch (error) {
          handleError(error);
        } finally {
          busy(send, false);
        }
      });
      mailRow.append(templateSelect, send);
      mailSection.append(mailRow);
      mailSection.append(el('div', 'modal-note', 'Los correos se guardan en la bandeja de salida y en data/outbox. Si el SMTP está configurado, también se envían.'));
      body.append(mailSection);

      /* Cancelación */
      if (r.status === 'pending_payment' || r.status === 'confirmed') {
        const cancelSection = el('div', 'modal-section');
        cancelSection.append(el('h3', '', 'Cancelar reserva'));
        const form = el('div', 'stack');
        const reasonLabel = el('label', 'field');
        reasonLabel.append(el('span', '', 'Motivo'));
        const reason = el('textarea');
        reason.rows = 2;
        reason.placeholder = 'Motivo de la cancelación';
        reasonLabel.append(reason);
        const amountLabel = el('label', 'field');
        amountLabel.append(el('span', '', 'Reembolso manual (opcional)'));
        const amount = el('input');
        amount.type = 'number';
        amount.min = '0';
        amount.max = String(r.total);
        amount.step = '0.01';
        amount.placeholder = `Automático según política (máx. ${money(r.total)})`;
        amountLabel.append(amount);
        const methodLabel = el('label', 'field');
        methodLabel.append(el('span', '', 'Método de reembolso'));
        const method = el('input');
        method.type = 'text';
        method.value = 'Medio de pago original';
        methodLabel.append(method);
        const submit = el('button', 'btn btn-danger btn-compact', 'Confirmar cancelación');
        submit.type = 'button';
        submit.addEventListener('click', async () => {
          if (!reason.value.trim()) {
            toast('Escribe el motivo de la cancelación.');
            reason.focus();
            return;
          }
          if (!window.confirm(`¿Cancelar la reserva ${r.code}? Esta acción queda registrada.`)) return;
          busy(submit, true);
          try {
            const result = await api(`/api/admin/reservations/${encodeURIComponent(r.code)}/cancel`, {
              method: 'POST',
              body: JSON.stringify({
                reason: reason.value.trim(),
                refundAmount: amount.value === '' ? null : Number(amount.value),
                refundMethod: method.value.trim() || 'Medio de pago original'
              })
            });
            const refund = result.refund?.amount || 0;
            toast(`Reserva cancelada. Reembolso ${money(refund)} registrado.`);
            openReservation(r.code);
            loadReservations();
          } catch (error) {
            handleError(error);
          } finally {
            busy(submit, false);
          }
        });
        form.append(reasonLabel, amountLabel, methodLabel, submit);
        cancelSection.append(form);
        cancelSection.append(el('div', 'modal-note warn', 'La política aplica 100% con 72 h o más, 50% entre 72 y 24 h, y 0% con menos de 24 h. Puedes fijar un importe manual si la operación lo requiere.'));
        body.append(cancelSection);
      }

      /* Historial */
      const historySection = el('div', 'modal-section');
      historySection.append(el('h3', '', 'Historial'));
      const timeline = el('div', 'timeline');
      (r.history || []).slice().reverse().forEach((entry) => {
        const item = el('div');
        item.append(el('strong', '', entry.label || entry.type || 'Actualización'), document.createTextNode(longDateTime(entry.at)));
        timeline.append(item);
      });
      if (!r.history?.length) timeline.append(el('div', '', 'Sin eventos registrados.'));
      historySection.append(timeline);
      body.append(historySection);

      openModal(r.code, body, { kicker: 'Gestión de reserva', wide: true });
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  /* ====================================================================
     Disponibilidad
     ==================================================================== */

  async function loadAvailability() {
    setSync(true);
    try {
      const days = Number($('#availabilityDays')?.value) || 14;
      const [availability, closures, tours] = await Promise.all([
        api(`/api/admin/availability?days=${days}`),
        api('/api/admin/closures'),
        state.tours.length ? Promise.resolve({ tours: state.tours }) : api('/api/admin/tours')
      ]);
      state.closures = closures.closures || [];
      state.tours = tours.tours || state.tours;
      renderAvailability(availability.grid || []);
      renderClosures();
      const note = $('#availabilityNote');
      if (note) note.textContent = `${availability.grid?.length || 0} días · ${state.tours.filter((t) => t.active !== false).length} tours activos`;
      const select = $('#closureTour');
      if (select) {
        const current = select.value;
        select.replaceChildren();
        const all = el('option', '', 'Todos los tours');
        all.value = 'all';
        select.append(all);
        state.tours.forEach((t) => {
          const option = el('option', '', t.name);
          option.value = t.id;
          select.append(option);
        });
        select.value = current && state.tours.some((t) => t.id === current) ? current : 'all';
      }
      const dateInput = $('#closureDate');
      if (dateInput && !dateInput.value) dateInput.value = availability.grid?.[0]?.date || '';
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderAvailability(days) {
    const grid = $('#availabilityGrid');
    if (!grid) return;
    grid.replaceChildren();
    if (!days.length) {
      grid.append(el('div', 'empty-state', 'No hay datos de disponibilidad.'));
      return;
    }
    days.forEach((day) => {
      const card = el('div', 'avail-day');
      const head = el('div', 'avail-day-head');
      head.append(el('strong', '', day.dateLong || formatUtcLong(day.date)), el('span', '', day.date));
      const closures = state.closures.filter((c) => c.date === day.date);
      if (closures.length) {
        const closed = el('span', 'avail-closed', closures.some((c) => c.tourId === 'all') ? 'Cerrado todo el día' : 'Con cierres parciales');
        head.append(closed);
      }
      card.append(head);
      const toursWrap = el('div', 'avail-tours');
      if (!day.occupancy?.length) {
        toursWrap.append(el('div', 'empty-note', 'Sin tours activos para este día.'));
      } else {
        day.occupancy.forEach((tour) => {
          const row = el('div', 'avail-tour');
          row.append(el('strong', '', tour.tourName));
          const times = el('div', 'avail-times');
          tour.times.forEach((slot) => {
            const closed = slot.status === 'closed';
            const status = ['open', 'last'].includes(slot.status) ? slot.status : 'full';
            const chip = el('span', `avail-time ${status}`);
            chip.append(el('b', '', slot.time), el('span', '', closed ? 'cerrado' : slot.status === 'past' ? 'venta cerrada' : `${slot.left} cupos`));
            times.append(chip);
          });
          row.append(times);
          toursWrap.append(row);
        });
      }
      card.append(toursWrap);
      grid.append(card);
    });
  }

  function renderClosures() {
    const list = $('#closureList');
    const count = $('#closureCount');
    if (!list) return;
    list.replaceChildren();
    if (count) count.textContent = `${state.closures.length} registrados`;
    const sorted = state.closures.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!sorted.length) {
      list.append(el('div', 'empty-state', 'No hay cierres programados.'));
      return;
    }
    sorted.forEach((closure) => {
      const item = el('div', 'closure-item');
      const date = el('div', 'closure-date');
      const [y, m, d] = closure.date.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 12));
      date.append(
        el('strong', '', String(d).padStart(2, '0')),
        el('span', '', new Intl.DateTimeFormat('es-GT', { month: 'short', timeZone: 'UTC' }).format(dt).replace('.', ''))
      );
      const info = el('div', 'closure-info');
      const tour = closure.tourId === 'all' ? 'Todos los tours' : state.tours.find((t) => t.id === closure.tourId)?.name || closure.tourId;
      info.append(el('strong', '', tour), el('span', '', closure.reason || 'Cierre administrativo'));
      const remove = el('button', '', '×');
      remove.type = 'button';
      remove.title = 'Eliminar cierre';
      remove.addEventListener('click', async () => {
        if (!window.confirm('¿Eliminar este cierre? Los cupos vuelven a estar disponibles.')) return;
        try {
          await api(`/api/admin/closures/${encodeURIComponent(closure.id)}`, { method: 'DELETE', body: '{}' });
          toast('Cierre eliminado.');
          loadAvailability();
        } catch (error) {
          handleError(error);
        }
      });
      item.append(date, info, remove);
      list.append(item);
    });
  }

  async function addClosure(event) {
    event.preventDefault();
    const date = $('#closureDate')?.value;
    const tourId = $('#closureTour')?.value || 'all';
    const reason = $('#closureReason')?.value.trim();
    const button = $('#closureSubmit');
    if (!date) {
      toast('Selecciona la fecha del cierre.');
      return;
    }
    if (!reason) {
      toast('Escribe el motivo del cierre.');
      $('#closureReason')?.focus();
      return;
    }
    busy(button, true);
    try {
      await api('/api/admin/closures', {
        method: 'POST',
        body: JSON.stringify({ date, tourId, reason })
      });
      const input = $('#closureReason');
      if (input) input.value = '';
      toast('Cierre registrado.');
      loadAvailability();
    } catch (error) {
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  /* ====================================================================
     Tours
     ==================================================================== */

  async function loadTours() {
    setSync(true);
    try {
      const data = await api('/api/admin/tours');
      state.tours = data.tours || [];
      renderTours();
      const note = $('#toursNote');
      if (note) note.textContent = `${state.tours.filter((t) => t.active !== false).length} activos de ${state.tours.length} tours`;
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderTours() {
    const grid = $('#toursGrid');
    if (!grid) return;
    grid.replaceChildren();
    if (!state.tours.length) {
      grid.append(el('div', 'empty-state', 'No hay tours. Crea el primero con “Nuevo tour”.'));
      return;
    }
    const filter = $('[data-tour-filter][aria-pressed="true"]')?.dataset.tourFilter;
    const tours = state.tours.filter(tour => filter === 'active' ? tour.active !== false
      : filter === 'archived' ? tour.active === false : filter === 'featured' ? tour.featured : true);
    if (!tours.length) grid.append(el('div', 'empty-state', 'No hay tours con este filtro.'));
    tours.forEach((tour) => {
      const card = el('article', 'tour-admin-card');
      const media = el('div', 'tour-admin-media');
      if (tour.image) {
        const img = el('img');
        img.src = tour.image;
        img.alt = '';
        img.loading = 'lazy';
        media.append(img);
      }
      media.append(statusBadge(tour.active !== false ? 'confirmed' : 'cancelled', tour.active !== false ? 'Activo' : 'Archivado'));
      if (tour.featured) media.append(el('span', 'featured-tag', 'Destacado'));
      const body = el('div', 'tour-admin-body');
      body.append(el('h3', '', tour.name), el('div', 'tour-id', tour.id));
      const meta = el('div', 'tour-admin-meta');
      [
        ['Precio', money(tour.price)],
        ['Duración', tour.duration],
        ['Cupo', `${tour.capacity} por salida`],
        ['Horarios', (tour.times || []).join(' · ')],
        ['Días', (tour.days || tour.diasOperacion || []).map(normalizeWeekday).filter((d) => d !== null).map((d) => DAY_NAMES[d]).join(' ')]
      ].forEach(([label, value]) => {
        const item = el('span');
        item.append(el('b', '', `${label}: `), document.createTextNode(value || '—'));
        meta.append(item);
      });
      body.append(meta);
      const actions = el('div', 'tour-admin-actions');
      const edit = el('button', 'btn btn-outline', 'Editar');
      edit.type = 'button';
      edit.addEventListener('click', () => openTourForm(tour));
      const remove = el('button', 'btn btn-outline danger', tour.active !== false ? 'Archivar' : 'Eliminar');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        const hasReservations = window.confirm(`¿${tour.active !== false ? 'Archivar' : 'Eliminar'} “${tour.name}”? Si tiene reservas, se archivará en lugar de borrarse.`);
        if (!hasReservations) return;
        try {
          const result = await api(`/api/admin/tours/${encodeURIComponent(tour.id)}`, { method: 'DELETE', body: '{}' });
          toast(result.archived ? 'Tour archivado (tiene reservas asociadas).' : 'Tour eliminado.');
          loadTours();
        } catch (error) {
          handleError(error);
        }
      });
      actions.append(edit, remove);
      body.append(actions);
      card.append(media, body);
      grid.append(card);
    });
  }

  function formField(labelText, name, value, opts = {}) {
    const wrap = el('label', `field${opts.full ? ' full' : ''}`);
    wrap.append(el('span', '', labelText));
    let input;
    if (opts.textarea) {
      input = el('textarea');
      input.rows = opts.rows || 3;
    } else {
      input = el('input');
      input.type = opts.type || 'text';
      if (opts.min !== undefined) input.min = String(opts.min);
      if (opts.max !== undefined) input.max = String(opts.max);
      if (opts.step !== undefined) input.step = String(opts.step);
    }
    input.name = name;
    input.value = value == null ? '' : value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.readOnly) input.readOnly = true;
    wrap.append(input);
    if (opts.hint) wrap.append(el('small', 'form-hint', opts.hint));
    return wrap;
  }

  function bindOperatingDays(start, end, checks) {
    if (!checks) return () => {};
    const inputs = checks.querySelectorAll ? checks.querySelectorAll('input') : [];
    function utcDay(value) {
      if (!value || typeof value !== 'string') return NaN;
      const trimmed = value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return NaN;
      const epoch = Date.parse(trimmed + 'T00:00:00Z');
      return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === trimmed ? epoch : NaN;
    }
    function refresh() {
      const first = start ? utcDay(start.value) : NaN;
      const last = end ? utcDay(end.value) : NaN;
      const hasClosedRange = Number.isFinite(first) && Number.isFinite(last) && first <= last;
      const allowed = new Set();
      if (hasClosedRange) {
        for (let day = first; day <= last && allowed.size < 7; day += 86400000) {
          allowed.add(new Date(day).getUTCDay());
        }
      }
      for (const input of inputs) {
        const isDisabled = hasClosedRange && !allowed.has(Number(input.value));
        input.disabled = isDisabled;
        if (isDisabled) input.checked = false;
        const label = input.closest ? input.closest('label') : input.parentElement;
        if (label) {
          if (label.classList?.toggle) label.classList.toggle('is-disabled', isDisabled);
          label.title = isDisabled ? 'Este día no cae dentro del rango de fechas del tour.' : '';
        }
      }
    }
    for (const field of [start, end]) {
      if (field?.addEventListener) {
        field.addEventListener('input', refresh);
        field.addEventListener('change', refresh);
      }
    }
    refresh();
    return (predicate) => {
      inputs.forEach(input => {
        if (!input.disabled) {
          input.checked = Boolean(predicate(Number(input.value)));
        }
      });
    };
  }

  function openTourForm(tour = null) {
    const editing = Boolean(tour);
    const form = el('form');
    const grid = el('div', 'form-grid');
    grid.append(
      formField('Identificador', 'id', tour?.id || '', { readOnly: editing, placeholder: 'se genera del nombre', hint: editing ? 'No se puede cambiar.' : undefined }),
      formField('Nombre', 'name', tour?.name || ''),
      formField('Etiqueta', 'badge', tour?.badge || '', { placeholder: 'Más reservado' }),
      formField('Duración (texto)', 'duration', tour?.duration || ''),
      formField('Duración (minutos)', 'durationMinutes', tour?.durationMinutes ?? '', { type: 'number', min: 30, max: 720 }),
      formField('Precio (Q)', 'price', tour?.price || '', { type: 'number', min: 1, step: '0.01' }),
      formField('Cupo por salida', 'capacity', tour?.capacity ?? '', { type: 'number', min: 1, max: 60 }),
      formField('Máximo de participantes', 'maxParticipants', tour?.maxParticipants ?? tour?.capacity ?? '', { type: 'number', min: 1, max: 60 }),
      formField('Dificultad', 'difficulty', tour?.difficulty || '', { placeholder: 'Moderada · agua al pecho' }),
      formField('Edad mínima', 'minAge', tour?.minAge || 0, { type: 'number', min: 0, max: 99 }),
      formField('Punto de encuentro', 'meetingPoint', tour?.meetingPoint || '', { full: true }),
      formField('Horarios (separados por coma)', 'times', (tour?.times || []).join(', '), { full: true, placeholder: 'HH:MM' }),
      formField('Descripción', 'description', [tour?.description, tour?.longDescription].filter(Boolean).join('\n\n'), { textarea: true, full: true, rows: 5 }),
      formField('Fecha de inicio', 'startDate', tour?.startDate || tour?.fechaInicio || '', { type: 'date' }),
      formField('Fecha de finalización', 'endDate', tour?.endDate || tour?.fechaFin || '', { type: 'date' }),
      formField('Hora de inicio', 'startTime', tour?.startTime || tour?.horaInicio || '', { type: 'time' }),
      formField('Hora de finalización', 'endTime', tour?.endTime || tour?.horaFin || '', { type: 'time' }),
    );

    const extras = el('fieldset', 'tour-editor-section full');
    extras.append(el('legend', '', 'Incluye'));
    const addItem = el('button', 'tour-add-item', 'Agregar elemento');
    addItem.type = 'button';
    const rows = el('div', 'tour-items');
    function addRow(value) {
      const row = el('div', 'tour-item');
      const input = el('input');
      input.name = 'includeItem';
      input.setAttribute('aria-label', 'Elemento incluido');
      input.value = value;
      const remove = el('button', 'btn btn-outline', 'Quitar');
      remove.type = 'button';
      remove.onclick = () => row.remove();
      row.append(input, remove);
      rows.append(row);
      return input;
    }
    (tour?.includes || []).forEach(addRow);
    addItem.onclick = () => addRow('').focus();
    extras.append(rows, addItem);
    const media = el('fieldset', 'tour-editor-section full');
    media.append(el('legend', '', 'Imagen del tour'));
    const picker = el('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp,image/gif';
    picker.setAttribute('aria-label', 'Subir imagen del tour');
    const preview = el('img', 'tour-preview');
    let image = tour?.image || '';
    preview.hidden = !image;
    if (image) preview.src = image;
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { toast('La imagen supera los 8 MB.'); return; }
      picker.disabled = save.disabled = true;
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await api('/api/admin/media', { method: 'POST', body: JSON.stringify({ dataUrl }) });
        image = result.url;
        preview.src = image;
        preview.hidden = false;
      } catch (error) { handleError(error); }
      finally { picker.disabled = save.disabled = false; }
    };
    picker.className = 'tour-file-input';
    const upload = el('label', 'tour-upload');
    const fileName = el('span', 'tour-file-name', image ? 'Cambiar imagen' : 'Seleccionar imagen');
    upload.append(picker, fileName);
    picker.addEventListener('change', () => { fileName.textContent = picker.files[0]?.name || 'Seleccionar imagen'; });
    media.append(upload, preview);
    grid.append(extras, media);
    const daysWrap = el('div', 'field full');
    daysWrap.append(el('span', '', 'Días de operación'));
    const checks = el('div', 'check-grid');
    const activeDays = (tour?.days || tour?.diasOperacion || []).map(normalizeWeekday).filter((d) => d !== null);
    [1, 2, 3, 4, 5, 6, 0].forEach(index => {
      const label = DAY_NAMES[index];
      const check = el('label', 'inline-check');
      const input = el('input');
      input.type = 'checkbox';
      input.name = 'days';
      input.value = String(index);
      input.checked = activeDays.includes(index);
      check.append(input, document.createTextNode(label));
      checks.append(check);
    });
    const selectDays = bindOperatingDays(grid.querySelector('[name=startDate]'), grid.querySelector('[name=endDate]'), checks);
    const shortcuts = el('div', 'tour-item');
    for (const [label, predicate] of [['Todos', () => true], ['Entre semana', day => day >= 1 && day <= 5], ['Ninguno', () => false]]) {
      const button = el('button', 'btn btn-outline', label);
      button.type = 'button';
      button.onclick = () => selectDays(predicate);
      shortcuts.append(button);
    }
    daysWrap.append(checks, shortcuts);
    grid.append(daysWrap);

    const flags = el('div', 'field full');
    const activeLabel = el('label', 'inline-check');
    const activeInput = el('input');
    activeInput.type = 'checkbox';
    activeInput.name = 'active';
    activeInput.checked = tour ? tour.active !== false : true;
    activeLabel.append(activeInput, document.createTextNode('Tour activo y visible en el sitio'));
    const featuredLabel = el('label', 'inline-check');
    const featuredInput = el('input');
    featuredInput.type = 'checkbox';
    featuredInput.name = 'featured';
    featuredInput.checked = Boolean(tour?.featured);
    featuredLabel.append(featuredInput, document.createTextNode('Marcar como destacado'));
    flags.append(activeLabel, featuredLabel);
    grid.append(flags);

    form.append(grid);
    const actions = el('div', 'modal-actions');
    const save = el('button', 'btn btn-primary btn-compact', editing ? 'Guardar cambios' : 'Crear tour');
    save.type = 'submit';
    const cancel = el('button', 'btn btn-outline btn-compact', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    actions.append(save, cancel);
    form.append(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = {
        id: form.elements.namedItem('id')?.value.trim() || undefined,
        name: form.elements.namedItem('name')?.value.trim(),
        badge: form.elements.namedItem('badge')?.value.trim(),
        duration: form.elements.namedItem('duration')?.value.trim(),
        durationMinutes: Number(form.elements.namedItem('durationMinutes')?.value),
        price: Number(form.elements.namedItem('price')?.value),
        capacity: Number(form.elements.namedItem('capacity')?.value),
        maxParticipants: Number(form.elements.namedItem('maxParticipants')?.value),
        difficulty: form.elements.namedItem('difficulty')?.value.trim(),
        minAge: Number(form.elements.namedItem('minAge')?.value) || 0,
        meetingPoint: form.elements.namedItem('meetingPoint')?.value.trim(),
        times: (form.elements.namedItem('times')?.value || '').split(',').map((t) => t.trim()).filter(Boolean),
        image,
        description: form.elements.namedItem('description')?.value.trim(),
        includes: $$('input[name="includeItem"]', form).map(input => input.value.trim()).filter(Boolean),
        ...Object.fromEntries(['startDate', 'endDate', 'startTime', 'endTime'].map(key => [key, form.elements.namedItem(key)?.value || ''])),
        fechaInicio: form.elements.namedItem('startDate')?.value || '',
        fechaFin: form.elements.namedItem('endDate')?.value || '',
        horaInicio: form.elements.namedItem('startTime')?.value || '',
        horaFin: form.elements.namedItem('endTime')?.value || '',
        days: $$('input[name="days"]:checked', form).map((input) => Number(input.value)),
        diasOperacion: $$('input[name="days"]:checked', form).map((input) => Number(input.value)),
        active: form.elements.namedItem('active')?.checked !== false,
        featured: Boolean(form.elements.namedItem('featured')?.checked)
      };
      if (!data.name || data.name.length < 3) {
        toast('El nombre del tour debe tener al menos 3 caracteres.');
        return;
      }
      if (!data.times.length) {
        toast('Agrega al menos un horario en formato HH:MM.');
        return;
      }
      if (!data.days.length) {
        toast('Selecciona al menos un día de operación.');
        return;
      }
      if (!Number.isFinite(data.price) || data.price <= 0) {
        toast('El precio debe ser mayor a cero.');
        return;
      }
      const fieldError = (key, message) => {
        const field = form.elements.namedItem(key);
        field.setCustomValidity(message);
        field.reportValidity();
        field.setCustomValidity('');
      };
      if (data.endDate && data.startDate && data.endDate < data.startDate) return fieldError('endDate', 'Elige una fecha igual o posterior al inicio.');
      if (data.endTime && data.startTime && data.endTime < data.startTime) return fieldError('endTime', 'La hora final debe ser igual o posterior al inicio.');
      for (const time of data.times) {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return fieldError('times', 'Usa el formato HH:MM para cada salida.');
        if ((data.startTime && time < data.startTime) || (data.endTime && time > data.endTime)) return fieldError('times', 'La salida ' + time + ' queda fuera del horario de operación.');
      }
      busy(save, true);
      try {
        if (editing) {
          await api(`/api/admin/tours/${encodeURIComponent(tour.id)}`, { method: 'PUT', body: JSON.stringify(data) });
          toast('Tour actualizado.');
        } else {
          await api('/api/admin/tours', { method: 'POST', body: JSON.stringify(data) });
          toast('Tour creado.');
        }
        closeModal();
        loadTours();
      } catch (error) {
        handleError(error);
      } finally {
        busy(save, false);
      }
    });

    openModal(editing ? tour.name : 'Nuevo tour', form, { kicker: 'Catálogo de experiencias', wide: true });
  }

  /* ====================================================================
     Contenido
     ==================================================================== */

  const CONTENT_TABS = [
    ['brand', 'Marca'],
    ['hero', 'Portada'],
    ['history', 'Historia'],
    ['sections', 'Secciones'],
    ['map', 'Mapa'],
    ['visitors', 'Visitantes'],
    ['contact', 'Contacto']
  ];

  async function loadContent() {
    setSync(true);
    try {
      const data = await api('/api/admin/content');
      state.content = clone(data.content);
      renderContent();
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderContent() {
    if (!state.content) return;
    const tabs = $('#contentTabs');
    const panels = $('#contentPanels');
    if (!tabs || !panels) return;
    tabs.replaceChildren();
    panels.replaceChildren();
    CONTENT_TABS.forEach(([key, label]) => {
      const button = el('button', 'content-tab', label);
      button.type = 'button';
      button.dataset.contentTab = key;
      button.addEventListener('click', () => showContentTab(key));
      tabs.append(button);
    });
    CONTENT_TABS.forEach(([key]) => {
      const panel = el('div', 'content-panel');
      panel.dataset.contentPanel = key;
      panel.append(buildContentPanel(key));
      panels.append(panel);
    });
    if (!CONTENT_TABS.some(([key]) => key === state.contentTab)) state.contentTab = 'brand';
    showContentTab(state.contentTab);
  }

  function showContentTab(key) {
    state.contentTab = key;
    $$('[data-content-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.contentTab === key));
    $$('[data-content-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.contentPanel === key));
  }

  function contentField(path, label, opts = {}) {
    const wrap = el('label', `field${opts.full ? ' full' : ''}`);
    wrap.append(el('span', '', label));
    let input;
    if (opts.textarea) {
      input = el('textarea');
      input.rows = opts.rows || 3;
    } else {
      input = el('input');
      input.type = opts.type || 'text';
      if (opts.min !== undefined) input.min = String(opts.min);
      if (opts.max !== undefined) input.max = String(opts.max);
      if (opts.step !== undefined) input.step = String(opts.step);
      if (opts.placeholder) input.placeholder = opts.placeholder;
    }
    const value = getPath(state.content, path);
    input.value = opts.lines ? (Array.isArray(value) ? value.join('\n') : '') : (value == null ? '' : String(value));
    input.dataset.path = path;
    if (opts.lines) input.dataset.lines = '1';
    if (opts.type === 'number') input.dataset.number = '1';
    wrap.append(input);
    if (opts.hint) wrap.append(el('small', 'form-hint', opts.hint));
    return wrap;
  }

  function contentCard(title, description, fields) {
    const card = el('div', 'admin-card');
    const head = el('div', 'content-section-head');
    const left = el('div');
    left.append(el('h3', '', title));
    if (description) left.append(el('p', '', description));
    head.append(left);
    card.append(head);
    const grid = el('div', 'form-grid');
    fields.forEach((field) => grid.append(field));
    card.append(grid);
    return card;
  }

  function repeater(container, path, fields, blank, addLabel) {
    let items = getPath(state.content, path);
    if (!Array.isArray(items)) {
      items = [];
      setPath(state.content, path, items);
    }
    const root = el('div', 'repeater');

    function draw() {
      root.replaceChildren();
      items.forEach((item, index) => {
        const row = el('div', 'repeater-item');
        const fieldsWrap = el('div', 'repeater-fields');
        fields.forEach((field) => {
          const wrap = el('label', `field${field.full ? ' full' : ''}`);
          wrap.append(el('span', '', field.label));
          let input;
          if (field.lines || field.textarea) {
            input = el('textarea');
            input.rows = field.rows || 2;
            input.value = field.lines && Array.isArray(item[field.key]) ? item[field.key].join('\n') : (item[field.key] || '');
          } else {
            input = el('input');
            input.type = 'text';
            input.value = item[field.key] == null ? '' : String(item[field.key]);
          }
          input.addEventListener('input', () => {
            if (field.lines) {
              item[field.key] = input.value.split('\n').map((v) => v.trim()).filter(Boolean);
            } else {
              item[field.key] = input.value;
            }
          });
          wrap.append(input);
          fieldsWrap.append(wrap);
        });
        const remove = el('button', 'repeater-remove', '×');
        remove.type = 'button';
        remove.title = 'Eliminar';
        remove.addEventListener('click', () => {
          items.splice(index, 1);
          draw();
        });
        row.append(fieldsWrap, remove);
        root.append(row);
      });
      const add = el('button', 'repeater-add', addLabel || '+ Añadir');
      add.type = 'button';
      add.addEventListener('click', () => {
        items.push(clone(blank));
        draw();
      });
      root.append(add);
    }

    draw();
    container.append(root);
  }

  function buildContentPanel(key) {
    const fragment = document.createDocumentFragment();
    if (key === 'brand') {
      fragment.append(contentCard('Identidad de marca', 'Nombre, promesa y frase principal del sitio.', [
        contentField('brand.name', 'Nombre'),
        contentField('brand.sub', 'Subtítulo'),
        contentField('brand.tagline', 'Tagline'),
        contentField('brand.claim', 'Frase de marca', { textarea: true, rows: 2, full: true })
      ]));
    }

    if (key === 'hero') {
      fragment.append(contentCard('Portada principal', 'Texto e imagen de la primera pantalla. Usa una URL o una ruta de /assets/img.', [
        contentField('hero.kicker', 'Antetítulo'),
        contentField('hero.title', 'Título'),
        contentField('hero.subtitle', 'Subtítulo'),
        contentField('hero.text', 'Texto descriptivo', { textarea: true, rows: 3, full: true }),
        contentField('hero.image', 'Imagen de portada', { full: true }),
        contentField('hero.imageAlt', 'Texto alternativo de la imagen', { full: true }),
        contentField('hero.badge', 'Etiqueta de disponibilidad'),
        contentField('hero.openText', 'Horario destacado'),
        contentField('hero.rating', 'Calificación'),
        contentField('hero.reviews', 'Número de reseñas')
      ]));
    }

    if (key === 'history') {
      const introCard = contentCard('La cueva', 'Relato introductorio y fotografías.', [
        contentField('intro.kicker', 'Antetítulo'),
        contentField('intro.title', 'Título'),
        contentField('intro.lead', 'Entradilla', { textarea: true, rows: 3, full: true }),
        contentField('intro.paragraphs', 'Párrafos (uno por línea)', { textarea: true, rows: 5, full: true, lines: true }),
        contentField('intro.image', 'Imagen principal'),
        contentField('intro.image2', 'Imagen secundaria')
      ]);
      fragment.append(introCard);

      const statsContainer = el('div');
      repeater(statsContainer, 'intro.stats', [
        { key: 'value', label: 'Valor' },
        { key: 'suffix', label: 'Sufijo' },
        { key: 'label', label: 'Etiqueta', full: true }
      ], { value: '0', suffix: '', label: 'Nueva cifra' }, '+ Añadir cifra');
      const statsCard = contentCard('Cifras', 'Datos que aparecen bajo el relato.', []);
      statsCard.append(statsContainer);
      fragment.append(statsCard);

      const valuesContainer = el('div');
      repeater(valuesContainer, 'values', [
        { key: 'icon', label: 'Icono (flame, water, leaf)' },
        { key: 'title', label: 'Título' },
        { key: 'text', label: 'Texto', full: true, lines: false, textarea: true, rows: 2 }
      ], { icon: 'flame', title: 'Nuevo valor', text: '' }, '+ Añadir valor');
      const valuesCard = contentCard('Valores', 'Los tres pilares de la experiencia.', []);
      valuesCard.append(valuesContainer);
      fragment.append(valuesCard);

      const timelineContainer = el('div');
      repeater(timelineContainer, 'timeline', [
        { key: 'year', label: 'Año' },
        { key: 'title', label: 'Título' },
        { key: 'text', label: 'Texto', full: true, textarea: true, rows: 2 }
      ], { year: '', title: '', text: '' }, '+ Añadir hito');
      const timelineCard = contentCard('Línea de tiempo', 'Historia y conservación.', []);
      timelineCard.append(timelineContainer);
      fragment.append(timelineCard);
    }

    if (key === 'sections') {
      const defs = [
        ['toursIntro', 'Experiencias', 'Introducción del catálogo de tours.'],
        ['bookingIntro', 'Reserva en línea', 'Texto del bloque de reserva.'],
        ['galleryIntro', 'Galería', 'Introducción del archivo visual.'],
        ['videosIntro', 'Videos', 'Introducción de la videoteca.'],
        ['infoIntro', 'Antes de bajar', 'Introducción de requisitos y recomendaciones.'],
        ['policiesIntro', 'Políticas', 'Introducción de las políticas.']
      ];
      defs.forEach(([path, title, description]) => {
        fragment.append(contentCard(title, description, [
          contentField(`${path}.kicker`, 'Antetítulo'),
          contentField(`${path}.title`, 'Título'),
          contentField(`${path}.text`, 'Texto', { textarea: true, rows: 3, full: true })
        ]));
      });
    }

    if (key === 'map') {
      fragment.append(contentCard('Cómo llegar', 'Dirección, coordenadas y notas de acceso.', [
        contentField('mapIntro.kicker', 'Antetítulo'),
        contentField('mapIntro.title', 'Título'),
        contentField('mapIntro.text', 'Texto', { textarea: true, rows: 3, full: true }),
        contentField('mapIntro.address', 'Dirección', { full: true }),
        contentField('mapIntro.lat', 'Latitud', { type: 'number', step: 'any' }),
        contentField('mapIntro.lng', 'Longitud', { type: 'number', step: 'any' }),
        contentField('mapIntro.plusCode', 'Plus Code', { full: true }),
        contentField('mapIntro.note', 'Nota de acceso', { textarea: true, rows: 2, full: true })
      ]));
      const directionsContainer = el('div');
      repeater(directionsContainer, 'mapIntro.directions', [
        { key: 'label', label: 'Desde' },
        { key: 'value', label: 'Distancia / tiempo' }
      ], { label: 'Nuevo origen', value: '' }, '+ Añadir indicación');
      const card = contentCard('Indicaciones', 'Distancias desde los puntos de referencia.', []);
      card.append(directionsContainer);
      fragment.append(card);
    }

    if (key === 'visitors') {
      fragment.append(contentCard('Requisitos', 'Un requisito por línea.', [
        contentField('requirements', 'Requisitos de ingreso', { textarea: true, rows: 6, full: true, lines: true })
      ]));
      fragment.append(contentCard('Recomendaciones', 'Un consejo por línea.', [
        contentField('recommendations', 'Recomendaciones', { textarea: true, rows: 6, full: true, lines: true })
      ]));
      fragment.append(contentCard('Restricciones', 'Una restricción por línea.', [
        contentField('restrictions', 'Restricciones', { textarea: true, rows: 7, full: true, lines: true })
      ]));

      const policyContainer = el('div');
      repeater(policyContainer, 'policies', [
        { key: 'id', label: 'Identificador' },
        { key: 'title', label: 'Título' },
        { key: 'summary', label: 'Resumen', full: true },
        { key: 'items', label: 'Puntos (uno por línea)', full: true, lines: true, rows: 4 }
      ], { id: 'nueva-politica', title: 'Nueva política', summary: '', items: [] }, '+ Añadir política');
      const policyCard = contentCard('Políticas', 'Reserva, pagos, cancelación, clima, reembolsos y privacidad.', []);
      policyCard.append(policyContainer);
      fragment.append(policyCard);

      const faqContainer = el('div');
      repeater(faqContainer, 'faq', [
        { key: 'q', label: 'Pregunta', full: true },
        { key: 'a', label: 'Respuesta', full: true, textarea: true, rows: 3 }
      ], { q: 'Nueva pregunta', a: '' }, '+ Añadir pregunta');
      const faqCard = contentCard('Preguntas frecuentes', 'Respuestas breves para visitantes.', []);
      faqCard.append(faqContainer);
      fragment.append(faqCard);
    }

    if (key === 'contact') {
      fragment.append(contentCard('Contacto', 'Datos públicos de atención.', [
        contentField('contact.phone', 'Teléfono'),
        contentField('contact.whatsapp', 'WhatsApp (solo dígitos)'),
        contentField('contact.email', 'Correo'),
        contentField('contact.address', 'Dirección', { full: true }),
        contentField('contact.hours', 'Horario'),
        contentField('contact.instagram', 'Instagram'),
        contentField('contact.facebook', 'Facebook'),
        contentField('contact.emergency', 'Emergencias'),
        contentField('footerNote', 'Nota del pie de página', { textarea: true, rows: 3, full: true })
      ]));
    }

    return fragment;
  }

  function collectContent() {
    $$('#contentPanels [data-path]').forEach((input) => {
      let value = input.value;
      if (input.dataset.lines) value = value.split('\n').map((line) => line.trim()).filter(Boolean);
      else if (input.dataset.number) value = Number(value);
      setPath(state.content, input.dataset.path, value);
    });
  }

  async function saveContent(button) {
    if (!state.content) return;
    busy(button, true);
    try {
      collectContent();
      const data = await api('/api/admin/content', {
        method: 'PUT',
        body: JSON.stringify({ content: state.content })
      });
      state.content = clone(data.content);
      renderContent();
      toast('Contenido publicado en el sitio.');
    } catch (error) {
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  /* ====================================================================
     Galería
     ==================================================================== */

  async function loadGallery() {
    setSync(true);
    try {
      const data = await api('/api/admin/content');
      state.content = clone(data.content);
      renderGallery();
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderGallery() {
    const grid = $('#galleryGrid');
    const note = $('#galleryNote');
    if (!grid) return;
    const gallery = state.content?.gallery || [];
    if (note) note.textContent = `${gallery.length} imágenes en la galería pública.`;
    grid.replaceChildren();
    if (!gallery.length) {
      grid.append(el('div', 'empty-state', 'No hay imágenes. Sube una foto o añade una URL.'));
      return;
    }
    gallery.forEach((item, index) => {
      const card = el('article', 'gallery-admin-card');
      const thumb = el('div', 'thumb');
      const img = el('img');
      img.src = item.src;
      img.alt = item.caption || '';
      img.loading = 'lazy';
      thumb.append(img);
      const body = el('div', 'gallery-admin-body');

      const caption = el('label', 'field');
      caption.append(el('span', '', 'Caption'));
      const captionInput = el('input');
      captionInput.value = item.caption || '';
      captionInput.addEventListener('input', () => { item.caption = captionInput.value; });
      caption.append(captionInput);

      const category = el('label', 'field');
      category.append(el('span', '', 'Categoría'));
      const select = el('select');
      CATEGORY_OPTIONS.forEach(([value, label]) => {
        const option = el('option', '', label);
        option.value = value;
        option.selected = item.category === value;
        select.append(option);
      });
      select.addEventListener('change', () => { item.category = select.value; });
      category.append(select);

      const credit = el('label', 'field');
      credit.append(el('span', '', 'Crédito / licencia'));
      const creditInput = el('input');
      creditInput.value = item.credit || '';
      creditInput.addEventListener('input', () => { item.credit = creditInput.value; });
      credit.append(creditInput);

      const actions = el('div', 'gallery-admin-actions');
      const preview = el('a', 'btn btn-outline', 'Ver');
      preview.href = item.src;
      preview.target = '_blank';
      preview.rel = 'noopener';
      const remove = el('button', 'btn btn-outline danger', 'Quitar');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!window.confirm('¿Quitar esta imagen de la galería? Se aplicará al guardar.')) return;
        state.content.gallery.splice(index, 1);
        renderGallery();
        toast('Imagen quitada. Guarda la galería para publicar.');
      });
      actions.append(preview, remove);
      body.append(caption, category, credit, actions);
      card.append(thumb, body);
      grid.append(card);
    });
  }

  function openGalleryForm(prefill = {}) {
    const form = el('form');
    const grid = el('div', 'form-grid');
    grid.append(
      formField('URL de la imagen', 'src', prefill.src || '', { full: true, placeholder: '/assets/img/foto.jpg o https://…' }),
      formField('Descripción', 'caption', prefill.caption || '', { full: true }),
      formField('Crédito / licencia', 'credit', prefill.credit || 'Wikimedia Commons')
    );
    const catWrap = el('label', 'field');
    catWrap.append(el('span', '', 'Categoría'));
    const select = el('select');
    select.name = 'category';
    CATEGORY_OPTIONS.forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      option.selected = (prefill.category || 'cueva') === value;
      select.append(option);
    });
    catWrap.append(select);
    grid.append(catWrap);
    form.append(grid);
    const actions = el('div', 'modal-actions');
    const save = el('button', 'btn btn-primary btn-compact', 'Añadir a la galería');
    save.type = 'submit';
    const cancel = el('button', 'btn btn-outline btn-compact', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    actions.append(save, cancel);
    form.append(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const src = form.elements.namedItem('src')?.value.trim();
      if (!src) {
        toast('La URL de la imagen es obligatoria.');
        return;
      }
      state.content.gallery = state.content.gallery || [];
      state.content.gallery.push({
        id: `img_${Date.now()}`,
        src,
        caption: form.elements.namedItem('caption')?.value.trim() || '',
        category: select.value || 'cueva',
        credit: form.elements.namedItem('credit')?.value.trim() || ''
      });
      closeModal();
      renderGallery();
      toast('Imagen añadida. Guarda la galería para publicar.');
    });

    openModal('Añadir imagen', form, { kicker: 'Galería pública' });
  }

  async function saveGallery(button) {
    busy(button, true);
    try {
      const data = await api('/api/admin/content', {
        method: 'PUT',
        body: JSON.stringify({ content: state.content })
      });
      state.content = clone(data.content);
      renderGallery();
      toast('Galería publicada.');
    } catch (error) {
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  async function uploadGallery(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast('La imagen supera los 8 MB.');
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setSync(true);
    try {
      const data = await api('/api/admin/media', {
        method: 'POST',
        body: JSON.stringify({ dataUrl })
      });
      openGalleryForm({ src: data.url, caption: file.name.replace(/\.[^.]+$/, ''), credit: 'Carga propia' });
      toast('Imagen subida. Completa los datos para añadirla.');
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
      const input = $('#galleryUpload');
      if (input) input.value = '';
    }
  }

  /* ====================================================================
     Videos
     ==================================================================== */

  async function loadVideos() {
    setSync(true);
    try {
      const data = await api('/api/admin/content');
      state.content = clone(data.content);
      renderVideos();
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderVideos() {
    const grid = $('#videosGrid');
    const note = $('#videosNote');
    if (!grid) return;
    const videos = state.content?.videos || [];
    if (note) note.textContent = `${videos.length} videos en la videoteca pública.`;
    grid.replaceChildren();
    if (!videos.length) {
      grid.append(el('div', 'empty-state', 'No hay videos. Añade uno con “Nuevo video”.'));
      return;
    }
    videos.forEach((video, index) => {
      const card = el('article', 'video-admin-card');
      const thumb = el('div', 'video-thumb');
      const img = el('img');
      img.src = `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`;
      img.alt = '';
      img.loading = 'lazy';
      thumb.append(img, el('span'));
      const body = el('div', 'video-admin-body');
      body.append(el('h3', '', video.title || 'Video'), el('p', '', video.description || 'Sin descripción.'));
      const meta = el('div', 'video-admin-meta');
      meta.append(el('span', '', video.category || 'General'), el('span', '', video.youtubeId || '—'));
      const actions = el('div', 'video-admin-actions');
      const edit = el('button', 'btn btn-outline', 'Editar');
      edit.type = 'button';
      edit.addEventListener('click', () => openVideoForm(video));
      const remove = el('button', 'btn btn-outline danger', 'Quitar');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!window.confirm('¿Quitar este video de la videoteca? Se aplicará al guardar.')) return;
        state.content.videos.splice(index, 1);
        renderVideos();
        toast('Video quitado. Guarda los videos para publicar.');
      });
      actions.append(edit, remove);
      body.append(meta, actions);
      card.append(thumb, body);
      grid.append(card);
    });
  }

  function openVideoForm(video = null) {
    const editing = Boolean(video);
    const form = el('form');
    const grid = el('div', 'form-grid');
    grid.append(
      formField('ID de YouTube', 'youtubeId', video?.youtubeId || '', { full: true, placeholder: 'kZusYOYxpA8', hint: 'Solo el identificador, no la URL completa.' }),
      formField('Título', 'title', video?.title || '', { full: true }),
      formField('Categoría', 'category', video?.category || 'Cueva'),
      formField('Descripción', 'description', video?.description || '', { textarea: true, rows: 3, full: true })
    );
    form.append(grid);
    const actions = el('div', 'modal-actions');
    const save = el('button', 'btn btn-primary btn-compact', editing ? 'Guardar cambios' : 'Añadir video');
    save.type = 'submit';
    const cancel = el('button', 'btn btn-outline btn-compact', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    actions.append(save, cancel);
    form.append(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const youtubeId = form.elements.namedItem('youtubeId')?.value.trim();
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(youtubeId || '')) {
        toast('El ID de YouTube no es válido.');
        return;
      }
      const data = {
        id: video?.id || `vid_${Date.now()}`,
        youtubeId,
        title: form.elements.namedItem('title')?.value.trim() || 'Video',
        description: form.elements.namedItem('description')?.value.trim() || '',
        category: form.elements.namedItem('category')?.value.trim() || 'Cueva'
      };
      state.content.videos = state.content.videos || [];
      if (editing) {
        const index = state.content.videos.findIndex((v) => v.id === video.id);
        if (index >= 0) state.content.videos[index] = data;
      } else {
        state.content.videos.push(data);
      }
      closeModal();
      renderVideos();
      toast('Video actualizado. Guarda los videos para publicar.');
    });
    openModal(editing ? 'Editar video' : 'Nuevo video', form, { kicker: 'Videoteca pública' });
  }

  async function saveVideos(button) {
    busy(button, true);
    try {
      const data = await api('/api/admin/content', {
        method: 'PUT',
        body: JSON.stringify({ content: state.content })
      });
      state.content = clone(data.content);
      renderVideos();
      toast('Videos publicados.');
    } catch (error) {
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  /* ====================================================================
     Correos
     ==================================================================== */

  async function loadEmails() {
    setSync(true);
    try {
      const data = await api('/api/admin/emails?limit=200');
      state.emails = data.emails || [];
      renderEmails();
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderEmails() {
    const list = $('#emailsList');
    const count = $('#emailCount');
    if (!list) return;
    if (count) count.textContent = `${state.emails.length} correos en la bandeja`;
    list.replaceChildren();
    if (!state.emails.length) {
      list.append(el('div', 'empty-state', 'La bandeja está vacía. Los correos aparecen al crear y pagar reservas.'));
      return;
    }
    state.emails.forEach((email) => {
      const item = el('div', 'email-item');
      const icon = el('div', 'email-icon');
      icon.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      const main = el('div', 'email-main');
      main.append(el('strong', '', email.subject || '(Sin asunto)'), el('span', '', `${email.to || '—'} · ${email.reservationCode || '—'} · ${email.template || '—'}`));
      const side = el('div', 'email-side');
      side.append(el('time', '', longDateTime(email.createdAt)), statusBadge(email.status, STATUS_LABEL[email.status] || email.status));
      item.append(icon, main, side);
      item.addEventListener('click', () => openEmail(email));
      list.append(item);
    });
  }

  function openEmail(email) {
    const body = el('div');
    const meta = el('div', 'email-meta');
    const entries = [
      ['Para', email.to],
      ['Plantilla', email.template],
      ['Reserva', email.reservationCode],
      ['Estado', STATUS_LABEL[email.status] || email.status],
      ['Intentos', email.attempts != null ? `${email.attempts}/5` : '—'],
      ['Próximo reintento', email.nextAttemptAt ? longDateTime(email.nextAttemptAt) : '—'],
      ['Proveedor', email.provider],
      ['Creado', longDateTime(email.createdAt)]
    ];
    if (email.error) {
      entries.push(['Último error', email.error]);
    }
    entries.forEach(([label, value]) => {
      const item = el('span');
      item.append(el('b', '', `${label}: `), document.createTextNode(value || '—'));
      meta.append(item);
    });
    const preview = el('div', 'email-preview');
    const frame = el('iframe');
    frame.setAttribute('sandbox', '');
    frame.setAttribute('title', 'Vista previa del correo');
    frame.srcdoc = email.html || `<pre>${String(email.text || '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</pre>`;
    preview.append(frame);
    body.append(meta, preview);
    openModal(email.subject || 'Correo', body, { kicker: 'Bandeja de salida', wide: true });
  }

  /* ====================================================================
     Reembolsos
     ==================================================================== */

  async function loadRefunds() {
    setSync(true);
    try {
      const data = await api('/api/admin/refunds');
      state.refunds = data.refunds || [];
      renderRefundItems($('#refundsList'), state.refunds);
      const count = $('#refundCount');
      if (count) count.textContent = `${state.refunds.length} reembolsos · ${state.refunds.filter((r) => r.status === 'pending').length} pendientes`;
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function renderRefundItems(container, refunds, { compact = false } = {}) {
    if (!container) return;
    container.replaceChildren();
    if (!refunds?.length) {
      const empty = el('div', 'empty-state');
      empty.append(el('strong', '', 'Sin reembolsos pendientes'), document.createTextNode('Las cancelaciones con importe a favor aparecerán aquí.'));
      container.append(empty);
      return;
    }
    refunds.forEach((refund) => {
      const item = el('div', 'refund-item');
      const main = el('div', 'refund-main');
      main.append(
        el('strong', '', `${refund.reservationCode || '—'} · ${refund.customerName || 'Cliente'}`),
        el('span', '', `${refund.customerEmail || '—'} · ${refund.reason || 'Sin motivo'} · ${shortDate(refund.requestedAt)}`)
      );
      const amount = el('div', 'refund-amount');
      amount.append(el('strong', '', money(refund.amount)), el('span', '', `${refund.percent || 0}% · ${refund.method || '—'}`));
      const actions = el('div', 'refund-actions');
      const view = el('button', 'btn btn-outline', 'Ver reserva');
      view.type = 'button';
      view.addEventListener('click', () => openReservation(refund.reservationCode));
      actions.append(view);
      if (refund.status === 'pending') {
        const process = el('button', 'btn btn-primary', 'Procesar');
        process.type = 'button';
        process.addEventListener('click', () => openRefundProcess(refund));
        actions.append(process);
      } else {
        actions.append(statusBadge(refund.status || 'processed', refund.status === 'processed' ? 'Procesado' : refund.status));
      }
      item.append(main, amount, actions);
      if (!compact) {
        const meta = el('div', 'refund-main');
        meta.style.flexBasis = '100%';
        meta.append(el('span', '', `Solicitado ${longDateTime(refund.requestedAt)}${refund.processedAt ? ` · procesado ${longDateTime(refund.processedAt)}` : ''}${refund.reference ? ` · referencia ${refund.reference}` : ''}`));
        item.append(meta);
      }
      container.append(item);
    });
  }

  function openRefundProcess(refund) {
    const form = el('form');
    const note = el('div', 'modal-note warn', `Se procesará un reembolso de ${money(refund.amount)} para ${refund.customerName} (${refund.reservationCode}). Se enviará un correo automático.`);
    form.append(note);
    const actions = el('div', 'modal-actions');
    const process = el('button', 'btn btn-primary btn-compact', refund.reference ? 'Consultar reembolso' : 'Solicitar reembolso');
    process.type = 'submit';
    const cancel = el('button', 'btn btn-outline btn-compact', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    actions.append(process, cancel);
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      busy(process, true);
      try {
        const result = await api(`/api/admin/refunds/${encodeURIComponent(refund.id)}/process`, {
          method: 'POST', body: '{}'
        });
        toast(result.refund.status === 'processed' ? 'Reembolso procesado y correo generado.' : 'Solicitud registrada. La pasarela está procesando el reembolso.');
        closeModal();
        loadRefunds();
        if (state.view === 'overview') loadOverview();
      } catch (error) {
        handleError(error);
      } finally {
        busy(process, false);
      }
    });
    openModal('Procesar reembolso', form, { kicker: 'Control de reembolsos' });
  }

  /* ====================================================================
     Configuración
     ==================================================================== */

  async function loadSettings() {
    setSync(true);
    try {
      const data = await api('/api/admin/settings');
      state.settings = clone(data.settings);
      state.smtpStatus = data.smtpStatus || null;
      renderSettings();
    } catch (error) {
      handleError(error);
    } finally {
      setSync(false);
    }
  }

  function settingsField(container, path, label, opts = {}) {
    const value = getPath(state.settings, path);
    const wrap = el('label', `field${opts.full ? ' full' : ''}`);
    wrap.append(el('span', '', label));
    let input;
    if (opts.checkbox) {
      const check = el('label', 'inline-check');
      input = el('input');
      input.type = 'checkbox';
      input.checked = Boolean(value);
      check.append(input, document.createTextNode(opts.checkboxLabel || 'Activo'));
      wrap.append(check);
    } else if (opts.select) {
      input = el('select');
      opts.select.forEach(([val, text]) => {
        const option = el('option', '', text);
        option.value = val;
        option.selected = String(value) === String(val);
        input.append(option);
      });
      wrap.append(input);
    } else {
      input = el('input');
      input.type = opts.secret ? 'password' : (opts.type || 'text');
      input.value = value == null ? '' : String(value);
      if (opts.secret) {
        input.autocomplete = 'new-password';
        input.placeholder = opts.placeholder || 'Déjalo vacío para conservar la actual';
      }
      if (opts.min !== undefined) input.min = String(opts.min);
      if (opts.max !== undefined) input.max = String(opts.max);
      if (opts.step !== undefined) input.step = String(opts.step);
      if (opts.placeholder && !opts.secret) input.placeholder = opts.placeholder;
      wrap.append(input);
    }
    if (opts.secret && opts.configured) {
      const hint = el('small', 'form-hint', 'Configurada. Déjalo vacío para no cambiarla.');
      wrap.append(hint);
    }
    if (opts.disabled) {
      input.disabled = true;
      wrap.style.opacity = '0.75';
    }
    input.dataset.settingsPath = path;
    container.append(wrap);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function renderSettings() {
    if (!state.settings) return;
    const business = $('#settingsBusiness');
    const booking = $('#settingsBooking');
    const payments = $('#settingsPayments');
    const smtp = $('#settingsSmtp');
    if (business) {
      business.replaceChildren();
      settingsField(business, 'business.legalName', 'Razón social', { full: true });
      settingsField(business, 'business.nit', 'NIT');
      settingsField(business, 'business.phone', 'Teléfono');
      settingsField(business, 'business.email', 'Correo');
      settingsField(business, 'business.address', 'Dirección', { full: true });
    }
    if (booking) {
      booking.replaceChildren();
      settingsField(booking, 'booking.holdMinutes', 'Bloqueo de cupos (min)', { type: 'number', min: 5, max: 120 });
      settingsField(booking, 'booking.advanceDays', 'Venta anticipada (días)', { type: 'number', min: 7, max: 365 });
      settingsField(booking, 'booking.cutoffHours', 'Corte previo (horas)', { type: 'number', min: 0 });
      settingsField(booking, 'booking.exchangeRate', 'Tipo de cambio GTQ/USD', { type: 'number', min: 1, step: '0.01' });
      settingsField(booking, 'booking.pendingLimit', 'Reservas pendientes por cuenta', { type: 'number', min: 1 });
      settingsField(booking, 'booking.lastSeatsPercent', 'Avisar últimos cupos al alcanzar (%)', { type: 'number', min: 0, max: 100, step: 'any' });
      settingsField(booking, 'booking.currency', 'Moneda');
      settingsField(booking, 'booking.maxSeatsPerOrder', 'Máximo de asientos por orden', { type: 'number', min: 1, max: 60 });
    }
    if (payments) {
      payments.replaceChildren();
      settingsField(payments, 'payments.provider', 'Proveedor configurado en el servidor', { full: true, disabled: true });
      settingsField(payments, 'payments.merchantId', 'Merchant ID');
      settingsField(payments, 'payments.publicKey', 'Llave pública', { full: true });
      settingsField(payments, 'payments.secretKey', 'Llave secreta', { full: true, secret: true, disabled: true, placeholder: 'Variable PAYMENTS_SECRET_KEY', configured: Boolean(state.settings.payments?.secretKeyConfigured) });
      settingsField(payments, 'payments.webhookSecret', 'Secreto de webhook', { full: true, secret: true, disabled: true, placeholder: 'Variable PAYMENTS_WEBHOOK_SECRET', configured: Boolean(state.settings.payments?.webhookSecretConfigured) });
      settingsField(payments, 'payments.statement', 'Descriptor del estado de cuenta', { full: true });
    }
    if (smtp) {
      smtp.replaceChildren();
      const status = state.smtpStatus;
      const banner = $('#smtpBanner');
      const overrides = status?.hasEnvOverrides || {};

      if (banner) {
        banner.hidden = false;
        if (status?.source === 'env') {
          banner.style.background = 'rgba(47, 107, 87, 0.12)';
          banner.style.color = '#1b4a3c';
          banner.style.border = '1px solid rgba(47, 107, 87, 0.3)';
          banner.innerHTML = `<strong>Configuración activa desde variables de entorno (Render)</strong><br>` +
            `Host: <code>${escapeHtml(status.host) || '—'}</code> · Puerto: <code>${status.port}</code> (${status.secure ? 'TLS' : 'STARTTLS/Plano'})<br>` +
            `Usuario: <code>${escapeHtml(status.userMasked)}</code> · Remitente: <code>${escapeHtml(status.fromEmail)}</code><br>` +
            `<small style="color:#4a6358;">Los campos sobreescritos por Render no se pueden editar desde aquí.</small>`;
        } else if (status?.source === 'database') {
          banner.style.background = 'rgba(201, 142, 69, 0.12)';
          banner.style.color = '#734e18';
          banner.style.border = '1px solid rgba(201, 142, 69, 0.3)';
          banner.innerHTML = `<strong>Configuración activa desde base de datos (Panel Admin)</strong><br>` +
            `Usuario activo: <code>${escapeHtml(status.userMasked)}</code> en <code>${escapeHtml(status.host)}:${status.port}</code>`;
        } else {
          banner.style.background = 'rgba(189, 96, 65, 0.1)';
          banner.style.color = '#8e3b25';
          banner.style.border = '1px solid rgba(189, 96, 65, 0.25)';
          banner.innerHTML = `<strong>SMTP no configurado</strong><br>` +
            `Los correos se guardan localmente en la bandeja de salida y <code>data/outbox/</code>.`;
        }
      }

      settingsField(smtp, 'smtp.host', 'Host', { full: true, placeholder: 'smtp.ejemplo.com', disabled: overrides.host });
      settingsField(smtp, 'smtp.port', 'Puerto', { type: 'number', min: 1, max: 65535, disabled: overrides.port });
      settingsField(smtp, 'smtp.secure', 'Conexión segura', { checkbox: true, checkboxLabel: 'TLS/SSL', disabled: overrides.secure });
      settingsField(smtp, 'smtp.user', 'Usuario', { full: true, disabled: overrides.user });
      settingsField(smtp, 'smtp.pass', 'Contraseña', { type: 'password', full: true, secret: true, configured: Boolean(state.settings.smtp?.passConfigured), disabled: true });
      settingsField(smtp, 'smtp.fromEmail', 'Correo remitente', { disabled: overrides.fromEmail });
      settingsField(smtp, 'smtp.fromName', 'Nombre remitente', { disabled: overrides.fromName });
    }
  }

  async function saveSettings(button) {
    if (!state.settings) return;
    $$('#settingsForm [data-settings-path]').forEach((input) => {
      let value;
      if (input.type === 'checkbox') value = input.checked;
      else if (input.type === 'number') value = Number(input.value);
      else value = input.value;
      setPath(state.settings, input.dataset.settingsPath, value);
    });
    busy(button, true);
    try {
      const data = await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: state.settings })
      });
      state.settings = clone(data.settings);
      state.smtpStatus = data.smtpStatus || state.smtpStatus;
      renderSettings();
      toast('Configuración guardada.');
    } catch (error) {
      handleError(error);
    } finally {
      busy(button, false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    const current = $('#currentPassword');
    const next = $('#nextPassword');
    const confirm = $('#confirmPassword');
    const error = $('#passwordError');
    const button = $('#savePassword');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    if (!current?.value || !next?.value) {
      showPasswordError('Completa todos los campos.');
      return;
    }
    if (next.value.length < 8) {
      showPasswordError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (next.value !== confirm?.value) {
      showPasswordError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    busy(button, true);
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ current: current.value, next: next.value })
      });
      current.value = '';
      next.value = '';
      if (confirm) confirm.value = '';
      toast('Contraseña actualizada.');
    } catch (err) {
      showPasswordError(err.status === 401 ? 'La contraseña actual no es correcta.' : err.message);
    } finally {
      busy(button, false);
    }
  }

  function showPasswordError(message) {
    const error = $('#passwordError');
    if (!error) {
      toast(message);
      return;
    }
    error.hidden = false;
    error.textContent = message;
  }

  /* ====================================================================
     Eventos e inicio
     ==================================================================== */

  function bind() {
    $('#logoutButton')?.addEventListener('click', logout);

    $$('.nav-item').forEach((item) => {
      item.addEventListener('click', () => navigate(item.dataset.view));
    });

    $('#menuToggle')?.addEventListener('click', openSidebar);
    const filters = $$('[data-tour-filter]');
    filters.forEach(button => button.addEventListener('click', () => {
      filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      renderTours();
    }));
    $('#sidebarClose')?.addEventListener('click', closeSidebar);
    $('#sidebarScrim')?.addEventListener('click', closeSidebar);

    $('#refreshButton')?.addEventListener('click', () => loadView(state.view));

    document.addEventListener('click', (event) => {
      const go = event.target.closest('[data-go]');
      if (go) navigate(go.dataset.go);
      const close = event.target.closest('[data-close-modal]');
      if (close) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeModal();
        closeSidebar();
      }
    });

    let searchTimer;
    $('#reservationSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadReservations, 320);
    });
    $('#reservationStatus')?.addEventListener('change', loadReservations);
    $('#refreshReservations')?.addEventListener('click', loadReservations);

    $('#availabilityDays')?.addEventListener('change', loadAvailability);
    $('#refreshAvailability')?.addEventListener('click', loadAvailability);
    $('#closureForm')?.addEventListener('submit', addClosure);

    $('#newTourButton')?.addEventListener('click', () => openTourForm(null));

    $('#saveContent')?.addEventListener('click', (event) => saveContent(event.currentTarget));
    $('#reloadContent')?.addEventListener('click', loadContent);

    $('#galleryAddUrl')?.addEventListener('click', () => openGalleryForm({ category: 'cueva' }));
    $('#galleryUpload')?.addEventListener('change', (event) => uploadGallery(event.target.files?.[0]));
    $('#saveGallery')?.addEventListener('click', (event) => saveGallery(event.currentTarget));

    $('#newVideoButton')?.addEventListener('click', () => openVideoForm(null));
    $('#saveVideos')?.addEventListener('click', (event) => saveVideos(event.currentTarget));

    $('#refreshEmails')?.addEventListener('click', loadEmails);
    $('#refreshRefunds')?.addEventListener('click', loadRefunds);

    $('#settingsForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings($('#saveSettings'));
    });
    $('#passwordForm')?.addEventListener('submit', savePassword);

    $('#btnTestSmtp')?.addEventListener('click', async (event) => {
      const emailInput = $('#testSmtpEmail');
      const resultBox = $('#smtpTestResult');
      const button = event.currentTarget;
      const email = emailInput?.value.trim();

      if (resultBox) {
        resultBox.hidden = true;
        resultBox.textContent = '';
        resultBox.className = 'form-error';
      }

      if (!email || !email.includes('@')) {
        if (resultBox) {
          resultBox.textContent = 'Ingresa un correo electrónico válido para la prueba.';
          resultBox.hidden = false;
        } else {
          toast('Ingresa un correo válido.');
        }
        return;
      }

      busy(button, true);
      try {
        const res = await api('/api/admin/settings/test-smtp', {
          method: 'POST',
          body: JSON.stringify({ to: email })
        });
        if (resultBox) {
          resultBox.className = 'panel-alert';
          resultBox.style.background = 'rgba(47, 107, 87, 0.12)';
          resultBox.style.color = '#1b4a3c';
          resultBox.style.border = '1px solid rgba(47, 107, 87, 0.3)';
          resultBox.textContent = `✓ Conexión exitosa. Correo de prueba enviado a ${res.result?.recipient || email} usando ${res.result?.host}.`;
          resultBox.hidden = false;
        }
        toast('Prueba de conexión SMTP exitosa.');
      } catch (err) {
        if (resultBox) {
          resultBox.className = 'form-error';
          resultBox.style.background = '';
          resultBox.style.color = '';
          resultBox.style.border = '';
          resultBox.textContent = `Error SMTP: ${err.message}`;
          resultBox.hidden = false;
        }
        toast(`Error: ${err.message}`);
      } finally {
        busy(button, false);
      }
    });

    bindCafeEvents();
  }

  /* ====================================================================
     Cafetería · Ventas, Productos, Inventario, Gastos y Reportes
     ==================================================================== */

  // --- Ventas y POS ---
  async function loadCafeSales() {
    setSync(true);
    const from = $('#cafeSalesFrom')?.value || '';
    const to = $('#cafeSalesTo')?.value || '';
    const paymentMethod = $('#cafeSalesPaymentFilter')?.value || '';
    const search = $('#cafeSalesSearch')?.value || '';

    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (paymentMethod) params.set('paymentMethod', paymentMethod);
      if (search) params.set('search', search);

      const res = await api(`/api/admin/cafe/sales?${params.toString()}`);
      const sales = res.sales || [];
      state.cafeSales = sales;

      let totalAmount = 0;
      for (const s of sales) totalAmount += (Number(s.total) || 0);
      const avg = sales.length ? totalAmount / sales.length : 0;

      const kpis = $('#cafeSalesKpis');
      if (kpis) {
        kpis.replaceChildren(
          kpiCard('Total Ventas', money(totalAmount), 'Ingresos por comandas y ventas en caja', 'lime'),
          kpiCard('Cantidad de Ventas', String(sales.length), 'Comprobantes y comandas emitidas'),
          kpiCard('Ticket Promedio', money(avg), 'Consumo medio por orden', 'amber')
        );
      }

      const countNode = $('#cafeSalesCount');
      if (countNode) countNode.textContent = `${sales.length} ventas`;

      const tbody = $('#cafeSalesTbody');
      if (tbody) {
        tbody.replaceChildren();
        if (!sales.length) {
          const tr = el('tr');
          const td = el('td', '', 'No se encontraron ventas con los filtros aplicados.');
          td.colSpan = 8;
          td.style.textAlign = 'center';
          td.style.color = 'var(--muted)';
          tr.append(td);
          tbody.append(tr);
        } else {
          for (const s of sales) {
            const tr = el('tr');
            const tdCode = el('td');
            const strongCode = el('strong', '', s.code);
            tdCode.append(strongCode);

            const tdRec = el('td', '', s.receipt?.number || '—');
            const tdDate = el('td', '', s.createdAt ? new Date(s.createdAt).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
            const tdCust = el('td', '', s.customer?.name || 'Cliente en barra');
            const tdServ = el('td', '', s.customer?.serviceType || 'En mesa');

            const tdPay = el('td');
            const pMethod = s.payment?.method === 'cash' ? 'Efectivo' : s.payment?.method === 'card' ? 'Tarjeta' : s.payment?.method === 'transfer' ? 'Transferencia' : 'Otro';
            tdPay.append(statusBadge(s.payment?.status || 'paid', pMethod));

            const tdTot = el('td', '', money(s.total));
            tdTot.style.textAlign = 'right';
            tdTot.style.fontWeight = 'bold';

            const tdActions = el('td');
            tdActions.style.textAlign = 'center';
            const btnRec = el('button', 'btn btn-outline btn-sm', 'Ver comprobante');
            btnRec.type = 'button';
            btnRec.addEventListener('click', () => openCafeReceiptModal(s));
            tdActions.append(btnRec);

            tr.append(tdCode, tdRec, tdDate, tdCust, tdServ, tdPay, tdTot, tdActions);
            tbody.append(tr);
          }
        }
      }
    } catch (err) {
      handleError(err);
    } finally {
      setSync(false);
    }
  }

  function openCafeReceiptModal(order) {
    const wrap = el('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '14px';

    const header = el('div');
    header.style.textAlign = 'center';
    header.style.borderBottom = '1px solid var(--line)';
    header.style.paddingBottom = '10px';
    const h2 = el('h3', '', 'Café The Hope · K’anba Cuevas Vivas');
    h2.style.margin = '0 0 4px';
    const sub = el('p', '', `Comprobante Interno: ${order.receipt?.number || '—'} · Código: ${order.code}`);
    sub.style.margin = '0';
    sub.style.fontSize = '12px';
    sub.style.color = 'var(--muted)';
    header.append(h2, sub);

    const meta = el('div');
    meta.style.fontSize = '12px';
    meta.style.lineHeight = '1.6';
    meta.innerHTML = `
      <div><strong>Fecha:</strong> ${new Date(order.createdAt).toLocaleString('es-GT')}</div>
      <div><strong>Cliente:</strong> ${order.customer?.name || 'Cliente en barra'}</div>
      ${order.customer?.phone ? `<div><strong>Teléfono:</strong> ${order.customer.phone}</div>` : ''}
      <div><strong>Servicio:</strong> ${order.customer?.serviceType || 'En mesa · Cafetería'}</div>
      ${order.customer?.notes ? `<div><strong>Notas/Mesa:</strong> ${order.customer.notes}</div>` : ''}
      <div><strong>Forma de Pago:</strong> ${order.payment?.brand || order.payment?.method || 'Tarjeta'} (${order.payment?.provider || ''})</div>
    `;

    const tableWrap = el('div', 'table-wrap');
    const table = el('table', 'data-table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Cant.</th>
          <th>Producto</th>
          <th style="text-align:right;">Precio</th>
          <th style="text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${(order.items || []).map(item => `
          <tr>
            <td style="text-align:center;">${item.quantity}</td>
            <td>${item.displayName || item.name}</td>
            <td style="text-align:right;">${money(item.unitPrice)}</td>
            <td style="text-align:right;">${money(item.subtotal)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        ${order.tax ? `<tr><td colspan="3" style="text-align:right;color:var(--muted);">IVA 12% (incluido):</td><td style="text-align:right;color:var(--muted);">${money(order.tax)}</td></tr>` : ''}
        <tr>
          <td colspan="3" style="text-align:right;font-weight:bold;font-size:14px;">Total Pagado:</td>
          <td style="text-align:right;font-weight:bold;font-size:14px;color:var(--deep);">${money(order.total)}</td>
        </tr>
      </tfoot>
    `;
    tableWrap.append(table);

    const foot = el('div');
    foot.style.display = 'flex';
    foot.style.justifyContent = 'space-between';
    foot.style.marginTop = '10px';

    const btnPrint = el('button', 'btn btn-primary', '🖨️ Imprimir Comprobante');
    btnPrint.type = 'button';
    btnPrint.addEventListener('click', () => {
      const w = window.open('', '_blank', 'width=450,height=600');
      w.document.write(`<!doctype html><html><head><title>${order.code}</title><style>body{font-family:monospace;padding:20px;font-size:13px;line-height:1.4;}table{width:100%;border-collapse:collapse;margin:10px 0;}th,td{padding:4px 0;text-align:left;}th{border-bottom:1px solid #000;}.r{text-align:right;}.c{text-align:center;}</style></head><body><div class="c"><h2>CAFÉ THE HOPE</h2><p>K’anba Cuevas Vivas</p><p>Comprobante: ${order.receipt?.number || '—'}<br>Código: ${order.code}</p><hr></div><p>Fecha: ${new Date(order.createdAt).toLocaleString('es-GT')}<br>Cliente: ${order.customer?.name || 'Cliente'}<br>Servicio: ${order.customer?.serviceType || 'Mesa'}</p><table><thead><tr><th>Cant</th><th>Item</th><th class="r">Total</th></tr></thead><tbody>${(order.items || []).map(i => `<tr><td>${i.quantity}</td><td>${i.displayName || i.name}</td><td class="r">Q${Number(i.subtotal).toFixed(2)}</td></tr>`).join('')}</tbody></table><hr><div class="r"><p><strong>TOTAL: Q${Number(order.total).toFixed(2)}</strong></p><p>Pago: ${order.payment?.method || 'Efectivo'}</p></div><div class="c" style="margin-top:20px;"><p>¡Gracias por su visita!</p></div></body></html>`);
      w.document.close();
      w.focus();
      w.print();
    });

    const btnClose = el('button', 'btn btn-outline', 'Cerrar');
    btnClose.type = 'button';
    btnClose.addEventListener('click', closeModal);

    foot.append(btnPrint, btnClose);
    wrap.append(header, meta, tableWrap, foot);

    openModal(`Comprobante ${order.receipt?.number || order.code}`, wrap, { kicker: 'Cafetería' });
  }

  async function openCafePosModal() {
    setSync(true);
    let products = [];
    try {
      const res = await api('/api/admin/cafe/products');
      products = (res.products || []).filter(p => p.active !== false);
    } catch (err) {
      handleError(err);
      return;
    } finally {
      setSync(false);
    }

    if (!products.length) {
      toast('No hay productos activos en el menú. Agrega productos primero.');
      return;
    }

    const cart = [];
    const wrap = el('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '16px';

    const topGrid = el('div');
    topGrid.style.display = 'grid';
    topGrid.style.gridTemplateColumns = '2fr 1fr 1fr auto';
    topGrid.style.gap = '8px';
    topGrid.style.alignItems = 'end';

    const prodSelect = el('select');
    prodSelect.className = 'select-compact';
    prodSelect.innerHTML = '<option value="">Selecciona un producto…</option>' +
      products.map(p => `<option value="${p.id}" data-price="${p.price}" data-name="${p.name}" data-category="${p.category}">${p.name} - ${money(p.price)} (Stock: ${p.stock})</option>`).join('');

    const variantSelect = el('select');
    variantSelect.className = 'select-compact';
    variantSelect.innerHTML = '<option value="">Variante / Sabor</option>';

    prodSelect.addEventListener('change', () => {
      const selId = prodSelect.value;
      const prod = products.find(p => p.id === selId);
      variantSelect.innerHTML = '<option value="">Variante estándar</option>';
      if (prod && Array.isArray(prod.variants) && prod.variants.length) {
        for (const v of prod.variants) {
          const opt = el('option', '', v);
          opt.value = v;
          variantSelect.append(opt);
        }
      }
    });

    const qtyInput = el('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.value = '1';
    qtyInput.style.padding = '8px 10px';
    qtyInput.style.borderRadius = '9px';
    qtyInput.style.border = '1px solid var(--line)';

    const btnAdd = el('button', 'btn btn-outline', '+ Agregar');
    btnAdd.type = 'button';

    topGrid.append(
      Object.assign(el('div'), { innerHTML: '<label style="font-size:11px;font-weight:700;">Producto</label>' }, { children: [prodSelect] }),
      Object.assign(el('div'), { innerHTML: '<label style="font-size:11px;font-weight:700;">Variante</label>' }, { children: [variantSelect] }),
      Object.assign(el('div'), { innerHTML: '<label style="font-size:11px;font-weight:700;">Cantidad</label>' }, { children: [qtyInput] }),
      btnAdd
    );

    const cartWrap = el('div', 'table-wrap');
    const cartTable = el('table', 'data-table');
    cartTable.innerHTML = `
      <thead>
        <tr>
          <th>Cant.</th>
          <th>Ítem</th>
          <th style="text-align:right;">Precio</th>
          <th style="text-align:right;">Total</th>
          <th style="text-align:center;">Quitar</th>
        </tr>
      </thead>
      <tbody id="posCartTbody">
        <tr><td colspan="5" style="text-align:center;color:var(--muted);">El carrito está vacío. Agrega productos arriba.</td></tr>
      </tbody>
    `;
    cartWrap.append(cartTable);

    const totalBar = el('div');
    totalBar.style.display = 'flex';
    totalBar.style.justifyContent = 'flex-end';
    totalBar.style.fontSize = '16px';
    totalBar.style.fontWeight = 'bold';
    totalBar.innerHTML = '<span>Total a cobrar: <strong id="posCartTotal">Q 0.00</strong></span>';

    function renderPosCart() {
      const tbody = $('#posCartTbody', cartTable);
      const totalNode = $('#posCartTotal', totalBar);
      tbody.replaceChildren();

      if (!cart.length) {
        const tr = el('tr');
        tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--muted);">El carrito está vacío. Agrega productos arriba.</td>';
        tbody.append(tr);
        if (totalNode) totalNode.textContent = 'Q 0.00';
        return;
      }

      let grandTotal = 0;
      cart.forEach((item, index) => {
        grandTotal += item.subtotal;
        const tr = el('tr');
        tr.innerHTML = `
          <td style="text-align:center;">${item.quantity}</td>
          <td>${item.displayName}</td>
          <td style="text-align:right;">${money(item.unitPrice)}</td>
          <td style="text-align:right;font-weight:bold;">${money(item.subtotal)}</td>
          <td style="text-align:center;"><button type="button" class="icon-button" style="color:var(--rust);font-size:14px;" data-remove="${index}">✕</button></td>
        `;
        $('button[data-remove]', tr).addEventListener('click', () => {
          cart.splice(index, 1);
          renderPosCart();
        });
        tbody.append(tr);
      });

      if (totalNode) totalNode.textContent = money(grandTotal);
    }

    btnAdd.addEventListener('click', () => {
      const prodId = prodSelect.value;
      const prod = products.find(p => p.id === prodId);
      if (!prod) {
        toast('Selecciona un producto del menú.');
        return;
      }
      const qty = parseInt(qtyInput.value, 10) || 1;
      if (qty < 1) {
        toast('La cantidad debe ser al menos 1.');
        return;
      }
      const variant = variantSelect.value || null;
      const displayName = variant ? `${prod.name} (${variant})` : prod.name;
      const subtotal = Math.round(prod.price * qty * 100) / 100;

      const existing = cart.find(c => c.id === prod.id && c.variant === variant);
      if (existing) {
        existing.quantity += qty;
        existing.subtotal = Math.round(prod.price * existing.quantity * 100) / 100;
      } else {
        cart.push({
          id: prod.id,
          name: prod.name,
          displayName,
          variant,
          unitPrice: prod.price,
          quantity: qty,
          subtotal
        });
      }

      qtyInput.value = '1';
      renderPosCart();
    });

    const formMeta = el('div');
    formMeta.style.display = 'grid';
    formMeta.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
    formMeta.style.gap = '10px';
    formMeta.innerHTML = `
      <label class="field"><span>Nombre del cliente</span><input type="text" id="posCustName" value="Cliente en barra" required></label>
      <label class="field"><span>Teléfono (opcional)</span><input type="text" id="posCustPhone" placeholder="+502 ..."></label>
      <label class="field"><span>Tipo de servicio</span>
        <select id="posServiceType" class="select-compact">
          <option value="En mesa · Cafetería">En mesa · Cafetería</option>
          <option value="Para llevar">Para llevar</option>
          <option value="En barra">En barra</option>
        </select>
      </label>
      <label class="field"><span>Forma de pago</span>
        <select id="posPaymentMethod" class="select-compact">
          <option value="cash">Efectivo en caja</option>
          <option value="card">Tarjeta (POS)</option>
          <option value="transfer">Transferencia bancaria</option>
          <option value="other">Otro</option>
        </select>
      </label>
    `;

    const notesField = el('label', 'field');
    notesField.innerHTML = '<span>Notas del pedido o número de mesa</span><input type="text" id="posNotes" placeholder="Ej. Mesa 4, sin azúcar…">';

    const footBar = el('div');
    footBar.style.display = 'flex';
    footBar.style.justifyContent = 'flex-end';
    footBar.style.gap = '10px';
    footBar.style.marginTop = '12px';

    const btnCancel = el('button', 'btn btn-outline', 'Cancelar');
    btnCancel.type = 'button';
    btnCancel.addEventListener('click', closeModal);

    const btnSubmit = el('button', 'btn btn-primary', 'Emitir Venta y Comprobante');
    btnSubmit.type = 'button';
    btnSubmit.addEventListener('click', async () => {
      if (!cart.length) {
        toast('El pedido no tiene productos.');
        return;
      }
      const customerName = $('#posCustName', formMeta)?.value.trim() || 'Cliente en barra';
      const customerPhone = $('#posCustPhone', formMeta)?.value.trim() || '';
      const serviceType = $('#posServiceType', formMeta)?.value || 'En mesa · Cafetería';
      const paymentMethod = $('#posPaymentMethod', formMeta)?.value || 'cash';
      const notes = $('#posNotes', notesField)?.value.trim() || '';

      busy(btnSubmit, true);
      try {
        const res = await api('/api/admin/cafe/sales', {
          method: 'POST',
          body: JSON.stringify({
            items: cart,
            paymentMethod,
            customer: { name: customerName, phone: customerPhone, serviceType, notes }
          })
        });

        toast(`Venta registrada exitosamente: ${res.order.code}`);
        closeModal();
        openCafeReceiptModal(res.order);
        loadCafeSales();
      } catch (err) {
        handleError(err);
      } finally {
        busy(btnSubmit, false);
      }
    });

    footBar.append(btnCancel, btnSubmit);
    wrap.append(topGrid, cartWrap, totalBar, formMeta, notesField, footBar);

    openModal('Nueva Venta · Caja y POS', wrap, { kicker: 'Café The Hope', wide: true });
  }

  // --- Catálogo de Productos y Precios ---
  async function loadCafeProducts() {
    setSync(true);
    const catFilter = $('#cafeProductCatFilter')?.value || '';
    const search = ($('#cafeProductSearch')?.value || '').toLowerCase().trim();

    try {
      const res = await api('/api/admin/cafe/products');
      let products = res.products || [];
      state.cafeProducts = products;

      const select = $('#cafeProductCatFilter');
      if (select && select.children.length <= 1) {
        const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
        for (const c of cats) {
          const opt = el('option', '', c);
          opt.value = c;
          select.append(opt);
        }
      }

      if (catFilter) products = products.filter(p => p.category === catFilter);
      if (search) products = products.filter(p => p.name.toLowerCase().includes(search) || p.category.toLowerCase().includes(search));

      const countNode = $('#cafeProductsCount');
      if (countNode) countNode.textContent = `${products.length} productos`;

      const tbody = $('#cafeProductsTbody');
      if (tbody) {
        tbody.replaceChildren();
        if (!products.length) {
          const tr = el('tr');
          const td = el('td', '', 'No hay productos registrados.');
          td.colSpan = 10;
          td.style.textAlign = 'center';
          td.style.color = 'var(--muted)';
          tr.append(td);
          tbody.append(tr);
        } else {
          for (const p of products) {
            const tr = el('tr');
            const tdName = el('td');
            const strongName = el('strong', '', p.name);
            tdName.append(strongName);
            if (p.variants && p.variants.length) {
              const sm = el('small', '', ` (${p.variants.join(', ')})`);
              sm.style.color = 'var(--muted)';
              tdName.append(sm);
            }

            const tdCat = el('td', '', p.category);
            const tdPrice = el('td', '', money(p.price));
            tdPrice.style.textAlign = 'right';
            tdPrice.style.fontWeight = 'bold';

            const tdCost = el('td', '', money(p.cost || 0));
            tdCost.style.textAlign = 'right';

            const margin = p.price > 0 ? Math.round(((p.price - (p.cost || 0)) / p.price) * 100) : 0;
            const tdMargin = el('td', '', `${margin}%`);
            tdMargin.style.textAlign = 'right';
            tdMargin.style.color = margin > 30 ? '#27604e' : '#8a5e20';

            const tdStock = el('td', '', String(p.stock));
            tdStock.style.textAlign = 'center';
            if ((Number(p.stock) || 0) <= (Number(p.minStock) || 0)) {
              tdStock.style.color = 'var(--rust)';
              tdStock.style.fontWeight = 'bold';
            }

            const tdMin = el('td', '', String(p.minStock));
            tdMin.style.textAlign = 'center';
            tdMin.style.color = 'var(--muted)';

            const tdUnit = el('td', '', p.unit || 'unidad');
            const tdStatus = el('td');
            tdStatus.append(statusBadge(p.active !== false ? 'confirmed' : 'cancelled', p.active !== false ? 'Activo' : 'Inactivo'));

            const tdActions = el('td');
            tdActions.style.textAlign = 'center';
            tdActions.style.display = 'flex';
            tdActions.style.gap = '6px';
            tdActions.style.justifyContent = 'center';

            const btnEdit = el('button', 'btn btn-outline btn-sm', 'Editar');
            btnEdit.type = 'button';
            btnEdit.addEventListener('click', () => openCafeProductModal(p));

            const btnDel = el('button', 'btn btn-outline btn-sm danger', p.active !== false ? 'Archivar' : 'Eliminar');
            btnDel.type = 'button';
            btnDel.addEventListener('click', () => deleteCafeProduct(p));

            tdActions.append(btnEdit, btnDel);
            tr.append(tdName, tdCat, tdPrice, tdCost, tdMargin, tdStock, tdMin, tdUnit, tdStatus, tdActions);
            tbody.append(tr);
          }
        }
      }
    } catch (err) {
      handleError(err);
    } finally {
      setSync(false);
    }
  }

  function openCafeProductModal(product = null) {
    const isEdit = Boolean(product);
    const wrap = el('form');
    wrap.className = 'form-grid two';

    wrap.innerHTML = `
      <label class="field field-full"><span>Nombre del producto</span><input type="text" id="cpfName" value="${product?.name || ''}" required></label>
      <label class="field"><span>Categoría</span>
        <input type="text" id="cpfCategory" list="cpfCatList" value="${product?.category || 'Bebidas sin alcohol'}" required>
        <datalist id="cpfCatList">
          <option value="Cervezas">
          <option value="Bebidas sin alcohol">
          <option value="Licores">
          <option value="Comida y Snacks">
          <option value="Café y Calientes">
        </datalist>
      </label>
      <label class="field"><span>Unidad de medida</span><input type="text" id="cpfUnit" value="${product?.unit || 'unidad'}" required></label>
      <label class="field"><span>Precio de venta (Q)</span><input type="number" step="0.5" min="0" id="cpfPrice" value="${product?.price ?? 10}" required></label>
      <label class="field"><span>Costo unitario (Q)</span><input type="number" step="0.5" min="0" id="cpfCost" value="${product?.cost ?? 5}" required></label>
      <label class="field"><span>Stock actual</span><input type="number" min="0" id="cpfStock" value="${product?.stock ?? 20}" required></label>
      <label class="field"><span>Stock mínimo (Alerta)</span><input type="number" min="0" id="cpfMinStock" value="${product?.minStock ?? 5}" required></label>
      <label class="field field-full"><span>Variantes (separadas por coma)</span><input type="text" id="cpfVariants" value="${(product?.variants || []).join(', ')}" placeholder="Ej. Gallo Pequeña, Corona"></label>
      ${isEdit ? `
        <label class="field field-full" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="cpfActive" ${product.active !== false ? 'checked' : ''} style="width:auto;">
          <span>Producto disponible / activo para venta</span>
        </label>
      ` : ''}
      <div class="field-full" style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
        <button class="btn btn-outline" type="button" id="cpfCancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="cpfSubmit">${isEdit ? 'Guardar Cambios' : 'Crear Producto'}</button>
      </div>
    `;

    $('#cpfCancel', wrap).addEventListener('click', closeModal);
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('#cpfSubmit', wrap);
      busy(submitBtn, true);

      const payload = {
        name: $('#cpfName', wrap).value.trim(),
        category: $('#cpfCategory', wrap).value.trim(),
        unit: $('#cpfUnit', wrap).value.trim(),
        price: Number($('#cpfPrice', wrap).value),
        cost: Number($('#cpfCost', wrap).value),
        stock: parseInt($('#cpfStock', wrap).value, 10),
        minStock: parseInt($('#cpfMinStock', wrap).value, 10),
        variants: $('#cpfVariants', wrap).value.split(',').map(v => v.trim()).filter(Boolean),
        ...(isEdit ? { active: $('#cpfActive', wrap)?.checked } : {})
      };

      try {
        if (isEdit) {
          await api(`/api/admin/cafe/products/${product.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Producto actualizado correctamente.');
        } else {
          await api('/api/admin/cafe/products', { method: 'POST', body: JSON.stringify(payload) });
          toast('Producto creado con éxito.');
        }
        closeModal();
        loadCafeProducts();
      } catch (err) {
        handleError(err);
      } finally {
        busy(submitBtn, false);
      }
    });

    openModal(isEdit ? `Editar ${product.name}` : 'Nuevo Producto del Menú', wrap, { kicker: 'Cafetería' });
  }

  async function deleteCafeProduct(product) {
    if (!confirm(`¿Estás seguro de archivar o eliminar "${product.name}"?`)) return;
    try {
      const res = await api(`/api/admin/cafe/products/${product.id}`, { method: 'DELETE' });
      toast(res.message || 'Producto actualizado.');
      loadCafeProducts();
    } catch (err) {
      handleError(err);
    }
  }

  // --- Inventario y Kardex ---
  let activeInvTab = 'stock';
  async function loadCafeInventory() {
    setSync(true);
    try {
      const res = await api('/api/admin/cafe/inventory');
      const products = res.products || [];
      const supplies = res.supplies || [];
      const alerts = res.alerts || { totalLowStock: 0 };

      const kpis = $('#cafeInvKpis');
      if (kpis) {
        kpis.replaceChildren(
          kpiCard('Productos en Menú', String(products.length), `${products.filter(p => p.active !== false).length} activos`),
          kpiCard('Insumos de Cocina', String(supplies.length), `${supplies.filter(s => s.active !== false).length} activos`),
          kpiCard('Alertas Stock Bajo', String(alerts.totalLowStock || 0), alerts.totalLowStock ? 'Requieren abastecimiento urgente' : 'Niveles de inventario óptimos', alerts.totalLowStock ? 'rust' : 'lime')
        );
      }

      // Render Stock Panel
      const stockTbody = $('#cafeInvStockTbody');
      if (stockTbody) {
        stockTbody.replaceChildren();
        const allItems = [
          ...products.map(p => ({ ...p, itemType: 'product' })),
          ...supplies.map(s => ({ ...s, itemType: 'supply' }))
        ];

        for (const it of allItems) {
          const tr = el('tr');
          const tdType = el('td', '', it.itemType === 'product' ? 'Producto' : 'Insumo');
          const tdName = el('td');
          const strongName = el('strong', '', it.name);
          tdName.append(strongName);

          const tdCat = el('td', '', it.category);
          const tdStock = el('td', '', String(it.stock));
          tdStock.style.textAlign = 'center';
          tdStock.style.fontWeight = 'bold';

          const isLow = (Number(it.stock) || 0) <= (Number(it.minStock) || 0);
          if (isLow) tdStock.style.color = 'var(--rust)';

          const tdMin = el('td', '', String(it.minStock));
          tdMin.style.textAlign = 'center';

          const tdUnit = el('td', '', it.unit || 'unidad');
          const tdCost = el('td', '', money(it.cost || 0));
          tdCost.style.textAlign = 'right';

          const invValue = (Number(it.stock) || 0) * (Number(it.cost) || 0);
          const tdVal = el('td', '', money(invValue));
          tdVal.style.textAlign = 'right';

          const tdStatus = el('td');
          tdStatus.append(statusBadge(isLow ? 'cancelled' : 'confirmed', isLow ? 'Stock Bajo' : 'Normal'));

          const tdAction = el('td');
          tdAction.style.textAlign = 'center';
          const btnAdj = el('button', 'btn btn-outline btn-sm', 'Movimiento');
          btnAdj.type = 'button';
          btnAdj.addEventListener('click', () => openCafeMovementModal(it));
          tdAction.append(btnAdj);

          tr.append(tdType, tdName, tdCat, tdStock, tdMin, tdUnit, tdCost, tdVal, tdStatus, tdAction);
          stockTbody.append(tr);
        }
      }

      // Render Supplies Panel
      const supTbody = $('#cafeSuppliesTbody');
      if (supTbody) {
        supTbody.replaceChildren();
        for (const s of supplies) {
          const tr = el('tr');
          tr.innerHTML = `
            <td><strong>${s.name}</strong></td>
            <td>${s.category}</td>
            <td style="text-align:center;font-weight:bold;${(Number(s.stock) || 0) <= (Number(s.minStock) || 0) ? 'color:var(--rust);' : ''}">${s.stock}</td>
            <td style="text-align:center;">${s.minStock}</td>
            <td>${s.unit || 'unidad'}</td>
            <td style="text-align:right;">${money(s.cost || 0)}</td>
            <td><span class="status-badge ${s.active !== false ? 'confirmed' : 'cancelled'}">${s.active !== false ? 'Activo' : 'Inactivo'}</span></td>
            <td style="text-align:center;">
              <button class="btn btn-outline btn-sm" type="button" data-edit-sup="${s.id}">Editar</button>
            </td>
          `;
          $('button[data-edit-sup]', tr)?.addEventListener('click', () => openCafeSupplyModal(s));
          supTbody.append(tr);
        }
      }

      // If active tab is Kardex, load movements
      if (activeInvTab === 'kardex') {
        loadCafeKardex();
      }
    } catch (err) {
      handleError(err);
    } finally {
      setSync(false);
    }
  }

  async function loadCafeKardex() {
    const type = $('#kardexTypeFilter')?.value || '';
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    try {
      const res = await api(`/api/admin/cafe/inventory/movements?${params.toString()}`);
      const movements = res.movements || [];
      const tbody = $('#cafeKardexTbody');
      if (tbody) {
        tbody.replaceChildren();
        if (!movements.length) {
          const tr = el('tr');
          tr.innerHTML = '<td colspan="9" style="text-align:center;color:var(--muted);">No hay movimientos de inventario registrados.</td>';
          tbody.append(tr);
        } else {
          for (const m of movements) {
            const tr = el('tr');
            const mTypeLabel = m.movementType === 'in' ? 'Entrada (+)' : m.movementType === 'out' ? 'Salida (-)' : m.movementType === 'sale' ? 'Venta (-)' : 'Ajuste';
            const mBadge = m.movementType === 'in' ? 'confirmed' : m.movementType === 'sale' ? 'pending_payment' : m.movementType === 'out' ? 'cancelled' : 'processed';
            tr.innerHTML = `
              <td><strong>${m.code}</strong></td>
              <td>${new Date(m.createdAt).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>${m.itemType === 'product' ? 'Producto' : 'Insumo'}</td>
              <td>${m.itemName}</td>
              <td><span class="status-badge ${mBadge}">${mTypeLabel}</span></td>
              <td style="text-align:right;font-weight:bold;${m.quantity < 0 ? 'color:var(--rust);' : 'color:#27604e;'}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
              <td style="text-align:right;">${money(m.totalCost || 0)}</td>
              <td>${m.reason || '—'} ${m.reference ? `<small style="color:var(--muted);">(${m.reference})</small>` : ''}</td>
              <td>${m.createdBy || 'Sistema'}</td>
            `;
            tbody.append(tr);
          }
        }
      }
    } catch (err) {
      handleError(err);
    }
  }

  async function openCafeMovementModal(preselectedItem = null) {
    let products = [], supplies = [];
    try {
      const res = await api('/api/admin/cafe/inventory');
      products = res.products || [];
      supplies = res.supplies || [];
    } catch (err) {
      handleError(err);
      return;
    }

    const wrap = el('form');
    wrap.className = 'form-grid two';

    const itemTypeVal = preselectedItem ? preselectedItem.itemType : 'product';

    wrap.innerHTML = `
      <label class="field"><span>Tipo de ítem</span>
        <select id="cmfItemType" class="select-compact">
          <option value="product" ${itemTypeVal === 'product' ? 'selected' : ''}>Producto del menú</option>
          <option value="supply" ${itemTypeVal === 'supply' ? 'selected' : ''}>Insumo de operación</option>
        </select>
      </label>
      <label class="field"><span>Ítem</span>
        <select id="cmfItemId" class="select-compact" required></select>
      </label>
      <label class="field"><span>Tipo de movimiento</span>
        <select id="cmfMovType" class="select-compact">
          <option value="in">Entrada (+) [Compra, Reposición]</option>
          <option value="out">Salida (-) [Merma, Consumo interno]</option>
          <option value="adjustment">Ajuste físico [Fijar conteo exacto]</option>
        </select>
      </label>
      <label class="field"><span>Cantidad</span><input type="number" step="any" min="0.01" id="cmfQty" value="1" required></label>
      <label class="field"><span>Costo unitario (Q) (opcional)</span><input type="number" step="0.01" min="0" id="cmfUnitCost" placeholder="Por defecto el costo actual"></label>
      <label class="field"><span>Referencia (opcional)</span><input type="text" id="cmfReference" placeholder="Factura, orden, etc."></label>
      <label class="field field-full"><span>Motivo del movimiento</span><input type="text" id="cmfReason" placeholder="Ej. Compra de inventario semanal" required></label>
      <div class="field-full" style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
        <button class="btn btn-outline" type="button" id="cmfCancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="cmfSubmit">Registrar Movimiento</button>
      </div>
    `;

    const itemSelect = $('#cmfItemId', wrap);
    const typeSelect = $('#cmfItemType', wrap);

    function populateItems() {
      const type = typeSelect.value;
      const list = type === 'product' ? products : supplies;
      itemSelect.replaceChildren();
      for (const it of list) {
        const opt = el('option', '', `${it.name} (Stock: ${it.stock} ${it.unit || ''})`);
        opt.value = it.id;
        if (preselectedItem && preselectedItem.id === it.id) opt.selected = true;
        itemSelect.append(opt);
      }
    }

    typeSelect.addEventListener('change', populateItems);
    populateItems();

    $('#cmfCancel', wrap).addEventListener('click', closeModal);
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('#cmfSubmit', wrap);
      busy(submitBtn, true);

      const payload = {
        itemType: typeSelect.value,
        itemId: itemSelect.value,
        movementType: $('#cmfMovType', wrap).value,
        quantity: Number($('#cmfQty', wrap).value),
        unitCost: $('#cmfUnitCost', wrap).value ? Number($('#cmfUnitCost', wrap).value) : undefined,
        reason: $('#cmfReason', wrap).value.trim(),
        reference: $('#cmfReference', wrap).value.trim()
      };

      try {
        await api('/api/admin/cafe/inventory/movements', { method: 'POST', body: JSON.stringify(payload) });
        toast('Movimiento registrado correctamente en Kardex.');
        closeModal();
        loadCafeInventory();
      } catch (err) {
        handleError(err);
      } finally {
        busy(submitBtn, false);
      }
    });

    openModal('Registrar Movimiento de Inventario', wrap, { kicker: 'Kardex' });
  }

  function openCafeSupplyModal(supply = null) {
    const isEdit = Boolean(supply);
    const wrap = el('form');
    wrap.className = 'form-grid two';

    wrap.innerHTML = `
      <label class="field field-full"><span>Nombre del insumo</span><input type="text" id="csfName" value="${supply?.name || ''}" required></label>
      <label class="field"><span>Categoría</span>
        <input type="text" id="csfCategory" list="csfCatList" value="${supply?.category || 'Insumos de cocina'}" required>
        <datalist id="csfCatList">
          <option value="Insumos de cocina">
          <option value="Empaques y desechables">
          <option value="Limpieza y bar">
          <option value="Otros insumos">
        </datalist>
      </label>
      <label class="field"><span>Unidad de medida</span><input type="text" id="csfUnit" value="${supply?.unit || 'lb'}" placeholder="lb, kg, unidad, paquete" required></label>
      <label class="field"><span>Costo unitario (Q)</span><input type="number" step="0.01" min="0" id="csfCost" value="${supply?.cost ?? 10}" required></label>
      <label class="field"><span>Stock actual</span><input type="number" step="any" min="0" id="csfStock" value="${supply?.stock ?? 10}" required></label>
      <label class="field"><span>Stock mínimo</span><input type="number" step="any" min="0" id="csfMinStock" value="${supply?.minStock ?? 5}" required></label>
      <div class="field-full" style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
        <button class="btn btn-outline" type="button" id="csfCancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="csfSubmit">${isEdit ? 'Guardar Cambios' : 'Crear Insumo'}</button>
      </div>
    `;

    $('#csfCancel', wrap).addEventListener('click', closeModal);
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('#csfSubmit', wrap);
      busy(submitBtn, true);

      const payload = {
        name: $('#csfName', wrap).value.trim(),
        category: $('#csfCategory', wrap).value.trim(),
        unit: $('#csfUnit', wrap).value.trim(),
        cost: Number($('#csfCost', wrap).value),
        stock: Number($('#csfStock', wrap).value),
        minStock: Number($('#csfMinStock', wrap).value)
      };

      try {
        if (isEdit) {
          await api(`/api/admin/cafe/supplies/${supply.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Insumo actualizado.');
        } else {
          await api('/api/admin/cafe/supplies', { method: 'POST', body: JSON.stringify(payload) });
          toast('Insumo registrado.');
        }
        closeModal();
        loadCafeInventory();
      } catch (err) {
        handleError(err);
      } finally {
        busy(submitBtn, false);
      }
    });

    openModal(isEdit ? `Editar ${supply.name}` : 'Nuevo Insumo de Operación', wrap, { kicker: 'Inventario' });
  }

  // --- Control de Gastos ---
  async function loadCafeExpenses() {
    setSync(true);
    const from = $('#cafeExpensesFrom')?.value || '';
    const to = $('#cafeExpensesTo')?.value || '';
    const cat = $('#cafeExpensesCategoryFilter')?.value || '';

    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (cat) params.set('category', cat);

    try {
      const res = await api(`/api/admin/cafe/expenses?${params.toString()}`);
      const expenses = res.expenses || [];
      state.cafeExpenses = expenses;

      let totalExpenses = 0;
      let insumosTotal = 0;
      let otrosTotal = 0;

      for (const e of expenses) {
        const amt = Number(e.amount) || 0;
        totalExpenses += amt;
        if (e.category === 'insumos') insumosTotal += amt;
        else otrosTotal += amt;
      }

      const kpis = $('#cafeExpensesKpis');
      if (kpis) {
        kpis.replaceChildren(
          kpiCard('Total Gastos del Período', money(totalExpenses), 'Egresos operativos registrados', totalExpenses ? 'rust' : ''),
          kpiCard('Compras de Insumos', money(insumosTotal), 'Materia prima y productos'),
          kpiCard('Servicios y Otros', money(otrosTotal), 'Mantenimiento, energía y personal', 'amber')
        );
      }

      const totNode = $('#cafeExpensesTotal');
      if (totNode) totNode.textContent = `Total: ${money(totalExpenses)}`;

      const tbody = $('#cafeExpensesTbody');
      if (tbody) {
        tbody.replaceChildren();
        if (!expenses.length) {
          const tr = el('tr');
          tr.innerHTML = '<td colspan="8" style="text-align:center;color:var(--muted);">No se registraron gastos en este período.</td>';
          tbody.append(tr);
        } else {
          for (const e of expenses) {
            const tr = el('tr');
            tr.innerHTML = `
              <td><strong>${e.id}</strong></td>
              <td>${e.expenseDate}</td>
              <td>${e.concept}</td>
              <td style="text-transform:capitalize;">${e.category}</td>
              <td style="text-align:right;font-weight:bold;color:var(--rust);">${money(e.amount)}</td>
              <td>${e.notes || '—'}</td>
              <td>${e.createdBy || 'Administrador'}</td>
              <td style="text-align:center;"><button type="button" class="btn btn-outline btn-sm danger" data-del-exp="${e.id}">Eliminar</button></td>
            `;
            $('button[data-del-exp]', tr)?.addEventListener('click', () => deleteCafeExpense(e.id, e.concept));
            tbody.append(tr);
          }
        }
      }
    } catch (err) {
      handleError(err);
    } finally {
      setSync(false);
    }
  }

  function openCafeExpenseModal() {
    const wrap = el('form');
    wrap.className = 'form-grid two';

    const todayStr = new Date().toISOString().slice(0, 10);
    wrap.innerHTML = `
      <label class="field field-full"><span>Concepto del gasto</span><input type="text" id="cefConcept" placeholder="Ej. Compra de 10 lbs de café en grano" required></label>
      <label class="field"><span>Categoría</span>
        <select id="cefCategory" class="select-compact">
          <option value="insumos">Insumos (café, azúcar, leche, etc.)</option>
          <option value="servicios">Servicios (luz, agua, gas)</option>
          <option value="mantenimiento">Mantenimiento de equipo</option>
          <option value="personal">Personal / Turnos</option>
          <option value="otros">Otros egresos</option>
        </select>
      </label>
      <label class="field"><span>Monto (Q)</span><input type="number" step="0.5" min="0.5" id="cefAmount" placeholder="0.00" required></label>
      <label class="field"><span>Fecha del gasto</span><input type="date" id="cefDate" value="${todayStr}" required></label>
      <label class="field field-full"><span>Notas / Proveedor (opcional)</span><textarea id="cefNotes" placeholder="Detalles de factura o proveedor…"></textarea></label>
      <div class="field-full" style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
        <button class="btn btn-outline" type="button" id="cefCancel">Cancelar</button>
        <button class="btn btn-primary" type="submit" id="cefSubmit">Guardar Gasto</button>
      </div>
    `;

    $('#cefCancel', wrap).addEventListener('click', closeModal);
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('#cefSubmit', wrap);
      busy(submitBtn, true);

      const payload = {
        concept: $('#cefConcept', wrap).value.trim(),
        category: $('#cefCategory', wrap).value,
        amount: Number($('#cefAmount', wrap).value),
        expenseDate: $('#cefDate', wrap).value,
        notes: $('#cefNotes', wrap).value.trim()
      };

      try {
        await api('/api/admin/cafe/expenses', { method: 'POST', body: JSON.stringify(payload) });
        toast('Gasto registrado con éxito.');
        closeModal();
        loadCafeExpenses();
      } catch (err) {
        handleError(err);
      } finally {
        busy(submitBtn, false);
      }
    });

    openModal('Registrar Gasto de Operación', wrap, { kicker: 'Control de Gastos' });
  }

  async function deleteCafeExpense(id, concept) {
    if (!confirm(`¿Eliminar el registro de gasto "${concept}"?`)) return;
    try {
      await api(`/api/admin/cafe/expenses/${id}`, { method: 'DELETE' });
      toast('Gasto eliminado.');
      loadCafeExpenses();
    } catch (err) {
      handleError(err);
    }
  }

  // --- Estadísticas y Reportes ---
  async function loadCafeReports() {
    setSync(true);
    let from = $('#cafeReportFrom')?.value || '';
    let to = $('#cafeReportTo')?.value || '';

    if (!from || !to) {
      const now = new Date();
      to = now.toISOString().slice(0, 10);
      from = `${to.slice(0, 7)}-01`;
      if ($('#cafeReportFrom')) $('#cafeReportFrom').value = from;
      if ($('#cafeReportTo')) $('#cafeReportTo').value = to;
    }

    try {
      const res = await api(`/api/admin/cafe/reports?from=${from}&to=${to}`);
      state.cafeReports = res;

      const sum = res.summary || {};
      const kpis = $('#cafeReportKpis');
      if (kpis) {
        kpis.replaceChildren(
          kpiCard('Ingresos por Ventas', money(sum.totalIncome), `${sum.salesCount} ventas · Promedio ${money(sum.averageTicket)}`, 'lime'),
          kpiCard('Gastos Operativos', money(sum.totalExpenses), 'Egresos en insumos y servicios', 'rust'),
          kpiCard('Utilidad Neta', money(sum.netProfit), `Margen operativo de ${sum.profitMargin}%`, sum.netProfit >= 0 ? 'lime' : 'rust'),
          kpiCard('Alertas Inventario', String(res.inventorySummary?.lowStockAlerts || 0), `${res.inventorySummary?.totalProducts || 0} productos · ${res.inventorySummary?.totalSupplies || 0} insumos`, res.inventorySummary?.lowStockAlerts ? 'rust' : 'amber')
        );
      }

      // Top Products Table
      const topTbody = $('#cafeTopProductsTbody');
      if (topTbody) {
        topTbody.replaceChildren();
        const top = res.topProducts || [];
        if (!top.length) {
          const tr = el('tr');
          tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--muted);">No hay ventas en este período.</td>';
          topTbody.append(tr);
        } else {
          top.slice(0, 10).forEach((p, idx) => {
            const tr = el('tr');
            tr.innerHTML = `
              <td><strong>#${idx + 1}</strong></td>
              <td><strong>${p.name}</strong></td>
              <td>${p.category || '—'}</td>
              <td style="text-align:center;font-weight:bold;">${p.unitsSold} uds.</td>
              <td style="text-align:right;font-weight:bold;color:#27604e;">${money(p.totalRevenue)}</td>
            `;
            topTbody.append(tr);
          });
        }
      }

      // Financial breakdown
      const breakdown = $('#cafeFinancialBreakdown');
      if (breakdown) {
        const pmTotals = res.payments?.totals || {};
        const expCat = res.expensesByCategory || {};

        breakdown.innerHTML = `
          <div>
            <span style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--muted);">Ventas por Forma de Pago</span>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:6px;">
              <div style="background:rgba(47,107,87,.08);padding:10px;border-radius:8px;">
                <small style="color:var(--muted);">Efectivo</small><br><strong>${money(pmTotals.cash || 0)}</strong>
              </div>
              <div style="background:rgba(47,107,87,.08);padding:10px;border-radius:8px;">
                <small style="color:var(--muted);">Tarjeta (POS/Web)</small><br><strong>${money(pmTotals.card || 0)}</strong>
              </div>
              <div style="background:rgba(47,107,87,.08);padding:10px;border-radius:8px;">
                <small style="color:var(--muted);">Transferencia</small><br><strong>${money(pmTotals.transfer || 0)}</strong>
              </div>
            </div>
          </div>
          <div>
            <span style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--muted);">Gastos por Categoría</span>
            <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px;margin-top:6px;">
              <div style="background:rgba(189,96,65,.08);padding:10px;border-radius:8px;">
                <small style="color:var(--muted);">Insumos</small><br><strong>${money(expCat.insumos || 0)}</strong>
              </div>
              <div style="background:rgba(189,96,65,.08);padding:10px;border-radius:8px;">
                <small style="color:var(--muted);">Servicios y Otros</small><br><strong>${money((expCat.servicios || 0) + (expCat.mantenimiento || 0) + (expCat.personal || 0) + (expCat.otros || 0))}</strong>
              </div>
            </div>
          </div>
        `;
      }
    } catch (err) {
      handleError(err);
    } finally {
      setSync(false);
    }
  }

  function exportCafeExcel() {
    const from = $('#cafeReportFrom')?.value || '';
    const to = $('#cafeReportTo')?.value || '';
    window.location.href = `/api/admin/cafe/reports/export?format=csv&type=summary&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  function exportCafePdf() {
    const from = $('#cafeReportFrom')?.value || '';
    const to = $('#cafeReportTo')?.value || '';
    window.open(`/api/admin/cafe/reports/export?format=html&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, '_blank');
  }

  function bindCafeEvents() {
    // Ventas
    $('#btnFilterCafeSales')?.addEventListener('click', loadCafeSales);
    $('#cafeSalesPaymentFilter')?.addEventListener('change', loadCafeSales);
    $('#cafeSalesSearch')?.addEventListener('input', () => {
      clearTimeout(bindCafeEvents.__salesTimer);
      bindCafeEvents.__salesTimer = setTimeout(loadCafeSales, 300);
    });
    $('#btnNewCafeSale')?.addEventListener('click', openCafePosModal);

    // Menú
    $('#cafeProductCatFilter')?.addEventListener('change', loadCafeProducts);
    $('#cafeProductSearch')?.addEventListener('input', () => {
      clearTimeout(bindCafeEvents.__prodTimer);
      bindCafeEvents.__prodTimer = setTimeout(loadCafeProducts, 300);
    });
    $('#btnNewCafeProduct')?.addEventListener('click', () => openCafeProductModal(null));

    // Inventario Tabs & Buttons
    $('#tabInvStock')?.addEventListener('click', () => {
      activeInvTab = 'stock';
      $('#tabInvStock').classList.add('is-active');
      $('#tabInvKardex').classList.remove('is-active');
      $('#tabInvSupplies').classList.remove('is-active');
      $('#panelInvStock').hidden = false;
      $('#panelInvKardex').hidden = true;
      $('#panelInvSupplies').hidden = true;
      loadCafeInventory();
    });
    $('#tabInvKardex')?.addEventListener('click', () => {
      activeInvTab = 'kardex';
      $('#tabInvStock').classList.remove('is-active');
      $('#tabInvKardex').classList.add('is-active');
      $('#tabInvSupplies').classList.remove('is-active');
      $('#panelInvStock').hidden = true;
      $('#panelInvKardex').hidden = false;
      $('#panelInvSupplies').hidden = true;
      loadCafeKardex();
    });
    $('#tabInvSupplies')?.addEventListener('click', () => {
      activeInvTab = 'supplies';
      $('#tabInvStock').classList.remove('is-active');
      $('#tabInvKardex').classList.remove('is-active');
      $('#tabInvSupplies').classList.add('is-active');
      $('#panelInvStock').hidden = true;
      $('#panelInvKardex').hidden = true;
      $('#panelInvSupplies').hidden = false;
      loadCafeInventory();
    });
    $('#kardexTypeFilter')?.addEventListener('change', loadCafeKardex);
    $('#btnExportKardexCsv')?.addEventListener('click', () => {
      window.location.href = '/api/admin/cafe/reports/export?format=csv&type=inventory';
    });
    $('#btnNewCafeSupply')?.addEventListener('click', () => openCafeSupplyModal(null));
    $('#btnNewCafeMovement')?.addEventListener('click', () => openCafeMovementModal(null));

    // Gastos
    $('#btnFilterCafeExpenses')?.addEventListener('click', loadCafeExpenses);
    $('#cafeExpensesCategoryFilter')?.addEventListener('change', loadCafeExpenses);
    $('#btnNewCafeExpense')?.addEventListener('click', openCafeExpenseModal);

    // Reportes
    $('#btnUpdateCafeReport')?.addEventListener('click', loadCafeReports);
    $('#btnExportCafeExcel')?.addEventListener('click', exportCafeExcel);
    $('#btnExportCafePdf')?.addEventListener('click', exportCafePdf);
  }

  function init() {
    bind();
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
