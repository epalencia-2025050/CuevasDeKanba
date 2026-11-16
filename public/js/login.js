/* ==========================================================================
   K’anba · Controlador de Login (Usuario / Administrador)
   Integrado con la estética y flujo del sitio K'anba Cuevas Vivas
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  // --------------------------------------------------------------------------
  // Password Visibility Toggle
  // --------------------------------------------------------------------------
  function initPasswordToggles() {
    document.querySelectorAll('.pw-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        const eyeOpen = btn.querySelector('.eye-open');
        const eyeClosed = btn.querySelector('.eye-closed');
        if (eyeOpen && eyeClosed) {
          eyeOpen.hidden = isPassword;
          eyeClosed.hidden = !isPassword;
        }
        btn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
      });
    });
  }

  // --------------------------------------------------------------------------
  // Lógica de Autenticación y Formularios
  // --------------------------------------------------------------------------
  const form = $('#loginForm');
  if (!form) return;

  const nextInput = $('#nextUrl');
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (nextInput && next) nextInput.value = next;

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

  const successes = {
    user: $('#userSuccess'),
    register: $('#regSuccess')
  };

  function showError(box, message) {
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  function showSuccess(box, message) {
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
    Object.values(successes).forEach((box) => {
      if (!box) return;
      box.textContent = '';
      box.hidden = true;
    });
  }

  function activePanel() {
    if (panels.register?.classList.contains('is-active')) return 'register';
    if (panels.admin?.classList.contains('is-active')) return 'admin';
    return 'user';
  }

  function setActivePanel(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('is-active', key === name);
    });
    document.querySelectorAll('.login-tab').forEach((tab) => {
      const active =
        (name === 'admin' && tab.dataset.role === 'admin') ||
        ((name === 'user' || name === 'register') && tab.dataset.role === 'user');
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    clearErrors();
  }

  function setRole(nextRole) {
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

  function setBusy(on) {
    form.querySelectorAll('button[type="submit"]').forEach((button) => {
      button.disabled = on;
      if (on) button.classList.add('is-loading');
      else button.classList.remove('is-loading');
    });
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

  async function submitUser() {
    const email = $('#userEmail')?.value.trim() || '';
    const password = $('#userPassword')?.value || '';
    if (!email || !password) {
      showError(errors.user, 'Ingresa tu correo y contraseña.');
      return;
    }
    await api('/api/auth/login', { email, password });
    redirectAfterLogin();
  }

  async function submitRegister() {
    const name = $('#regName')?.value.trim() || '';
    const email = $('#regEmail')?.value.trim() || '';
    const password = $('#regPassword')?.value || '';
    if (!name || !email || !password) {
      showError(errors.register, 'Completa nombre, correo y contraseña.');
      return;
    }
    await api('/api/auth/register', { name, email, password });

    // Redirigir al panel de iniciar sesión con correo prellenado y mensaje
    setActivePanel('user');
    const userEmailInput = $('#userEmail');
    if (userEmailInput) {
      userEmailInput.value = email;
    }
    const userPwInput = $('#userPassword');
    if (userPwInput) {
      userPwInput.value = '';
      userPwInput.focus();
    }
    showSuccess(successes.user, '¡Cuenta creada con éxito! Ingresa tu contraseña para iniciar sesión.');
  }

  async function submitAdmin() {
    const password = $('#adminPassword')?.value || '';
    if (!password) {
      showError(errors.admin, 'Ingresa la contraseña de administración.');
      return;
    }
    await api('/api/admin/login', { password });
    window.location.href = '/admin.html';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const panel = activePanel();
    setBusy(true);
    try {
      if (panel === 'register') await submitRegister();
      else if (panel === 'admin') await submitAdmin();
      else await submitUser();
    } catch (err) {
      if (panel === 'register') showError(errors.register, err.message);
      else if (panel === 'admin') showError(errors.admin, err.message);
      else showError(errors.user, err.message);
      setBusy(false);
    }
  });

  document.querySelectorAll('.login-tab').forEach((tab) => {
    tab.addEventListener('click', () => setRole(tab.dataset.role));
  });

  $('#goRegister')?.addEventListener('click', () => setActivePanel('register'));
  $('#goLogin')?.addEventListener('click', () => setActivePanel('user'));

  $('#backButton')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  });

  if (params.get('role') === 'admin') setRole('admin');

  // Si el usuario ya tiene sesión iniciada y entra a login.html, redirigir
  (async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.authenticated && data.user) {
          redirectAfterLogin();
        }
      }
    } catch { /* noop */ }
  })();

  initPasswordToggles();
})();
