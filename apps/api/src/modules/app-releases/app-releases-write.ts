import { randomUUID } from 'node:crypto';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { parseApkIdentity } from './apk-manifest.js';
import { isZipBuffer } from './apk-zip.js';
import { sha256Hex } from './app-release-storage.js';
import { sanitizeFileName, sanitizeReleaseNotes } from './app-releases.mapper.js';
import type { AppReleaseRow, UploadedApkFile } from './app-releases.types.js';
import { MAX_RELEASE_NOTES } from './app-releases.types.js';

export const APP_RELEASE_SELECT = {
  id: true,
  versionCode: true,
  versionName: true,
  fileName: true,
  storageKey: true,
  sha256: true,
  sizeBytes: true,
  releaseNotes: true,
  isLatest: true,
  createdAt: true,
  retiredAt: true,
} as const;

export interface PreparedApkUpload {
  readonly buffer: Buffer;
  readonly identity: { readonly versionCode: number; readonly versionName: string };
  readonly sha256: string;
  readonly fileName: string;
  readonly notes: string | null;
}

export function prepareApkUpload(
  file: UploadedApkFile | undefined,
  releaseNotes: string | undefined,
  maxSizeBytes: number,
): PreparedApkUpload {
  if (!file?.buffer?.length) {
    throw VfmErrors.validationError([{ path: ['file'], message: 'APK fajl je obavezan.', code: 'REQUIRED' }]);
  }
  if (file.size > maxSizeBytes || file.buffer.length > maxSizeBytes) {
    throw VfmErrors.payloadTooLarge(maxSizeBytes);
  }
  if (!isZipBuffer(file.buffer)) {
    throw VfmErrors.unsupportedMediaType(['application/vnd.android.package-archive']);
  }
  if ((releaseNotes?.length ?? 0) > MAX_RELEASE_NOTES) {
    throw VfmErrors.validationError([
      { path: ['releaseNotes'], message: `Napomena smije imati najviše ${MAX_RELEASE_NOTES} znakova.`, code: 'MAX' },
    ]);
  }
  try {
    const identity = parseApkIdentity(file.buffer);
    return {
      buffer: file.buffer,
      identity,
      sha256: sha256Hex(file.buffer),
      fileName: sanitizeFileName(file.originalname),
      notes: sanitizeReleaseNotes(releaseNotes),
    };
  } catch {
    throw VfmErrors.validationError([
      { path: ['file'], message: 'APK nema čitljiv AndroidManifest.xml (versionCode/versionName).', code: 'MANIFEST' },
    ]);
  }
}

export function persistPreparedApk(
  prisma: PrismaService,
  prepared: PreparedApkUpload,
  storageKey: string,
  publishedById: string,
): Promise<AppReleaseRow> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.appRelease.updateMany({
      where: { isLatest: true },
      data: { isLatest: false, retiredAt: now },
    });
    return tx.appRelease.create({
      data: {
        id: randomUUID(),
        versionCode: prepared.identity.versionCode,
        versionName: prepared.identity.versionName,
        fileName: prepared.fileName,
        storageKey,
        sha256: prepared.sha256,
        sizeBytes: prepared.buffer.length,
        releaseNotes: prepared.notes,
        isLatest: true,
        publishedById,
      },
      select: APP_RELEASE_SELECT,
    });
  });
}
