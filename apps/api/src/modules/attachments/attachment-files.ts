/**
 * Prilozi — čista logika nad bajtovima (bez Nest-a, bez baze).
 *
 * Zašto odvojeno: sve što se može pokvariti pri uploadu (pogrešan tip, EXIF s
 * GPS lokacijom, putanja koja izlazi iz storage-a) testira se direktno, bez
 * HTTP-a i bez diska.
 *
 * Pravila (docs/05 §7, B-15):
 * 1. **Magic bytes, ne `Content-Type`.** Klijent može poslati šta hoće; tip se
 *    određuje iz prvih bajtova, a `Content-Type` header se koristi samo kao
 *    dodatna provjera.
 * 2. **Metapodaci se uklanjaju.** JPEG `APPn`/`COM` segmenti i PNG `eXIf`/`tEXt`
 *    nose GPS i ime uređaja — izbacuju se prije nego fajl dođe na disk
 *    (`exifStripped` u bazi govori da li je obrada stvarno urađena).
 * 3. **Ime fajla nikad ne određuje putanju.** `storageKey` se generiše iz
 *    SHA-256 i UUID-a; originalno ime ostaje samo kao metapodatak.
 */
import { createHash, randomUUID } from 'node:crypto';

/** Prepoznati tipovi — usklađeno s `ATTACHMENT_ALLOWED_MIME`. */
export interface DetectedFileType {
  readonly mimeType: string;
  readonly ext: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** HEIF/HEIC brandovi koje telefoni stvarno šalju. */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'] as const;

/**
 * Prepoznaje tip fajla iz magic bytes.
 *
 * Vraća `null` kad tip nije podržan — pozivalac tada baca
 * `UNSUPPORTED_MEDIA_TYPE` (415).
 */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }

  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mimeType: 'image/png', ext: 'png' };
  }

  // WEBP: "RIFF" <size> "WEBP"
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }

  // PDF: "%PDF-"
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mimeType: 'application/pdf', ext: 'pdf' };
  }

  // HEIC/HEIF: <size> "ftyp" <brand>
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if ((HEIC_BRANDS as readonly string[]).includes(brand)) {
      return { mimeType: 'image/heic', ext: 'heic' };
    }
  }

  return null;
}

/** SHA-256 (hex, malim slovima) — sadržaj, ne ime, je identitet fajla. */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Relativna putanja u storage-u: `YYYY/MM/<prva 2 hexa sha>/<uuid>.<ext>`.
 *
 * Primjer iz docs/03 §3.9: `2026/10/ab/ab12…jpg`. Datum je **UTC** (isto pravilo
 * kao i sve ostalo u bazi), a UUID sprječava sudar dva fajla istog sadržaja.
 */
export function buildStorageKey(
  sha256: string,
  ext: string,
  now: Date = new Date(),
  id: string = randomUUID(),
): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const bucket = sha256.slice(0, 2) || '00';
  return `${year}/${month}/${bucket}/${id}.${ext}`;
}

/** Provjera da relativna putanja ne izlazi iz korijena storage-a. */
export function isSafeStorageKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith('/') &&
    !key.includes('\\') &&
    !key.includes('\0') &&
    key.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

export interface MetadataStripResult {
  readonly buffer: Buffer;
  /** `true` ako je barem jedan metapodatak stvarno uklonjen. */
  readonly stripped: boolean;
}

/**
 * Uklanja metapodatke iz JPEG/PNG slike; ostale tipove vraća nepromijenjene.
 *
 * JPEG: izbacuje `APP0…APP15` i `COM` segmente (tu žive EXIF/GPS, ime uređaja i
 * thumbnail iz JFIF-a),
 * kopira ostalo do `SOS` markera, a od `SOS` do kraja fajla kopira bajt po bajt
 * (entropijski kodirani podaci se ne diraju).
 *
 * PNG: izbacuje `eXIf`, `tEXt`, `zTXt`, `iTXt` i `tIME` chunk-ove; `IHDR`,
 * `PLTE`, `IDAT`, `IEND` i ostali ostaju netaknuti.
 */
export function stripImageMetadata(buffer: Buffer, mimeType: string): MetadataStripResult {
  if (mimeType === 'image/jpeg') return stripJpegMetadata(buffer);
  if (mimeType === 'image/png') return stripPngMetadata(buffer);
  return { buffer, stripped: false };
}

function stripJpegMetadata(buffer: Buffer): MetadataStripResult {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { buffer, stripped: false };
  }

  const chunks: Buffer[] = [buffer.subarray(0, 2)];
  let offset = 2;
  let stripped = false;

  while (offset + 1 < buffer.length) {
    // Segmenti mogu imati „fill" 0xFF bajtove prije markera.
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      return { buffer: Buffer.concat(chunks), stripped };
    }

    let markerOffset = offset;
    while (markerOffset < buffer.length && buffer[markerOffset + 1] === 0xff) markerOffset += 1;
    const marker = buffer[markerOffset + 1];

    // Kraj slike bez EOI ili SOS — ostatak kopiramo kakav jeste.
    if (marker === undefined || marker === 0xd9) {
      chunks.push(buffer.subarray(offset));
      return { buffer: Buffer.concat(chunks), stripped };
    }

    // SOS (0xDA) i dalje je entropijski kodiran tok — kopiramo do kraja.
    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      return { buffer: Buffer.concat(chunks), stripped };
    }

    // Premalo bajtova za dužinu segmenta (pokvaren/odsječen fajl) — ostatak
    // kopiramo; nikad ne bacamo iz `stripImageMetadata`.
    if (markerOffset + 4 > buffer.length) {
      chunks.push(buffer.subarray(offset));
      return { buffer: Buffer.concat(chunks), stripped };
    }

    const length = buffer.readUInt16BE(markerOffset + 2);
    const segmentEnd = markerOffset + 2 + length;
    if (length < 2 || segmentEnd > buffer.length) {
      chunks.push(buffer.subarray(offset));
      return { buffer: Buffer.concat(chunks), stripped };
    }

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) {
      chunks.push(buffer.subarray(offset, segmentEnd));
    } else {
      stripped = true;
    }
    offset = segmentEnd;
  }

  return { buffer: Buffer.concat(chunks), stripped };
}

const PNG_STRIPPED_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPngMetadata(buffer: Buffer): MetadataStripResult {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { buffer, stripped: false };
  }

  const chunks: Buffer[] = [buffer.subarray(0, 8)];
  let offset = 8;
  let stripped = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) break;

    if (PNG_STRIPPED_CHUNKS.has(type)) {
      stripped = true;
    } else {
      chunks.push(buffer.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  // Ostatak (ako ga ima) ide uz fajl — ne gubimo bajtove.
  if (offset < buffer.length) chunks.push(buffer.subarray(offset));
  return { buffer: Buffer.concat(chunks), stripped };
}
