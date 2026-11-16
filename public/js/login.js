/* ==========================================================================
   K’anba · Glass Login Controller + WebGL Flame Canvas + Dragging
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  // --------------------------------------------------------------------------
  // WebGL Flame Shader (inspirado en el componente GlassLogin con ambiente cueva)
  // --------------------------------------------------------------------------
  function initFlameCanvas() {
    const canvas = document.getElementById('flameCanvas');
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return;

    const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
    const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;

float hash(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; }
  return v;
}

// Chispas y ascuas flotando estilo vela en cueva
float embers(vec2 p, float t){
  float acc = 0.;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float density = 5. + fl * 4.;
    vec2 g = p * density;
    g.y -= t * (.8 + fl * .35);
    g.x += sin(g.y * .45 + fl * 2.1 + t * .3) * .55;
    vec2 id = floor(g), f = fract(g) - .5;
    float r = hash(id + fl * 13.7);
    if (r < .62) continue;
    vec2 o = (vec2(hash(id + 3.1), hash(id + 7.7)) - .5) * .6;
    float d = length(f - o) / density;
    float twinkle = .55 + .45 * sin(t * (3. + r * 5.) + r * 50.);
    float size = .0018 + .0018 * hash(id + 9.3);
    acc += smoothstep(size * 2.6, 0., d) * twinkle * (1.2 - fl * .25);
  }
  return acc;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - .5) * max(ar, 1.), uv.y);
  float t = uTime * .32;

  // Domain warp simulando el calor de las velas subiendo en la cueva
  vec2 w = vec2(fbm(p * 1.6 + vec2(0., -t * .26)), fbm(p * 1.6 + vec2(4.1, -t * .22)));
  float n = fbm(vec2(p.x * 2.2, p.y * 1.4) + w * 2. + vec2(0., -t * .75));

  float height = uv.y * 1.6 + abs(uv.x - .5) * .45;
  float flame = clamp(n * 1.45 - height + .08, 0., 1.);

  // Paleta de cueva: cálidos ámbar/fuego de vela con toques de río esmeralda profundo
  vec3 col = mix(vec3(.035, .015, .01), vec3(.01, .012, .01), uv.y);
  vec3 fire = vec3(.35, .05, .02) * smoothstep(.0, .05, flame);
  fire = mix(fire, vec3(.65, .1, .03), smoothstep(.06, .16, flame));
  fire = mix(fire, vec3(.95, .35, .04), smoothstep(.18, .3, flame));
  fire = mix(fire, vec3(1., .68, .16), smoothstep(.34, .48, flame));
  fire = mix(fire, vec3(1., .88, .65), smoothstep(.62, .85, flame));

  // Tono verde/azulado místico en el fondo inferior (reflejo de las pozas de agua viva)
  float mysticalGaze = smoothstep(.0, .14, flame - .28 - uv.y * 2.2);
  fire = mix(fire, mix(vec3(.04, .25, .2), vec3(.3, .7, .45), smoothstep(.2, .7, flame - uv.y * 2.2)), mysticalGaze);
  col += fire * (.45 + .4 * smoothstep(.0, .5, flame));

  // Ambient bloom
  float bloom = fbm(p * .65 + vec2(t * .03, -t * .05));
  col += vec3(.38, .12, .04) * bloom * bloom * smoothstep(1.1, .2, uv.y) * .55;

  float e = embers(p, t) * smoothstep(1.05, .1, uv.y);
  col += mix(vec3(1., .6, .2), vec3(.6, .85, .5), step(.7, fbm(p * 3. + 11.))) * e;

  col += (hash(gl_FragCoord.xy + fract(t)) - .5) / 255.;
  gl_FragColor = vec4(col, 1.);
}`;

    const compileShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = performance.now();
    let time = 12;
    let raf = 0;

    const draw = () => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let last = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / 24 - 2) return;
      last = now;
      time = 12 + (now - start) / 1000;
      draw();
    };

    const play = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches) draw();
      else raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(() => {
      const s = Math.min(window.devicePixelRatio || 1, 2) * 0.45;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * s));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    });

    ro.observe(canvas);
    reduce.addEventListener('change', play);
    play();
  }

  // --------------------------------------------------------------------------
  // Dragging interactivo de la tarjeta de cristal
  // --------------------------------------------------------------------------
  function initGlassCardDrag() {
    const card = document.getElementById('glassCard');
    if (!card) return;

    let offset = { x: 0, y: 0 };
    let drag = null;

    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // No arrastrar si se hizo clic en inputs, botones, enlaces o selectores
      if (e.target.closest('input, button, a, label, textarea, select')) return;

      e.preventDefault();
      card.setPointerCapture(e.pointerId);
      card.classList.add('is-dragging');
      drag = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    });

    card.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const parent = card.parentElement;
      if (!parent) return;

      const deltaX = e.clientX - drag.px;
      const deltaY = e.clientY - drag.py;

      // Limitar el movimiento para que no se salga de la pantalla
      const limitX = Math.min(180, Math.max(-180, drag.ox + deltaX));
      const limitY = Math.min(180, Math.max(-180, drag.oy + deltaY));

      offset = { x: limitX, y: limitY };
      card.style.transform = `translate3d(${limitX}px, ${limitY}px, 0)`;
    });

    const stopDrag = () => {
      if (!drag) return;
      drag = null;
      card.classList.remove('is-dragging');
    };

    card.addEventListener('pointerup', stopDrag);
    card.addEventListener('pointercancel', stopDrag);
  }

  // --------------------------------------------------------------------------
  // Password Visibility Toggle
  // --------------------------------------------------------------------------
  function initPasswordToggles() {
    document.querySelectorAll('.toggle-password-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        const eyeIcon = btn.querySelector('.icon-eye');
        const eyeOffIcon = btn.querySelector('.icon-eye-off');
        if (eyeIcon && eyeOffIcon) {
          eyeIcon.hidden = isPassword;
          eyeOffIcon.hidden = !isPassword;
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

  function activePanel() {
    if (panels.register?.classList.contains('is-active')) return 'register';
    if (panels.admin?.classList.contains('is-active')) return 'admin';
    return 'user';
  }

  function setActivePanel(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('is-active', key === name);
    });
    document.querySelectorAll('.glass-tab').forEach((tab) => {
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
      if (on) button.dataset.busy = '1';
      else delete button.dataset.busy;
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
    redirectAfterLogin();
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

  document.querySelectorAll('.glass-tab').forEach((tab) => {
    tab.addEventListener('click', () => setRole(tab.dataset.role));
  });

  $('#goRegister')?.addEventListener('click', () => setActivePanel('register'));
  $('#goLogin')?.addEventListener('click', () => setActivePanel('user'));

  $('#backButton')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  });

  if (params.get('role') === 'admin') setRole('admin');

  // Inicializar efectos visuales interactivos
  initFlameCanvas();
  initGlassCardDrag();
  initPasswordToggles();
})();
