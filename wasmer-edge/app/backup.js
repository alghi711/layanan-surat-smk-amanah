(() => {
  const dialog = document.querySelector('#backup-dialog');
  if (!dialog) return;
  const message = dialog.querySelector('#backup-message');
  const list = dialog.querySelector('#backup-list');
  const createButton = dialog.querySelector('#create-backup');
  let creating = false;
  let loading = null;

  function sizeLabel(bytes) {
    const size = Number(bytes) || 0;
    return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
  }

  function render(backups) {
    list.replaceChildren();
    if (!backups.length) {
      const empty = document.createElement('p');
      empty.className = 'backup-empty';
      empty.textContent = 'Belum ada backup. Buat salinan pertama sekarang.';
      list.append(empty);
      return;
    }
    for (const backup of backups) {
      if (!/^amanah-\d{8}-\d{6}-[a-f0-9]{8}$/.test(backup.id)) continue;
      const item = document.createElement('article');
      item.className = 'backup-item';
      const info = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short'
      }).format(new Date(backup.createdAt));
      const description = document.createElement('small');
      description.textContent = `${Number(backup.applicationCount) || 0} pengajuan · ${Number(backup.documentCount) || 0} berkas · ${sizeLabel(backup.bytes)}`;
      info.append(title, description);
      const download = document.createElement('a');
      download.href = `/api/admin/backups/download?id=${encodeURIComponent(backup.id)}`;
      download.className = 'backup-download';
      download.textContent = 'Unduh ZIP';
      download.target = '_blank';
      download.rel = 'noopener';
      download.setAttribute('aria-label', `Unduh backup ${title.textContent}`);
      item.append(info, download);
      list.append(item);
    }
  }

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const response = await fetch('/api/admin/backups', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Daftar backup belum dapat dimuat.');
      if (!Array.isArray(data.backups)) throw new Error('Daftar backup belum dapat dibaca.');
      dialog.querySelector('#backup-schedule').textContent = data.schedule === '24h'
        ? 'Backup otomatis dijadwalkan setiap 24 jam.' : 'Pada server lokal, backup dibuat melalui tombol di bawah.';
      render(data.backups);
      return data.backups;
    })();
    try { return await loading; } finally { loading = null; }
  }

  document.querySelectorAll('[data-open-backups]').forEach((link) => link.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!dialog.open) dialog.showModal();
    if (creating) return;
    message.textContent = 'Memuat daftar backup…';
    try { await load(); message.textContent = ''; }
    catch (error) { message.textContent = error.message; }
  }));
  dialog.querySelector('#close-backups').addEventListener('click', () => dialog.close());
  createButton.addEventListener('click', async () => {
    if (creating) return;
    creating = true;
    createButton.disabled = true;
    createButton.textContent = 'Membuat backup…';
    message.textContent = 'Data dan berkas sedang disalin. Anda tetap dapat menggunakan dashboard.';
    try {
      const response = await fetch('/api/admin/backups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(210000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Backup belum berhasil dibuat.');
      await load();
      message.textContent = 'Backup lengkap berhasil dibuat. Unduh ZIP untuk menyimpan salinan di tempat terpisah.';
    } catch (error) {
      message.textContent = error.name === 'TimeoutError'
        ? 'Proses belum terkonfirmasi. Buka kembali daftar backup sebelum membuat salinan baru.' : error.message;
    } finally {
      creating = false;
      createButton.disabled = false;
      createButton.textContent = 'Buat backup sekarang';
    }
  });
})();
