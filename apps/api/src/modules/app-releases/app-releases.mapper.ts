import { toUtcIso } from '@vfm/shared';
import type { AppReleaseLatest, AppReleaseListItem, AppReleaseRow } from './app-releases.types.js';
import { LATEST_DOWNLOAD_PATH } from './app-releases.types.js';

export function toLatestDto(row: AppReleaseRow): AppReleaseLatest {
  return {
    versionCode: row.versionCode,
    versionName: row.versionName,
    releaseNotes: row.releaseNotes,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    downloadUrl: LATEST_DOWNLOAD_PATH,
  };
}

export function toListItem(row: AppReleaseRow): AppReleaseListItem {
  return {
    id: row.id,
    versionCode: row.versionCode,
    versionName: row.versionName,
    fileName: row.fileName,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    releaseNotes: row.releaseNotes,
    isLatest: row.isLatest,
    createdAt: toUtcIso(row.createdAt),
    retiredAt: row.retiredAt ? toUtcIso(row.retiredAt) : null,
  };
}

export function sanitizeFileName(original: string): string {
  const base = original.replace(/[^a-zA-Z0-9._-]+/gu, '_').replace(/^\.+/u, '');
  const trimmed = base.slice(0, 180);
  if (trimmed.toLowerCase().endsWith('.apk')) return trimmed;
  return `${trimmed || 'vozni-park'}.apk`;
}

export function sanitizeReleaseNotes(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return value.length > 0 ? value.slice(0, 2_000) : null;
}
