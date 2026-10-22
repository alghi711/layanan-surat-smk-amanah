/* Minimal Open XML workbook writer. All cell values are literal strings, never formulas. */
(() => {
  'use strict';
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const xml = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function column(index) {
    let result = '';
    for (index++; index; index = Math.floor((index - 1) / 26)) result = String.fromCharCode(65 + (index - 1) % 26) + result;
    return result;
  }
  function worksheet(rows, filter) {
    if (rows.length > 1048576) throw new Error('Data melebihi batas baris Excel. Persempit periode laporan.');
    const endColumn = column(rows.reduce((max, row) => Math.max(max, row.length - 1), 0));
    const data = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, col) => `<c r="${column(col)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value ?? '').slice(0, 32767))}</t></is></c>`).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${endColumn}${Math.max(1, rows.length)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="12" width="25" customWidth="1"/></cols><sheetData>${data}</sheetData>${filter ? `<autoFilter ref="A1:${endColumn}${rows.length}"/>` : ''}</worksheet>`;
  }
  function zip(files) {
    const chunks = [], directory = [];
    let offset = 0, total = 0;
    for (const [filename, source] of files) {
      const name = encoder.encode(filename), body = encoder.encode(source);
      total += body.length;
      if (total > 100 * 1024 * 1024) throw new Error('Laporan terlalu besar. Persempit periode sebelum mengekspor.');
      let crc = 0xffffffff;
      for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;
      const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
      view.setUint16(12, 0x21, true); view.setUint32(14, crc, true); view.setUint32(18, body.length, true); view.setUint32(22, body.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
      const entry = new Uint8Array(46 + name.length), central = new DataView(entry.buffer);
      central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true); central.setUint16(14, 0x21, true);
      central.setUint32(16, crc, true); central.setUint32(20, body.length, true); central.setUint32(24, body.length, true); central.setUint16(28, name.length, true); central.setUint32(42, offset, true); entry.set(name, 46);
      chunks.push(header, body); directory.push(entry); offset += header.length + body.length;
    }
    const directorySize = directory.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
    return new Blob([...chunks, ...directory, end], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  window.AmanahReportExcel = (summary, records) => zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ringkasan" sheetId="1" r:id="rId1"/><sheet name="Data Pengajuan" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', worksheet(summary, false)],
    ['xl/worksheets/sheet2.xml', worksheet(records, true)]
  ]);
})();
