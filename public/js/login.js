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

  // Conserva el destino (?next=...) al iniciar sesión con Google.
  const googleSignIn = $('#googleSignIn');
  if (googleSignIn) {
    googleSignIn.href = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  }

  const panels = {
    user: $('#panel-user'),
    register: $('#panel-register')
  };

  const errors = {
    user: $('#userError'),
    register: $('#regError')
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
    return 'user';
  }

  function setActivePanel(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('is-active', key === name);
    });
    setBusy(false);
    clearErrors();
  }

  function redirectAfterLogin(data) {
    const target = data?.redirectTo;
    if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') &&
        !target.includes('\\') && new URL(target, window.location.origin).origin === window.location.origin) {
      window.location.replace(target);
    }
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
      setBusy(false);
      return;
    }
    redirectAfterLogin(await api('/api/auth/login', { email, password }));
  }

  async function submitRegister() {
    const name = $('#regName')?.value.trim() || '';
    const email = $('#regEmail')?.value.trim() || '';
    const password = $('#regPassword')?.value || '';
    if (!name || !email || !password) {
      showError(errors.register, 'Completa nombre, correo y contraseña.');
      setBusy(false);
      return;
    }
    redirectAfterLogin(await api('/api/auth/register', { name, email, password }));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const panel = activePanel();
    setBusy(true);
    try {
      if (panel === 'register') await submitRegister();
      else await submitUser();
    } catch (err) {
      if (panel === 'register') showError(errors.register, err.message);
      else showError(errors.user, err.message);
      setBusy(false);
    }
  });

  $('#goRegister')?.addEventListener('click', () => setActivePanel('register'));
  $('#goLogin')?.addEventListener('click', () => setActivePanel('user'));

  $('#backButton')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  });


  // Mensajes cuando el flujo de Google regresa con error.
  const GOOGLE_ERRORS = {
    google_token_timeout: 'Google no respondió a tiempo. Inicia un nuevo intento.',
    google_token_network_failed: 'No pudimos conectar con Google. Inicia un nuevo intento.',
    google_token_unavailable: 'Google no está disponible temporalmente. Espera e inicia un nuevo intento.',
    google_token_invalid_response: 'Recibimos una respuesta no válida de Google. Inicia un nuevo intento.',
    google_token_request_rejected: 'Google rechazó la solicitud de acceso. Contacta al administrador.',
    google_code_missing: 'Google no devolvió el código de autorización. Inicia de nuevo desde el botón de Google.',
    google_client_rejected: 'Google rechazó la configuración de acceso de la aplicación. Contacta al administrador.',
    google_code_rejected: 'El código de Google expiró, ya fue utilizado o no corresponde a esta solicitud. Inicia un nuevo intento.',
    google_token_exchange_failed: 'No pudimos completar el intercambio con Google. Inicia un nuevo intento.',
    google_profile_failed: 'No pudimos obtener un perfil válido de Google. Inicia un nuevo intento.',
    google_unconfigured: 'El inicio de sesión con Google aún no está disponible. Usa tu correo y contraseña.',
    google_cancelled: 'Cancelaste el inicio de sesión con Google.',
    google_state: 'La sesión de Google expiró. Inténtalo de nuevo.',
    google_failed: 'No pudimos completar el inicio de sesión con Google. Inténtalo de nuevo.',
    google_email_unverified: 'El correo de tu cuenta de Google no está verificado.'
  };
  const googleError = params.get('error');
  if (googleError && GOOGLE_ERRORS[googleError]) {
    setActivePanel('user');
    showError(errors.user, GOOGLE_ERRORS[googleError]);
  }

  // Si el usuario ya tiene sesión iniciada y entra a login.html, redirigir
  (async () => {
    if (googleError) return; // Keep the OAuth error visible; do not hide it with an existing session.
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.authenticated && data.user) {
          redirectAfterLogin(data);
        }
      }
    } catch { /* noop */ }
  })();

  initPasswordToggles();
})();
