/**
 * Magic-bytes detekcija priloga. HEIC/GIF/ZIP-bez-Office se odbijaju.
 */
export interface DetectedFileType {
  readonly mimeType: string;
  readonly ext: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const AVIF_BRANDS = new Set(['avif', 'avis', 'avio']);
const DOCX_MARK = 'word/document.xml';
const XLSX_MARK = 'xl/workbook.xml';
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';

export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return { mimeType: 'image/png', ext: 'png' };
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { mimeType: 'application/pdf', ext: 'pdf' };
  if (isAvif(buffer)) return { mimeType: 'image/avif', ext: 'avif' };
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') return null;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return detectOfficeZip(buffer);
  if (buffer.subarray(0, 8).equals(OLE_SIGNATURE)) return detectOleExcel(buffer);
  return null;
}

function isAvif(buffer: Buffer): boolean {
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp' || buffer.length < 16) return false;
  const size = buffer.readUInt32BE(0);
  const end = size >= 16 && size <= buffer.length ? size : Math.min(buffer.length, 64);
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.has(buffer.subarray(offset, offset + 4).toString('latin1'))) return true;
  }
  return false;
}

function detectOfficeZip(buffer: Buffer): DetectedFileType | null {
  const ascii = buffer.subarray(0, Math.min(buffer.length, 65_536)).toString('latin1');
  if (ascii.includes(DOCX_MARK) || ascii.includes(DOCX_CONTENT_TYPE)) {
    return { mimeType: DOCX_MIME, ext: 'docx' };
  }
  if (ascii.includes(XLSX_MARK) || ascii.includes(XLSX_CONTENT_TYPE)) {
    return { mimeType: XLSX_MIME, ext: 'xlsx' };
  }
  return null;
}

function detectOleExcel(buffer: Buffer): DetectedFileType | null {
  if (buffer.includes(Buffer.from('WordDocument', 'utf16le'))) return null;
  if (buffer.includes(Buffer.from('Workbook', 'utf16le')) || buffer.includes(Buffer.from('Book', 'utf16le'))) {
    return { mimeType: XLS_MIME, ext: 'xls' };
  }
  return null;
}
