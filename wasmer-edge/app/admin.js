(() => {
  const form = document.querySelector('#login-form');
  const error = document.querySelector('#login-error');
  const activeSession = document.querySelector('#active-session');
  const switchButton = document.querySelector('#switch-account');
  const submitButton = form.querySelector('button[type="submit"]');
  const destination = role => ['tu', 'principal'].includes(role) ? 'tu.html' : null;

  async function checkSession() {
    submitButton.disabled = true;
    try {
      const response = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Sesi belum dapat diperiksa.');
      const session = await response.json();
      const authenticated = session.authenticated && !!destination(session.role);
      form.classList.toggle('hidden', authenticated);
      activeSession.classList.toggle('hidden', !authenticated);
      document.querySelector('#active-account').textContent = authenticated
        ? `Anda sedang masuk sebagai ${session.role === 'tu' ? 'Tata Usaha' : 'Kepala Sekolah'}.` : '';
    } catch {
      error.textContent = 'Sesi belum dapat diperiksa. Anda dapat mencoba login kembali.';
    } finally {
      submitButton.disabled = false;
    }
  }

  async function switchAccount() {
    if (switchButton.disabled) return;
    const message = document.querySelector('#switch-error');
    switchButton.disabled = true;
    submitButton.disabled = true;
    message.textContent = '';
    try {
      const response = await fetch('/api/logout', { method: 'POST', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Logout gagal.');
      activeSession.classList.add('hidden');
      form.classList.remove('hidden');
      form.reset();
      error.textContent = '';
      history.replaceState(null, '', 'admin.html');
      form.elements.username.focus();
    } catch {
      activeSession.classList.remove('hidden');
      form.classList.add('hidden');
      message.textContent = 'Belum berhasil keluar. Periksa koneksi lalu tekan Ganti akun kembali.';
    } finally {
      switchButton.disabled = false;
      submitButton.disabled = false;
    }
  }
  switchButton.addEventListener('click', switchAccount);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const data = new FormData(form);
    button.disabled = true;
    button.textContent = 'Memeriksa…';
    error.textContent = '';
    try {
      const response = await fetch('/api/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: data.get('username'), password: data.get('password')}),
        signal: AbortSignal.timeout(45000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Login gagal.');
      const target = destination(result.role);
      if (!target) throw new Error('Peran akun tidak tersedia. Hubungi administrator sekolah.');
      form.reset();
      window.location.replace(target);
    } catch (failure) {
      error.textContent = ['TypeError', 'NetworkError', 'TimeoutError', 'AbortError'].includes(failure.name)
        ? 'Koneksi login terputus. Periksa koneksi lalu coba kembali.' : failure.message;
      form.elements.password.value = '';
      form.elements.password.focus();
    } finally {
      button.disabled = false;
      button.textContent = 'Masuk';
    }
  });
  if (new URLSearchParams(window.location.search).get('switch') === '1') {
    form.classList.add('hidden');
    switchAccount();
  } else {
    checkSession();
  }
  window.addEventListener('pageshow', event => {if (event.persisted) checkSession();});
})();