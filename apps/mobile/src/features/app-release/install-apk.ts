import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { DEFAULT_WEB_ORIGIN } from '@vfm/shared';
import { latestApkUrl } from './fetch-latest-release';

export function isStandaloneBuild(): boolean {
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

export async function openLandingPage(): Promise<void> {
  await Linking.openURL(DEFAULT_WEB_ORIGIN);
}

export async function downloadAndInstallApk(input: {
  readonly versionCode: number;
  readonly sha256: string;
  readonly onProgress: (ratio: number) => void;
}): Promise<void> {
  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error('Keš direktorij nije dostupan.');
  const dest = `${directory}vfm-${input.versionCode}.apk`;
  const download = FileSystem.createDownloadResumable(latestApkUrl(), dest, {}, (progress) => {
    const total = progress.totalBytesExpectedToWrite;
    input.onProgress(total > 0 ? progress.totalBytesWritten / total : 0);
  });
  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error('Preuzimanje APK-a nije uspjelo.');
  const hash = await sha256File(result.uri);
  if (hash !== input.sha256.toLowerCase()) throw new Error('Kontrolni zbroj APK-a se ne poklapa.');
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1,
    type: 'application/vnd.android.package-archive',
  });
}

async function sha256File(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
