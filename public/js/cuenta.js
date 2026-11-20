(() => {
  const status = document.getElementById('accountStatus');
  const list = document.getElementById('accountReservations');
  async function load() {
    try {
      const response = await fetch('/api/auth/dashboard', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/login.html'); return; }
      if (!response.ok) throw new Error('No pudimos cargar tu cuenta. Recarga para intentarlo de nuevo.');
      const data = await response.json();
      if (data.redirectTo !== '/cuenta.html') { window.location.replace('/cuenta.html'); return; }
      document.getElementById('accountName').textContent = data.user.name;
      list.replaceChildren();
      for (const reservation of data.reservations) {
        const item = document.createElement('li');
        item.textContent = `${reservation.code} · ${reservation.tourName} · ${reservation.date} ${reservation.time} · ${reservation.status}`;
        list.append(item);
      }
      status.textContent = data.reservations.length ? '' : 'Todavía no tienes reservas.';
    } catch (error) { status.textContent = error.message; }
  }
  document.getElementById('accountLogout').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('No se pudo cerrar la sesión. Intenta de nuevo.');
      list.replaceChildren();
      document.getElementById('accountName').textContent = '';
      window.location.replace('/login.html');
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  load();
})();
