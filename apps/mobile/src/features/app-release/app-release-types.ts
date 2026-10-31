export interface AppReleaseLatest {
  readonly versionCode: number;
  readonly versionName: string;
  readonly releaseNotes: string | null;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly downloadUrl: string;
}

export function needsForceUpdate(localVersionCode: number, latestVersionCode: number): boolean {
  return Number.isFinite(localVersionCode) && Number.isFinite(latestVersionCode) && latestVersionCode > localVersionCode;
}
