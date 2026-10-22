(() => {
  'use strict';
  const dialog = document.querySelector('#letter-composer');
  if (!dialog) return;
  const $ = selector => dialog.querySelector(selector);
  const form = $('#letter-editor-form'), launch = document.querySelector('#letter-create');
  const fieldset = form.querySelector('fieldset');
  const names = ['title','number','recipient','opening','studentName','studentId','studentClass','year','body','closing','city','date','position','principal','nip'];
  const settingsNames = ['city','year','position','nip'];
  const principalName = window.AmanahSchool.principalName;
  const drafts = new Map();
  let bridge, snapshot, generated = null, revision = 0;
  let generating = false, submitting = false, savingDraft = false, reloadingDraft = false;
  let draftVersion = 0, savedFingerprint = '', savedAt = '', edited = false, conflicted = false;
  const values = () => ({...Object.fromEntries(names.map(name => [name,String(form.elements.namedItem(name).value).trim()])),principal:principalName,includeStudent:form.elements.namedItem('includeStudent').checked});
  const fingerprint = fields => JSON.stringify([...names.map(name => String(fields?.[name] ?? '').trim()),fields?.includeStudent !== false]);
  const signature = item => JSON.stringify(item ? [item.code,item.student,item.nis,item.className,item.type,item.purpose,item.status,item.updatedAt] : null);
  const eligible = record => bridge?.getMode() === 'tu' && record?.status === 'Disetujui Tata Usaha';
  const current = () => bridge?.getRecord();
  const versionOf = draft => Number.isSafeInteger(draft?.version) && draft.version > 0 ? draft.version : 0;
  const stale = () => conflicted || !eligible(current()) || signature(current()) !== signature(snapshot);
  const unsaved = () => edited && fingerprint(values()) !== savedFingerprint;
  function remember() {
    if (snapshot) drafts.set(snapshot.code,{fields:values(),version:draftVersion,savedFingerprint,savedAt,edited});
  }
  function statusLabel() {
    let label = 'Belum disimpan ke database.';
    if (savedAt && !Number.isNaN(new Date(savedAt).getTime())) label = `Tersimpan ${new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'}).format(new Date(savedAt))} WIB · Versi ${draftVersion}`;
    if (unsaved()) label = 'Ada perubahan yang belum disimpan ke database.';
    if (conflicted) label = 'Draf berubah di perangkat lain. Muat draf terbaru sebelum melanjutkan.';
    if (savingDraft) label = 'Menyimpan draf ke database…';
    if (reloadingDraft) label = 'Memuat draf terbaru…';
    $('#letter-draft-status').textContent = label;
  }
  function buttons() {
    const busy = generating || submitting || savingDraft || reloadingDraft;
    $('#letter-build').disabled = busy || stale();
    $('#letter-save-draft').disabled = busy || stale();
    $('#letter-load-draft').disabled = busy;
    $('#letter-close').disabled = submitting || savingDraft || reloadingDraft;
    $('#letter-download').disabled = busy || !generated || stale();
    $('#letter-review').disabled = busy || !generated || stale();
    $('#letter-submit').disabled = busy || !generated || stale() || !$('#letter-review').checked;
    fieldset.disabled = submitting || savingDraft || reloadingDraft;
    statusLabel();
  }
  function invalidate(trackEdit = true) {
    revision++; generated = null;
    $('#letter-review').checked = false;
    $('#letter-preview-image').hidden = true;
    $('#letter-preview-placeholder').hidden = false;
    $('#letter-preview-placeholder').textContent = 'Klik Buat pratinjau setelah melengkapi data. Surat akan ditampilkan sesuai PDF yang akan dikirim.';
    if (trackEdit) edited = true;
    remember(); buttons();
  }
  function today() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part => [part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function defaults(record) {
    let settings = {};
    try { const saved = JSON.parse(localStorage.getItem('amanah_letter_school_settings_v1') || '{}'); if (saved && typeof saved === 'object') settings = Object.fromEntries(settingsNames.map(name=>[name,typeof saved[name] === 'string' ? saved[name] : ''])); } catch { /* Isian manual tetap tersedia. */ }
    const active = record.type === 'Surat keterangan aktif sekolah';
    return {...settings,title:record.type === 'Lainnya' ? '' : record.type,number:'',date:today(),position:settings.position || 'Kepala SMK Amanah',recipient:'',opening:active ? 'Yang bertanda tangan di bawah ini, Kepala SMK Amanah, menerangkan bahwa:' : 'Dengan hormat,',studentName:record.student || '',studentId:record.nis || '',studentClass:record.className || '',includeStudent:true,body:active ? `Adalah benar siswa aktif di SMK Amanah. Surat keterangan ini dibuat untuk keperluan:\n${record.purpose || ''}` : record.purpose || '',closing:'Demikian surat ini dibuat agar dapat dipergunakan sebagaimana mestinya.'};
  }
  function studentFields() {
    const include = form.elements.namedItem('includeStudent').checked;
    $('#letter-student-fields').hidden = !include;
    for (const name of ['studentName','studentId','studentClass']) form.elements.namedItem(name).required = include;
  }
  function fill(record, remoteDraft, useMemory) {
    snapshot = {...record};
    const memory = useMemory ? drafts.get(record.code) : null;
    const remoteVersion = versionOf(remoteDraft);
    const draft = memory?.fields || (remoteVersion ? remoteDraft.fields : defaults(record));
    draftVersion = memory ? memory.version : remoteVersion;
    savedFingerprint = memory ? memory.savedFingerprint : remoteVersion ? fingerprint(remoteDraft.fields) : '';
    savedAt = memory ? memory.savedAt : remoteDraft?.savedAt || '';
    edited = memory ? memory.edited : false;
    conflicted = remoteVersion > draftVersion;
    for (const name of names) form.elements.namedItem(name).value = draft?.[name] || '';
    form.elements.namedItem('principal').value = principalName;
    form.elements.namedItem('includeStudent').checked = draft?.includeStudent !== false;
    studentFields();
    $('#letter-student-name').textContent = record.student || '—';
    $('#letter-student-meta').textContent = `${record.nis || '—'} · ${record.className || '—'} · ${record.code}`;
    $('#letter-composer-message').textContent = conflicted ? 'Isian lokal tetap dipertahankan. Muat draf terbaru untuk melanjutkan versi dari database.' : '';
    invalidate(false);
  }
  function markConflict(text) {
    conflicted = true; generated = null; $('#letter-review').checked = false;
    $('#letter-composer-message').textContent = text;
    buttons();
  }
  function open() {
    const record = current();
    if (!eligible(record) || bridge.isBusy()) return;
    fill(record,record.letterDraft,true);
    dialog.showModal();
  }
  async function reload() {
    if (submitting || generating || savingDraft || reloadingDraft || !snapshot) return;
    if (unsaved() && !window.confirm('Muat draf dari database? Perubahan lokal yang belum disimpan akan diganti.')) return;
    reloadingDraft = true; buttons();
    try {
      const response = await fetch(`/api/admin/letter-draft?code=${encodeURIComponent(snapshot.code)}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Draf terbaru belum dapat dimuat.');
      const record = current();
      if (!eligible(record) || result.status !== 'Disetujui Tata Usaha') throw new Error('Status pengajuan sudah berubah. Tutup editor dan periksa data terbaru.');
      fill(record,result.draft,false);
      $('#letter-composer-message').textContent = result.draft ? 'Draf terbaru berhasil dimuat dari database. Buat pratinjau untuk memeriksa surat.' : 'Belum ada draf tersimpan. Isian awal dimuat dari pengajuan.';
    } catch (error) { $('#letter-composer-message').textContent = error.message || 'Draf belum dapat dimuat. Isian lokal tetap dipertahankan.'; }
    finally { reloadingDraft = false; buttons(); }
  }
  async function saveDraft(fromSubmit = false) {
    if (savingDraft || reloadingDraft || generating || (!fromSubmit && submitting) || stale()) return false;
    const fields = values(), sentFingerprint = fingerprint(fields);
    if (draftVersion > 0 && sentFingerprint === savedFingerprint) {
      $('#letter-composer-message').textContent = 'Draf ini sudah tersimpan di database.';
      return true;
    }
    savingDraft = true; buttons();
    try {
      const response = await fetch('/api/admin/letter-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:snapshot.code,version:draftVersion,fields}),signal:AbortSignal.timeout(25000)});
      const result = await response.json();
      if (!response.ok) {
        if (result.draftConflict) markConflict(result.error);
        throw new Error(result.error || 'Draf belum tersimpan. Coba kembali.');
      }
      if (!result.ok || !versionOf(result.draft)) throw new Error('Penyimpanan belum terkonfirmasi. Muat draf terbaru sebelum mencoba lagi.');
      draftVersion = result.draft.version; savedAt = result.draft.savedAt;
      savedFingerprint = sentFingerprint; edited = false; remember();
      if (versionOf(current()?.letterDraft) > draftVersion) {
        markConflict('Draf diperbarui lagi dari perangkat lain. Muat draf terbaru sebelum melanjutkan.');
        return false;
      }
      $('#letter-composer-message').textContent = 'Draf tersimpan di database. Anda dapat melanjutkan dari perangkat lain setelah login.';
      return true;
    } catch (error) {
      $('#letter-composer-message').textContent = error.name === 'TimeoutError' ? 'Penyimpanan belum terkonfirmasi. Muat draf terbaru untuk memeriksa hasilnya; isian lokal tetap tersedia.' : error.message || 'Draf belum tersimpan. Periksa koneksi dan coba kembali.';
      return false;
    } finally { savingDraft = false; buttons(); }
  }
  async function build(event) {
    event?.preventDefault();
    if (generating || submitting || savingDraft || reloadingDraft || stale()) return;
    if (!form.reportValidity()) return;
    const fields = values();
    if (names.some(name => form.elements.namedItem(name).required && !fields[name])) { $('#letter-composer-message').textContent = 'Lengkapi semua isian wajib dengan data yang benar.'; return; }
    generating = true; generated = null; $('#letter-review').checked = false;
    const token = ++revision;
    $('#letter-composer-message').textContent = 'Menyiapkan pratinjau PDF…';
    $('#letter-build').textContent = 'Menyiapkan…'; buttons();
    try {
      const result = await window.AmanahBuildLetter(fields);
      if (token !== revision || !dialog.open) return;
      if (stale()) throw new Error('Pengajuan atau draf sudah berubah. Muat data terbaru sebelum melanjutkan.');
      generated = result;
      $('#letter-preview-image').src = result.preview;
      $('#letter-preview-image').hidden = false; $('#letter-preview-placeholder').hidden = true;
      $('#letter-composer-message').textContent = 'Pratinjau siap. Periksa isi surat, lalu centang konfirmasi sebelum meneruskan ke Kepsek.';
      try { localStorage.setItem('amanah_letter_school_settings_v1',JSON.stringify(Object.fromEntries(settingsNames.map(name=>[name,fields[name]])))); } catch { /* Pengaturan dapat diisi ulang. */ }
    } catch (error) { if (token === revision) $('#letter-composer-message').textContent = error.message || 'PDF belum dapat dibuat. Periksa isian lalu coba kembali.'; }
    finally { generating = false; $('#letter-build').textContent = 'Buat pratinjau'; buttons(); }
  }
  const filename = () => `Surat-${snapshot.code}.pdf`;
  launch.addEventListener('click',open);
  $('#letter-save-draft').addEventListener('click',()=>saveDraft());
  $('#letter-load-draft').addEventListener('click',reload);
  $('#letter-build').addEventListener('click',build);
  form.addEventListener('submit',build);
  form.addEventListener('input',()=> { invalidate(); $('#letter-composer-message').textContent = 'Isian berubah. Simpan draf untuk menyimpannya ke database; buat ulang pratinjau sebelum mengirim.'; });
  form.addEventListener('change',()=> { studentFields(); invalidate(); });
  $('#letter-review').addEventListener('change',buttons);
  function mayClose() {
    if (submitting || savingDraft || reloadingDraft) return false;
    return !unsaved() || window.confirm('Ada perubahan yang belum disimpan ke database. Tutup editor?');
  }
  $('#letter-close').addEventListener('click',()=> { if (mayClose()) dialog.close(); });
  dialog.addEventListener('cancel',event=> { if (!mayClose()) event.preventDefault(); });
  dialog.addEventListener('close',()=> { revision++; generated = null; $('#letter-preview-image').removeAttribute('src'); });
  window.addEventListener('beforeunload',event=> { if ((snapshot && unsaved()) || savingDraft || submitting) { event.preventDefault(); event.returnValue=''; } });
  $('#letter-download').addEventListener('click',()=> {
    if (!generated || stale() || generating || submitting || savingDraft || reloadingDraft) return;
    const url = URL.createObjectURL(generated.pdf), link = document.createElement('a');
    link.href=url; link.download=filename(); document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  $('#letter-submit').addEventListener('click',async()=> {
    if (!generated || !$('#letter-review').checked || stale() || submitting || generating || savingDraft || reloadingDraft || bridge.isBusy()) return;
    const readyPdf = generated.pdf;
    submitting = true; buttons();
    try {
      if (!await saveDraft(true)) return;
      if (stale()) throw new Error('Draf sudah berubah. Muat draf terbaru sebelum mengirim.');
      $('#letter-composer-message').textContent = 'Menyimpan PDF dan meneruskan surat ke kepala sekolah…';
      const file = new File([readyPdf],filename(),{type:'application/pdf'});
      const success = await bridge.send(file,snapshot.code,draftVersion);
      if (!success) throw new Error(document.querySelector('#action-message').textContent || 'Surat belum terkirim. Periksa koneksi lalu coba kembali.');
      drafts.delete(snapshot.code); edited=false; dialog.close();
    } catch (error) { $('#letter-composer-message').textContent = error.message || 'Surat belum terkirim. Coba kembali.'; }
    finally { submitting = false; buttons(); }
  });
  window.AmanahLetterComposer = {
    configure(options) { bridge=options; },
    update(record) {
      document.querySelector('#letter-template-launch').hidden = !eligible(record);
      launch.disabled = !eligible(record);
      if (dialog.open && !submitting && !savingDraft && !reloadingDraft) {
        if (versionOf(record?.letterDraft) > draftVersion) {
          markConflict('Draf sudah diperbarui dari perangkat lain. Isian Anda tetap tersedia; muat draf terbaru sebelum melanjutkan.');
        } else if (stale()) {
          revision++; generated=null; $('#letter-review').checked=false;
          $('#letter-composer-message').textContent = 'Data atau status pengajuan berubah. Tutup editor dan buka kembali dari pengajuan terbaru.';
          buttons();
        }
      }
    }
  };
})();
