import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? config.android?.versionCode ?? 1);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('ANDROID_VERSION_CODE mora biti pozitivan cijeli broj.');
  }

  return {
    ...config,
    name: config.name ?? 'Vozni park',
    slug: config.slug ?? 'vfm-mobile',
    version: process.env.ANDROID_VERSION_NAME ?? config.version ?? '1.0.0',
    android: {
      ...config.android,
      package: process.env.ANDROID_PACKAGE ?? config.android?.package ?? 'ba.example.voznipark',
      versionCode,
    },
  };
};
