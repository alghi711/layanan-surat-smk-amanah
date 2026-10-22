(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const filters = ['from','to','type','major','status','search'];
  const controls = Object.fromEntries(filters.map(key => [key, $(`#report-${key}`)]));
  const pageSize = 25;
  let records = [], filtered = [], page = 1, loaded = false, loading = false, exporting = false;
  let etag = '', checkedAt = '', timer, failures = 0;
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit', day:'2-digit'});
  const dateFormatter = new Intl.DateTimeFormat('id-ID', {timeZone:'Asia/Jakarta', day:'2-digit', month:'short', year:'numeric'});
  const timeFormatter = new Intl.DateTimeFormat('id-ID', {timeZone:'Asia/Jakarta', dateStyle:'medium', timeStyle:'short'});
  function day(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  const formatDate = value => day(value) ? dateFormatter.format(new Date(value)) : '—';
  const majorOf = item => String(item.major || String(item.className || '').match(/\b(?:TKJ|TKR)(?:\s+[12])?\b|\bMP\b/i)?.[0] || '').trim().replace(/\s+/g, ' ').toUpperCase();
  function counts(items) {
    return {
      total:items.length,
      pending:items.filter(item => item.status === 'Menunggu konfirmasi TU').length,
      processing:items.filter(item => ['Disetujui Tata Usaha','Menunggu persetujuan Kepala Sekolah'].includes(item.status)).length,
      done:items.filter(item => item.status === 'Selesai').length,
      rejected:items.filter(item => ['Ditolak oleh TU','Ditolak Kepala Sekolah'].includes(item.status)).length
    };
  }
  function periodText() {
    const from = controls.from.value, to = controls.to.value;
    if (!from && !to) return 'Semua waktu';
    const label = value => formatDate(`${value}T12:00:00+07:00`);
    if (from && to) return `${label(from)} – ${label(to)}`;
    return from ? `Mulai ${label(from)}` : `Sampai ${label(to)}`;
  }
  function contextText() {
    return [periodText(), controls.type.value || 'Semua jenis surat', controls.major.value || 'Semua jurusan', controls.status.value || 'Semua status', controls.search.value.trim() ? `Pencarian: ${controls.search.value.trim()}` : ''].filter(Boolean).join(' · ');
  }
  function validFilters() {
    const invalid = controls.from.value && controls.to.value && controls.from.value > controls.to.value;
    $('#report-filter-error').hidden = !invalid;
    $('#report-filter-error').textContent = invalid ? 'Tanggal akhir harus sama atau setelah tanggal awal.' : '';
    controls.to.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    return !invalid;
  }
  function updateActions() {
    const disabled = !loaded || loading || exporting || !filtered.length || !validFilters();
    $('#report-export').disabled = disabled;
    $('#report-print').disabled = disabled;
  }
  function addCell(row, value, secondary) {
    const cell = document.createElement('td');
    const content = document.createElement(secondary !== undefined ? 'b' : 'span');
    content.textContent = value || '—'; cell.append(content);
    if (secondary !== undefined) { const small = document.createElement('small'); small.textContent = secondary || '—'; cell.append(small); }
    row.append(cell); return cell;
  }
  function renderRows() {
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(Math.max(1, page), pages);
    const start = (page - 1) * pageSize;
    const fragment = document.createDocumentFragment();
    filtered.slice(start, start + pageSize).forEach((item, index) => {
      const row = document.createElement('tr');
      addCell(row, String(start + index + 1)); addCell(row, item.code, formatDate(item.submittedAt));
      addCell(row, item.student, item.parent); addCell(row, item.className, majorOf(item)); addCell(row, item.type);
      const cell = document.createElement('td'), badge = document.createElement('span');
      badge.className = 'report-status' + (item.status === 'Selesai' ? ' done' : String(item.status).includes('Ditolak') ? ' rejected' : item.status !== 'Menunggu konfirmasi TU' ? ' processing' : '');
      badge.textContent = item.status || '—'; cell.append(badge); row.append(cell); fragment.append(row);
    });
    $('#report-rows').replaceChildren(fragment);
    $('#report-empty').hidden = filtered.length > 0;
    $('#report-empty-text').textContent = !loaded ? 'Data belum tersedia. Tunggu proses pemuatan atau klik Muat ulang.' : !validFilters() ? 'Perbaiki rentang tanggal untuk menampilkan laporan.' : 'Tidak ada pengajuan yang sesuai. Coba ubah periode atau reset filter.';
    $('#report-page-label').textContent = filtered.length ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} dari ${filtered.length} pengajuan · Halaman ${page}/${pages}` : '0 pengajuan';
    $('#report-prev').disabled = page <= 1; $('#report-next').disabled = page >= pages;
  }
  function render(resetPage = true) {
    if (resetPage) page = 1;
    const query = controls.search.value.trim().toLocaleLowerCase('id-ID');
    filtered = validFilters() ? records.filter(item => {
      const submitted = day(item.submittedAt);
      return (!controls.from.value || (submitted && submitted >= controls.from.value)) &&
        (!controls.to.value || (submitted && submitted <= controls.to.value)) &&
        (!controls.type.value || item.type === controls.type.value) &&
        (!controls.major.value || majorOf(item) === controls.major.value || (['TKJ','TKR'].includes(controls.major.value) && majorOf(item).startsWith(controls.major.value + ' '))) &&
        (!controls.status.value || item.status === controls.status.value) &&
        (!query || `${item.code} ${item.student} ${item.parent}`.toLocaleLowerCase('id-ID').includes(query));
    }) : [];
    const summary = counts(filtered);
    for (const [key, value] of Object.entries(summary)) $(`#report-${key}`).textContent = loaded ? String(value) : '—';
    $('#report-count').textContent = `${filtered.length} pengajuan`;
    $('#report-period-label').textContent = contextText();
    renderRows(); updateActions();
  }
  function setPeriod(kind) {
    const [year, month] = day(new Date()).split('-').map(Number);
    const iso = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (kind === 'month') { controls.from.value = iso(year,month,1); controls.to.value = iso(year,month,new Date(Date.UTC(year,month,0)).getUTCDate()); }
    else if (kind === 'previous') { const y = month === 1 ? year - 1 : year, m = month === 1 ? 12 : month - 1; controls.from.value = iso(y,m,1); controls.to.value = iso(y,m,new Date(Date.UTC(y,m,0)).getUTCDate()); }
    else if (kind === 'year') { controls.from.value = iso(year,1,1); controls.to.value = iso(year,12,31); }
    else { controls.from.value = ''; controls.to.value = ''; }
    document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === kind)));
    render();
  }
  function setSync(text, state = '') { $('#report-sync').textContent = text; $('#report-sync').dataset.state = state; }
  function schedule() {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') timer = setTimeout(() => load(true), Math.min(15000 * (2 ** failures), 60000));
  }
  async function load(background = false) {
    if (loading) return;
    if (window.matchMedia('print').matches) { schedule(); return; }
    loading = true; $('#report-refresh').disabled = true; updateActions();
    if (!background) setSync('Mengambil data pengajuan…');
    try {
      const response = await fetch('/api/admin/applications', {cache:'no-store', headers:etag ? {'If-None-Match':etag} : {}, signal:AbortSignal.timeout(20000)});
      if ([401,403].includes(response.status)) { window.location.replace('admin.html'); return; }
      if (response.status !== 304) {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Laporan belum dapat dimuat.');
        if (!Array.isArray(data)) throw new Error('Data laporan tidak dapat dibaca.');
        records = data.filter(item => item && typeof item === 'object').sort((a,b) => (new Date(b.submittedAt).getTime() || 0) - (new Date(a.submittedAt).getTime() || 0) || String(a.code).localeCompare(String(b.code)));
        loaded = true;
        const chosen = controls.type.value;
        const types = [...new Set(records.map(item => item.type).filter(Boolean))].sort((a,b) => a.localeCompare(b,'id-ID'));
        if (chosen && !types.includes(chosen)) types.push(chosen);
        controls.type.replaceChildren(new Option('Semua jenis surat',''), ...types.map(type => new Option(type,type)));
        controls.type.value = chosen;
        etag = response.headers.get('ETag') || '';
        render(false);
      }
      checkedAt = timeFormatter.format(new Date()) + ' WIB'; failures = 0;
      setSync(`Data diperiksa ${checkedAt} · Pembaruan otomatis setiap 15 detik.`);
    } catch (error) {
      failures = Math.min(failures + 1,2);
      setSync(loaded ? `Koneksi tertunda. Menampilkan data terakhir (${checkedAt}). Mencoba kembali otomatis.` : 'Data belum dapat dimuat. Periksa koneksi lalu klik Muat ulang.', 'error');
    } finally { loading = false; $('#report-refresh').disabled = false; updateActions(); schedule(); }
  }
  const reportHeaders = ['No.','Nomor pelacakan','Tanggal pengajuan (WIB)','Nama siswa','Nama pemohon','Kelas','Jurusan','Jenis surat','Keperluan','Status'];
  const reportRows = items => items.map((item,index) => [String(index + 1),item.code,formatDate(item.submittedAt),item.student,item.parent,item.className,majorOf(item),item.type,item.purpose,item.status]);
  function summaryRows(items) {
    const s = counts(items);
    return [['REKAP LAPORAN SURAT','SMK AMANAH'],['Periode pengajuan (WIB)',periodText()],['Jenis surat',controls.type.value || 'Semua'],['Jurusan',controls.major.value || 'Semua'],['Status',controls.status.value || 'Semua'],['Pencarian',controls.search.value.trim() || '—'],['Dibuat',timeFormatter.format(new Date()) + ' WIB'],['Data terakhir diperiksa',checkedAt],['Total pengajuan',String(s.total)],['Menunggu TU',String(s.pending)],['Dalam proses',String(s.processing)],['Selesai',String(s.done)],['Ditolak',String(s.rejected)],['Keterangan','Dalam proses: disetujui TU atau menunggu persetujuan kepala sekolah.']];
  }
  $('#report-export').addEventListener('click', async () => {
    if (!loaded || loading || exporting || !filtered.length || !validFilters()) return;
    const snapshot = filtered.slice();
    const summary = summaryRows(snapshot);
    const filename = `Rekap-Surat-SMK-Amanah-${controls.from.value || 'awal'}-${controls.to.value || day(new Date())}.xlsx`;
    exporting = true; updateActions();
    $('#report-export').textContent = 'Menyiapkan Excel…';
    try {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve,0)));
      const blob = window.AmanahReportExcel(summary, [reportHeaders,...reportRows(snapshot)]);
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
      setSync(`Excel disiapkan: ${snapshot.length} pengajuan sesuai filter. Data terakhir diperiksa ${checkedAt}.`);
    } catch (error) { setSync(error.message || 'Ekspor gagal. Persempit periode dan coba kembali.','error'); }
    finally { exporting = false; $('#report-export').textContent = '↓ Ekspor Excel'; updateActions(); }
  });
  function preparePrint() {
    const root = $('#report-print-area'); root.replaceChildren();
    const brand = document.createElement('header'); brand.className = 'print-brand';
    const logo = document.createElement('img'); logo.src = 'assets/logo-smk-amanah.png'; logo.alt = 'Logo SMK Amanah';
    const heading = document.createElement('div'), title = document.createElement('h1'), subtitle = document.createElement('p');
    title.textContent = 'SMK AMANAH'; subtitle.textContent = 'Rekap laporan pengajuan surat'; heading.append(title,subtitle); brand.append(logo,heading); root.append(brand);
    const context = document.createElement('p'); context.className = 'print-context'; context.textContent = contextText(); root.append(context);
    const summary = document.createElement('div'); summary.className = 'print-summary';
    const s = counts(filtered);
    for (const [label,key] of [['Total','total'],['Menunggu TU','pending'],['Dalam proses','processing'],['Selesai','done'],['Ditolak','rejected']]) { const element = document.createElement('span'); element.textContent = `${label}: ${s[key]}`; summary.append(element); }
    root.append(summary);
    const table = document.createElement('table'), head = document.createElement('thead'), header = document.createElement('tr'), body = document.createElement('tbody');
    const printHeaders = ['No.','Nomor pelacakan','Tanggal (WIB)','Nama siswa / pemohon','Kelas / jurusan','Jenis surat','Status'];
    printHeaders.forEach(label => { const th = document.createElement('th'); th.textContent = label; th.scope = 'col'; header.append(th); }); head.append(header);
    filtered.forEach((item,index) => { const row = document.createElement('tr'); [String(index+1),item.code,formatDate(item.submittedAt),`${item.student || '—'} / ${item.parent || '—'}`,item.className || majorOf(item),item.type,item.status].forEach(value => { const td = document.createElement('td'); td.textContent = value || '—'; row.append(td); }); body.append(row); });
    table.append(head,body); root.append(table);
    const footer = document.createElement('p'); footer.className = 'print-footer'; footer.textContent = `Dibuat ${timeFormatter.format(new Date())} WIB · Data diperiksa ${checkedAt || '—'} · Dalam proses: disetujui TU atau menunggu kepala sekolah. Laporan untuk administrasi sekolah.`; root.append(footer);
  }
  $('#report-print').addEventListener('click', () => { if (loaded && !loading && filtered.length && validFilters()) { preparePrint(); window.print(); } });
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', schedule);
  for (const key of filters) controls[key].addEventListener(key === 'search' ? 'input' : 'change', () => {
    if (['from','to'].includes(key)) document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed','false'));
    render();
  });
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => setPeriod(button.dataset.period)));
  $('#report-reset').addEventListener('click', () => { Object.values(controls).forEach(control => { control.value = ''; }); setPeriod('all'); });
  $('#report-prev').addEventListener('click', () => { page--; renderRows(); });
  $('#report-next').addEventListener('click', () => { page++; renderRows(); });
  $('#report-refresh').addEventListener('click', () => load());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(true); else clearTimeout(timer); });
  window.addEventListener('online', () => load(true));
  setPeriod('month');
  load();
})();
