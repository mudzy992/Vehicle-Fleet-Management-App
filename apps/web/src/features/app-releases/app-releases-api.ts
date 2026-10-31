import { api } from '../../lib/api.js';

export interface AppReleaseLatest {
  readonly versionCode: number;
  readonly versionName: string;
  readonly releaseNotes: string | null;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly downloadUrl: string;
}

export interface AppReleaseListItem {
  readonly id: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly releaseNotes: string | null;
  readonly isLatest: boolean;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

export function fetchLatestAppRelease(): Promise<AppReleaseLatest> {
  return api.get<AppReleaseLatest>('/app-releases/latest');
}

export function fetchAppReleaseHistory(): Promise<{ items: AppReleaseListItem[] }> {
  return api.get<{ items: AppReleaseListItem[] }>('/app-releases');
}

export function uploadAppRelease(file: File, releaseNotes: string): Promise<AppReleaseListItem> {
  const body = new FormData();
  body.append('file', file);
  if (releaseNotes.trim()) body.append('releaseNotes', releaseNotes.trim());
  return api.upload<AppReleaseListItem>('/app-releases', body);
}

export function activateAppRelease(id: string): Promise<AppReleaseListItem> {
  return api.post<AppReleaseListItem>(`/app-releases/${id}/activate`);
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
