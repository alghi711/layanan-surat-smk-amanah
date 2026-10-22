(() => {
  'use strict';
  const dialog = document.querySelector('#wa-dialog');
  if (!dialog) return;
  const button = document.querySelector('#contact-parent');
  const error = document.querySelector('#contact-phone-error');
  const message = document.querySelector('#wa-message');
  const continueLink = document.querySelector('#wa-continue');
  const feedback = document.querySelector('#wa-feedback');
  const rebuild = document.querySelector('#wa-rebuild');
  const phoneInput = document.querySelector('#wa-phone');
  const phoneError = document.querySelector('#wa-phone-error');
  let current = null, draftRecord = null, stale = false;

  function phoneNumber(value) {
    const raw = String(value ?? '').trim();
    if (!/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return '';
    let digits = raw.replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    else if (digits.startsWith('8')) digits = '62' + digits;
    // National mobile input is normalized to Indonesia; explicit international numbers remain supported.
    if (!/^[1-9]\d{7,14}$/.test(digits)) return '';
    if (digits.startsWith('62') && !/^628\d{7,11}$/.test(digits)) return '';
    return digits;
  }
  const text = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  function trackingUrl(record) {
    const url = new URL('index.html', window.location.href);
    url.search = ''; url.hash = 'lacak';
    url.searchParams.set('code', record.code);
    return url.href;
  }
  function template(record) {
    const state = {
      'Menunggu konfirmasi TU':'Pengajuan surat telah diterima dan sedang menunggu pemeriksaan Tata Usaha.',
      'Disetujui Tata Usaha':'Pengajuan surat telah disetujui Tata Usaha. Surat sedang disiapkan untuk persetujuan kepala sekolah.',
      'Menunggu persetujuan Kepala Sekolah':'Surat telah disiapkan Tata Usaha dan sedang menunggu persetujuan kepala sekolah.',
      'Ditolak oleh TU':'Mohon maaf, pengajuan surat belum dapat disetujui oleh Tata Usaha.',
      'Ditolak Kepala Sekolah':'Mohon maaf, surat belum mendapat persetujuan kepala sekolah.',
      'Selesai':record.letterPath ? 'Surat telah disetujui kepala sekolah dan siap diunduh melalui tautan pelacakan di bawah.' : 'Proses pengajuan telah selesai. Silakan lihat informasi pada halaman pelacakan atau hubungi Tata Usaha.'
    }[record.status] || `Status pengajuan saat ini: ${text(record.status) || 'Dalam pemeriksaan'}.`;
    const latestEvent = Array.isArray(record.history) ? [...record.history].reverse().find(event => event?.status === record.status) : null;
    const note = latestEvent ? latestEvent.note : (['Ditolak Kepala Sekolah','Selesai'].includes(record.status) ? record.principalNote : record.note);
    return [
      `Yth. Bapak/Ibu ${text(record.parent) || 'Orang Tua/Wali'},`,
      '', 'Informasi Layanan Surat SMK Amanah',
      `Nama siswa: ${text(record.student) || '—'}`,
      `Jenis surat: ${text(record.type) || '—'}`,
      `Nomor pelacakan: ${text(record.code)}`,
      '', state,
      ...(note ? ['', `Catatan sekolah: ${String(note).trim()}`] : []),
      '', `Lacak pengajuan: ${trackingUrl(record)}`,
      '', 'Mohon simpan nomor dan tautan pelacakan ini untuk keperluan Anda.',
      'Terima kasih.', 'Tata Usaha SMK Amanah'
    ].join('\n');
  }
  const fingerprint = record => JSON.stringify(record);
  function refreshLink() {
    const number = draftRecord && phoneNumber(phoneInput.value);
    const enabled = !stale && number && message.value.trim();
    phoneError.hidden = Boolean(number);
    phoneInput.setAttribute('aria-invalid', number ? 'false' : 'true');
    continueLink.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    continueLink.tabIndex = enabled ? 0 : -1;
    if (enabled) continueLink.href = `https://wa.me/${number}?text=${encodeURIComponent(message.value.trim())}`;
    else continueLink.removeAttribute('href');
  }
  function prepare() {
    if (!current) return;
    draftRecord = current; stale = false;
    document.querySelector('#wa-parent').textContent = text(current.parent) || 'Orang Tua/Wali';
    phoneInput.value = phoneNumber(current.phone) ? '+' + phoneNumber(current.phone) : text(current.phone);
    document.querySelector('#wa-status').textContent = `${text(current.code)} · ${text(current.status)}`;
    message.value = template(current); message.disabled = false;
    feedback.textContent = ''; rebuild.hidden = true; refreshLink();
  }
  window.AmanahStaffWhatsApp = {
    update(record) {
      // Keep only the fields used for this draft; documents are not sent to WhatsApp.
      current = record ? {code:record.code,phone:record.phone,parent:record.parent,student:record.student,type:record.type,status:record.status,note:record.note,principalNote:record.principalNote,letterPath:Boolean(record.letterPath),history:Array.isArray(record.history) ? record.history.map(event => ({status:event.status,note:event.note})) : []} : null;
      const valid = current && phoneNumber(current.phone);
      button.disabled = !current;
      error.hidden = Boolean(valid);
      error.textContent = valid ? '' : 'Nomor pemohon perlu diperiksa. Buka pratinjau untuk memperbaiki nomor tujuan.';
      if (dialog.open && fingerprint(current) !== fingerprint(draftRecord)) {
        stale = true; message.disabled = true;
        feedback.textContent = 'Data atau status pengajuan sudah berubah. Buat ulang pesan agar informasinya sesuai.';
        rebuild.hidden = !current; refreshLink();
      }
    }
  };
  button.addEventListener('click', () => { prepare(); if (draftRecord && !button.disabled) dialog.showModal(); });
  document.querySelector('#wa-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { draftRecord = null; message.value = ''; continueLink.removeAttribute('href'); });
  rebuild.addEventListener('click', prepare);
  message.addEventListener('input', refreshLink);
  phoneInput.addEventListener('input', refreshLink);
  continueLink.addEventListener('click', event => {
    refreshLink();
    if (stale || !draftRecord || !phoneNumber(phoneInput.value) || fingerprint(current) !== fingerprint(draftRecord) || !message.value.trim()) { event.preventDefault(); return; }
    feedback.textContent = 'Lanjutkan pengiriman melalui WhatsApp. Pesan belum dikirim oleh aplikasi ini.';
  });
})();


 (async () => {
  let authSession;
  try {
    const serverRole = document.querySelector('meta[name="amanah-staff-role"]')?.content;
    if (['tu', 'principal'].includes(serverRole)) {
      // Only emitted after the server has authorized this private HTML request.
      authSession = { authenticated: true, role: serverRole };
    } else {
      const response = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Sesi tidak tersedia.');
      authSession = await response.json();
    }
  } catch {
    window.location.replace('admin.html');
    return;
  }
  if (!authSession.authenticated || !authSession.role) {
    window.location.replace('admin.html');
    return;
  }
  const $ = (selector) => document.querySelector(selector);
  const rowsRoot = $('#application-rows');
  const detailPanel = $('#detail-panel');
  const detailBody = $('#detail-body');
  const detailEmpty = $('.detail-empty');
  let records = [];
  let selectedCode = '';
  let currentMode = authSession.role;
  document.querySelectorAll('[data-mode]').forEach(link => {
    if (link.dataset.mode !== currentMode) { link.hidden = true; link.style.display = 'none'; }
  });
  document.querySelectorAll('[data-tu-only]').forEach(link => { if (currentMode !== 'tu') { link.hidden = true; link.style.display = 'none'; } });
  let loadingRequest = null;
  let loadController = null;
  let saving = false;
  let refreshTimer;
  let recordsEtag = '';
  let lastSnapshotAt = 0;
  let refreshFailures = 0;
  const syncStatus = $('#sync-status');
  const changeKey = 'amanah_surat_changed';

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    if (document.visibilityState !== 'visible') return;
    const delay = refreshFailures || saving
      ? Math.min(1000 * (2 ** refreshFailures), 15000)
      : document.querySelector('#seal-dialog[open],#letter-composer[open]') ? 5000 : 2500;
    refreshTimer = window.setTimeout(async () => {
      await loadRecords(true, { background: true });
      scheduleRefresh();
    }, delay);
  }

  function showSynced() {
    refreshFailures = 0;
    syncStatus.dataset.state = 'connected';
    const label = 'Data tersinkron otomatis · pembaruan cepat aktif';
    if (syncStatus.textContent !== label) syncStatus.textContent = label;
    // Keep the timestamp available without announcing it every second.
    syncStatus.title = `Terakhir diperiksa ${new Date().toLocaleTimeString('id-ID')}`;
  }

  function notifyChange() {
    try { localStorage.setItem(changeKey, String(Date.now())); } catch { /* Polling tetap berjalan. */ }
  }
  const statusTu = ['Menunggu konfirmasi TU', 'Disetujui Tata Usaha', 'Ditolak oleh TU'];
  const statusPrincipal = ['Menunggu persetujuan Kepala Sekolah', 'Selesai', 'Ditolak Kepala Sekolah'];

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };

  function statusClass(status = '') {
    if (status.includes('Ditolak')) return 'rejected';
    if (status.includes('persetujuan Kepala')) return 'principal';
    if (status.includes('Disetujui')) return 'approved';
    return '';
  }

  function refreshStats() {
    $('#total-count').textContent = records.length;
    $('#review-count').textContent = records.filter((item) => item.status === 'Menunggu konfirmasi TU').length;
    $('#approved-count').textContent = records.filter((item) => item.status === 'Disetujui Tata Usaha').length;
    $('#principal-count').textContent = records.filter((item) => item.status === 'Menunggu persetujuan Kepala Sekolah').length;
    $('#nav-pending').textContent = records.filter((item) => item.status === 'Menunggu konfirmasi TU').length;
    $('#nav-principal').textContent = records.filter((item) => item.status === 'Menunggu persetujuan Kepala Sekolah').length;
  }

  function visibleRecords() {
    const query = $('#search-input').value.trim().toLocaleLowerCase('id-ID');
    const status = $('#status-filter').value;
    return records.filter((item) => {
      const inMode = (currentMode === 'tu' ? statusTu : statusPrincipal).includes(item.status);
      const matchesStatus = status === 'all' || item.status === status;
      const haystack = `${item.code} ${item.parent} ${item.student} ${item.type}`.toLocaleLowerCase('id-ID');
      return inMode && matchesStatus && haystack.includes(query);
    });
  }

  function renderRows() {
    const visible = visibleRecords();
    $('#visible-count').textContent = `${visible.length} pengajuan`;
    $('#empty-list').classList.toggle('hidden', visible.length > 0);
    rowsRoot.innerHTML = visible.map((item) => `
      <tr data-code="${escapeHtml(item.code)}" class="${item.code === selectedCode ? 'selected' : ''}">
        <td><span class="row-code">${escapeHtml(item.code)}</span></td>
        <td class="person-cell"><b>${escapeHtml(item.student)}</b><small>${escapeHtml(item.parent)}</small></td>
        <td class="type-cell">${escapeHtml(item.type)}</td>
        <td class="date-cell">${escapeHtml(formatDate(item.submittedAt))}</td>
        <td><span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      </tr>`).join('');
    rowsRoot.querySelectorAll('tr[data-code]').forEach((row) => row.addEventListener('click', () => selectRecord(row.dataset.code)));
  }

  function setText(id, value) { $(id).textContent = value || '—'; }

  function selectRecord(code, { scroll = true, preserveDraft = false, clearMessage = true, renderList = true } = {}) {
    const record = records.find((item) => item.code === code);
    if (!record) return;
    selectedCode = code;
    if (renderList) renderRows();
    detailEmpty.classList.add('hidden');
    detailBody.classList.remove('hidden');
    if (scroll) detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setText('#detail-type', record.type);
    setText('#detail-code', `Nomor pelacakan: ${record.code}`);
    const badge = $('#detail-status');
    badge.textContent = record.status;
    badge.className = `status-badge ${statusClass(record.status)}`;
    $('#detail-date').textContent = `Diajukan ${formatDate(record.submittedAt)}`;
    setText('#detail-parent', record.parent);
    setText('#detail-phone', record.phone);
    setText('#detail-email', record.email || '—');
    setText('#detail-relation', record.relation);
    setText('#detail-student', record.student);
    setText('#detail-nis', record.nis);
    setText('#detail-class', record.className);
    setText('#detail-purpose', record.purpose);
    window.AmanahStaffWhatsApp?.update(record);
    window.AmanahLetterComposer?.update(record);
    window.AmanahPrincipalSigning?.update(record);
    if (!preserveDraft) $('#tu-note').value = currentMode === 'principal' ? (record.principalNote || '') : (record.note || '');
    if (clearMessage) $('#action-message').textContent = '';

    const supportLink = $('#supporting-link');
    const noSupport = $('#no-supporting');
    if (record.documentPath) {
      supportLink.href = `/api/admin/document?code=${encodeURIComponent(record.code)}&kind=support`;
      $('#supporting-name').textContent = record.documentName || 'Dokumen pendukung';
      supportLink.classList.remove('hidden');
      noSupport.classList.add('hidden');
    } else {
      supportLink.classList.add('hidden');
      noSupport.classList.remove('hidden');
    }
    const letterLink = $('#letter-link');
    if (record.letterPath) {
      letterLink.href = `/api/admin/document?code=${encodeURIComponent(record.code)}&kind=letter`;
      $('#letter-name').textContent = record.letterName || 'Surat untuk persetujuan kepala sekolah';
      letterLink.classList.remove('hidden');
    } else {
      letterLink.classList.add('hidden');
    }

    const canReview = currentMode === 'tu' ? record.status === 'Menunggu konfirmasi TU' : record.status === 'Menunggu persetujuan Kepala Sekolah';
    $('.decision-actions').classList.toggle('hidden', !canReview);
    const canUpload = currentMode === 'tu' && record.status === 'Disetujui Tata Usaha';
    $('#letter-upload').classList.toggle('hidden', !canUpload);
    $('.decision-section').classList.toggle('hidden', !canReview && !canUpload);
    $('.decision-section > label').innerHTML = currentMode === 'principal' ? 'Catatan keputusan <span>(wajib jika menolak)</span>' : 'Catatan untuk orang tua <span>(wajib jika menolak)</span>';
    $('#approve-button').textContent = currentMode === 'principal' ? 'Atur pengesahan' : 'Setujui pengajuan';
    $('#approve-button').classList.toggle('hidden', currentMode === 'principal');
    if (record.letterPath) {
      $('#letter-upload').querySelector('label').textContent = `Surat terunggah: ${record.letterName || 'surat'}`;
      $('#letter-file').classList.add('hidden');
      $('#send-principal').textContent = 'Kirim ulang ke kepala sekolah';
    } else {
      $('#letter-upload').querySelector('label').textContent = 'Unggah surat yang sudah dibuat (PDF/JPG/PNG, maks. 10 MB)';
      $('#letter-file').classList.remove('hidden');
      $('#send-principal').textContent = 'Kirim ke kepala sekolah';
    }
  }

  async function loadRecords(keepSelection = true, { background = false } = {}) {
    if (saving) return false;
    if (loadingRequest) return loadingRequest;
    loadingRequest = (async () => {
      $('#refresh-button').disabled = true;
      if (!background) syncStatus.textContent = 'Memperbarui data…';
      const controller = new AbortController();
      loadController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      try {
        const headers = {};
        // Periodic full snapshots also recover changes made outside this API.
        if (background && recordsEtag && Date.now() - lastSnapshotAt < 30000) headers['If-None-Match'] = recordsEtag;
        const response = await fetch('/api/admin/applications', { cache: 'no-store', headers, signal: controller.signal });
        if (response.status === 401) {
          window.location.replace('admin.html');
          return false;
        }
        if (saving || controller.signal.aborted) return false;
        if (response.status === 304) {
          showSynced();
          return true;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Data pengajuan gagal dimuat.');
        if (!Array.isArray(data) && !data?.code) throw new Error('Format data pengajuan tidak valid.');
        // A response started before a decision must not overwrite the newer state.
        if (saving || controller.signal.aborted) return false;
        const nextRecords = Array.isArray(data) ? data : [data];
        recordsEtag = response.headers.get('ETag') || '';
        lastSnapshotAt = Date.now();
        const previous = records.find((item) => item.code === selectedCode);
        const nextSelected = nextRecords.find((item) => item.code === selectedCode);
        const savedNote = currentMode === 'principal' ? previous?.principalNote : previous?.note;
        const hasDraft = Boolean(previous) && $('#tu-note').value !== (savedNote || '');
        const changed = JSON.stringify(records) !== JSON.stringify(nextRecords);
        records = nextRecords;
        if (changed || !background) {
          refreshStats();
          renderRows();
        }
        if (keepSelection && nextSelected) {
          if (!background || JSON.stringify(previous) !== JSON.stringify(nextSelected)) {
            selectRecord(selectedCode, { scroll: false, preserveDraft: hasDraft, clearMessage: false, renderList: false });
          }
        } else if (selectedCode || !keepSelection) {
          selectedCode = '';
          detailBody.classList.add('hidden');
          detailEmpty.classList.remove('hidden');
        }
        showSynced();
        return true;
      } catch (error) {
        if (saving) return false;
        refreshFailures = Math.min(refreshFailures + 1, 4);
        syncStatus.dataset.state = 'error';
        syncStatus.textContent = 'Koneksi tertunda. Mencoba kembali otomatis; data terakhir tetap ditampilkan.';
        return false;
      } finally {
        window.clearTimeout(timeout);
        if (loadController === controller) loadController = null;
        $('#refresh-button').disabled = false;
      }
    })();
    try { return await loadingRequest; } finally { loadingRequest = null; }
  }

  async function fileAsBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function updateStatus(status, file = null, role = 'tu', expectedCode = selectedCode, letterDraftVersion = null, authorization = null) {
    if (saving) return false;
    if (selectedCode !== expectedCode) return false;
    const record = records.find((item) => item.code === selectedCode);
    if (!record) return;
    const note = $('#tu-note').value.trim();
    if ((status === 'Ditolak oleh TU' || status === 'Ditolak Kepala Sekolah') && !note) {
      $('#action-message').textContent = 'Tulis alasan penolakan agar orang tua tahu apa yang perlu diperbaiki.';
      $('#action-message').style.color = '#b13e48';
      $('#tu-note').focus();
      return;
    }
    const message = $('#action-message');
    message.textContent = 'Menyimpan perubahan…';
    message.style.color = '';
    const payload = { code: record.code, status, note, role };
    if (Number.isInteger(letterDraftVersion)) payload.letterDraftVersion = letterDraftVersion;
    if (authorization) payload.authorization = authorization;
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        message.textContent = 'Ukuran surat maksimal 10 MB.';
        message.style.color = '#b13e48';
        return;
      }
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        message.textContent = 'Format surat harus PDF, JPG, atau PNG.';
        message.style.color = '#b13e48';
        return;
      }
    }
    saving = true;
    loadController?.abort();
    const actionButtons = [$('#approve-button'), $('#reject-button'), $('#send-principal')];
    actionButtons.forEach((button) => { button.disabled = true; });
    try {
      if (file) {
        payload.letterName = file.name;
        payload.letterBase64 = await fileAsBase64(file);
      }
      const response = await fetch('/api/admin/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Perubahan gagal disimpan.');
      if (result.record?.code === record.code) {
        records = records.map((item) => item.code === record.code ? result.record : item);
        refreshStats();
        renderRows();
        if (selectedCode === record.code) selectRecord(record.code, {
          scroll: false, clearMessage: false, renderList: false,
          preserveDraft: $('#tu-note').value.trim() !== note
        });
        showSynced();
      }
      // Keep the previous ETag: other devices may have changed different records.
      notifyChange();
      $('#action-message').textContent = status === 'Ditolak oleh TU' || status === 'Ditolak Kepala Sekolah'
        ? 'Pengajuan ditolak dan catatan tersimpan.' : status === 'Disetujui Tata Usaha'
          ? 'Pengajuan disetujui. Anda dapat menyiapkan surat untuk kepala sekolah.'
          : status === 'Selesai' ? 'Surat disetujui dan siap diunduh orang tua.' : 'Surat sudah dikirim untuk persetujuan kepala sekolah.';
      $('#action-message').style.color = '#267e4c';
      return true;
    } catch (error) {
      message.textContent = ['TypeError', 'NetworkError', 'TimeoutError', 'AbortError'].includes(error.name)
        ? 'Koneksi terputus saat menyimpan. Muat ulang daftar dan periksa status surat sebelum mencoba kembali.'
        : error.message;
      message.style.color = '#b13e48';
      return false;
    } finally {
      saving = false;
      actionButtons.forEach((button) => { button.disabled = false; });
      scheduleRefresh();
    }
  }

  $('#search-input').addEventListener('input', renderRows);
  $('#status-filter').addEventListener('change', renderRows);
  $('#refresh-button').addEventListener('click', () => loadRecords());
  $('#logout-button').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.querySelector('.logout-label').textContent = 'Keluar...';
    try {
      const response = await fetch('/api/logout', { method: 'POST', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Logout gagal.');
      window.clearTimeout(refreshTimer);
      loadController?.abort();
      window.location.replace('admin.html');
    } catch {
      syncStatus.dataset.state = 'error';
      syncStatus.textContent = 'Belum berhasil keluar dari server. Periksa koneksi lalu coba kembali.';
      button.disabled = false;
      button.querySelector('.logout-label').textContent = 'Logout';
    }
  });
  $('#close-detail').addEventListener('click', () => {
    selectedCode = '';
    detailBody.classList.add('hidden');
    detailEmpty.classList.remove('hidden');
    renderRows();
    $('#application-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#approve-button').addEventListener('click', () => currentMode === 'tu'
    ? updateStatus('Disetujui Tata Usaha', null, 'tu') : window.AmanahPrincipalSigning?.open());
  $('#reject-button').addEventListener('click', () => currentMode === 'tu'
    ? updateStatus('Ditolak oleh TU', null, 'tu') : updateStatus('Ditolak Kepala Sekolah', null, 'principal'));
  $('#send-principal').addEventListener('click', () => {
    const file = $('#letter-file').files[0];
    if (!file && !records.find((item) => item.code === selectedCode)?.letterPath) {
      $('#action-message').textContent = 'Pilih file surat terlebih dahulu.';
      $('#action-message').style.color = '#b13e48';
      return;
    }
    updateStatus('Menunggu persetujuan Kepala Sekolah', file || null, 'tu');
  });

  document.querySelectorAll('[data-mode]').forEach((link) => link.addEventListener('click', async (event) => {
    event.preventDefault();
    if (saving) return;
    const nextMode = link.dataset.mode;
    if (nextMode !== authSession.role) return;
    currentMode = nextMode;
    document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === link));
    $('#page-title').textContent = currentMode === 'tu' ? 'Menu Tata Usaha' : 'Menu Kepala Sekolah';
    $('#page-description').textContent = currentMode === 'tu'
      ? 'Periksa pengajuan, buat surat, lalu teruskan untuk persetujuan kepala sekolah.'
      : 'Periksa surat yang disiapkan Tata Usaha, lalu setujui atau kembalikan dengan catatan.';
    $('#list-title').textContent = currentMode === 'tu' ? 'Pengajuan masuk' : 'Surat menunggu persetujuan';
    $('#list-description').textContent = currentMode === 'tu'
      ? 'Data baru dari orang tua dan surat yang sedang disiapkan.' : 'Tinjau file surat sebelum memberikan keputusan.';
    $('#status-filter').value = 'all';
    selectedCode = '';
    detailBody.classList.add('hidden');
    detailEmpty.classList.remove('hidden');
    renderRows();
    if (loadingRequest) await loadingRequest;
    await loadRecords(false);
    scheduleRefresh();
  }));

  window.AmanahLetterComposer?.configure({
    getRecord: () => records.find(item => item.code === selectedCode),
    getMode: () => currentMode,
    isBusy: () => saving,
    send: (file, code, version) => updateStatus('Menunggu persetujuan Kepala Sekolah', file, 'tu', code, version)
  });
  window.AmanahPrincipalSigning?.configure({
    getRecord: () => records.find(item => item.code === selectedCode),
    getMode: () => currentMode,
    isBusy: () => saving,
    publish: (file, code, authorization) => updateStatus('Selesai', file, 'principal', code, null, authorization)
  });
  if (currentMode === 'principal') $('[data-mode="principal"]').click();
  await loadRecords(false);
  scheduleRefresh();
  const refreshNow = async () => {
    if (document.visibilityState !== 'visible') return;
    await loadRecords(true, { background: true });
    scheduleRefresh();
  };
  document.addEventListener('visibilitychange', refreshNow);
  window.addEventListener('focus', refreshNow);
  window.addEventListener('online', refreshNow);
  window.addEventListener('pageshow', (event) => { if (event.persisted) refreshNow(); });
  window.addEventListener('storage', (event) => { if (event.key === changeKey) refreshNow(); });
})();
