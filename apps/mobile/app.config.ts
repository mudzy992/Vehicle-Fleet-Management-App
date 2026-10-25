import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? config.android?.versionCode ?? 1);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('ANDROID_VERSION_CODE mora biti pozitivan cijeli broj.');
  }

  const android = { ...config.android };
  if (existsSync('./google-services.json')) android.googleServicesFile = './google-services.json';
  else delete android.googleServicesFile;

  return {
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
};
