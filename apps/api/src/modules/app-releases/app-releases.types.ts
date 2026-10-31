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

export interface AppReleaseRow {
  readonly id: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly fileName: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly releaseNotes: string | null;
  readonly isLatest: boolean;
  readonly createdAt: Date;
  readonly retiredAt: Date | null;
}

export interface AppReleaseActor {
  readonly id: string;
  readonly isSuperAdmin: boolean;
}

export interface AppReleaseOptions {
  readonly rootPath: string;
  readonly tempPath: string;
  readonly maxSizeBytes: number;
}

export interface UploadedApkFile {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly size: number;
}

export const APP_RELEASE_OPTIONS = 'VFM_APP_RELEASE_OPTIONS';
export const LATEST_DOWNLOAD_PATH = '/api/v1/app-releases/latest/file';
export const APK_MIME = 'application/vnd.android.package-archive';
export const MAX_RELEASE_NOTES = 2_000;
