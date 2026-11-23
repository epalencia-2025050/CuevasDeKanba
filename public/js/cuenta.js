(() => {
  const byId = id => document.getElementById(id);
  const status = byId('accountStatus');
  function element(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }
  function link(text, href) {
    const node = element('a', text);
    node.href = href;
    return node;
  }
  function profile(user) {
    byId('accountName').textContent = user.name;
    byId('email').textContent = user.email;
    const contact = [user.phone, user.country].filter(Boolean).join(' · ');
    byId('contact').textContent = contact;
    byId('contact').hidden = !contact;
    byId('initials').textContent = (user.name || user.email).trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    if (!user.avatar) return;
    let url;
    try { url = new URL(user.avatar, window.location.origin); } catch { return; }
    if (url.origin !== window.location.origin && !(url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com'))) return;
    const image = byId('photo');
    image.onload = () => { image.hidden = false; };
    image.onerror = () => { image.hidden = true; };
    image.src = url.href;
  }
  function reservations(rows, today, user) {
    const labels = { confirmed: 'Confirmada', pending_payment: 'Pendiente de pago', expired: 'Vencida', cancelled: 'Cancelada' };
    const emailParam = user?.email ? '&email=' + encodeURIComponent(user.email) : '';
    for (const row of rows) {
      const active = row.status === 'pending_payment' || (row.status === 'confirmed' && row.date >= today);
      const group = row.status === 'cancelled' ? 'cancelled' : active ? 'active' : 'history';
      const tokenParam = row.token ? '&token=' + encodeURIComponent(row.token) : '';
      const card = document.createElement('article');
      card.append(element('strong', row.tourName), element('p', [row.date, row.time].filter(Boolean).join(' · ')),
        element('p', [labels[row.status] || row.status, row.code].join(' · ')),
        link(active ? 'Consultar o cancelar' : 'Consultar reserva', `/mi-reserva.html?code=${encodeURIComponent(row.code)}${tokenParam}${emailParam}`));
      byId(group).append(card);
    }
    byId('historySection').hidden = !byId('history').childElementCount;
    if (!byId('active').childElementCount) byId('active').append(element('p', 'No tienes reservas activas.'), link('Reservar un tour', '/reservar.html'));
    if (!byId('cancelled').childElementCount) byId('cancelled').append(element('p', 'No tienes reservas canceladas.'));
  }
  async function load() {
    try {
      const response = await fetch('/api/auth/dashboard', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/login.html'); return; }
      if (!response.ok) throw new Error('No pudimos cargar tu cuenta. Recarga para intentarlo de nuevo.');
      const data = await response.json();
      profile(data.user);
      reservations(data.reservations, data.today, data.user);
      byId('accountContent').hidden = false;
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
  }
  byId('accountLogout').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('No se pudo cerrar la sesión. Intenta de nuevo.');
      byId('accountContent').hidden = true;
      window.location.replace('/login.html');
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  load();
})();
