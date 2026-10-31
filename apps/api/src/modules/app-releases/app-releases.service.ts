import { Inject, Injectable, Optional } from '@nestjs/common';
import { maxAppReleaseSizeBytes } from '@vfm/shared/env';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { APP_RELEASE_SELECT, persistPreparedApk, prepareApkUpload } from './app-releases-write.js';
import { buildApkStorageKey, openApkStream, writeApkFile } from './app-release-storage.js';
import { toLatestDto, toListItem } from './app-releases.mapper.js';
import type {
  AppReleaseActor,
  AppReleaseLatest,
  AppReleaseListItem,
  AppReleaseOptions,
  AppReleaseRow,
  UploadedApkFile,
} from './app-releases.types.js';
import { APP_RELEASE_OPTIONS } from './app-releases.types.js';

@Injectable()
export class AppReleasesService {
  private readonly overrides?: Partial<AppReleaseOptions>;
  private resolved?: AppReleaseOptions;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @Optional() @Inject(APP_RELEASE_OPTIONS) overrides?: Partial<AppReleaseOptions>,
  ) {
    this.overrides = overrides ?? undefined;
  }

  private get options(): AppReleaseOptions {
    if (!this.resolved) this.resolved = resolveOptions(this.overrides);
    return this.resolved;
  }

  async latest(): Promise<AppReleaseLatest> {
    const row = await this.prisma.appRelease.findFirst({ where: { isLatest: true }, select: APP_RELEASE_SELECT });
    if (!row) throw VfmErrors.notFound('izdanje aplikacije');
    return toLatestDto(row);
  }

  async list(actor: AppReleaseActor): Promise<{ items: AppReleaseListItem[] }> {
    this.assertSuperAdmin(actor);
    const rows = await this.prisma.appRelease.findMany({ orderBy: { versionCode: 'desc' }, select: APP_RELEASE_SELECT });
    return { items: rows.map(toListItem) };
  }

  async upload(
    file: UploadedApkFile | undefined,
    releaseNotes: string | undefined,
    actor: AppReleaseActor,
  ): Promise<AppReleaseListItem> {
    this.assertSuperAdmin(actor);
    const prepared = prepareApkUpload(file, releaseNotes, this.options.maxSizeBytes);
    const latest = await this.prisma.appRelease.findFirst({ where: { isLatest: true }, select: APP_RELEASE_SELECT });
    if (latest && prepared.identity.versionCode <= latest.versionCode) {
      throw VfmErrors.validationError([
        { path: ['versionCode'], message: `versionCode mora biti veći od ${latest.versionCode}.`, code: 'VERSION' },
      ]);
    }
    const storageKey = buildApkStorageKey(prepared.identity.versionCode, prepared.sha256);
    await writeApkFile(this.options, storageKey, prepared.buffer);
    const created = await persistPreparedApk(this.prisma, prepared, storageKey, actor.id);
    this.realtime.emitRefresh('app-releases');
    return toListItem(created);
  }

  async activate(id: string, actor: AppReleaseActor): Promise<AppReleaseListItem> {
    this.assertSuperAdmin(actor);
    const row = await this.prisma.appRelease.findUnique({ where: { id }, select: APP_RELEASE_SELECT });
    if (!row) throw VfmErrors.notFound('izdanje aplikacije');
    if (row.isLatest) return toListItem(row);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.appRelease.updateMany({
        where: { isLatest: true },
        data: { isLatest: false, retiredAt: now },
      }),
      this.prisma.appRelease.update({ where: { id }, data: { isLatest: true, retiredAt: null } }),
    ]);
    this.realtime.emitRefresh('app-releases');
    const updated = await this.prisma.appRelease.findUniqueOrThrow({ where: { id }, select: APP_RELEASE_SELECT });
    return toListItem(updated);
  }

  async file(): Promise<{ row: AppReleaseRow; stream: ReturnType<typeof openApkStream> }> {
    const row = await this.prisma.appRelease.findFirst({ where: { isLatest: true }, select: APP_RELEASE_SELECT });
    if (!row) throw VfmErrors.notFound('izdanje aplikacije');
    return { row, stream: openApkStream(this.options.rootPath, row.storageKey) };
  }

  assertSuperAdmin(actor: AppReleaseActor): void {
    if (!actor.isSuperAdmin) {
      throw VfmErrors.permissionDenied([
        { path: ['app_release'], message: 'Samo Super Admin može upravljati izdanjima aplikacije.', code: 'FORBIDDEN' },
      ]);
    }
  }
}

function resolveOptions(overrides?: Partial<AppReleaseOptions>): AppReleaseOptions {
  if (overrides?.rootPath && overrides.tempPath && overrides.maxSizeBytes) {
    return { rootPath: overrides.rootPath, tempPath: overrides.tempPath, maxSizeBytes: overrides.maxSizeBytes };
  }
  const env = getEnv();
  return {
    rootPath: env.VFM_STORAGE_CONTAINER_PATH,
    tempPath: env.ATTACHMENT_TEMP_PATH,
    maxSizeBytes: maxAppReleaseSizeBytes(env),
    ...overrides,
  };
}
