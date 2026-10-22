(() => {
  const $ = (selector) => document.querySelector(selector);
  const trackingForm = $('#lacak-form') || $('#tracking-form');
  if (!trackingForm) return;
  const trackingInput = $('#tracking-number') || $('#tracking-code');
  const feedback = $('#track-result') || $('#feedback');
  const feedbackClass = feedback.className;
  const results = $('#results');
  const emptyState = $('#empty-state');
  try { localStorage.removeItem('amanah_surat_demo'); } catch { /* Pelacakan tetap memakai server. */ }
  let currentCode = '';
  let lookupController;
  const stages = [
    ['Pengajuan diterima', 'Data pengajuan berhasil dikirim.'],
    ['Diperiksa Tata Usaha', 'Data dan dokumen sedang diverifikasi.'],
    ['Surat dibuat oleh TU', 'Surat sedang disiapkan untuk persetujuan.'],
    ['Persetujuan Kepala Sekolah', 'Surat menunggu persetujuan kepala sekolah.'],
    ['Surat siap diunduh', 'Proses pengajuan selesai.']
  ];

  function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {})
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function normalizeStatus(status = '') {
    const value = status.toLocaleLowerCase('id-ID');
    if (value.includes('tolak')) return { label: 'Ditolak', current: value.includes('kepala sekolah') ? 3 : 1, rejected: true, complete: false };
    if (value.includes('siap diunduh') || value.includes('selesai')) return { label: 'Selesai', current: 5, rejected: false, complete: true };
    if (value.includes('menunggu persetujuan kepala sekolah')) return { label: 'Menunggu persetujuan', current: 3, rejected: false, complete: false };
    if (value.includes('disetujui kepala sekolah')) return { label: 'Menunggu surat', current: 4, rejected: false, complete: false };
    if (value.includes('surat dibuat')) return { label: 'Surat dibuat', current: 3, rejected: false, complete: false };
    if (value.includes('disetujui tata usaha') || value.includes('disetujui tu')) return { label: 'Disetujui TU', current: 2, rejected: false, complete: false };
    return { label: 'Diproses TU', current: 1, rejected: false, complete: false };
  }

  function renderTimeline(application, state) {
    const submitted = formatDate(application.submittedAt, true);
    const events = Array.isArray(application.history) ? application.history : [];
    const eventFor = (...statuses) => [...events].reverse().find((event) => statuses.includes(event.status));
    const eventTime = (...statuses) => formatDate(eventFor(...statuses)?.at, true);
    const eventTimes = [submitted, eventTime('Disetujui Tata Usaha', 'Ditolak oleh TU'), eventTime('Menunggu persetujuan Kepala Sekolah'), eventTime('Selesai', 'Ditolak Kepala Sekolah'), eventTime('Selesai')];
    $('#timeline').innerHTML = stages.map(([title, description], index) => {
      let stateClass = '';
      let shownTitle = title;
      let shownDescription = description;
      let time = '';
      if (index === 0) {
        stateClass = 'completed';
        shownTitle = 'Pengajuan diterima';
        shownDescription = 'Data pengajuan berhasil dikirim.';
        time = submitted;
      } else if (state.rejected && index < state.current) {
        stateClass = 'completed';
        time = eventTimes[index];
      } else if (state.rejected && index === state.current) {
        stateClass = 'rejected';
        shownTitle = application.status === 'Ditolak Kepala Sekolah' ? 'Surat ditolak Kepala Sekolah' : 'Pengajuan ditolak Tata Usaha';
        shownDescription = application.note || 'Silakan hubungi Tata Usaha untuk informasi lebih lanjut.';
        time = eventTime(application.status) || formatDate(application.updatedAt, true);
      } else if (!state.rejected && index < state.current) {
        stateClass = 'completed';
        if (index === 1) shownDescription = 'Data dan dokumen telah diverifikasi.';
        if (index === 2) shownDescription = 'Surat telah disiapkan untuk persetujuan.';
        if (index === 3) shownDescription = 'Surat telah mendapat persetujuan.';
        time = eventTimes[index];
      } else if (!state.rejected && index === state.current && state.current < 5) {
        stateClass = 'current';
        shownTitle = state.current === 1 ? 'Sedang diperiksa Tata Usaha' : title;
        shownDescription = state.current === 1
          ? 'Pengajuan Anda sedang menunggu verifikasi petugas.' : description;
      }
      const mark = stateClass === 'completed' ? '✓' : stateClass === 'rejected' ? '×' : stateClass === 'current' ? '•' : String(index + 1);
      return `<li class="${stateClass}"><span class="node">${mark}</span><div><b>${escapeHtml(shownTitle)}</b>${time ? `<time>${escapeHtml(time)}</time>` : ''}<p>${escapeHtml(shownDescription)}</p></div></li>`;
    }).join('');
  }

  function showApplication(application) {
    const state = normalizeStatus(application.status);
    results.classList.remove('hidden');
    emptyState.classList.add('hidden');
    $('#request-type').textContent = application.type || 'Pengajuan Surat';
    $('#request-code').textContent = application.code;
    $('#student-name').textContent = application.student || '—';
    $('#student-class').textContent = application.className || '—';
    $('#submitted-date').textContent = formatDate(application.submittedAt);
    $('#purpose-text').textContent = application.purpose || '—';

    const pill = $('#status-pill');
    pill.textContent = state.label;
    pill.className = `status-pill${state.complete ? ' complete' : ''}${state.rejected ? ' rejected' : ''}`;
    const card = $('#status-card');
    card.className = `status-card${state.complete ? '' : ' pending'}${state.rejected ? ' rejected' : ''}`;
    $('#status-symbol').textContent = state.rejected ? '×' : state.complete ? '✓' : '…';
    $('#status-title').textContent = state.rejected ? 'Pengajuan perlu diperbaiki' : state.complete ? 'Pengajuan selesai' : 'Surat sedang diproses';
    $('#status-description').textContent = state.rejected
      ? `Periksa catatan ${application.status === 'Ditolak Kepala Sekolah' ? 'Kepala Sekolah' : 'Tata Usaha'} untuk mengetahui tindak lanjut.`
      : state.complete
        ? (application.hasLetter ? 'Surat resmi telah disetujui dan siap diunduh.' : 'Pengajuan telah selesai.')
        : 'Pantau halaman ini untuk mengetahui perkembangan terbaru dari sekolah.';
    $('#note-title').textContent = application.status === 'Ditolak Kepala Sekolah' ? 'Catatan Kepala Sekolah' : 'Catatan Tata Usaha';
    $('#tu-note').textContent = application.note || (state.rejected ? 'Silakan hubungi Tata Usaha untuk menindaklanjuti pengajuan.' : 'Belum ada catatan dari Tata Usaha.');
    $('#updated-at').textContent = `Terakhir diperbarui: ${formatDate(application.updatedAt || application.submittedAt, true)}`;
    const letterUrl = `/api/letter?code=${encodeURIComponent(application.code)}`;
    const ready = state.complete && application.hasLetter;
    $('#download-button').disabled = !ready;
    $('#view-button').disabled = !ready;
    $('#download-button').onclick = () => { if (ready) { const link = document.createElement('a'); link.href = letterUrl; link.download = application.letterName || 'surat-resmi'; link.click(); } };
    $('#view-button').onclick = () => { if (ready) window.open(letterUrl, '_blank', 'noopener'); };
    const placeholder = $('#letter-placeholder');
    placeholder.querySelector('b').textContent = ready ? (application.letterName || 'Surat resmi') : 'Surat resmi';
    placeholder.querySelector('small').textContent = ready ? 'Disetujui dan siap diunduh' : 'Belum tersedia untuk diunduh';
    renderTimeline(application, state);
  }

  async function lookup(code) {
    lookupController?.abort();
    const controller = new AbortController();
    lookupController = controller;
    currentCode = '';
    feedback.textContent = 'Sedang mencari pengajuan…';
    feedback.className = `${feedbackClass} loading`;
    results.classList.add('hidden');
    emptyState.classList.add('hidden');
    try {
      const response = await fetch(`/api/track?code=${encodeURIComponent(code)}`, {signal: controller.signal, cache: 'no-store'});
      let application;
      if (response.ok) application = await response.json();
      else if (response.status === 404) application = null;
      else throw new Error('Pelacakan sedang tidak tersedia. Coba lagi sebentar.');
      if (controller !== lookupController) return;
      if (!application) {
        feedback.textContent = 'Nomor pelacakan tidak ditemukan. Periksa kembali nomor yang Anda masukkan.';
        feedback.className = `${feedbackClass} error`;
        emptyState.classList.remove('hidden');
        return;
      }
      feedback.textContent = '';
      feedback.className = feedbackClass;
      currentCode = code;
      try { sessionStorage.setItem('amanah_tracking_code', code); } catch { /* Pelacakan tetap dapat dipakai. */ }
      showApplication(application);
      const url = new URL(window.location.href);
      url.searchParams.set('code', code);
      url.hash = 'lacak';
      history.replaceState({}, '', url);
    } catch (error) {
      if (error.name === 'AbortError' || controller !== lookupController) return;
      feedback.textContent = error instanceof TypeError
        ? 'Server pelacakan tidak terjangkau. Periksa koneksi internet Anda, lalu coba lagi.' : error.message;
      feedback.className = `${feedbackClass} error`;
      emptyState.classList.remove('hidden');
    }
  }

  trackingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = trackingInput.value.trim().toUpperCase();
    if (code) lookup(code);
  });

  let initialCode = new URLSearchParams(window.location.search).get('code');
  if (!initialCode && location.hash === '#lacak') {
    try { initialCode = sessionStorage.getItem('amanah_tracking_code'); } catch { /* Nomor tetap bisa diisi manual. */ }
  }
  if (initialCode) {
    trackingInput.value = initialCode.toUpperCase();
    lookup(initialCode.toUpperCase());
  }
  window.setInterval(async () => {
    if (!currentCode || document.visibilityState !== 'visible') return;
    const requestedCode = currentCode;
    try {
      const response = await fetch(`/api/track?code=${encodeURIComponent(requestedCode)}`);
      if (response.ok) {
        const application = await response.json();
        if (currentCode === requestedCode && currentCode === application.code.toUpperCase()) showApplication(application);
      }
    } catch { /* Status terakhir tetap terlihat bila koneksi terputus sebentar. */ }
  }, 15000);
})();
