import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppReleasesService } from '../../src/modules/app-releases/app-releases.service.js';
import { APP_RELEASE_OPTIONS } from '../../src/modules/app-releases/app-releases.types.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { buildTestApk } from './apk-test-builder.js';

const superAdmin = { id: 'admin-1', isSuperAdmin: true };
const administrator = { id: 'user-1', isSuperAdmin: false };

function fakePrisma(latest: { versionCode: number } | null = null) {
  const created = {
    id: 'rel-1',
    versionCode: 5,
    versionName: '1.0.5',
    fileName: 'app.apk',
    storageKey: 'app-releases/5-hash.apk',
    sha256: 'abc',
    sizeBytes: 12,
    releaseNotes: null,
    isLatest: true,
    createdAt: new Date('2026-10-31T00:00:00.000Z'),
    retiredAt: null,
  };
  const prisma = {
    appRelease: {
      findFirst: vi.fn(async () => latest),
      findMany: vi.fn(async () => [created]),
      findUnique: vi.fn(async () => created),
      findUniqueOrThrow: vi.fn(async () => created),
      create: vi.fn(async ({ data }: { data: typeof created }) => ({ ...created, ...data })),
      update: vi.fn(async () => created),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  return prisma;
}

describe('AppReleasesService', () => {
  let root: string;
  let service: AppReleasesService;
  let prisma: ReturnType<typeof fakePrisma>;
  const realtime = { emitRefresh: vi.fn() };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vfm-apk-'));
    prisma = fakePrisma(null);
    service = new AppReleasesService(prisma as never, realtime as never, {
      rootPath: root,
      tempPath: join(root, 'tmp'),
      maxSizeBytes: 10 * 1024 * 1024,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('hard Super Admin gate odbija administratora', async () => {
    await expect(service.list(administrator)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(() => service.assertSuperAdmin(administrator)).toThrow(VfmException);
  });

  it('novi versionCode mora biti strogo veći od latest', async () => {
    prisma = fakePrisma({ versionCode: 10 });
    service = new AppReleasesService(prisma as never, realtime as never, {
      rootPath: root,
      tempPath: join(root, 'tmp'),
      maxSizeBytes: 10 * 1024 * 1024,
    });
    const apk = buildTestApk(10, '1.0.10');
    await expect(
      service.upload({ buffer: apk, originalname: 'app.apk', size: apk.length }, undefined, superAdmin),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('upload Super Admina upisuje latest i emituje realtime', async () => {
    const apk = buildTestApk(3, '1.0.3');
    const result = await service.upload(
      { buffer: apk, originalname: 'vozni.apk', size: apk.length },
      'Prvo izdanje',
      superAdmin,
    );
    expect(result.versionCode).toBe(3);
    expect(result.versionName).toBe('1.0.3');
    expect(result.isLatest).toBe(true);
    expect(realtime.emitRefresh).toHaveBeenCalledWith('app-releases');
    expect(prisma.appRelease.create).toHaveBeenCalled();
  });
});

describe('APP_RELEASE_OPTIONS token', () => {
  it('postoji za DI u testovima', () => {
    expect(APP_RELEASE_OPTIONS).toBe('VFM_APP_RELEASE_OPTIONS');
  });
});
