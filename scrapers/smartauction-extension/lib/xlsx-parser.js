// Minimal XLSX parser for Chrome Extensions (no dependencies)
// Parses .xlsx files using browser-native APIs: ArrayBuffer → ZIP → XML → rows
// Only supports simple spreadsheets (no formulas, merged cells, etc.)

'use strict';

const XLSXParser = {
  // Main entry: ArrayBuffer → array of row objects (keyed by header names)
  async parse(arrayBuffer) {
    const files = await this._unzip(arrayBuffer);

    // Parse shared strings (all text values are stored here by index)
    const sharedStrings = this._parseSharedStrings(files['xl/sharedStrings.xml']);

    // Parse the first worksheet
    const sheetXml = files['xl/worksheets/sheet1.xml'];
    if (!sheetXml) {
      throw new Error('No worksheet found in xlsx file');
    }

    const rows = this._parseSheet(sheetXml, sharedStrings);
    if (rows.length < 2) return [];

    // First row = headers, rest = data
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = row[i] !== undefined ? row[i] : '';
      });
      return obj;
    });
  },

  // ── ZIP Parser ──
  // Extracts files from a ZIP archive (xlsx is a ZIP)
  async _unzip(buffer) {
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);
    const files = {};

    let offset = 0;
    while (offset < buffer.byteLength - 4) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break; // PK\x03\x04

      const generalPurposeFlag = view.getUint16(offset + 6, true);
      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const fileName = new TextDecoder().decode(uint8.slice(offset + 30, offset + 30 + fileNameLen));

      const dataStart = offset + 30 + fileNameLen + extraLen;

      // Check data descriptor flag BEFORE advancing offset
      const hasDataDescriptor = (generalPurposeFlag & 0x0008) !== 0;

      if (hasDataDescriptor && compressedSize === 0) {
        // Size is in a data descriptor after the compressed data.
        // Scan for the descriptor signature (0x08074b50) to recover sizes.
        let scanPos = dataStart;
        let recovered = false;
        while (scanPos < buffer.byteLength - 16) {
          if (view.getUint32(scanPos, true) === 0x08074b50) {
            // descriptor: sig(4) + crc(4) + compSize(4) + uncompSize(4)
            const actualCompSize = view.getUint32(scanPos + 8, true);
            if (dataStart + actualCompSize === scanPos) {
              const recoveredData = uint8.slice(dataStart, scanPos);
              if (fileName.endsWith('.xml') || fileName.endsWith('.rels')) {
                let text;
                if (compressionMethod === 0) {
                  text = new TextDecoder().decode(recoveredData);
                } else if (compressionMethod === 8) {
                  text = await this._inflate(recoveredData);
                }
                if (text) files[fileName] = text;
              }
              offset = scanPos + 16;
              recovered = true;
            }
            break;
          }
          scanPos++;
        }
        if (!recovered) {
          // Fallback: scan for next PK signature to skip past this entry
          console.warn('XLSX parser: could not recover data-descriptor entry:', fileName);
          offset = dataStart;
          while (offset < buffer.byteLength - 4) {
            const sig = view.getUint32(offset, true);
            if (sig === 0x04034b50 || sig === 0x02014b50) break;
            offset++;
          }
        }
        continue;
      }

      const compressedData = uint8.slice(dataStart, dataStart + compressedSize);

      if (fileName.endsWith('.xml') || fileName.endsWith('.rels')) {
        let text;
        if (compressionMethod === 0) {
          // Stored (no compression)
          text = new TextDecoder().decode(compressedData);
        } else if (compressionMethod === 8) {
          // Deflated — use DecompressionStream
          text = await this._inflate(compressedData);
        }
        if (text) {
          files[fileName] = text;
        }
      }

      offset = dataStart + compressedSize;

      // Skip past data descriptor if present (12 or 16 bytes)
      if (hasDataDescriptor) {
        // Check for optional signature 0x08074b50
        if (offset + 4 <= buffer.byteLength && view.getUint32(offset, true) === 0x08074b50) {
          offset += 16; // signature(4) + crc(4) + compSize(4) + uncompSize(4)
        } else {
          offset += 12; // crc(4) + compSize(4) + uncompSize(4)
        }
      }
    }

    return files;
  },

  // Decompress deflate-raw data using browser's DecompressionStream
  async _inflate(compressedData) {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(compressedData);
      writer.close();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLen);
      let pos = 0;
      for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
      }

      return new TextDecoder().decode(result);
    } catch (e) {
      console.error('Inflate error:', e);
      return null;
    }
  },

  // ── Shared Strings Parser ──
  _parseSharedStrings(xml) {
    if (!xml) return [];
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const si = doc.getElementsByTagName('si');
    const strings = [];
    for (const item of si) {
      // Get all text content (handles <t> and <r><t> rich text)
      strings.push(item.textContent || '');
    }
    return strings;
  },

  // ── Sheet Parser ──
  // Handles both standard and namespaced (x:) XML, plus inline strings
  _parseSheet(xml, sharedStrings) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    // Find sheetData — try both with and without namespace prefix
    const sheetData = doc.getElementsByTagName('sheetData')[0]
                   || doc.getElementsByTagName('x:sheetData')[0];
    if (!sheetData) return [];

    const rows = [];
    const rowElements = sheetData.getElementsByTagName('row').length
      ? sheetData.getElementsByTagName('row')
      : sheetData.getElementsByTagName('x:row');

    for (const rowEl of rowElements) {
      const cells = rowEl.getElementsByTagName('c').length
        ? rowEl.getElementsByTagName('c')
        : rowEl.getElementsByTagName('x:c');
      const rowData = [];

      for (const cell of cells) {
        const ref = cell.getAttribute('r') || '';
        const colIndex = ref ? this._colToIndex(ref) : rowData.length;
        const type = cell.getAttribute('t');

        let value = '';

        if (type === 'inlineStr') {
          // Inline string: <is><t>text</t></is> or <x:is><x:t>text</x:t></x:is>
          const isEl = cell.getElementsByTagName('is')[0]
                    || cell.getElementsByTagName('x:is')[0];
          if (isEl) {
            value = isEl.textContent || '';
          }
        } else if (type === 's') {
          // Shared string reference
          const vEl = cell.getElementsByTagName('v')[0]
                   || cell.getElementsByTagName('x:v')[0];
          const idx = vEl ? parseInt(vEl.textContent) : -1;
          value = (idx >= 0 && sharedStrings[idx]) || '';
        } else {
          // Number or other value
          const vEl = cell.getElementsByTagName('v')[0]
                   || cell.getElementsByTagName('x:v')[0];
          const raw = vEl ? vEl.textContent : '';
          if (raw) {
            const num = parseFloat(raw);
            value = isNaN(num) ? raw : num;
          }
        }

        while (rowData.length <= colIndex) rowData.push('');
        rowData[colIndex] = value;
      }

      rows.push(rowData);
    }

    return rows;
  },

  // Convert column reference (e.g., "A", "AB") to 0-based index
  _colToIndex(ref) {
    const match = ref.match(/^([A-Z]+)/);
    if (!match) return 0;
    const letters = match[1];
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }
};

if (typeof window !== 'undefined') {
  window.XLSXParser = XLSXParser;
}
