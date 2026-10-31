import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseApkIdentity, parseAndroidManifest } from '../../src/modules/app-releases/apk-manifest.js';
import { isZipBuffer } from '../../src/modules/app-releases/apk-zip.js';
import { buildAndroidManifest, buildTestApk } from './apk-test-builder.js';

describe('parseAndroidManifest', () => {
  it('čita versionCode i versionName iz AXML string pool-a', () => {
    const identity = parseAndroidManifest(buildAndroidManifest(42, '1.4.0'));
    expect(identity).toEqual({ versionCode: 42, versionName: '1.4.0' });
  });

  it('odbacuje manifest bez versionCode', () => {
    expect(() => parseAndroidManifest(Buffer.from('not-axml'))).toThrow(/versionCode/u);
  });
});

describe('parseApkIdentity', () => {
  it('izvlači identitet iz ZIP/APK spremnika', () => {
    const apk = buildTestApk(7, '1.0.7');
    expect(isZipBuffer(apk)).toBe(true);
    expect(parseApkIdentity(apk)).toEqual({ versionCode: 7, versionName: '1.0.7' });
  });
});

describe('storage key helper smoke', () => {
  it('tmp dir postoji za upload testove', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vfm-apk-'));
    expect(dir.length).toBeGreaterThan(4);
    await rm(dir, { recursive: true, force: true });
  });
});
