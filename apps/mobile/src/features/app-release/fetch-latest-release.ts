import { apiBaseUrl, request } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import type { AppReleaseLatest } from './app-release-types';

export async function fetchLatestRelease(): Promise<AppReleaseLatest | null> {
  try {
    return await request<AppReleaseLatest>('/app-releases/latest');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    return null;
  }
}

export function latestApkUrl(): string {
  return `${apiBaseUrl()}/app-releases/latest/file`;
}
