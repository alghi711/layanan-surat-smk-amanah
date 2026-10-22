/* One-page A4 letter. A high-resolution page image preserves logo and name glyphs
   without depending on remote fonts or a PDF service. No signature is generated. */
(() => {
  'use strict';
  let letterheadPromise;
  function letterhead() {
    if (!letterheadPromise) letterheadPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { letterheadPromise = null; reject(new Error('Kop surat sekolah belum dapat dimuat. Coba buat pratinjau kembali.')); };
      image.src = 'assets/letterhead-smk-amanah.png?v=20261020-1';
    });
    return letterheadPromise;
  }
  function pdfBlob(jpeg, width, height) {
    const binary = atob(jpeg.split(',')[1]);
    const imageBytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const encoder = new TextEncoder(), parts = [], offsets = [0];
    let size = 0;
    const append = part => { const bytes = typeof part === 'string' ? encoder.encode(part) : part; parts.push(bytes); size += bytes.length; };
    const object = (id, body) => { offsets[id] = size; append(`${id} 0 obj\n${body}\nendobj\n`); };
    append('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /PageImage 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = size;
    append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`);
    append(imageBytes); append('\nendstream\nendobj\n');
    const content = 'q\n595.28 0 0 841.89 0 0 cm\n/PageImage Do\nQ\n';
    object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    const xref = size;
    append('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) append(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, {type:'application/pdf'});
  }
  window.AmanahBuildLetter = async (fields) => {
    const image = await letterhead();
    const canvas = document.createElement('canvas');
    const scale = 3, width = 794, height = 1123;
    canvas.width = width * scale; canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Browser belum mendukung pembuatan surat. Gunakan pilihan unggah surat.');
    ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    // The header crop contains only the school's stationery, never student data.
    // Source page: 612.1 x 936.1 pt. Fit its width to A4 and extend only the left rules.
    const stationeryScale = width / 612.1;
    ctx.drawImage(image, 0, 0, width, 95 * stationeryScale);
    ctx.fillStyle = '#bfbfbf';
    const edgeTop = 105.3 * stationeryScale;
    for (const [x, stripeWidth] of [[5.1,19.05],[26.65,3.55],[33.4,3.55]]) {
      ctx.fillRect(x * stationeryScale, edgeTop, stripeWidth * stationeryScale, height - edgeTop);
    }
    ctx.fillStyle = '#18202a';
    const left = 79, right = 715, available = right - left;
    const clean = value => String(value ?? '').replace(/[\r\n\t]+/g,' ').trim();
    const font = (size = 16, bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Georgia, 'Times New Roman', serif`; };
    function lines(value, maxWidth) {
      const output = [];
      for (const paragraph of String(value ?? '').split(/\r?\n/)) {
        let line = '';
        for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
          if (ctx.measureText(word).width > maxWidth) {
            if (line) { output.push(line); line = ''; }
            let segment = '';
            for (const char of word) { if (ctx.measureText(segment + char).width > maxWidth) { output.push(segment); segment = char; } else segment += char; }
            line = segment;
          } else if (line && ctx.measureText(line + ' ' + word).width > maxWidth) { output.push(line); line = word; }
          else line = line ? line + ' ' + word : word;
        }
        output.push(line);
      }
      return output;
    }
    function paragraph(value, y, maxWidth = available, x = left, lineHeight = 24) {
      const wrapped = lines(value, maxWidth);
      for (const line of wrapped) { ctx.fillText(line, x, y); y += lineHeight; }
      return y;
    }
    ctx.textAlign = 'center';
    font(18,true);
    const titleLines = lines(clean(fields.title).toLocaleUpperCase('id-ID'),available);
    if (titleLines.length > 3) throw new Error('Judul terlalu panjang. Ringkas judul surat menjadi maksimal tiga baris.');
    let titleY = 207;
    for (const titleLine of titleLines) { ctx.fillText(titleLine,width/2,titleY); titleY += 25; }
    const titleWidth = Math.min(available,Math.max(...titleLines.map(line=>ctx.measureText(line).width)));
    ctx.strokeStyle = '#18202a'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo((width-titleWidth)/2,titleY-19); ctx.lineTo((width+titleWidth)/2,titleY-19); ctx.stroke();
    font(15); ctx.fillText(`Nomor: ${clean(fields.number)}`, width/2, titleY+7);
    ctx.textAlign = 'left'; font();
    let y = titleY+58;
    if (fields.recipient.trim()) y = paragraph(fields.recipient,y)+16;
    y = paragraph(fields.opening,y)+15;
    if (fields.includeStudent) {
      const identity = [['Nama siswa',fields.studentName],['NIS / NISN',fields.studentId],['Kelas / Jurusan',fields.studentClass]];
      if (fields.year.trim()) identity.push(['Tahun pelajaran',fields.year]);
      for (const [label,value] of identity) {
        ctx.fillText(label,left+10,y); ctx.fillText(':',left+163,y);
        y = paragraph(clean(value),y,available-190,left+180)+7;
      }
      y += 12;
    }
    y = paragraph(fields.body,y);
    y = paragraph(fields.closing,y+12);
    const signY = Math.max(805, y + 35);
    const date = new Date(`${fields.date}T12:00:00+07:00`);
    if (Number.isNaN(date.getTime())) throw new Error('Tanggal surat tidak valid.');
    const dateText = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long',year:'numeric'}).format(date);
    const signX = 435, signWidth = right - signX;
    const dateLines = lines(`${clean(fields.city)}, ${dateText}`,signWidth);
    const principalName = window.AmanahSchool.principalName;
    font(16,true); const nameLines = lines(principalName,signWidth);
    font(); const nipLines = fields.nip.trim() ? lines(`NIP: ${clean(fields.nip)}`,signWidth) : [];
    const positionLines = lines(clean(fields.position),signWidth);
    const signBottom = signY + dateLines.length*24 + positionLines.length*24 + 74 + nameLines.length*24 + nipLines.length*24;
    if (signBottom > 1050) throw new Error('Surat terlalu panjang untuk satu halaman A4. Ringkas judul, tujuan, atau isi surat lalu buat pratinjau kembali.');
    let lineY = paragraph(`${clean(fields.city)}, ${dateText}`,signY,signWidth,signX);
    lineY = paragraph(clean(fields.position),lineY,signWidth,signX);
    lineY += 74;
    font(16,true); lineY = paragraph(principalName,lineY,signWidth,signX);
    if (nipLines.length) { font(14); paragraph(`NIP: ${clean(fields.nip)}`,lineY,signWidth,signX,20); }
    const preview = canvas.toDataURL('image/jpeg',.95);
    const pdf = pdfBlob(preview,canvas.width,canvas.height);
    if (pdf.size > 10*1024*1024) throw new Error('Ukuran PDF terlalu besar. Gunakan pilihan unggah surat.');
    return {preview,pdf};
  };
})();
