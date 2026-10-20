/**
 * Prilozi — testovi nad bajtovima (bez diska i bez HTTP-a).
 *
 * Cilj: pokriti odluke koje određuju sigurnost uploada — prepoznavanje tipa iz
 * sadržaja, uklanjanje EXIF-a, putanju u storage-u koja ne smije izaći iz
 * korijena i stabilan SHA-256.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  detectFileType,
  isSafeStorageKey,
  sha256Hex,
  stripImageMetadata,
} from '../../src/modules/attachments/attachment-files.js';

/** Minimalni JPEG: SOI + APP1 (EXIF) + SOS + tok + EOI. */
function jpegWithExif(): Buffer {
  const app1Payload = Buffer.from('Exif\0\0GPS', 'latin1');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, app1Payload.length + 2]), app1Payload]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02]);
  const scan = Buffer.from([0x11, 0x22, 0x33]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos, scan, eoi]);
}

/** Minimalni PNG: signature + IHDR + tEXt + IDAT + IEND. */
function pngWithText(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    chunk('tEXt', Buffer.from('Author\0Mujo', 'latin1')),
    chunk('IDAT', Buffer.from([1, 2, 3])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('detectFileType', () => {
  it('prepoznaje dozvoljene tipove iz magic bytes', () => {
    expect(detectFileType(jpegWithExif())).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' });
    expect(detectFileType(pngWithText())).toEqual({ mimeType: 'image/png', ext: 'png' });
    expect(
      detectFileType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])),
    ).toEqual({ mimeType: 'image/webp', ext: 'webp' });
    expect(detectFileType(Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1'))).toEqual({
      mimeType: 'application/pdf',
      ext: 'pdf',
    });
    expect(
      detectFileType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)])),
    ).toEqual({ mimeType: 'image/heic', ext: 'heic' });
  });

  it('nepoznat sadržaj vraća `null` (→ 415 na servisu)', () => {
    expect(detectFileType(Buffer.from('MZ\x90\x00 ovo je exe', 'latin1'))).toBeNull();
    expect(detectFileType(Buffer.from('<!doctype html>'))).toBeNull();
    expect(detectFileType(Buffer.alloc(4))).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('vraća poznati hash i ne zavisi od imena fajla', () => {
    expect(sha256Hex(Buffer.from('vozni park'))).toBe(
      '2e785f5405f71129739c7f547c69c09d7ece2985c0c08dcfe4a94292fed00901',
    );
  });
});

describe('buildStorageKey', () => {
  it('gradi `YYYY/MM/<sha[0..2]>/<uuid>.<ext>` u UTC-u', () => {
    const key = buildStorageKey('ab12cd', 'jpg', new Date('2026-10-20T23:30:00.000Z'), 'uuid-1');
    expect(key).toBe('2026/10/ab/uuid-1.jpg');
  });

  it('mjesec je dvije cifre', () => {
    expect(buildStorageKey('ff00', 'pdf', new Date('2026-01-05T00:00:00.000Z'), 'x')).toBe(
      '2026/01/ff/x.pdf',
    );
  });
});

describe('isSafeStorageKey', () => {
  it('dozvoljava relativne putanje bez `..`', () => {
    expect(isSafeStorageKey('2026/10/ab/uuid.jpg')).toBe(true);
  });

  it('odbija apsolutne putanje, `..`, backslash i prazne segmente', () => {
    expect(isSafeStorageKey('/etc/passwd')).toBe(false);
    expect(isSafeStorageKey('2026/../../etc/passwd')).toBe(false);
    expect(isSafeStorageKey('2026\\10\\x.jpg')).toBe(false);
    expect(isSafeStorageKey('2026//x.jpg')).toBe(false);
    expect(isSafeStorageKey('')).toBe(false);
    expect(isSafeStorageKey('a\0b')).toBe(false);
  });
});

describe('stripImageMetadata', () => {
  it('izbacuje EXIF (APP1) iz JPEG-a, a cuva tok slike', () => {
    const input = jpegWithExif();
    const { buffer, stripped } = stripImageMetadata(input, 'image/jpeg');

    expect(stripped).toBe(true);
    expect(buffer.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
    expect(buffer.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
    // SOI, SOS i entropijski tok ostaju.
    expect(buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(buffer.includes(Buffer.from([0x11, 0x22, 0x33]))).toBe(true);
    expect(buffer.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('izbacuje i APP0 (JFIF thumbnail može nositi sliku)', () => {
    const jfif = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]),
      Buffer.from([0xff, 0xda, 0x00, 0x02]),
      Buffer.from([0x99]),
    ]);
    const { buffer, stripped } = stripImageMetadata(jfif, 'image/jpeg');
    expect(stripped).toBe(true);
    expect(buffer.includes(Buffer.from([0x4a, 0x46]))).toBe(false);
    expect(buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('izbacuje `tEXt` iz PNG-a, a cuva IHDR/IDAT/IEND', () => {
    const { buffer, stripped } = stripImageMetadata(pngWithText(), 'image/png');

    expect(stripped).toBe(true);
    expect(buffer.includes(Buffer.from('tEXt', 'latin1'))).toBe(false);
    expect(buffer.includes(Buffer.from('Mujo', 'latin1'))).toBe(false);
    expect(buffer.includes(Buffer.from('IHDR', 'latin1'))).toBe(true);
    expect(buffer.includes(Buffer.from('IDAT', 'latin1'))).toBe(true);
    expect(buffer.includes(Buffer.from('IEND', 'latin1'))).toBe(true);
  });

  it('PDF i nepoznat tip vraća nepromijenjen', () => {
    const pdf = Buffer.from('%PDF-1.7\n sadrzaj');
    expect(stripImageMetadata(pdf, 'application/pdf')).toEqual({ buffer: pdf, stripped: false });
  });

  it('pokvaren JPEG se ne baca — vraća se ono što je pročitano', () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]);
    expect(() => stripImageMetadata(broken, 'image/jpeg')).not.toThrow();
  });
});
