/* ==========================================================================
   K’anba · acceso con roles (usuario / administración)
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  const form = $('#loginForm');
  if (!form) return;

  const nextInput = $('#nextUrl');
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (nextInput && next) nextInput.value = next;

  let role = 'user';

  const panels = {
    user: $('#panel-user'),
    register: $('#panel-register'),
    admin: $('#panel-admin')
  };

  const errors = {
    user: $('#userError'),
    register: $('#regError'),
    admin: $('#adminError')
  };

  function showError(box, message) {
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  function clearErrors() {
    Object.values(errors).forEach((box) => {
      if (!box) return;
      box.textContent = '';
      box.hidden = true;
    });
  }

  function setActivePanel(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('is-active', key === name);
    });
    clearErrors();
  }

  function setRole(nextRole) {
    role = nextRole;
    document.querySelectorAll('.login-tab').forEach((tab) => {
      const active = tab.dataset.role === nextRole;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    setActivePanel(nextRole === 'admin' ? 'admin' : 'user');
  }

  function redirectAfterLogin() {
    const target = nextInput?.value;
    if (target && target.startsWith('/')) {
      window.location.href = target;
      return;
    }
    window.location.href = '/';
  }

  function busy(button, on) {
    if (!button) return;
    button.disabled = on;
    button.dataset.busy = on ? '1' : '';
  }

  async function api(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch { /* noop */ }
    if (!res.ok) {
      const err = new Error(data?.error?.message || data?.message || 'No pudimos completar la solicitud.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function submitUser(event) {
    event.preventDefault();
    clearErrors();
    const email = $('#userEmail')?.value.trim() || '';
    const password = $('#userPassword')?.value || '';
    const button = $('#userSubmit');
    busy(button, true);
    try {
      await api('/api/auth/login', { email, password });
      redirectAfterLogin();
    } catch (err) {
      showError(errors.user, err.message);
      busy(button, false);
    }
  }

  async function submitRegister(event) {
    event.preventDefault();
    clearErrors();
    const name = $('#regName')?.value.trim() || '';
    const email = $('#regEmail')?.value.trim() || '';
    const password = $('#regPassword')?.value || '';
    const button = $('#regSubmit');
    busy(button, true);
    try {
      await api('/api/auth/register', { name, email, password });
      redirectAfterLogin();
    } catch (err) {
      showError(errors.register, err.message);
      busy(button, false);
    }
  }

  async function submitAdmin(event) {
    event.preventDefault();
    clearErrors();
    const password = $('#adminPassword')?.value || '';
    const button = $('#adminSubmit');
    busy(button, true);
    try {
      await api('/api/admin/login', { password });
      window.location.href = '/admin.html';
    } catch (err) {
      showError(errors.admin, err.message);
      busy(button, false);
    }
  }

  // El formulario tiene varios botones; se resuelve el submit según el panel activo.
  form.addEventListener('submit', (event) => {
    if (!panels.user.classList.contains('is-active')) return;
    submitUser(event);
  });

  document.querySelectorAll('.login-tab').forEach((tab) => {
    tab.addEventListener('click', () => setRole(tab.dataset.role));
  });

  $('#goRegister')?.addEventListener('click', () => setActivePanel('register'));
  $('#goLogin')?.addEventListener('click', () => setRole('user'));

  // Botones que no disparan el submit general del formulario
  $('#regSubmit')?.addEventListener('click', submitRegister);
  $('#adminSubmit')?.addEventListener('click', submitAdmin);

  // Si llega ?role=admin, abre directamente el panel de administración.
  if (params.get('role') === 'admin') setRole('admin');
})();
