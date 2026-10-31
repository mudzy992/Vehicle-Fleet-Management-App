import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AppReleaseOptions } from './app-releases.types.js';

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function buildApkStorageKey(versionCode: number, sha256: string): string {
  return `app-releases/${versionCode}-${sha256}.apk`;
}

export function isSafeStorageKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith('/') &&
    !key.includes('\\') &&
    !key.includes('\0') &&
    key.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

export function resolveStoragePath(rootPath: string, storageKey: string): string {
  if (!isSafeStorageKey(storageKey)) throw new Error('Neispravna putanja APK-a.');
  const root = resolve(rootPath);
  const absolute = resolve(root, storageKey);
  if (absolute !== root && !absolute.startsWith(`${root}\\`) && !absolute.startsWith(`${root}/`)) {
    throw new Error('Putanja APK-a izlazi iz storage-a.');
  }
  return absolute;
}

export async function writeApkFile(
  options: AppReleaseOptions,
  storageKey: string,
  buffer: Buffer,
): Promise<void> {
  const target = resolveStoragePath(options.rootPath, storageKey);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(options.tempPath, { recursive: true });
  const tmp = join(options.tempPath, `${randomUUID()}.apk.part`);
  await writeFile(tmp, buffer);
  try {
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await writeFile(target, buffer);
  }
}

export function openApkStream(rootPath: string, storageKey: string): ReturnType<typeof createReadStream> {
  return createReadStream(resolveStoragePath(rootPath, storageKey));
}
