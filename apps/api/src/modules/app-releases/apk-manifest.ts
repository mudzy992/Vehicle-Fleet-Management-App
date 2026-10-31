import { readZipEntry } from './apk-zip.js';

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_RESOURCE_MAP = 0x0180;
const UTF8_FLAG = 1 << 8;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;

export interface ApkIdentity {
  readonly versionCode: number;
  readonly versionName: string;
}

export function parseApkIdentity(buffer: Buffer): ApkIdentity {
  const axml = readZipEntry(buffer, 'AndroidManifest.xml');
  return parseAndroidManifest(axml);
}

export function parseAndroidManifest(buffer: Buffer): ApkIdentity {
  let offset = 0;
  const firstType = buffer.readUInt16LE(0);
  if (firstType === RES_XML_TYPE) offset = buffer.readUInt16LE(2);
  let strings: string[] = [];
  let resourceIds: number[] = [];
  let versionCode: number | undefined;
  let versionName: string | undefined;
  while (offset + 8 <= buffer.length) {
    const type = buffer.readUInt16LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > buffer.length) break;
    if (type === RES_STRING_POOL_TYPE) strings = readStringPool(buffer, offset);
    else if (type === RES_XML_RESOURCE_MAP) resourceIds = readResourceMap(buffer, offset, size);
    else if (type === RES_XML_START_ELEMENT) {
      const found = readStartElement(buffer, offset, strings, resourceIds);
      versionCode = found.versionCode ?? versionCode;
      versionName = found.versionName ?? versionName;
    }
    offset += size;
  }
  if (versionCode === undefined || !Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('AndroidManifest.xml nema valjan versionCode.');
  }
  return { versionCode, versionName: versionName?.trim() || String(versionCode) };
}

function readResourceMap(buffer: Buffer, start: number, size: number): number[] {
  const ids: number[] = [];
  for (let cursor = start + 8; cursor + 4 <= start + size; cursor += 4) {
    ids.push(buffer.readUInt32LE(cursor));
  }
  return ids;
}

function readStartElement(
  buffer: Buffer,
  start: number,
  strings: readonly string[],
  resourceIds: readonly number[],
): { versionCode?: number; versionName?: string } {
  const headerSize = buffer.readUInt16LE(start + 2);
  const attrStart = buffer.readUInt16LE(start + headerSize + 8);
  const attrSize = buffer.readUInt16LE(start + headerSize + 10);
  const attrCount = buffer.readUInt16LE(start + headerSize + 12);
  const found: { versionCode?: number; versionName?: string } = {};
  const base = start + headerSize + attrStart;
  for (let i = 0; i < attrCount; i += 1) {
    const at = base + i * (attrSize || 20);
    if (at + 20 > buffer.length) break;
    const nameIndex = buffer.readInt32LE(at + 4);
    const dataType = buffer[at + 15] ?? 0;
    const data = buffer.readUInt32LE(at + 16);
    const raw = buffer.readInt32LE(at + 8);
    const name = attributeName(nameIndex, strings, resourceIds);
    if (name === 'versionCode' && (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX)) {
      found.versionCode = data;
    }
    if (name === 'versionName') {
      const index = dataType === TYPE_STRING ? data : raw;
      const value = strings[index];
      if (value) found.versionName = value;
    }
  }
  return found;
}

function attributeName(
  nameIndex: number,
  strings: readonly string[],
  resourceIds: readonly number[],
): string {
  const labeled = strings[nameIndex]?.replace(/^android:/u, '') ?? '';
  if (labeled) return labeled;
  const resourceId = resourceIds[nameIndex];
  if (resourceId === ATTR_VERSION_CODE) return 'versionCode';
  if (resourceId === ATTR_VERSION_NAME) return 'versionName';
  return '';
}

function readStringPool(buffer: Buffer, start: number): string[] {
  const stringCount = buffer.readUInt32LE(start + 8);
  const flags = buffer.readUInt32LE(start + 16);
  const stringsStart = buffer.readUInt32LE(start + 20);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const values: string[] = [];
  for (let i = 0; i < stringCount; i += 1) {
    const rel = buffer.readUInt32LE(start + 28 + i * 4);
    values.push(readPoolString(buffer, start + stringsStart + rel, utf8));
  }
  return values;
}

function readPoolString(buffer: Buffer, offset: number, utf8: boolean): string {
  if (utf8) {
    const chars = readEncodedLength(buffer, offset);
    const bytes = readEncodedLength(buffer, chars.next);
    return buffer.subarray(bytes.next, bytes.next + bytes.value).toString('utf8');
  }
  const charCount = buffer.readUInt16LE(offset);
  return buffer.subarray(offset + 2, offset + 2 + charCount * 2).toString('utf16le');
}

function readEncodedLength(buffer: Buffer, offset: number): { value: number; next: number } {
  const first = buffer[offset] ?? 0;
  if ((first & 0x80) === 0) return { value: first, next: offset + 1 };
  return { value: ((first & 0x7f) << 8) | (buffer[offset + 1] ?? 0), next: offset + 2 };
}
