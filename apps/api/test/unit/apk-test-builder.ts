import { crc32 } from 'node:zlib';

const UTF16 = (value: string): Buffer => {
  const chars = Buffer.from(value, 'utf16le');
  const header = Buffer.alloc(2);
  header.writeUInt16LE(value.length, 0);
  const raw = Buffer.concat([header, chars, Buffer.alloc(2)]);
  const pad = (4 - (raw.length % 4)) % 4;
  return Buffer.concat([raw, Buffer.alloc(pad)]);
};

export function buildAndroidManifest(versionCode: number, versionName: string): Buffer {
  const strings = ['manifest', 'versionCode', 'versionName', versionName];
  const encoded = strings.map(UTF16);
  const offsets = Buffer.alloc(strings.length * 4);
  let cursor = 0;
  encoded.forEach((entry, index) => {
    offsets.writeUInt32LE(cursor, index * 4);
    cursor += entry.length;
  });
  const data = Buffer.concat(encoded);
  const stringsStart = 28 + offsets.length;
  const poolSize = stringsStart + data.length;
  const pool = Buffer.alloc(poolSize);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(poolSize, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0, 12);
  pool.writeUInt32LE(0, 16);
  pool.writeUInt32LE(stringsStart, 20);
  offsets.copy(pool, 28);
  data.copy(pool, stringsStart);

  const attrCount = 2;
  const elementSize = 16 + 20 + 20 * attrCount;
  const element = Buffer.alloc(elementSize);
  element.writeUInt16LE(0x0102, 0);
  element.writeUInt16LE(16, 2);
  element.writeUInt32LE(elementSize, 4);
  element.writeUInt32LE(1, 8);
  element.writeUInt32LE(0xffffffff, 12);
  element.writeUInt32LE(0xffffffff, 16);
  element.writeUInt32LE(0, 20);
  element.writeUInt16LE(20, 24);
  element.writeUInt16LE(20, 26);
  element.writeUInt16LE(attrCount, 28);
  writeIntAttr(element, 36, 1, versionCode, 0x10, 0xffffffff);
  writeIntAttr(element, 56, 2, 3, 0x03, 3);

  const total = 8 + poolSize + elementSize;
  const file = Buffer.alloc(total);
  file.writeUInt16LE(0x0003, 0);
  file.writeUInt16LE(8, 2);
  file.writeUInt32LE(total, 4);
  pool.copy(file, 8);
  element.copy(file, 8 + poolSize);
  return file;
}

export function buildTestApk(versionCode: number, versionName: string): Buffer {
  return zipStore({ 'AndroidManifest.xml': buildAndroidManifest(versionCode, versionName) });
}

function writeIntAttr(
  buffer: Buffer,
  offset: number,
  nameIndex: number,
  data: number,
  dataType: number,
  rawValue: number,
): void {
  buffer.writeUInt32LE(0xffffffff, offset);
  buffer.writeUInt32LE(nameIndex, offset + 4);
  buffer.writeUInt32LE(rawValue >>> 0, offset + 8);
  buffer.writeUInt16LE(8, offset + 12);
  buffer.writeUInt8(0, offset + 14);
  buffer.writeUInt8(dataType, offset + 15);
  buffer.writeUInt32LE(data, offset + 16);
}

function zipStore(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localFull = Buffer.concat([local, nameBuf, data]);
    locals.push(localFull);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += localFull.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
