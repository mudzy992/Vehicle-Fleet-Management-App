import { inflateRawSync } from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_SIG;
}

export function readZipEntry(buffer: Buffer, entryName: string): Buffer {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error('APK nije valjan ZIP (nema EOCD).');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error('APK nije valjan ZIP (centralni direktorij).');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === entryName) return extractLocal(buffer, localOffset, method, compressed);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`APK ne sadrži ${entryName}.`);
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65_535);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function extractLocal(buffer: Buffer, localOffset: number, method: number, compressed: number): Buffer {
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new Error('APK nije valjan ZIP (lokalni header).');
  }
  const flags = buffer.readUInt16LE(localOffset + 6);
  if (flags & 1) throw new Error('APK je šifriran.');
  const nameLen = buffer.readUInt16LE(localOffset + 26);
  const extraLen = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const packed = buffer.subarray(dataStart, dataStart + compressed);
  if (method === METHOD_STORE) return Buffer.from(packed);
  if (method === METHOD_DEFLATE) return inflateRawSync(packed);
  throw new Error(`Nepodržana ZIP kompresija (${method}).`);
}
