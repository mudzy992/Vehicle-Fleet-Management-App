import { existsSync } from 'node:fs';
import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const withCleartextForLocalApi: ConfigPlugin = (config) =>
  withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? config.android?.versionCode ?? 1);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('ANDROID_VERSION_CODE mora biti pozitivan cijeli broj.');
  }

  const android = { ...config.android };
  if (existsSync('./google-services.json')) android.googleServicesFile = './google-services.json';
  else delete android.googleServicesFile;
  const expoConfig: ExpoConfig = {
    ...config,
    name: config.name ?? 'Vozni park',
    slug: config.slug ?? 'vfm-mobile',
    version: process.env.ANDROID_VERSION_NAME ?? config.version ?? '1.0.0',
    android: {
      ...android,
      package: process.env.ANDROID_PACKAGE ?? config.android?.package ?? 'ba.ba101.voznipark',
      versionCode,
    },
  };

  // Android blocks cleartext HTTP by default. Enable it only when an HTTP API
  // URL is explicitly configured; production EAS profiles use HTTPS.
  return process.env.EXPO_PUBLIC_API_URL?.startsWith('http://')
    ? withCleartextForLocalApi(expoConfig)
    : expoConfig;
};
