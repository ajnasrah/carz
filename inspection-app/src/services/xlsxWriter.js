// Minimal XLSX writer (no dependencies).
// Builds a valid .xlsx from rows of data using browser-native APIs:
//   rows -> SpreadsheetML XML -> ZIP (STORE, no compression) -> Blob
//
// ESM mirror of the extension's lib/xlsx-writer.js, used so the List Builder page
// and the extension emit byte-identical workbooks.
//
// We roll our own rather than use the installed `xlsx` package because SheetJS's
// community build writes neither cell styles nor freeze panes — the verdict
// colour-coding and the pinned header row are both worth having.
//
// Usage:
//   const blob = XLSXWriter.build({
//     sheetName: 'Target Buy List',
//     widths: [6, 10, 40],
//     rows: [
//       [{ v: 'Rank', s: XLSXWriter.S.HEADER }, ...],
//       [1, { v: 'TARGET', s: XLSXWriter.S.GREEN }, 'note'],
//     ],
//   });

const XLSXWriter = (() => {
  // ── CRC32 (required by the ZIP container) ──
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s);

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // strip control chars Excel rejects
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  // 0 -> A, 25 -> Z, 26 -> AA
  function colName(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = (n - m - 1) / 26;
    }
    return s;
  }

  // ── Style palette (indices into cellXfs below) ──
  const S = {
    DEFAULT: 0,
    HEADER: 1,
    GREEN: 2,
    YELLOW: 3,
    RED: 4,
    BOLD: 5,
    MONEY: 6,
    NUMBER: 7,
    GREY: 8,
  };

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><color rgb="FF808080"/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function sheetXml(rows, widths, freezeHeader, autofilter) {
    const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);

    let cols = '';
    if (widths && widths.length) {
      cols = '<cols>';
      for (let i = 0; i < nCols; i++) {
        const w = widths[i] || 12;
        cols += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
      }
      cols += '</cols>';
    }

    let body = '<sheetData>';
    rows.forEach((row, r) => {
      body += `<row r="${r + 1}">`;
      row.forEach((cell, c) => {
        if (cell === null || cell === undefined || cell === '') return;
        const obj = typeof cell === 'object' && cell !== null && 'v' in cell ? cell : { v: cell, s: 0 };
        const ref = `${colName(c)}${r + 1}`;
        const st = obj.s ? ` s="${obj.s}"` : '';
        if (typeof obj.v === 'number' && Number.isFinite(obj.v)) {
          body += `<c r="${ref}"${st}><v>${obj.v}</v></c>`;
        } else {
          body += `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(obj.v)}</t></is></c>`;
        }
      });
      body += '</row>';
    });
    body += '</sheetData>';

    const pane = freezeHeader
      ? '<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '';
    const filter =
      autofilter && rows.length > 1 ? `<autoFilter ref="A1:${colName(nCols - 1)}${rows.length}"/>` : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}${body}${filter}</worksheet>`;
  }

  // ── ZIP container (STORE method — Excel accepts uncompressed entries) ──
  function zip(files) {
    const local = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = bytes(f.name);
      const data = f.data;
      const crc = crc32(data);

      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0, true); // flags
      lv.setUint16(8, 0, true); // method: store
      lv.setUint16(10, 0, true); // mod time
      lv.setUint16(12, 0x21, true); // mod date (1980-01-01)
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      lh.set(name, 30);

      const cd = new Uint8Array(46 + name.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true); // extra len
      cv.setUint16(32, 0, true); // comment len
      cv.setUint16(34, 0, true); // disk
      cv.setUint16(36, 0, true); // internal attrs
      cv.setUint32(38, 0, true); // external attrs
      cv.setUint32(42, offset, true);
      cd.set(name, 46);

      local.push(lh, data);
      central.push(cd);
      offset += lh.length + data.length;
    }

    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...local, ...central, eocd], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  function build({ sheetName = 'Sheet1', rows = [], widths = [], freezeHeader = true, autofilter = true }) {
    const safeName = String(sheetName).replace(/[\\/*?[\]:]/g, '').slice(0, 31) || 'Sheet1';

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(safeName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    return zip([
      { name: '[Content_Types].xml', data: bytes(contentTypes) },
      { name: '_rels/.rels', data: bytes(rels) },
      { name: 'xl/workbook.xml', data: bytes(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: bytes(wbRels) },
      { name: 'xl/styles.xml', data: bytes(STYLES_XML) },
      { name: 'xl/worksheets/sheet1.xml', data: bytes(sheetXml(rows, widths, freezeHeader, autofilter)) },
    ]);
  }

  // Trigger a browser download of a built workbook.
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { build, download, S, colName };
})();

export const { build, download, S, colName } = XLSXWriter;
export default XLSXWriter;
