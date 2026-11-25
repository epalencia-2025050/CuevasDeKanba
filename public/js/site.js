/* ==========================================================================
   K’anba · Cuevas Vivas — lógica del sitio público
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Eventos para Google Tag Manager / Analytics (ver js/analytics.js)
  const track = (event, params) => {
    try { window.kanbaTrack?.(event, params); } catch { /* analítica no disponible */ }
  };

  const ICONS = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M16 5.4a3 3 0 0 1 0 5.6M17.5 14.3c1.7.6 2.8 2.2 3.1 4.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4M11 8v6M8 11h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1.2 4.3-3.5 5.6-3.5 9.4A3.5 3.5 0 0 0 12 16a3.5 3.5 0 0 0 3.5-3.6c0-1.4-.6-2.6-1.4-3.8-.5 1.2-1.1 1.9-2 2.3.7-2.8.3-5.9-.1-7.9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 16v5M7 21h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    water: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.4 6 10.6A6 6 0 0 1 6 13.6C6 9.4 12 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 14.2c.3 1.3 1.3 2.1 2.6 2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C11 4 5 8.2 5 14.5 5 17.5 7.2 20 10.4 20c6 0 9.6-6.2 9.6-16Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 21c1.5-5.4 4.8-9 9.5-11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m8.5 12 2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5V6h18v2.5a3.5 3.5 0 0 0 0 7V18H3v-2.5a3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 6v12" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 3"/></svg>'
  };

  const icon = (name) => ICONS[name] || '';

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                         */
  /* ------------------------------------------------------------------ */

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined && options.text !== null) node.textContent = options.text;
    if (options.html) node.innerHTML = options.html;
    if (options.attrs) {
      for (const [key, value] of Object.entries(options.attrs)) {
        if (value === undefined || value === null || value === false) continue;
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    if (options.dataset) {
      for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = value;
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function api(url, options = {}) {
    const opts = { ...options };
    opts.headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* respuesta vacía */ }
    if (!res.ok) {
      const error = new Error(data?.error?.message || data?.message || 'No pudimos completar la solicitud.');
      error.status = res.status;
      error.data = data;
      error.fields = data?.error?.fields || data?.fields || null;
      throw error;
    }
    return data;
  }

  const money = value => state.site?.settings?.booking?.currency ? new Intl.NumberFormat('es-GT', { style: 'currency', currency: state.site.settings.booking.currency }).format(value) : String(value);

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

  function dateObj(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  }

  function formatLong(date) {
    if (!date) return '—';
    return new Intl.DateTimeFormat('es-GT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(dateObj(date));
  }

  function formatFull(date) {
    if (!date) return '—';
    return new Intl.DateTimeFormat('es-GT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(dateObj(date));
  }

  function formatShort(date) {
    if (!date) return '—';
    return new Intl.DateTimeFormat('es-GT', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(dateObj(date));
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node && value !== undefined && value !== null) node.textContent = value;
  }

  function setAttr(id, name, value) {
    const node = document.getElementById(id);
    if (node && value !== undefined && value !== null) node.setAttribute(name, value);
  }


  let toastTimer = null;
  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3600);
  }

  function busy(button, on) {
    if (!button) return;
    button.classList.toggle('is-loading', Boolean(on));
    button.disabled = Boolean(on);
  }

  function loginUrl() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return `/login.html?next=${next}`;
  }

  function requireLogin(message) {
    const gate = $('#bookingAuthGate');
    if (gate) {
      gate.hidden = false;
      const msg = $('#bookingAuthMessage');
      if (msg) msg.textContent = message || 'Para continuar con tu reserva, inicia sesión o crea tu cuenta.';
      gate.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    toast(message || 'Inicia sesión para reservar.');
    window.setTimeout(() => { window.location.href = loginUrl(); }, 900);
  }

  async function loadAuth() {
    try {
      const data = await api('/api/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      state.user = data?.authenticated === true ? data.user || null : null;
    } catch {
      state.user = null;
    } finally {
      state.authChecked = true;

      // Actualizar botón de sesión / perfil en la cabecera
      const loginBtn = document.querySelector('.header-actions .btn-login, .header-actions .user-profile-btn');
      if (loginBtn) {
        loginBtn.removeAttribute('aria-busy');
        if (state.user) {
          const firstName = (state.user.name || state.user.email || 'Mi cuenta').split(' ')[0];
          const initial = firstName.charAt(0).toUpperCase();
          loginBtn.className = 'user-profile-btn';
          loginBtn.href = state.user.role === 'admin' ? '/admin.html' : '/cuenta.html';
          loginBtn.title = 'Sesión activa: ' + (state.user.name || state.user.email);
          loginBtn.innerHTML = `
            <span class="user-avatar" aria-hidden="true"></span>
            <span class="profile-name"></span>
            <span class="btn-logout-icon" title="Cerrar sesión" aria-label="Cerrar sesión">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </span>
          `;
          loginBtn.querySelector('.user-avatar').textContent = initial;
          loginBtn.querySelector('.profile-name').textContent = firstName;
          loginBtn.onclick = async (e) => {
            if (e.target.closest('.btn-logout-icon')) {
              e.preventDefault();
              if (loginBtn.dataset.loggingOut === 'true') return;
              loginBtn.dataset.loggingOut = 'true';
              try {
                await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
                state.user = null;
                loginBtn.className = 'link-subtle btn-login';
                loginBtn.href = 'login.html';
                loginBtn.textContent = 'Iniciar sesión';
                loginBtn.removeAttribute('title');
                loginBtn.onclick = null;
                const badge = $('#authBadge');
                if (badge) { badge.textContent = ''; badge.hidden = true; }
                window.location.reload();
              } catch (err) {
                toast(err.message || 'No se pudo cerrar la sesión. Intenta de nuevo.');
              } finally {
                delete loginBtn.dataset.loggingOut;
              }
            }
          };
        } else {
          loginBtn.className = 'link-subtle btn-login';
          loginBtn.href = 'login.html';
          loginBtn.textContent = 'Iniciar sesión';
          loginBtn.removeAttribute('title');
          loginBtn.onclick = null;
        }
      }
      const badge = $('#authBadge');
      if (badge) {
        if (state.user) {
          badge.textContent = state.user.name || state.user.email || 'Sesión activa';
          badge.hidden = false;
        } else {
          badge.textContent = '';
          badge.hidden = true;
        }
      }
      const gate = $('#bookingAuthGate');
      if (gate) {
        gate.hidden = Boolean(state.user);
        const msg = $('#bookingAuthMessage');
        if (msg && !state.user) msg.textContent = 'Para continuar con tu reserva, inicia sesión o crea tu cuenta. Es rápido y necesario para guardar tus datos y cupos.';
      }
      $$('[data-requires-auth]').forEach((node) => {
        node.disabled = !state.user;
      });
    }
  }

  function guardAuth() {
    if (!state.user) {
      requireLogin('Inicia sesión para continuar con tu reserva.');
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Estado del sitio                                                    */
  /* ------------------------------------------------------------------ */

  const state = {
    site: null,
    tours: [],
    tourId: null,
    availability: [],
    date: null,
    time: null,
    pax: 1,
    isGuideGroup: false,
    guideAgency: '',
    step: 1,
    gallery: [],
    galleryFilter: 'all',
    galleryIndex: 0,
    videos: [],
    map: null,
    mapReady: false,
    user: null,
    authChecked: false
  };


  /* ------------------------------------------------------------------ */
  /* Header, navegación y detalles                                         */
  /* ------------------------------------------------------------------ */

  function setupHeader() {
    const header = $('#siteHeader');
    const nav = $('#mainNav');
    const toggle = $('#navToggle');
    if (header) {
      let isScrolled = false;
      let ticking = false;
      const update = () => {
        const scrolled = window.scrollY > 24;
        if (scrolled !== isScrolled) {
          isScrolled = scrolled;
          header.classList.toggle('is-scrolled', isScrolled);
        }
        ticking = false;
      };
      const onScroll = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      };
      update();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    if (!nav || !toggle) return;
    const close = () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('no-scroll');
    };
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('no-scroll', open);
    });
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('open')) close();
    });
  }

  function setupReveal() {
    const targets = $$('.section-head, .value-card, .tour-card, .info-card, .video-card, .safety-item, .cta-inner, .location-info');
    if (!('IntersectionObserver' in window)) {
      targets.forEach((node) => node.classList.add('in'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach((node) => {
      node.classList.add('reveal');
      observer.observe(node);
    });
  }

  function animateCount(node, target) {
    const raw = String(target);
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    const end = Number(target);
    if (!Number.isFinite(end)) { node.textContent = raw; return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = end.toFixed(decimals);
      return;
    }
    const start = performance.now();
    const duration = 1100;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = (end * eased).toFixed(decimals);
      if (progress < 1) requestAnimationFrame(tick);
      else node.textContent = end.toFixed(decimals);
    };
    requestAnimationFrame(tick);
  }

  function setupStatCounters() {
    const stats = $$('#stats .stat-value');
    if (!stats.length) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCount(entry.target, entry.target.dataset.count);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    stats.forEach((node) => observer.observe(node));
  }

  /* ------------------------------------------------------------------ */
  /* Contenido                                                          */
  /* ------------------------------------------------------------------ */

  function applyContent(site) {
    state.site = site;
    state.tours = Array.isArray(site.tours) ? site.tours : [];
    state.gallery = Array.isArray(site.gallery) ? site.gallery : [];
    state.videos = Array.isArray(site.videos) ? site.videos : [];

    const { brand, hero, intro, values, timeline, toursIntro, bookingIntro, galleryIntro, videosIntro, mapIntro, infoIntro, policiesIntro, contact } = site;


    if (hero) {
      if (hero.kicker) setText('heroKicker', hero.kicker);
      if (hero.title) setText('heroTitle', hero.title);
      if (hero.subtitle) setText('heroSubtitle', hero.subtitle);
      if (hero.text) setText('heroText', hero.text);
      if (hero.rating) setText('heroRating', hero.rating);
      if (hero.reviews) setText('heroReviews', hero.reviews);
      if (hero.openText) setText('heroOpen', hero.openText);
      const img = $('#heroImage');
      if (img && hero.image) {
        const cleanHeroImg = hero.image
          .replace(/(?:^|\/)(?:kanba-cave-02\.jpg|image_12\.png)$/, 'images/kanba-hero.jpg');
        img.src = cleanHeroImg;
        img.alt = hero.imageAlt || img.alt;
      }
    }

    if (intro) {
      if (intro.kicker) setText('introKicker', intro.kicker);
      if (intro.title) setText('introTitle', intro.title);
      if (intro.lead) setText('introLead', intro.lead);
      const paragraphs = $('#introParagraphs');
      if (paragraphs && Array.isArray(intro.paragraphs) && intro.paragraphs.length > 0) {
        paragraphs.replaceChildren();
        intro.paragraphs.forEach((text) => paragraphs.append(el('p', { text })));
      }
      const img1 = $('#introImage');
      const img2 = $('#introImage2');
      if (img1 && intro.image) {
        const cleanImg1 = intro.image.replace(/^\/assets\/img\/kanba-cave-04\.jpg$/, 'images/kanba-intro-main.jpg');
        img1.src = cleanImg1;
      }
      if (img2 && intro.image2) {
        const cleanImg2 = intro.image2.replace(/^\/assets\/img\/kanba-river-01\.jpg$/, 'images/kanba-intro-river.jpg');
        img2.src = cleanImg2;
      }
      const stats = $('#stats');
      if (stats && Array.isArray(intro.stats)) {
        const STAT_ICONS = [
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20v-7a9 9 0 0 1 18 0v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 20v-4.5a4 4 0 0 1 8 0V20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="19" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.3 17.2 16.7 6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="1.6 3"/></svg>',
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s5.6 6 5.6 10.2a5.6 5.6 0 0 1-11.2 0C6.4 9 12 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.6 19c.6-3.1 2.7-4.9 5.4-4.9s4.8 1.8 5.4 4.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15.5 5.4a3 3 0 0 1 0 5.7M17 14.4c1.7.6 2.8 2.2 3 4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
        ];
        stats.replaceChildren();
        intro.stats.forEach((stat, index) => {
          const unit = String(stat.suffix || '').trim();
          stats.append(el('div', { className: 'stat' }, [
            el('span', { className: 'stat-icon', html: STAT_ICONS[index] || STAT_ICONS[0] }),
            el('div', { className: 'stat-main' }, [
              el('span', { className: 'stat-value', text: stat.value, dataset: { count: stat.value } }),
              el('span', { className: 'stat-unit', text: unit }),
              el('span', { className: 'stat-label', text: stat.label })
            ])
          ]));
        });
        setupStatCounters();
      }
    }

    if (Array.isArray(timeline)) {
      const wrap = $('#timeline');
      if (wrap) {
        wrap.replaceChildren();
        timeline.forEach((item) => {
          wrap.append(el('div', { className: 'timeline-item' }, [
            el('span', { className: 'timeline-year', text: item.year }),
            el('h4', { text: item.title }),
            el('p', { text: item.text })
          ]));
        });
      }
    }

    if (Array.isArray(values)) {
      const wrap = $('#valuesGrid');
      if (wrap) {
        wrap.replaceChildren();
        values.forEach((value, index) => {
          wrap.append(el('article', { className: 'value-card' }, [
            el('span', { className: 'value-num', text: String(index + 1).padStart(2, '0') }),
            el('div', { className: 'value-icon', html: icon(value.icon === 'water' ? 'water' : value.icon === 'leaf' ? 'leaf' : 'flame') }),
            el('h3', { text: value.title }),
            el('p', { text: value.text })
          ]));
        });
      }
    }

    if (toursIntro) {
      setText('toursKicker', toursIntro.kicker);
      setText('toursTitle', toursIntro.title);
      setText('toursText', toursIntro.text);
    }
    if (bookingIntro) {
      setText('bookingKicker', bookingIntro.kicker);
      setText('bookingTitle', bookingIntro.title);
      setText('bookingText', bookingIntro.text);
    }
    if (galleryIntro) {
      setText('galleryKicker', galleryIntro.kicker);
      setText('galleryTitle', galleryIntro.title);
      setText('galleryText', galleryIntro.text);
    }
    if (videosIntro) {
      setText('videosKicker', videosIntro.kicker);
      setText('videosTitle', videosIntro.title);
      setText('videosText', videosIntro.text);
    }
    if (mapIntro) {
      setText('mapKicker', mapIntro.kicker);
      setText('mapTitle', mapIntro.title);
      setText('mapText', mapIntro.text);
      setText('mapAddress', mapIntro.address);
      setText('mapPlus', mapIntro.plusCode);
      setText('mapCoords', `${mapIntro.lat}, ${mapIntro.lng}`);
      setText('mapNote', mapIntro.note);
      const note = $('#mapNote');
      if (note && mapIntro.note) {
        note.replaceChildren();
        note.append(el('strong', { text: 'Importante: ' }), document.createTextNode(mapIntro.note));
      }
      const directions = $('#directionList');
      if (directions) {
        directions.replaceChildren();
        (mapIntro.directions || []).forEach((item) => {
          directions.append(el('div', {}, [el('dt', { text: item.label }), el('dd', { text: item.value })]));
        });
      }
      const google = $('#googleMapsBtn');
      const waze = $('#wazeBtn');
      if (google) google.href = `https://www.google.com/maps/dir/?api=1&destination=${mapIntro.lat},${mapIntro.lng}`;
      if (waze) waze.href = `https://waze.com/ul?ll=${mapIntro.lat},${mapIntro.lng}&navigate=yes`;
      setupMap(mapIntro);
    }
    if (infoIntro) {
      setText('infoTitle', infoIntro.title);
      setText('infoText', infoIntro.text);
    }
    if (policiesIntro) {
      setText('policiesKicker', policiesIntro.kicker);
      setText('policiesTitle', policiesIntro.title);
      setText('policiesText', policiesIntro.text);
    }
    if (contact) {
      setText('footerPhone', contact.phone);
      setText('footerEmail', contact.email);
      setText('footerAddress', contact.address);
      setText('footerHours', contact.hours);
      const phone = $('#footerPhone');
      const email = $('#footerEmail');
      if (phone) phone.href = `tel:${String(contact.phone || '').replace(/[^\d+]/g, '')}`;
      if (email) email.href = `mailto:${contact.email}`;
      const wa = String(contact.whatsapp || '').replace(/\D/g, '');
      $$('a[href*="wa.me"]').forEach((link) => { link.href = `https://wa.me/${wa}`; });
    }
    setText('footerNote', site.footerNote);

    const holdMinutes = site.settings?.booking?.holdMinutes ?? '20';
    setText('holdMinutesText', holdMinutes);
    setText('holdMinutesNotice', holdMinutes);
    $$('#bookingSummary .summary-hold strong, #bookingForm .form-legal strong').forEach((node) => { node.textContent = holdMinutes; });

    renderList('requirementsList', site.requirements);
    renderList('recommendationsList', site.recommendations);
    renderList('restrictionsList', site.restrictions);

    renderTours();
    renderTourOptions();
    renderGalleryFilters();
    renderGallery('all');
    renderVideos();
    renderAccordions('policiesAccordion', site.policies, true);
    renderAccordions('faqAccordion', site.faq, false);
    renderSummary();
    setupReveal();
  }

  function renderList(id, items) {
    const wrap = document.getElementById(id);
    if (!wrap || !Array.isArray(items)) return;
    wrap.replaceChildren();
    items.forEach((text) => wrap.append(el('li', { text })));
  }

  function renderToursSkeleton(count = 3) {
    const grid = $('#toursGrid');
    if (!grid) return;
    grid.replaceChildren();
    for (let i = 0; i < count; i++) {
      const card = el('article', { className: 'skeleton-tour-card' }, [
        el('div', { className: 'skeleton skeleton-media' }),
        el('div', { className: 'skeleton-content' }, [
          el('div', { className: 'skeleton skeleton-text sm', style: 'width: 40%;' }),
          el('div', { className: 'skeleton skeleton-text lg', style: 'width: 75%;' }),
          el('div', { className: 'skeleton skeleton-text md' }),
          el('div', { className: 'skeleton skeleton-text md', style: 'width: 90%;' }),
          el('div', { className: 'skeleton', style: 'height: 44px; border-radius: 999px; margin-top: 8px;' })
        ])
      ]);
      grid.appendChild(card);
    }
  }

  function renderGallerySkeleton(count = 6) {
    const grid = $('#galleryGrid');
    if (!grid) return;
    grid.replaceChildren();
    for (let i = 0; i < count; i++) {
      grid.appendChild(el('div', { className: 'skeleton skeleton-gallery-thumb' }));
    }
  }

  function renderAvailabilitySkeleton() {
    const strip = $('#dateStrip');
    if (strip) {
      if (strip.parentElement) strip.parentElement.hidden = false;
      strip.replaceChildren();
      for (let i = 0; i < 7; i++) {
        strip.appendChild(el('div', { className: 'skeleton skeleton-date-btn' }));
      }
    }
    const wrap = $('#timeSlots');
    if (wrap) {
      wrap.replaceChildren();
      for (let i = 0; i < 4; i++) {
        wrap.appendChild(el('div', { className: 'skeleton skeleton-time-btn' }));
      }
    }
  }

  function renderAccordionsSkeleton(id, count = 4, dark = false) {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.replaceChildren();
    if (dark) wrap.classList.add('accordion-dark');
    for (let i = 0; i < count; i++) {
      const item = el('div', { className: `skeleton-accordion-item${dark ? ' dark' : ''}` }, [
        el('div', { className: 'skeleton-accordion-lines' }, [
          el('div', { className: `skeleton${dark ? ' skeleton-dark' : ''}`, style: `height: 18px; width: ${60 + (i % 3) * 15}%; border-radius: 4px;` }),
          el('div', { className: `skeleton${dark ? ' skeleton-dark' : ''}`, style: `height: 11px; width: ${35 + (i % 2) * 20}%; border-radius: 3px;` })
        ]),
        el('div', { className: `skeleton skeleton-accordion-icon${dark ? ' skeleton-dark' : ''}` })
      ]);
      wrap.appendChild(item);
    }
  }

  function renderInfoListSkeleton(id, count = 4) {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.replaceChildren();
    for (let i = 0; i < count; i++) {
      const item = el('li', { className: 'skeleton-list-item' }, [
        el('span', { className: 'skeleton skeleton-bullet' }),
        el('span', { className: 'skeleton', style: `height: 12px; width: ${70 + (i % 3) * 10}%; border-radius: 4px;` })
      ]);
      wrap.appendChild(item);
    }
  }

  function renderCafeMenuSkeleton(wrap, count = 6) {
    if (!wrap) return;
    wrap.replaceChildren();
    for (let i = 0; i < count; i++) {
      const card = el('div', { className: 'skeleton-cafe-card' }, [
        el('div', { className: 'skeleton skeleton-cafe-media' }),
        el('div', { className: 'skeleton-cafe-body' }, [
          el('div', { className: 'skeleton', style: 'height: 12px; width: 35%;' }),
          el('div', { className: 'skeleton', style: 'height: 18px; width: 70%;' }),
          el('div', { className: 'skeleton', style: 'height: 13px; width: 90%;' }),
          el('div', { className: 'skeleton', style: 'height: 38px; border-radius: 8px; margin-top: 6px;' })
        ])
      ]);
      wrap.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tours                                                              */
  /* ------------------------------------------------------------------ */

  function renderTours() {
    const grid = $('#toursGrid');
    if (!grid) return;
    grid.replaceChildren();
    if (!state.tours.length) {
      grid.append(el('p', { className: 'loading-line', text: 'Pronto publicaremos nuestras experiencias.' }));
      return;
    }
    state.tours.forEach((tour) => {
      const featured = Boolean(tour.featured);
      const card = el('article', { className: `tour-card${featured ? ' is-featured' : ''}` });
      const media = el('div', { className: 'tour-media' }, [
        el('img', { attrs: { src: tour.image, alt: tour.name, loading: 'lazy' } }),
        el('span', { className: `tour-badge${tour.badge && /vendido|clásico|completo/i.test(tour.badge) ? ' hot' : ''}`, text: tour.badge || 'Experiencia' }),
        el('div', { className: 'tour-media-meta' }, [
          el('span', {}, [el('span', { html: icon('clock') }), document.createTextNode(tour.duration)]),
          el('span', {}, [el('span', { html: icon('users') }), document.createTextNode(`máx. ${tour.maxParticipants}`)])
        ]),
        el('span', { className: 'tour-price-chip' }, [
          document.createTextNode(money(tour.price)),
          el('small', { text: 'por persona' })
        ])
      ]);
      const body = el('div', { className: 'tour-body' }, [
        el('p', { className: 'tour-topline' }, [
          document.createTextNode(tour.difficulty || 'Aventura'),
          el('span', { className: 'dot' }),
          document.createTextNode(`desde ${tour.minAge} años`)
        ]),
        el('h3', { text: tour.name }),
        el('p', { className: 'tour-desc', text: tour.description }),
        el('details', { className: 'tour-includes' }, [el('summary', { text: 'Ver qué incluye' }), ...(tour.includes || []).map(item => el('span', { text: item }))]),
        el('div', { className: 'tour-schedule' }, [
          el('span', { className: 'label', text: 'Horarios de salida' }),
          ...(tour.times || []).map((time) => el('span', { className: 'time-pill', text: time }))
        ]),
        el('div', { className: 'tour-foot' }, [
          el('span', { className: 'tour-seats' }, [el('i'), document.createTextNode(`Hasta ${tour.capacity} por grupo`)]),
          el('button', {
            className: 'btn btn-dark',
            attrs: { type: 'button' },
            text: 'Reservar',
            dataset: { tour: tour.id }
          })
        ])
      ]);
      card.append(media, body);
      const button = $('button[data-tour]', body);
      if (button) {
        button.addEventListener('click', () => {
          selectTour(tour.id, { scroll: true });
        });
      }
      grid.append(card);
    });
  }

  function renderTourOptions() {
    const wrap = $('#tourOptions');
    if (!wrap) return;
    wrap.replaceChildren();
    state.tours.forEach((tour) => {
      const button = el('button', {
        className: `tour-option${state.tourId === tour.id ? ' selected' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(state.tourId === tour.id) },
        dataset: { tour: tour.id }
      }, [
        el('span', { className: 'tour-option-radio' }),
        el('img', { attrs: { src: tour.image, alt: '' } }),
        el('span', { className: 'tour-option-info' }, [
          el('strong', { text: tour.name }),
          el('span', { text: `${tour.duration} · ${tour.difficulty}` })
        ]),
        el('span', { className: 'tour-option-price' }, [
          document.createTextNode(money(tour.price)),
          el('small', { text: 'por persona' })
        ])
      ]);
      button.addEventListener('click', () => selectTour(tour.id));
      wrap.append(button);
    });
  }

  async function selectTour(tourId, { scroll = false } = {}) {
    const tour = state.tours.find((item) => item.id === tourId);
    if (!tour) return;
    track('select_tour', {
      tour_id: tour.id,
      tour_name: tour.name,
      price: Number(tour.price) || 0,
      currency: state.site?.settings?.booking?.currency
    });
    state.tourId = tourId;
    state.date = null;
    state.time = null;
    state.pax = 1;
    state.availability = [];
    if (typeof renderAvailabilitySkeleton === 'function') renderAvailabilitySkeleton();
    else { renderDates(); renderTimes(); }
    setText('selectedDateLabel', '');
    showAvailabilityNote('Consultando las salidas del tour…');
    renderTourOptions();
    updatePaxControls();
    renderSummary();

    if (scroll) {
      window.location.href = `/reservar.html?tour=${encodeURIComponent(tourId)}`;
      return;
    }

    try {
      const availableDays = [];
      const today = state.site.today;
      const advance = state.site.settings?.booking?.advanceDays;
      const hasAdvance = /^\d+$/.test(String(advance));
      const tourStart = tour.startDate || tour.fechaInicio || null;
      const tourEnd = tour.endDate || tour.fechaFin || null;
      let from = tourStart && tourStart > today ? tourStart : today;
      // With no sales horizon, preview one API page starting at the first operating date.
      const limit = new Date((hasAdvance ? today : from) + 'T00:00:00Z');
      limit.setUTCDate(limit.getUTCDate() + (hasAdvance ? Number(advance) : 44));
      const lastSale = limit.toISOString().slice(0, 10);
      const until = tourEnd && tourEnd < lastSale ? tourEnd : lastSale;
      while (from <= until) {
        const fromMs = Date.parse(from + 'T00:00:00Z');
        const untilMs = Date.parse(until + 'T00:00:00Z');
        const diffDays = Math.max(0, Math.round((untilMs - fromMs) / 86400000));
        const days = Math.min(45, diffDays + 1);
        const data = await api(`/api/availability?tour=${encodeURIComponent(tourId)}&days=${days}&from=${from}`);
        if (state.tourId !== tourId) return;
        const page = data.daysList || [];
        availableDays.push(...page);
        const next = new Date(from + 'T00:00:00Z');
        next.setUTCDate(next.getUTCDate() + days);
        from = next.toISOString().slice(0, 10);
      }
      state.availability = availableDays.filter(day => {
        if (tourStart && day.date < tourStart) return false;
        if (tourEnd && day.date > tourEnd) return false;
        return day.tours?.some(entry => entry.tourId === tourId);
      });
      renderDates();
      const first = state.availability.find(dayHasSeats);
      if (first) selectDate(first.date);
      else {
        renderTimes();
        showAvailabilityNote(tourEnd && tourEnd < today ? 'El periodo de operación de este tour ya terminó.'
          : (tourStart && tourStart > lastSale) ? 'La venta para este tour aún no está abierta.'
          : state.availability.length ? 'No quedan salidas con cupos reservables en este periodo.'
          : 'No hay días y horarios de operación en el periodo de venta vigente.');
      }
    } catch (error) {
      if (state.tourId !== tourId) return;
      state.availability = [];
      renderDates();
      renderTimes();
      showAvailabilityNote(error.message);
    }
  }

  function dayHasSeats(day) {
    const entry = (day.tours || []).find((item) => item.tourId === state.tourId);
    return Boolean(entry && entry.departures.some((departure) => departure.left > 0 && !['past', 'closed', 'soldout'].includes(departure.status)));
  }

  function tourEntryFor(date) {
    const day = state.availability.find((item) => item.date === date);
    if (!day) return null;
    return (day.tours || []).find((item) => item.tourId === state.tourId) || null;
  }

  function renderDates() {
    const strip = $('#dateStrip');
    if (!strip) return;
    strip.replaceChildren();
    strip.parentElement.hidden = !state.availability.length;
    const today = state.site?.today;
    state.availability.forEach((day) => {
      const entry = (day.tours || []).find((item) => item.tourId === state.tourId);
      const available = dayHasSeats(day);
      const date = dateObj(day.date);
      const dow = new Intl.DateTimeFormat('es-GT', { weekday: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
      const month = new Intl.DateTimeFormat('es-GT', { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
      const dayNum = String(Number(day.date.split('-')[2]));
      const button = el('button', {
        className: `date-btn${state.date === day.date ? ' selected' : ''}${day.date === today ? ' today' : ''}`,
        attrs: { type: 'button', disabled: !available, 'aria-pressed': String(state.date === day.date) },
        dataset: { date: day.date }
      }, [
        el('span', { className: 'dow', text: dow }),
        el('span', { className: 'day', text: dayNum }),
        el('span', { className: 'month', text: month })
      ]);
      button.addEventListener('click', () => selectDate(day.date));
      strip.append(button);
    });
    const selected = $('.date-btn.selected', strip);
    if (selected) selected.scrollIntoView({ block: 'nearest', inline: 'center' });
    updateDateArrows();
  }

  function updateDateArrows() {
    const strip = $('#dateStrip');
    if (!strip) return;
    const prev = $('#datePrev');
    const next = $('#dateNext');
    if (prev) prev.disabled = strip.scrollLeft <= 2;
    if (next) next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
  }

  function selectDate(date) {
    const day = state.availability.find((item) => item.date === date);
    if (!day || !dayHasSeats(day)) {
      showAvailabilityNote('Ese día no tiene cupos disponibles. Elige otra fecha.');
      return;
    }
    state.date = date;
    state.time = null;
    renderDates();
    renderTimes();
    renderSummary();
    updateToStep3();
    const entry = tourEntryFor(date);
    if (entry && entry.closed) showAvailabilityNote('La cueva está cerrada ese día por mantenimiento o clima. Elige otra fecha.');
    else hideAvailabilityNote();
    setText('selectedDateLabel', `· ${formatLong(date)}`);
    if (day && entry && !entry.departures.some((item) => item.left > 0)) {
      showAvailabilityNote('No quedan cupos en esta fecha. Prueba otro día.');
    }
  }

  function renderTimes() {
    const wrap = $('#timeSlots');
    const guideSelect = $('#guideScheduleSelect');
    if (!wrap && !guideSelect) return;
    if (wrap) wrap.replaceChildren();
    if (guideSelect) {
      guideSelect.replaceChildren();
      guideSelect.appendChild(el('option', { value: '', text: state.date ? 'Selecciona un horario disponible' : 'Selecciona fecha primero' }));
    }
    if (!state.date) {
      if (wrap) wrap.append(el('p', { className: 'loading-line', text: 'Elige una fecha para ver los horarios.' }));
      return;
    }
    const entry = tourEntryFor(state.date);
    if (!entry) {
      if (wrap) wrap.append(el('p', { className: 'loading-line', text: 'No hay horarios para esta fecha.' }));
      return;
    }
    entry.departures.forEach((departure) => {
      const disabled = departure.left < 1 || ['past', 'closed', 'soldout'].includes(departure.status);
      let label = `${departure.left} cupos`;
      if (departure.status === 'past') label = 'Ya pasó';
      else if (departure.status === 'closed') label = 'Cerrado';
      else if (departure.status === 'soldout' || departure.left <= 0) label = 'Agotado';
      else if (departure.status === 'last') label = `Últimos ${departure.left}`;
      if (wrap) {
        const button = el('button', {
          className: `time-slot${state.time === departure.time ? ' selected' : ''}`,
          attrs: { type: 'button', disabled, 'aria-pressed': String(state.time === departure.time) },
          dataset: { time: departure.time }
        }, [
          el('strong', { text: departure.time }),
          el('small', { text: label })
        ]);
        if (!disabled) {
          button.addEventListener('click', () => selectTime(departure.time));
        }
        wrap.append(button);
      }

      if (guideSelect) {
        const opt = el('option', {
          value: departure.time,
          text: `${departure.time} · ${departure.left} ${departure.left === 1 ? 'cupo' : 'cupos'}${disabled ? ' (' + label + ')' : ''}`
        });
        if (disabled) opt.disabled = true;
        if (state.time === departure.time) opt.selected = true;
        guideSelect.appendChild(opt);
      }
    });

    if (state.isGuideGroup) {
      syncGuidePax();
    }
  }

  function selectTime(time) {
    state.time = time;
    const entry = tourEntryFor(state.date);
    const departure = entry?.departures.find((item) => item.time === time);
    const tour = currentTour();
    if (departure && tour) {
      const max = Math.max(1, Math.min(tour.maxParticipants, departure.left));
      if (state.pax > max) state.pax = max;
    }
    const guideSelect = $('#guideScheduleSelect');
    if (guideSelect && guideSelect.value !== time) {
      guideSelect.value = time || '';
    }
    renderTimes();
    if (state.isGuideGroup) {
      syncGuidePax();
    } else {
      updatePaxControls();
    }
    renderSummary();
    updateToStep3();
    hideAvailabilityNote();
  }

  function syncGuidePax() {
    const val = $('#guidePaxValue');
    const minus = $('#minusGuidePax');
    const plus = $('#plusGuidePax');
    const hint = $('#guidePaxHint');
    const tour = currentTour();
    const left = selectedDepartureLeft();
    const max = Math.max(1, Math.min(tour ? tour.maxParticipants : 12, left === null ? 12 : left));
    if (left !== null && state.pax > max) {
      state.pax = max;
    }
    if (val) val.textContent = String(state.pax);
    if (minus) minus.disabled = state.pax <= 1;
    if (plus) plus.disabled = left === null || state.pax >= max;
    if (hint) {
      if (left === null) {
        hint.textContent = 'Selecciona un horario para consultar los cupos disponibles.';
      } else if (left <= 0) {
        hint.textContent = 'Este horario está agotado. Elige otro horario para tu grupo.';
      } else {
        hint.textContent = `Cupos libres en este horario: ${left}. Máximo por grupo: ${max} turistas.`;
      }
    }
    const scheduleHint = $('#guideScheduleHint');
    if (scheduleHint) {
      scheduleHint.textContent = state.time && left !== null
        ? `Horario ${state.time} seleccionado (${left} cupos libres).`
        : 'Cupos disponibles calculados en tiempo real.';
    }
  }

  function syncGuideToggle(active) {
    state.isGuideGroup = Boolean(active);
    const guideCheckbox = $('#isGuideGroupCheckbox');
    if (guideCheckbox && guideCheckbox.checked !== state.isGuideGroup) {
      guideCheckbox.checked = state.isGuideGroup;
    }
    const guideFields = $('#guideGroupFields');
    if (guideFields) guideFields.hidden = !state.isGuideGroup;
    const standardRow = $('#standardPaxRow');
    if (standardRow) standardRow.hidden = state.isGuideGroup;
    if (state.isGuideGroup) {
      const guideSelect = $('#guideScheduleSelect');
      if (guideSelect && state.time) guideSelect.value = state.time;
      syncGuidePax();
    } else {
      updatePaxControls();
    }
    renderSummary();
    updateToStep3();
  }

  function currentTour() {
    return state.tours.find((item) => item.id === state.tourId) || null;
  }

  function showAvailabilityNote(message) {
    const note = $('#availabilityNote');
    if (!note) return;
    note.textContent = message;
    note.hidden = false;
  }

  function hideAvailabilityNote() {
    const note = $('#availabilityNote');
    if (note) note.hidden = true;
  }

  function selectedDepartureLeft() {
    const entry = state.date ? tourEntryFor(state.date) : null;
    const departure = entry?.departures.find((item) => item.time === state.time);
    return departure ? Number(departure.left) : null;
  }

  function updatePaxControls() {
    const tour = currentTour();
    const output = $('#paxValue');
    const minus = $('#minusPax');
    const plus = $('#plusPax');
    const help = $('#participantHelp');
    if (!tour || !output) return;
    const left = selectedDepartureLeft();
    const max = Math.max(1, Math.min(tour.maxParticipants, left === null ? tour.maxParticipants : left));
    const min = 1;
    state.pax = Math.min(Math.max(state.pax, min), max);
    output.textContent = String(state.pax);
    if (minus) minus.disabled = left === null || state.pax <= min;
    if (plus) plus.disabled = left === null || state.pax >= max;
    if (help) {
      help.textContent = left !== null
        ? `Este horario tiene ${left} cupos libres. Máximo por reserva: ${tour.maxParticipants}.`
        : `Máximo ${tour.maxParticipants} por reserva.`;
    }
  }

  function updateToStep3() {
    const button = $('#toStep3');
    if (!button) return;
    const tour = currentTour();
    const left = selectedDepartureLeft();
    const valid = Boolean(tour && state.date && state.time && left !== null && left >= state.pax && state.pax >= 1);
    button.disabled = !valid || !state.user;
    if (state.isGuideGroup && tour && left !== null && left < state.pax) {
      showAvailabilityNote(`Tu grupo tiene ${state.pax} turistas, pero este horario solo tiene ${left} cupos disponibles. Reduce la cantidad de turistas o elige otro horario.`);
    } else if (tour && left !== null && left < state.pax) {
      showAvailabilityNote(`Solo quedan ${left} cupos en ese horario. Reduce los participantes o elige otro horario.`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Resumen de reserva                                                 */
  /* ------------------------------------------------------------------ */

  function renderSummary() {
    const tour = currentTour();
    const empty = $('#summaryEmpty');
    const content = $('#summaryContent');
    const status = $('#summaryStatus');
    if (!tour) {
      if (empty) empty.hidden = false;
      if (content) content.hidden = true;
      if (status) { status.textContent = 'Sin iniciar'; status.classList.remove('live'); }
      return;
    }
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    if (status) {
      status.textContent = state.time ? 'Cupos disponibles' : state.date ? 'Fecha elegida' : 'En proceso';
      status.classList.toggle('live', Boolean(state.time));
    }
    const image = $('#summaryImage');
    if (image) { image.src = tour.image; image.alt = tour.name; }
    setText('summaryTourName', tour.name);
    setText('summaryTourMeta', `${tour.duration} · ${tour.difficulty}`);
    setText('summaryDate', state.date ? formatShort(state.date) : 'Por elegir');
    setText('summaryTime', state.time || 'Por elegir');
    updatePaxControls();
    const names = $('#participantNames');
    if (names) {
      while (names.children.length > state.pax - 1 && names.lastElementChild) names.lastElementChild.remove();
      while (names.children.length < state.pax - 1) {
        const number = names.children.length + 2;
        const labelText = state.isGuideGroup
          ? 'Nombre del turista ' + number
          : 'Nombre del participante ' + number;
        names.append(el('label', { className: 'field' }, [
          el('span', { text: labelText }),
          el('input', { attrs: { name: 'guestName', required: true, maxlength: 120 } })
        ]));
      }
    }
    const recapGuide = $('#recapGuideBadge');
    if (recapGuide) {
      recapGuide.hidden = !state.isGuideGroup;
      if (state.isGuideGroup) {
        recapGuide.replaceChildren();
        recapGuide.append(
          el('svg', { attrs: { viewBox: '0 0 24 24', width: '13', height: '13', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' } }, [
            el('path', { attrs: { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' } }),
            el('circle', { attrs: { cx: '9', cy: '7', r: '4' } })
          ]),
          document.createTextNode(` Guía con grupo (${state.pax} turistas)`)
        );
      }
    }
    setText('summaryPax', state.isGuideGroup ? `${state.pax || 1} turistas` : String(state.pax || 1));
    setText('summaryUnit', `${money(tour.price)} × ${state.pax || 1}`);
    setText('summaryTotal', money(tour.price * (state.pax || 1)));

    setText('recapTourName', tour.name);
    setText('recapTourMeta', `${tour.duration} · ${tour.difficulty}`);
    setText('recapDate', state.date ? formatLong(state.date) : 'Por elegir');
    setText('recapTime', state.time || 'Por elegir');
    setText('recapPax', String(state.pax || 1));
    setText('recapTotal', money(tour.price * (state.pax || 1)));
  }

  /* ------------------------------------------------------------------ */
  /* Asistente de reserva                                               */
  /* ------------------------------------------------------------------ */

  function goStep(step) {
    if (step > 1 && !guardAuth()) return;
    state.step = step;
    $$('.wizard-panel').forEach((panel) => { panel.hidden = Number(panel.dataset.panel) !== step; });
    $$('[data-step-indicator]').forEach((indicator) => {
      const value = Number(indicator.dataset.stepIndicator);
      indicator.classList.toggle('active', value === step);
      indicator.classList.toggle('done', value < step);
    });
    if (step === 2) {
      setText('selectedDateLabel', state.date ? `· ${formatLong(state.date)}` : '');
      renderDates();
      renderTimes();
      updateToStep3();
    }
    if (step === 3) {
      updatePaxControls();
      renderSummary();
    }
  }

  function setupWizard() {
    $$('[data-next]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = Number(button.dataset.next);
        if (target === 2 && !state.tourId) {
          toast('Elige una experiencia para continuar.');
          return;
        }
        if (target === 3) {
          if (!state.date || !state.time) { toast('Elige fecha y horario.'); return; }
          const left = selectedDepartureLeft();
          if (left !== null && left < state.pax) { toast('No hay suficientes cupos en ese horario.'); return; }
        }
        goStep(target);
      });
    });
    $$('[data-prev]').forEach((button) => {
      button.addEventListener('click', () => goStep(Number(button.dataset.prev)));
    });

    const minus = $('#minusPax');
    const plus = $('#plusPax');
    if (minus) minus.addEventListener('click', () => {
      const tour = currentTour();
      if (!tour) return;
      state.pax = Math.max(1, state.pax - 1);
      renderSummary();
      updateToStep3();
    });
    if (plus) plus.addEventListener('click', () => {
      const tour = currentTour();
      if (!tour) return;
      const left = selectedDepartureLeft();
      const max = Math.max(1, Math.min(tour.maxParticipants, left === null ? tour.maxParticipants : left));
      state.pax = Math.min(max, state.pax + 1);
      renderSummary();
      updateToStep3();
    });

    const guideToggle = $('#isGuideGroupCheckbox');
    if (guideToggle) {
      guideToggle.addEventListener('change', (e) => syncGuideToggle(e.target.checked));
    }
    const guideSchedule = $('#guideScheduleSelect');
    if (guideSchedule) {
      guideSchedule.addEventListener('change', (e) => {
        if (e.target.value) selectTime(e.target.value);
      });
    }
    const minusGuide = $('#minusGuidePax');
    const plusGuide = $('#plusGuidePax');
    if (minusGuide) {
      minusGuide.addEventListener('click', () => {
        state.pax = Math.max(1, state.pax - 1);
        syncGuidePax();
        renderSummary();
        updateToStep3();
      });
    }
    if (plusGuide) {
      plusGuide.addEventListener('click', () => {
        const tour = currentTour();
        const left = selectedDepartureLeft();
        const max = Math.max(1, Math.min(tour ? tour.maxParticipants : 12, left === null ? 12 : left));
        if (state.pax < max) {
          state.pax = Math.min(max, state.pax + 1);
          syncGuidePax();
          renderSummary();
          updateToStep3();
        } else if (left !== null && state.pax >= left) {
          showAvailabilityNote(`No puedes agregar más turistas: este horario solo tiene ${left} cupos disponibles.`);
        }
      });
    }
    const guideAgency = $('#guideAgencyName');
    if (guideAgency) {
      guideAgency.addEventListener('input', () => {
        state.guideAgency = guideAgency.value.trim();
      });
    }

    const strip = $('#dateStrip');
    const prev = $('#datePrev');
    const next = $('#dateNext');
    if (prev && strip) prev.addEventListener('click', () => strip.scrollBy({ left: -260, behavior: 'smooth' }));
    if (next && strip) next.addEventListener('click', () => strip.scrollBy({ left: 260, behavior: 'smooth' }));
    if (strip) {
      strip.addEventListener('scroll', updateDateArrows, { passive: true });
      window.addEventListener('resize', updateDateArrows);
    }

    $('#bookingForm')?.addEventListener('submit', submitBooking);
    $$('#bookingForm input, #bookingForm textarea').forEach((input) => {
      input.addEventListener('input', () => clearFieldError(input.name));
    });
  }

  function clearFieldError(name) {
    if (!name) return;
    const field = $(`[data-error="${name}"]`);
    if (field) field.textContent = '';
    const input = $(`#bookingForm [name="${name}"]`);
    if (input) input.classList.remove('invalid');
  }

  function setFieldError(name, message) {
    const field = $(`[data-error="${name}"]`);
    if (field) field.textContent = message;
    const input = $(`#bookingForm [name="${name}"]`);
    if (input) input.classList.add('invalid');
  }

  function validateBookingForm(form) {
    const fields = [
      ['name', 'Escribe tu nombre completo.'],
      ['email', 'Escribe un correo válido.'],
      ['phone', 'Escribe un teléfono de contacto.'],
      ['country', 'Indica tu país.']
    ];
    let valid = true;
    let firstInvalid = null;
    fields.forEach(([name, message]) => {
      clearFieldError(name);
      const input = form.elements[name];
      const value = String(input?.value || '').trim();
      if (!value) {
        setFieldError(name, message);
        valid = false;
        if (!firstInvalid) firstInvalid = input;
      } else if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        setFieldError(name, 'Correo electrónico inválido.');
        valid = false;
        if (!firstInvalid) firstInvalid = input;
      } else if (name === 'phone' && (!/^\+?[\d ()-]{7,25}$/.test(value) || !/^\d{7,15}$/.test(value.replace(/\D/g, '')))) {
        setFieldError(name, 'El teléfono debe tener al menos 7 dígitos.');
        valid = false;
        if (!firstInvalid) firstInvalid = input;
      }
    });

    const error = $('#bookingError');
    if (!form.elements.acceptPolicies.checked) {
      valid = false;
      if (error) { error.textContent = 'Debes aceptar las políticas de reserva y cancelación.'; error.hidden = false; }
    } else if (!form.elements.acceptTerms.checked) {
      valid = false;
      if (error) { error.textContent = 'Debes aceptar los requisitos y la carta de responsabilidad.'; error.hidden = false; }
    }

    if (valid && firstInvalid) {
      valid = false;
    }
    if (firstInvalid) {
      firstInvalid.focus({ preventScroll: false });
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (!valid && error && error.hidden) {
      error.textContent = 'Revisa los datos marcados antes de continuar.';
      error.hidden = false;
    }
    return valid;
  }

  async function submitBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = $('#bookingError');
    if (errorBox) errorBox.hidden = true;
    if (!guardAuth()) return;
    if (!validateBookingForm(form)) return;

    const tour = currentTour();
    if (!tour || !state.date || !state.time) {
      toast('Vuelve a elegir experiencia, fecha y horario.');
      goStep(1);
      return;
    }

    const button = $('#submitBooking');
    busy(button, true);
    try {
      const customer = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
        country: form.elements.country.value.trim(),
        document: form.elements.document.value.trim(),
        notes: form.elements.notes.value.trim(),
        acceptPolicies: form.elements.acceptPolicies.checked,
        acceptTerms: form.elements.acceptTerms.checked
      };
      const participantNames = [customer.name, ...Array.from(form.querySelectorAll('[name="guestName"]'), input => input.value.trim())];
      if (participantNames.some(name => !name)) { toast('Completa el nombre de cada participante.'); return; }
      const bookingPayload = {
        requestId: state.bookingRequestId,
        tourId: tour.id,
        date: state.date,
        time: state.time,
        participants: state.pax,
        participantNames,
        customer
      };
      if (state.isGuideGroup) {
        const agency = ($('#guideAgencyName')?.value || '').trim();
        bookingPayload.guideGroup = {
          isGuide: true,
          tourists: state.pax,
          agency: agency || 'Guía independiente'
        };
      }
      const requestFingerprint = JSON.stringify({
        tourId: tour.id,
        date: state.date,
        time: state.time,
        participants: state.pax,
        customer,
        participantNames,
        guideGroup: state.isGuideGroup ? bookingPayload.guideGroup : undefined
      });
      if (state.bookingFingerprint !== requestFingerprint) {
        state.bookingFingerprint = requestFingerprint;
        state.bookingRequestId = crypto.randomUUID();
        bookingPayload.requestId = state.bookingRequestId;
      }
      let data;
      try {
        data = await api('/api/reservations', {
          method: 'POST',
          body: JSON.stringify(bookingPayload)
        });
      } catch (error) {
        if (error.status === 401) {
          requireLogin('Inicia sesión para poder reservar.');
          return;
        }
        throw error;
      }
      sessionStorage.setItem(`kanba:${data.code}`, JSON.stringify({ code: data.code, token: data.token }));
      track('reservation_created', {
        currency: state.site?.settings?.booking?.currency,
        value: Number(tour.price) * state.pax,
        transaction_id: data.code,
        items: [{
          item_id: tour.id,
          item_name: tour.name,
          item_category: 'tour',
          price: Number(tour.price) || 0,
          quantity: state.pax
        }]
      });
      window.location.href = data.paymentUrl;
    } catch (error) {
      if (errorBox) {
        errorBox.replaceChildren();
        if (error.status === 409) {
          const isCapacityIssue = /agotó|quedan|cupos|sold_out/i.test(error.message) || error.code === 'sold_out';
          const title = document.createElement('strong');
          title.textContent = isCapacityIssue ? 'Cupos no disponibles en este momento' : 'Aviso sobre tu reserva';
          const p = document.createElement('p');
          p.textContent = isCapacityIssue
            ? `Otro viajero completó su reserva justo antes (${error.message}). Tus datos personales se han conservado intactos en el formulario. Puedes ajustar la cantidad de participantes o elegir otro horario/fecha sin volver a escribir todo.`
            : error.message;
          const actions = document.createElement('div');
          actions.className = 'form-error-actions';
          const changeSlotBtn = document.createElement('button');
          changeSlotBtn.type = 'button';
          changeSlotBtn.className = 'btn btn-outline btn-compact';
          changeSlotBtn.textContent = 'Elegir otro horario o fecha (Paso 2)';
          changeSlotBtn.onclick = () => {
            goStep(2);
            const t = currentTour();
            if (t) selectTour(t.id);
          };
          actions.append(changeSlotBtn);
          errorBox.append(title, p, actions);
        } else {
          errorBox.textContent = error.message;
        }
        errorBox.hidden = false;
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (error.fields) {
        Object.entries(error.fields).forEach(([name, message]) => setFieldError(name, message));
      }
      busy(button, false);
      if (error.status === 409) toast(error.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Galería                                                            */
  /* ------------------------------------------------------------------ */

  function renderGalleryFilters() {
    const wrap = $('#galleryFilters');
    if (!wrap) return;
    wrap.replaceChildren(el('button', { className: 'active', text: 'Todo', dataset: { filter: 'all' }, attrs: { type: 'button', role: 'tab', 'aria-selected': 'true' } }));
    for (const category of new Set(state.gallery.map(item => item.category).filter(Boolean))) {
      wrap.append(el('button', { text: category, dataset: { filter: category }, attrs: { type: 'button', role: 'tab', 'aria-selected': 'false' } }));
    }
    $$('button', wrap).forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter || 'all';
        state.galleryFilter = filter;
        $$('button', wrap).forEach((item) => {
          const active = item === button;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
        });
        renderGallery(filter);
      });
    });
  }

  function galleryItems(filter) {
    return state.gallery.filter((item) => filter === 'all' || item.category === filter);
  }

  function renderGallery(filter) {
    const grid = $('#galleryGrid');
    if (!grid) return;
    const items = galleryItems(filter);
    grid.replaceChildren();
    if (!items.length) {
      grid.append(el('p', { className: 'empty-state-text', text: 'No hay imágenes disponibles en esta categoría.' }));
      setText('photoCount', '0 fotografías');
      return;
    }
    items.forEach((item, index) => {
      const button = el('button', {
        className: 'gallery-item',
        attrs: { type: 'button', 'aria-label': `Ampliar: ${item.caption}` },
        dataset: { index: String(index) }
      }, [
        el('img', { attrs: { src: item.src, alt: item.caption, loading: 'lazy', decoding: 'async' } }),
        el('span', { className: 'zoom', html: icon('zoom') }),
        el('figcaption', {}, [
          el('strong', { text: item.caption }),
          el('span', { text: item.category })
        ])
      ]);
      button.addEventListener('click', () => openLightbox(items, index));
      grid.append(button);
    });
    setText('photoCount', `${items.length} ${items.length === 1 ? 'fotografía' : 'fotografías'}`);
  }

  let lightboxItems = [];
  let lightboxIndex = 0;

  function openLightbox(items, index) {
    lightboxItems = items;
    lightboxIndex = index;
    renderLightbox();
    const box = $('#lightbox');
    if (!box) return;
    box.hidden = false;
    document.body.classList.add('no-scroll');
    $('#lightboxClose')?.focus();
  }

  function renderLightbox() {
    const item = lightboxItems[lightboxIndex];
    if (!item) return;
    const image = $('#lightboxImage');
    if (image) { image.src = item.src; image.alt = item.caption; }
    setText('lightboxCaption', item.caption);
    setText('lightboxCredit', item.credit);
    setText('lightboxCounter', `${lightboxIndex + 1} / ${lightboxItems.length}`);
  }

  function moveLightbox(delta) {
    if (!lightboxItems.length) return;
    lightboxIndex = (lightboxIndex + delta + lightboxItems.length) % lightboxItems.length;
    renderLightbox();
  }

  function closeLightbox() {
    const box = $('#lightbox');
    if (box) box.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  function setupLightbox() {
    $('#lightboxClose')?.addEventListener('click', closeLightbox);
    $('#lightboxPrev')?.addEventListener('click', () => moveLightbox(-1));
    $('#lightboxNext')?.addEventListener('click', () => moveLightbox(1));
    $('#lightbox')?.addEventListener('click', (event) => {
      if (event.target.id === 'lightbox') closeLightbox();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Videos                                                             */
  /* ------------------------------------------------------------------ */

  function renderVideos() {
    const grid = $('#videosGrid');
    if (!grid) return;
    grid.replaceChildren();
    state.videos.forEach((video) => {
      const button = el('button', {
        className: 'video-card',
        attrs: { type: 'button', 'aria-label': `Reproducir: ${video.title}` }
      }, [
        el('span', { className: 'video-thumb' }, [
          el('img', { attrs: { src: `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`, alt: video.title, loading: 'lazy', decoding: 'async' } }),
          el('span', { className: 'video-cat', text: video.category }),
          el('span', { className: 'video-play', html: icon('play') })
        ]),
        el('span', { className: 'video-body' }, [
          el('h3', { text: video.title }),
          el('p', { text: video.description })
        ])
      ]);
      button.addEventListener('click', () => openVideo(video));
      grid.append(button);
    });
  }

  function openVideo(video) {
    const modal = $('#videoModal');
    const embed = $('#videoEmbed');
    if (!modal || !embed) return;
    track('video_play', { video_id: video.youtubeId, video_title: video.title, video_category: video.category });
    embed.replaceChildren();
    const iframe = el('iframe', {
      attrs: {
        src: `https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0`,
        title: video.title,
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: true
      }
    });
    embed.append(iframe);
    setText('videoTitle', video.title);
    setText('videoDesc', video.description);
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    $('#videoClose')?.focus();
  }

  function closeVideo() {
    const modal = $('#videoModal');
    if (modal) modal.hidden = true;
    const embed = $('#videoEmbed');
    if (embed) embed.replaceChildren();
    document.body.classList.remove('no-scroll');
  }

  function setupVideoModal() {
    $('#videoClose')?.addEventListener('click', closeVideo);
    $('#videoModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'videoModal') closeVideo();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Acordeones                                                         */
  /* ------------------------------------------------------------------ */

  const DEFAULT_POLICIES = [
    {
      id: 'puntualidad',
      title: '1. Horarios de salida y registro previo (Check-in)',
      summary: 'Llegada anticipada y tolerancia horaria.',
      items: [
        'Presentarse con 20 minutos de anticipación en la taquilla de K’anba para validar tu comprobante de reserva (código RES-... impreso o digital).',
        'Por respeto a los demás viajeros y a la seguridad del recorrido, la tolerancia máxima de salida es de 10 minutos.',
        'En caso de retraso no imputable a K’anba, el acceso queda sujeto a disponibilidad de cupo en los siguientes grupos del mismo día sin garantía de horario.'
      ]
    },
    {
      id: 'clima-seguridad',
      title: '2. Clima, caudal del río y decisiones de seguridad',
      summary: 'Cuidado del visitante y protocolo de crecidas.',
      items: [
        'El descenso acuático depende de los niveles de agua de la cuenca del río Cahabón.',
        'Si los monitores hidrológicos detectan crecidas o alertas climáticas que comprometan la seguridad, la actividad se suspende de inmediato.',
        'Toda cancelación por fuerza mayor u orden del guía q’eqchi’ otorga derecho automático a reprogramación sin costo o reembolso del 100%.'
      ]
    },
    {
      id: 'aptitud-fisica',
      title: '3. Salud física, edad y carta de responsabilidad',
      summary: 'Requisitos corporales para un descenso seguro.',
      items: [
        'Edad mínima obligatoria: 8 años cumplidos. Menores de edad (8 a 17 años) deben ingresar acompañados por un adulto responsable.',
        'Es indispensable saber flotar o tener nociones básicas de natación; el uso del chaleco salvavidas y casco provistos es obligatorio durante todo el trayecto.',
        'No apto para personas con afecciones cardiovasculares severas, lesiones graves de columna, movilidad reducida o embarazo avanzado.'
      ]
    },
    {
      id: 'reembolsos-proceso',
      title: '4. Tramitación de reembolsos y plazos de acreditación',
      summary: 'Procedimiento bancario y canales autorizados.',
      items: [
        'Las solicitudes de cancelación se gestionan directamente a través del portal “Mi reserva” o enviando un correo con tu número de reserva.',
        'Los reembolsos aprobados se emiten hacia el método de pago original (tarjeta o transferencia) en un plazo de 5 a 10 días hábiles bancarios.',
        'Por seguridad antifraude, no se realizan devoluciones en efectivo de reservas pagadas en línea ni transferencias a cuentas de terceros.'
      ]
    }
  ];

  const DEFAULT_FAQ = [
    {
      q: '¿Qué tan profunda es el agua dentro de la cueva?',
      a: 'El recorrido combina tramos poco profundos donde el agua llega a los tobillos o las rodillas, con pozas profundas donde es necesario nadar. En todo momento el uso del chaleco salvavidas es obligatorio y vas acompañado por guías locales capacitados que asisten en cada poza.'
    },
    {
      q: '¿Puedo entrar a K’anba si no sé nadar muy bien?',
      a: 'Sí, siempre que te sientas cómodo en el agua con chaleco salvavidas y sigas las instrucciones del guía. El chaleco garantiza flotación total sin esfuerzo y en los tramos más hondos hay cuerdas de apoyo y asistencia cercana de tu guía q’eqchi’.'
    },
    {
      q: '¿Cómo se ilumina el interior durante el recorrido?',
      a: 'La tradición de K’anba es cruzar la caverna llevando una vela de cera encendida en la mano, lo que crea una atmósfera mística e inolvidable. Adicionalmente, los guías llevan linternas acuáticas profesionales de respaldo para garantizar visibilidad en cascadas y pasos de roca.'
    },
    {
      q: '¿Hay casilleros para guardar mochilas, teléfonos y pertenencias?',
      a: 'Sí. En la recepción y cafetería antes de descender al río contamos con casilleros seguros y resguardo de equipaje. Recomendamos no ingresar a la cueva con celulares o cámaras que no sean 100% sumergibles con cordón de seguridad.'
    },
    {
      q: '¿Qué ropa y calzado se recomienda llevar?',
      a: 'Ropa cómoda que se pueda mojar por completo (licra, traje de baño, camiseta de secado rápido) y calzado acuático cerrado o zapatillas deportivas con buen agarre. Por seguridad están estrictamente prohibidas las sandalias abiertas, chanclas o entrar descalzo.'
    },
    {
      q: '¿Qué ocurre si llueve el día de mi tour?',
      a: 'Una lluvia tropical ligera no suspende la actividad. Sin embargo, si se presentan crecidas extraordinarias del río Cahabón que alteren el caudal de la cueva, la seguridad es primero: el acceso se suspende y se te ofrece reprogramar tu fecha sin costo o el reembolso íntegro del 100%.'
    }
  ];

  function renderAccordions(id, items, dark) {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    let list = Array.isArray(items) && items.length > 0 ? items : null;
    if (!list) {
      if (id === 'policiesAccordion') list = DEFAULT_POLICIES;
      else if (id === 'faqAccordion') list = DEFAULT_FAQ;
    }
    if (!list) return;
    wrap.replaceChildren();
    if (dark) wrap.classList.add('accordion-dark');
    list.forEach((item, index) => {
      const title = item.title || item.q || '';
      const meta = item.summary || '';
      const bullets = Array.isArray(item.items) ? item.items : null;
      const body = el('div', { className: 'accordion-body' });
      if (item.a) body.append(el('p', { text: item.a }));
      if (bullets) body.append(el('ul', {}, bullets.map((entry) => el('li', { text: entry }))));
      const panel = el('div', { className: 'accordion-panel' }, [body]);
      const trigger = el('button', {
        className: 'accordion-trigger',
        attrs: { type: 'button', 'aria-expanded': index === 0 ? 'true' : 'false' }
      }, [
        el('span', {}, [
          el('h3', { text: title }),
          meta ? el('span', { className: 'trigger-meta', text: meta }) : null
        ]),
        el('span', { className: 'accordion-icon', attrs: { 'aria-hidden': 'true' } })
      ]);
      const wrapper = el('div', { className: 'accordion-item' }, [trigger, panel]);
      trigger.addEventListener('click', () => toggleAccordion(wrapper));
      wrap.append(wrapper);
      if (index === 0) toggleAccordion(wrapper, true);
    });
  }

  function toggleAccordion(item, forceOpen = false) {
    const trigger = $('.accordion-trigger', item);
    const panel = $('.accordion-panel', item);
    if (!trigger || !panel) return;
    const open = forceOpen || !item.classList.contains('open');
    if (open) {
      $$('.accordion-item.open', item.parentElement).forEach((other) => {
        if (other === item) return;
        other.classList.remove('open');
        $('.accordion-trigger', other)?.setAttribute('aria-expanded', 'false');
        const otherPanel = $('.accordion-panel', other);
        if (otherPanel) otherPanel.style.maxHeight = '0px';
      });
    }
    item.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
    panel.style.maxHeight = open ? `${panel.scrollHeight}px` : '0px';
  }

  /* ------------------------------------------------------------------ */
  /* Mapa                                                               */
  /* ------------------------------------------------------------------ */

  function setupMap(mapIntro) {
    const node = $('#map');
    const fallback = $('#mapFallback');
    if (!node) return;
    const showFallback = (err) => {
      if (err) console.warn('Leaflet map error, falling back:', err);
      if (fallback) fallback.hidden = false;
      if (node) node.style.display = 'none';
    };

    // Si Leaflet aún no está disponible (ej. por orden de ejecución o script diferido), reintentar brevemente
    if (!window.L) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (window.L) {
          clearInterval(interval);
          setupMap(mapIntro);
        } else if (attempts >= 25) {
          clearInterval(interval);
          showFallback('Leaflet library not found on window.L');
        }
      }, 100);
      return;
    }

    try {
      if (state.map) {
        state.map.remove();
        state.map = null;
      }
      const lat = Number(mapIntro?.lat ?? 15.537628);
      const lng = Number(mapIntro?.lng ?? -89.955361);
      const map = window.L.map(node, { scrollWheelZoom: false, zoomControl: true }).setView([lat, lng], 13);
      state.map = map;
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(map);

      const kanbaIcon = window.L.divIcon({ className: '', html: '<span class="kanba-pin" aria-hidden="true"></span>', iconSize: [18, 18], iconAnchor: [9, 9] });
      const semucIcon = window.L.divIcon({ className: '', html: '<span class="semuc-pin" aria-hidden="true"></span>', iconSize: [11, 11], iconAnchor: [5, 5] });
      const lanquinIcon = window.L.divIcon({ className: '', html: '<span class="lanquin-pin" aria-hidden="true"></span>', iconSize: [11, 11], iconAnchor: [5, 5] });

      const popup = (title, subtitle) => {
        const wrap = el('div');
        wrap.append(el('strong', { text: title }), el('span', { text: subtitle }));
        return wrap;
      };

      window.L.marker([lat, lng], { icon: kanbaIcon, title: 'K’anba' })
        .addTo(map)
        .bindPopup(popup('K’anba · Cuevas Vivas', mapIntro?.address || 'Lanquín, Alta Verapaz'))
        .openPopup();
      window.L.marker([15.5333, -89.9667], { icon: semucIcon })
        .addTo(map)
        .bindPopup(popup('Semuc Champey', 'Pozas y mirador · 10 min'));
      window.L.marker([15.575, -89.99], { icon: lanquinIcon })
        .addTo(map)
        .bindPopup(popup('Lanquín', 'Salida de pickups y tuk-tuks'));

      if (fallback) fallback.hidden = true;
      if (node) node.style.display = '';
      state.mapReady = true;
      setTimeout(() => map.invalidateSize(), 500);
    } catch (error) {
      showFallback(error);
    }
  }

  function setupMapButtons() {
    const copy = $('#copyCoords');
    if (!copy) return;
    copy.addEventListener('click', async () => {
      const lat = state.site?.mapIntro?.lat ?? 15.537628;
      const lng = state.site?.mapIntro?.lng ?? -89.955361;
      const text = `${lat}, ${lng}`;
      try {
        await navigator.clipboard.writeText(text);
        toast('Coordenadas copiadas.');
      } catch {
        toast(`Coordenadas: ${text}`);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Barra de progreso de scroll                                          */
  /* ------------------------------------------------------------------ */

  function setupScrollProgress() {
    if (document.querySelector('.scroll-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('i');
    bar.append(inner);
    document.body.append(bar);
    let ticking = false;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      inner.style.transform = `scaleX(${max > 0 ? Math.min(1, doc.scrollTop / max) : 0})`;
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Cafetería · flipbook del menú                                        */
  /* ------------------------------------------------------------------ */

  const FB_NAMES = ['Desayunos', 'Almuerzos', 'Cenas', 'Postres', 'Café', 'Frías & cosas de la casa', 'Alcohólicas'];

  function fbClamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fbEndpaper() {
    const back = document.createElement('div');
    back.className = 'flip-back';
    back.innerHTML = '<div class="flip-back-inner"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 35V20a15 15 0 0 1 30 0v15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 31c-4.7-3.6-7-6.8-7-10.4a7 7 0 0 1 14 0c0 3.6-2.3 6.8-7 10.4Z" fill="currentColor"/></svg><strong>EL SENDERO</strong><span>café de la cueva · est. 2019</span></div>';
    return back;
  }

  function setupFlipbook() {
    const wrap = document.getElementById('flipbook');
    if (!wrap) return;
    const surface = document.getElementById('bookSurface');
    const pages = Array.from(surface.querySelectorAll('.flip-page'));
    if (!pages.length) return;
    const prevBtn = document.getElementById('bookPrev');
    const nextBtn = document.getElementById('bookNext');
    const dots = Array.from(wrap.querySelectorAll('.book-dot'));
    const nameEl = document.getElementById('bookName');
    const nowEl = document.getElementById('bookNow');

    /* Número de página grabado en cada hoja */
    pages.forEach((page, i) => {
      const num = document.createElement('span');
      num.className = 'page-number';
      num.textContent = `— ${i + 1} —`;
      page.append(num);
    });

    let index = 0;
    let animating = false;

    function render() {
      pages.forEach((page, i) => {
        page.hidden = i !== index;
        page.classList.toggle('is-current', i === index);
      });
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
        dot.setAttribute('aria-selected', String(i === index));
      });
      if (nameEl) nameEl.textContent = FB_NAMES[index] || '';
      if (nowEl) nowEl.textContent = String(index + 1);
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === pages.length - 1;
    }

    function createLeaf() {
      const leaf = document.createElement('div');
      leaf.className = 'flip-leaf';
      leaf.setAttribute('aria-hidden', 'true');
      const front = pages[index].cloneNode(true);
      front.hidden = false;
      front.classList.add('flip-front');
      front.classList.remove('is-current');
      front.removeAttribute('data-page');
      front.removeAttribute('id');
      front.setAttribute('aria-hidden', 'true');
      leaf.append(front, fbEndpaper());
      surface.append(leaf);
      return leaf;
    }

    function flipTo(target) {
      target = fbClamp(target, 0, pages.length - 1);
      if (animating || target === index) return;
      animating = true;
      const direction = target > index ? 'next' : 'prev';
      const sign = direction === 'next' ? -1 : 1;
      const leaf = createLeaf();
      index = target;
      render();
      // Forzar flujo de estilos y aplicar el giro (con respaldo si rAF no corre)
      const apply = () => {
        leaf.classList.add('flipping');
        leaf.style.transform = `rotateY(${sign * 180}deg)`;
      };
      requestAnimationFrame(apply);
      window.setTimeout(apply, 60);
      window.setTimeout(() => { leaf.remove(); animating = false; }, 720);
    }

    if (prevBtn) prevBtn.addEventListener('click', () => flipTo(index - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => flipTo(index + 1));
    dots.forEach((dot) => dot.addEventListener('click', () => flipTo(Number(dot.dataset.goto))));

    surface.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); flipTo(index + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); flipTo(index - 1); }
    });

    /* Arrastre con mouse o dedo */
    const drag = { active: false, decided: false, direction: null, target: index, startX: 0, startY: 0, width: 1, leaf: null, progress: 0 };

    surface.addEventListener('pointerdown', (event) => {
      if (animating) return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      drag.active = true;
      drag.decided = false;
      drag.direction = null;
      drag.leaf = null;
      drag.progress = 0;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      try { surface.setPointerCapture(event.pointerId); } catch { /* no crítico */ }
    });

    surface.addEventListener('pointermove', (event) => {
      if (!drag.active) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.decided) {
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
        if (Math.abs(dy) >= Math.abs(dx)) { drag.active = false; return; }
        drag.direction = dx < 0 ? 'next' : 'prev';
        drag.target = drag.direction === 'next' ? index + 1 : index - 1;
        if (drag.target < 0 || drag.target >= pages.length) { drag.active = false; return; }
        drag.width = Math.max(160, surface.clientWidth);
        drag.leaf = createLeaf();
        drag.decided = true;
      }
      event.preventDefault();
      const sign = drag.direction === 'next' ? -1 : 1;
      drag.progress = fbClamp(Math.abs(dx) / drag.width, 0, 1);
      drag.leaf.style.transition = 'none';
      drag.leaf.style.transform = `rotateY(${sign * drag.progress * 180}deg)`;
    });

    const endDrag = () => {
      if (!drag.active) return;
      drag.active = false;
      if (!drag.decided) return;
      const { leaf, target, direction, progress } = drag;
      const sign = direction === 'next' ? -1 : 1;
      const complete = progress > 0.36;
      animating = true;
      leaf.style.transition = '';
      leaf.classList.add('flipping');
      leaf.style.transform = complete ? `rotateY(${sign * 180}deg)` : 'rotateY(0deg)';
      if (complete) { index = target; render(); }
      window.setTimeout(() => { leaf.remove(); animating = false; }, 620);
    };
    surface.addEventListener('pointerup', endDrag);
    surface.addEventListener('pointercancel', endDrag);

    render();
  }

  /* ------------------------------------------------------------------ */
  /* Cafetería · Café The Hope (menú, carrito y pago en línea)           */
  /* ------------------------------------------------------------------ */

  function setupCafeOrderSystem() {
    const menuCard = document.getElementById('hopeMenuCard');
    const orderPanel = document.getElementById('cafeOrderPanel');
    if (!menuCard || !orderPanel) return;

    const STORAGE_KEY = 'kanba:cafe_cart_v1';
    let cart = [];
    const selectedVariants = {};

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        cart = saved.filter((item) => item && item.id && Number(item.quantity) > 0);
      }
    } catch {
      cart = [];
    }

    function saveCart() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      } catch { /* almacenamiento no disponible */ }
    }

    const formatQ = (amount) => {
      const n = Number(amount || 0);
      return Number.isInteger(n) ? `${n} Q` : `${n.toFixed(2)} Q`;
    };

    function cartKey(id) {
      return id;
    }

    function addItem(prod, delta = 1) {
      const key = prod.id;
      const existing = cart.find((item) => item.key === key);
      const currentQty = existing ? existing.quantity : 0;
      const targetQty = currentQty + delta;
      if (delta > 0 && typeof prod.stock === 'number' && targetQty > prod.stock) {
        toast(`Solo hay ${prod.stock} disponibles de ${prod.name}.`);
        return;
      }
      if (existing) {
        existing.quantity += delta;
        if (existing.quantity <= 0) {
          cart = cart.filter((item) => item.key !== key);
        }
      } else if (delta > 0) {
        cart.push({
          key,
          id: prod.id,
          name: prod.name,
          displayName: prod.name,
          price: Number(prod.price),
          category: prod.category || '',
          stock: typeof prod.stock === 'number' ? prod.stock : null,
          quantity: delta
        });
      }
      saveCart();
      const receiptBox = document.getElementById('cafeReceiptBox');
      if (receiptBox && !receiptBox.hidden && cart.length > 0) {
        receiptBox.hidden = true;
      }
      renderCafeCart();
    }

    function renderCafeCart() {
      const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const net = Math.round((totalAmount / 1.12) * 100) / 100;
      const tax = Math.round((totalAmount - net) * 100) / 100;

      // Actualizar contadores en cada fila del menú
      $$('.hope-item', menuCard).forEach((row) => {
        const id = row.dataset.itemId;
        const qtyForId = cart
          .filter((item) => item.id === id)
          .reduce((sum, item) => sum + item.quantity, 0);
        const qtyNode = row.querySelector(`[data-qty-for="${id}"]`);
        const minusBtn = row.querySelector('[data-action="minus"]');
        const plusBtn = row.querySelector('[data-action="plus"]');
        if (qtyNode) qtyNode.textContent = String(qtyForId);
        if (minusBtn) minusBtn.disabled = qtyForId <= 0;
        if (plusBtn) plusBtn.textContent = qtyForId > 0 ? '+' : '+ Pedir';
        row.classList.toggle('in-cart', qtyForId > 0);
      });

      // Badges y barra móvil
      setText('cafeCartBadge', `${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}`);
      setText('heroCartCount', String(totalItems));
      const mobileLabel = document.getElementById('mobileCafeLabel');
      const mobileTotal = document.getElementById('mobileCafeTotal');
      const mobileBtn = document.getElementById('mobileCafeBtn');
      if (mobileLabel && mobileTotal) {
        if (totalItems > 0) {
          mobileLabel.textContent = `Tu pedido (${totalItems})`;
          mobileTotal.textContent = formatQ(totalAmount);
          if (mobileBtn) mobileBtn.textContent = 'Pagar pedido';
        } else {
          mobileLabel.textContent = 'Café The Hope';
          mobileTotal.textContent = 'Menú K\'anba';
          if (mobileBtn) mobileBtn.textContent = 'Ver mi pedido';
        }
      }

      const emptyNode = document.getElementById('cafeCartEmpty');
      const contentNode = document.getElementById('cafeCartContent');
      const receiptBox = document.getElementById('cafeReceiptBox');
      const showingReceipt = receiptBox && !receiptBox.hidden;

      if (totalItems === 0) {
        if (contentNode) contentNode.hidden = true;
        if (emptyNode) emptyNode.hidden = Boolean(showingReceipt);
        return;
      }

      if (emptyNode) emptyNode.hidden = true;
      if (contentNode) contentNode.hidden = false;

      const listNode = document.getElementById('cafeCartList');
      if (listNode) {
        listNode.replaceChildren();
        cart.forEach((item) => {
          const li = el('li', { className: 'cafe-cart-row' }, [
            el('div', { className: 'cafe-cart-row-info' }, [
              el('strong', { text: item.displayName }),
              el('small', { text: `${formatQ(item.price)} c/u` })
            ]),
            el('div', { className: 'cafe-cart-row-actions' }, [
              el('button', {
                attrs: { type: 'button', 'aria-label': `Restar ${item.displayName}` },
                text: '−'
              }),
              el('span', { text: String(item.quantity) }),
              el('button', {
                attrs: { type: 'button', 'aria-label': `Sumar ${item.displayName}` },
                text: '+'
              })
            ]),
            el('span', { className: 'cafe-cart-row-sub', text: formatQ(item.price * item.quantity) })
          ]);
          const [btnMinus, btnPlus] = $$('button', li);
          btnMinus?.addEventListener('click', () => addItem(item, -1));
          btnPlus?.addEventListener('click', () => addItem(item, 1));
          listNode.append(li);
        });
      }

      setText('cafeSubtotal', `${net.toFixed(2)} Q`);
      setText('cafeTax', `${tax.toFixed(2)} Q`);
      setText('cafeTotal', formatQ(totalAmount));
      setText('cafeCardSubmitBtnText', `Pagar con tarjeta · ${formatQ(totalAmount)}`);
      setText('cafeCashSubmitBtnText', `Confirmar pedido en efectivo · ${formatQ(totalAmount)}`);
      setText('cafePayBtnText', `Continuar al pago · ${formatQ(totalAmount)}`);
    }

    // Vaciar carrito
    document.getElementById('cafeClearCart')?.addEventListener('click', () => {
      cart = [];
      saveCart();
      renderCafeCart();
      toast('Pedido vaciado.');
    });

    const customerNameInput = document.getElementById('cafeCustomerName');
    customerNameInput?.addEventListener('input', () => setCafeFieldError('customerName', ''));

    // Alternar método de pago: Tarjeta vs Efectivo
    let selectedPaymentMethod = 'card';
    const btnPayCard = document.getElementById('btnPayCard');
    const btnPayCash = document.getElementById('btnPayCash');
    const cardBlock = document.getElementById('cafeCardBlock');
    const cashBlock = document.getElementById('cafeCashBlock');

    function setPaymentMethod(method) {
      selectedPaymentMethod = method;
      if (method === 'card') {
        btnPayCard?.classList.add('is-active');
        btnPayCash?.classList.remove('is-active');
        if (cardBlock) cardBlock.hidden = false;
        if (cashBlock) cashBlock.hidden = true;
      } else {
        btnPayCash?.classList.add('is-active');
        btnPayCard?.classList.remove('is-active');
        if (cardBlock) cardBlock.hidden = true;
        if (cashBlock) cashBlock.hidden = false;
      }
      ['number', 'name', 'expiry', 'cvc'].forEach((f) => setCafeFieldError(f, ''));
      const errBox = document.getElementById('cafePayError');
      if (errBox) errBox.hidden = true;
    }

    btnPayCard?.addEventListener('click', () => setPaymentMethod('card'));
    btnPayCash?.addEventListener('click', () => setPaymentMethod('cash'));

    // Formateo y validación de tarjeta
    const cardNumber = document.getElementById('cafeCardNumber');
    const cardName = document.getElementById('cafeCardName');
    const cardExpiry = document.getElementById('cafeCardExpiry');
    const cardCvc = document.getElementById('cafeCardCvc');

    cardNumber?.addEventListener('input', () => {
      const digits = cardNumber.value.replace(/\D/g, '').slice(0, 19);
      cardNumber.value = digits.replace(/(.{4})/g, '$1 ').trim();
      setCafeFieldError('number', '');
    });
    cardExpiry?.addEventListener('input', () => {
      let digits = cardExpiry.value.replace(/\D/g, '').slice(0, 4);
      if (digits.length >= 3) digits = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      cardExpiry.value = digits;
      setCafeFieldError('expiry', '');
    });
    cardCvc?.addEventListener('input', () => {
      cardCvc.value = cardCvc.value.replace(/\D/g, '').slice(0, 4);
      setCafeFieldError('cvc', '');
    });
    cardName?.addEventListener('input', () => setCafeFieldError('name', ''));

    document.getElementById('cafeFillDemoCard')?.addEventListener('click', () => {
      if (cardNumber) cardNumber.value = '4242 4242 4242 4242';
      if (cardName && !cardName.value.trim()) {
        cardName.value = customerNameInput?.value.trim() || state.user?.name || 'Visitante K’anba';
      }
      if (cardExpiry) cardExpiry.value = '12/29';
      if (cardCvc) cardCvc.value = '123';
      ['number', 'name', 'expiry', 'cvc'].forEach((f) => setCafeFieldError(f, ''));
      toast('Tarjeta de prueba cargada.');
    });

    function setCafeFieldError(field, message) {
      const errNode = orderPanel.querySelector(`[data-cafe-error="${field}"]`);
      if (errNode) errNode.textContent = message || '';
    }

    function luhnCheck(num) {
      const digits = String(num || '').replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let d = Number(digits[i]);
        if (alt) {
          d *= 2;
          if (d > 9) d -= 9;
        }
        sum += d;
        alt = !alt;
      }
      return sum % 10 === 0;
    }

    function validateCafeCheckout() {
      ['customerName', 'number', 'name', 'expiry', 'cvc'].forEach((f) => setCafeFieldError(f, ''));
      let valid = true;

      const custName = customerNameInput?.value.trim() || '';
      if (custName.length < 2) {
        setCafeFieldError('customerName', 'Escribe tu nombre para el pedido.');
        valid = false;
      }

      if (selectedPaymentMethod === 'card') {
        const num = cardNumber?.value.replace(/\s/g, '') || '';
        const holder = cardName?.value.trim() || '';
        const exp = cardExpiry?.value.trim() || '';
        const cvc = cardCvc?.value.trim() || '';

        if (!luhnCheck(num)) {
          setCafeFieldError('number', 'Número de tarjeta inválido.');
          valid = false;
        }
        if (holder.length < 3) {
          setCafeFieldError('name', 'Escribe el nombre del titular.');
          valid = false;
        }
        if (!/^\d{2}\s*\/\s*\d{2}$/.test(exp)) {
          setCafeFieldError('expiry', 'Formato MM/AA.');
          valid = false;
        } else {
          const [mm, yy] = exp.split('/').map((x) => Number(x.trim()));
          if (mm < 1 || mm > 12) {
            setCafeFieldError('expiry', 'Mes inválido.');
            valid = false;
          } else if (new Date(2000 + yy, mm, 1).getTime() <= Date.now()) {
            setCafeFieldError('expiry', 'Tarjeta vencida.');
            valid = false;
          }
        }
        if (!/^\d{3,4}$/.test(cvc)) {
          setCafeFieldError('cvc', 'CVV inválido.');
          valid = false;
        }
      }

      return valid;
    }

    function renderCafeReceipt(order) {
      const receiptBox = document.getElementById('cafeReceiptBox');
      const contentNode = document.getElementById('cafeCartContent');
      const emptyNode = document.getElementById('cafeCartEmpty');
      if (!receiptBox) return;

      if (contentNode) contentNode.hidden = true;
      if (emptyNode) emptyNode.hidden = true;
      receiptBox.hidden = false;

      setText('cafeReceiptCode', order?.code || '—');
      const recNumber = order?.receipt?.number || order?.receiptNumber || '';
      const refCode = order?.payment?.reference || '';
      const metaParts = [];
      if (recNumber && recNumber !== 'null') metaParts.push(`Comprobante ${recNumber}`);
      if (refCode && refCode !== 'null') metaParts.push(`Ref. ${refCode}`);
      setText('cafeReceiptMeta', metaParts.length ? metaParts.join(' · ') : 'Comprobante emitido');
      setText('cafeReceiptTotal', formatQ(order?.total || 0));

      const details = document.getElementById('cafeReceiptDetails');
      if (details) {
        const rows = [];
        const cust = order?.customer || {};
        const custName = (cust.name && cust.name !== 'null') ? cust.name : '';
        if (custName) {
          rows.push(el('div', {}, [el('strong', { text: 'Cliente: ' }), document.createTextNode(custName)]));
        }

        const phone = (cust.phone && cust.phone !== 'null') ? cust.phone : '';
        if (phone) {
          rows.push(el('div', {}, [el('strong', { text: 'Teléfono: ' }), document.createTextNode(phone)]));
        }

        const serviceType = (cust.serviceType && cust.serviceType !== 'null') ? cust.serviceType : '';
        if (serviceType) {
          rows.push(el('div', {}, [el('strong', { text: 'Entrega: ' }), document.createTextNode(serviceType)]));
        }

        const notes = (cust.notes && cust.notes !== 'null') ? String(cust.notes).trim() : '';
        if (notes) {
          rows.push(el('div', {}, [el('strong', { text: 'Notas: ' }), document.createTextNode(notes)]));
        }

        const payment = order?.payment || {};
        const isCash = payment.method === 'cash' || payment.brand === 'Efectivo';
        let payLabel = '';
        if (isCash) {
          payLabel = 'Efectivo';
        } else {
          const brand = (payment.brand && payment.brand !== 'null') ? payment.brand : 'Tarjeta';
          const last4 = (payment.last4 && payment.last4 !== 'null' && payment.last4 !== '—') ? ` ****${payment.last4}` : '';
          payLabel = `${brand}${last4}`;
        }
        rows.push(el('div', {}, [el('strong', { text: 'Pago: ' }), document.createTextNode(payLabel || 'Confirmado')]));

        details.replaceChildren(...rows);
      }

      const itemsList = document.getElementById('cafeReceiptItems');
      if (itemsList) {
        itemsList.replaceChildren();
        (order?.items || []).forEach((item) => {
          const name = item.displayName || item.name || 'Producto';
          itemsList.append(el('li', {}, [
            el('span', { text: `${item.quantity || 1} × ${name}` }),
            el('strong', { text: formatQ(item.subtotal || 0) })
          ]));
        });
      }

      receiptBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.getElementById('cafeOrderForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = document.getElementById('cafePayError');
      if (errorBox) errorBox.hidden = true;

      if (!cart.length) {
        toast('Agrega al menos un producto del menú.');
        return;
      }
      if (!validateCafeCheckout()) return;

      const submitBtn = selectedPaymentMethod === 'cash'
        ? document.getElementById('cafeCashSubmitBtn')
        : document.getElementById('cafeCardSubmitBtn');
      busy(submitBtn, true);

      try {
        const custName = customerNameInput?.value.trim() || '';
        const isCash = selectedPaymentMethod === 'cash';
        const payload = {
          paymentMethod: selectedPaymentMethod,
          items: cart.map((item) => ({
            id: item.id,
            quantity: item.quantity
          })),
          customer: {
            name: custName,
            email: state.user?.email || '',
            phone: document.getElementById('cafeCustomerPhone')?.value.trim() || '',
            serviceType: document.getElementById('cafeServiceType')?.value || 'En mesa · Cafetería',
            notes: document.getElementById('cafeOrderNotes')?.value.trim() || ''
          }
        };

        if (!isCash) {
          payload.card = {
            number: cardNumber?.value.replace(/\s/g, '') || '',
            name: cardName?.value.trim() || custName,
            expiry: cardExpiry?.value.trim() || '',
            cvc: cardCvc?.value.trim() || ''
          };
        }

        const res = await api('/api/cafe/orders', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const orderObj = res.order;
        if (!orderObj) throw new Error('No se recibió la confirmación del pedido.');

        cart = [];
        saveCart();
        renderCafeCart();
        renderCafeReceipt(orderObj);
        toast(`¡Pedido ${orderObj.code} confirmado con éxito!`);
      } catch (error) {
        if (errorBox) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
        }
        if (error.fields) {
          Object.entries(error.fields).forEach(([field, msg]) => setCafeFieldError(field, msg));
        }
      } finally {
        busy(submitBtn, false);
      }
    });

    document.getElementById('cafePrintReceipt')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('cafeNewOrder')?.addEventListener('click', () => {
      const receiptBox = document.getElementById('cafeReceiptBox');
      if (receiptBox) receiptBox.hidden = true;
      renderCafeCart();
    });

    async function loadDynamicMenu() {
      const menuBody = document.getElementById('hopeMenuBody');
      const tabsWrap = document.getElementById('cafeCategoryTabs');
      if (menuBody) renderCafeMenuSkeleton(menuBody, 6);
      try {
        const res = await api('/api/cafe/menu');
        const items = res?.items;
        if (!Array.isArray(items) || !items.length) {
          if (menuBody) {
            menuBody.innerHTML = '<div class="cafe-empty-state" style="padding: 2.5rem 1rem; text-align: center; color: var(--muted, #666);"><p>Por el momento no hay productos registrados en el menú de cafetería.</p></div>';
          }
          if (tabsWrap) {
            tabsWrap.replaceChildren();
            const allBtn = document.createElement('button');
            allBtn.className = 'cafe-cat-tab is-active';
            allBtn.type = 'button';
            allBtn.role = 'tab';
            allBtn.setAttribute('aria-selected', 'true');
            allBtn.dataset.cafeTab = 'all';
            allBtn.textContent = 'Todo el menú';
            tabsWrap.append(allBtn);
          }
          renderCafeCart();
          return;
        }
        if (!menuBody) return;

        const categories = {};
        for (const it of items) {
          const cat = it.category || 'Otros';
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(it);
        }

        if (tabsWrap) {
          tabsWrap.replaceChildren();
          const allBtn = document.createElement('button');
          allBtn.className = 'cafe-cat-tab is-active';
          allBtn.type = 'button';
          allBtn.role = 'tab';
          allBtn.setAttribute('aria-selected', 'true');
          allBtn.dataset.cafeTab = 'all';
          allBtn.textContent = 'Todo el menú';
          tabsWrap.append(allBtn);

          for (const cat of Object.keys(categories)) {
            const btn = document.createElement('button');
            btn.className = 'cafe-cat-tab';
            btn.type = 'button';
            btn.role = 'tab';
            btn.setAttribute('aria-selected', 'false');
            btn.dataset.cafeTab = cat;
            btn.textContent = cat;
            tabsWrap.append(btn);
          }

          $$('[data-cafe-tab]', tabsWrap).forEach((tabBtn) => {
            tabBtn.addEventListener('click', () => {
              const targetCat = tabBtn.dataset.cafeTab || 'all';
              $$('[data-cafe-tab]', tabsWrap).forEach((b) => {
                const active = b === tabBtn;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', String(active));
              });
              $$('[data-category-section]', menuCard).forEach((sec) => {
                sec.hidden = targetCat !== 'all' && sec.dataset.categorySection !== targetCat;
              });
            });
          });
        }

        menuBody.replaceChildren();
        for (const [catName, prodList] of Object.entries(categories)) {
          const sec = document.createElement('section');
          sec.className = 'hope-category';
          sec.dataset.categorySection = catName;
          const h3 = document.createElement('h3');
          h3.textContent = catName;
          const ul = document.createElement('ul');
          ul.className = 'hope-list';

          for (const p of prodList) {
            const li = document.createElement('li');
            li.className = 'hope-item';
            li.dataset.itemId = p.id;
            li.dataset.itemName = p.name;
            li.dataset.itemPrice = String(p.price);
            li.dataset.itemCategory = p.category;
            if (typeof p.stock === 'number') li.dataset.itemStock = String(p.stock);

            const isOutOfStock = typeof p.stock === 'number' && p.stock <= 0;

            const main = document.createElement('div');
            main.className = 'hope-item-main';
            main.innerHTML = `<span class="hope-bullet" aria-hidden="true">•</span>`;

            const nameWrap = document.createElement('div');
            nameWrap.className = 'hope-name-wrap';
            const badgeHtml = isOutOfStock ? ' <span class="badge badge-gray" style="font-size:9.5px;margin-left:6px;padding:2px 7px;">Agotado</span>' : '';
            nameWrap.innerHTML = `<span class="hope-name">${p.name}: <strong class="hope-price">${p.price} Q</strong>${badgeHtml}</span>`;
            main.append(nameWrap);

            const controls = document.createElement('div');
            controls.className = 'hope-item-controls';
            if (isOutOfStock) {
              controls.innerHTML = `<span style="font-size:11px;color:var(--muted);font-weight:600;padding:4px 8px;">Sin stock</span>`;
            } else {
              controls.innerHTML = `
                <button type="button" class="hope-qty-btn hope-minus" data-action="minus" aria-label="Quitar ${p.name}" disabled>−</button>
                <span class="hope-qty-val" data-qty-for="${p.id}">0</span>
                <button type="button" class="hope-qty-btn hope-plus" data-action="plus" aria-label="Agregar ${p.name}">+ Pedir</button>
              `;

              const minusBtn = controls.querySelector('[data-action="minus"]');
              const plusBtn = controls.querySelector('[data-action="plus"]');

              plusBtn?.addEventListener('click', () => {
                addItem(p, 1);
              });

              minusBtn?.addEventListener('click', () => {
                const match = cart.find(item => item.id === p.id);
                if (match) addItem(match, -1);
              });
            }

            li.append(main, controls);
            ul.append(li);
          }

          sec.append(h3, ul);
          menuBody.append(sec);
        }

        renderCafeCart();
      } catch {
        if (menuBody) {
          menuBody.innerHTML = '<div class="cafe-empty-state" style="padding: 2.5rem 1rem; text-align: center; color: var(--muted, #666);"><p>No se pudo cargar el menú de cafetería en este momento.</p></div>';
        }
      }
    }

    loadDynamicMenu();
    renderCafeCart();
  }

  function prefillCafeUser() {
    if (!state.user) return;
    const nameInput = document.getElementById('cafeCustomerName');
    const phoneInput = document.getElementById('cafeCustomerPhone');
    if (nameInput && !nameInput.value) nameInput.value = state.user.name || '';
    if (phoneInput && !phoneInput.value) phoneInput.value = state.user.phone || '';
  }

  /* ------------------------------------------------------------------ */
  /* Teclado global                                                     */
  /* ------------------------------------------------------------------ */

  function setupKeyboard() {
    document.addEventListener('keydown', (event) => {
      const lightbox = $('#lightbox');
      const video = $('#videoModal');
      if (event.key === 'Escape') {
        if (lightbox && !lightbox.hidden) closeLightbox();
        if (video && !video.hidden) closeVideo();
      }
      if (lightbox && !lightbox.hidden) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); moveLightbox(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); moveLightbox(1); }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Arranque                                                           */
  /* ------------------------------------------------------------------ */

  async function init() {
    setupHeader();
    setupWizard();
    setupScrollProgress();
    setupFlipbook();
    setupCafeOrderSystem();
    setupLightbox();
    setupVideoModal();
    setupMapButtons();
    setupKeyboard();
    setText('year', String(new Date().getFullYear()));
    renderToursSkeleton();
    renderGallerySkeleton();
    renderAccordionsSkeleton('policiesAccordion', 4, true);
    renderAccordionsSkeleton('faqAccordion', 5, false);
    await loadAuth();
    prefillCafeUser();

    try {
      const site = await api('/api/site');
      applyContent(site);
      const presetTour = new URLSearchParams(window.location.search).get('tour');
      if (presetTour && state.tours.some((t) => t.id === presetTour) && $('#tourOptions')) {
        await selectTour(presetTour);
      }
    } catch (error) {
      const tours = $('#toursGrid');
      if (tours) tours.replaceChildren(el('p', { className: 'loading-line', text: 'No pudimos cargar el contenido. Verifica tu conexión y recarga la página.' }));
      const gallery = $('#galleryGrid');
      if (gallery) gallery.replaceChildren(el('p', { className: 'loading-line', text: 'La galería no está disponible en este momento.' }));
      renderAccordions('policiesAccordion', null, true);
      renderAccordions('faqAccordion', null, false);
      toast('No pudimos cargar el contenido del sitio.');
      console.error(error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
