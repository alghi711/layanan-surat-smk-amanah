(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $('#request-form');
  const panels = [...document.querySelectorAll('.step-panel')];
  const indicators = [...document.querySelectorAll('[data-step-indicator]')];
  const draftKey = 'amanah_surat_draft_real_v1';
  try { localStorage.removeItem('amanah_surat_draft'); } catch { /* Browser dapat membatasi penyimpanan. */ }
  const fileInput = $('#supporting-file');
  let step = 1;
  let selectedFile = null;

  function setStep(next) {
    step = Math.max(1, Math.min(4, next));
    panels.forEach((panel) => {
      const active = Number(panel.dataset.step) === step;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    indicators.forEach((item) => {
      const n = Number(item.dataset.stepIndicator);
      item.classList.toggle('current', n === step);
      item.classList.toggle('done', n < step);
      if (n < step) item.querySelector('span').textContent = '✓';
      else item.querySelector('span').textContent = String(n);
    });
    $('#previous-step').hidden = step === 1;
    $('#next-step').hidden = step === 4;
    $('#submit-request').hidden = step !== 4;
    $('#form-alert').textContent = '';
    if (step === 4) renderSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function currentPanelIsValid() {
    const panel = panels.find((item) => Number(item.dataset.step) === step);
    const fields = [...panel.querySelectorAll('input[required], select[required], textarea[required]')]
      .filter((field) => field.type !== 'checkbox');
    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        field.focus();
        return false;
      }
    }
    return true;
  }

  function formValues() {
    return Object.fromEntries(new FormData(form).entries());
  }

  function saveDraft(showMessage = true) {
    try {
      localStorage.setItem(draftKey, JSON.stringify(formValues()));
      if (showMessage) {
        const button = $('#save-draft');
        const original = button.innerHTML;
        button.innerHTML = 'Tersimpan ✓';
        window.setTimeout(() => { button.innerHTML = original; }, 1800);
      }
    } catch {
      $('#form-alert').textContent = 'Draf tidak dapat disimpan pada browser ini.';
    }
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
      Object.entries(draft).forEach(([name, value]) => {
        const field = form.elements.namedItem(name);
        if (field && typeof value === 'string' && field.type !== 'file') field.value = value;
      });
      updateCount();
    } catch { /* Draf yang tidak valid diabaikan. */ }
  }

  function renderSummary() {
    const values = formValues();
    const rows = [
      ['Nama pemohon', values.parent], ['Nomor WhatsApp', values.phone],
      ['Email', values.email || '—'], ['Hubungan dengan siswa', values.relation],
      ['Nama siswa', values.student], ['NIS / NISN', values.nis],
      ['Kelas', values.className], ['Jurusan', values.major],
      ['Jenis surat', values.type], ['Keperluan', values.purpose],
      ['Dokumen', selectedFile?.name || 'Tidak ada dokumen pendukung']
    ];
    $('#summary-list').innerHTML = rows.map(([label, value]) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function updateCount() {
    $('#purpose-count').textContent = `${form.elements.namedItem('purpose').value.length}/500 karakter`;
  }

  $('#next-step').addEventListener('click', () => {
    if (!currentPanelIsValid()) return;
    saveDraft(false);
    setStep(step + 1);
  });
  $('#previous-step').addEventListener('click', () => setStep(step - 1));
  $('#save-draft').addEventListener('click', () => saveDraft());
  $('#confirm-accuracy').addEventListener('change', () => { $('#form-alert').textContent = ''; });
  $('#request-form').addEventListener('input', (event) => {
    $('#duplicate-notice').hidden = true;
    if (event.target.name === 'purpose') updateCount();
  });
  $('#request-form').addEventListener('change', (event) => {
    $('#duplicate-notice').hidden = true;
    if (event.target.type !== 'file') saveDraft(false);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) {
      fileInput.value = '';
      selectedFile = null;
      $('#form-alert').textContent = 'Format file harus PDF, JPG, atau PNG.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      fileInput.value = '';
      selectedFile = null;
      $('#form-alert').textContent = 'Ukuran file melebihi batas 5 MB.';
      return;
    }
    selectedFile = file;
    $('#form-alert').textContent = '';
    $('#upload-title').textContent = file.name;
    $('#upload-hint').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · klik untuk mengganti file`;
  });
  const uploadZone = $('#upload-zone');
  uploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    uploadZone.classList.add('dragging');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
  uploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadZone.classList.remove('dragging');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('#purpose-count').textContent = '0/500 karakter';

  $('#submit-request').addEventListener('click', async (event) => {
    if (event.currentTarget.disabled) return;
    if (!$('#confirm-accuracy').checked) {
      $('#form-alert').textContent = 'Centang konfirmasi kebenaran data sebelum mengirim.';
      return;
    }
    const values = formValues();
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Mengirim…';
    $('#duplicate-notice').hidden = true;
    $('#form-alert').textContent = '';
    try {
      let documentBase64 = '';
      if (selectedFile) {
        const bytes = new Uint8Array(await selectedFile.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        documentBase64 = btoa(binary);
      }
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, documentName: selectedFile?.name || '', documentBase64 })
      });
      const result = await response.json();
      if (response.status === 409 && result.duplicate) {
        $('#duplicate-message').textContent = result.error || 'Pengajuan sebelumnya masih diproses. Tidak ada pengajuan baru yang dibuat.';
        const canTrack = typeof result.code === 'string' && /^SA-\d{6}-[a-f0-9]{32}$/.test(result.code);
        $('#duplicate-tracking').hidden = !canTrack;
        if (canTrack) {
          $('#duplicate-code').textContent = result.code;
          $('#duplicate-status').textContent = `Status: ${result.status || 'Dalam proses'}`;
          $('#duplicate-link').href = `index.html?code=${encodeURIComponent(result.code)}#lacak`;
        } else {
          $('#duplicate-code').textContent = '';
          $('#duplicate-link').removeAttribute('href');
        }
        $('#duplicate-notice').hidden = false;
        $('#duplicate-notice').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'center'});
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Pengajuan gagal disimpan.');
      try { localStorage.setItem('amanah_surat_changed', String(Date.now())); } catch { /* Dashboard tetap memeriksa otomatis. */ }
      localStorage.removeItem(draftKey);
      $('#tracking-code').textContent = result.code;
      $('#success-dialog a').href = `index.html?code=${encodeURIComponent(result.code)}#lacak`;
      $('#success-dialog').showModal();
    } catch (error) {
      $('#form-alert').textContent = error.message || 'Pengajuan belum tersimpan. Periksa koneksi internet Anda, lalu coba lagi.';
    } finally {
      button.disabled = false;
      button.innerHTML = 'Kirim Pengajuan <span>→</span>';
    }
  });

  $('#copy-tracking').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText($('#tracking-code').textContent);
      event.currentTarget.textContent = 'Nomor tersalin ✓';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($('#tracking-code'));
      selection.removeAllRanges();
      selection.addRange(range);
      event.currentTarget.textContent = 'Pilih nomor lalu salin';
    }
  });

  restoreDraft();
})();
