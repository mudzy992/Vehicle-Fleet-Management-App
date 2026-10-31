import { Body, Controller, Get, Param, Post, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { uuidSchema } from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import {
  AllowedClientTypes,
  Audit,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { AppReleasesService } from './app-releases.service.js';
import type { AppReleaseLatest, AppReleaseListItem, UploadedApkFile } from './app-releases.types.js';
import { APK_MIME } from './app-releases.types.js';

const MULTER_HARD_LIMIT_BYTES = 512 * 1024 * 1024;

@Controller('app-releases')
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  @Get('latest')
  @Public()
  latest(): Promise<AppReleaseLatest> {
    return this.releases.latest();
  }

  @Get('latest/file')
  @Public()
  async latestFile(): Promise<StreamableFile> {
    const { row, stream } = await this.releases.file();
    return new StreamableFile(stream, {
      type: APK_MIME,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      length: row.sizeBytes,
    });
  }

  @Get()
  @RequirePermissions('app_release:manage')
  @AllowedClientTypes('WEB')
  list(@CurrentUser() actor: AuthenticatedUser): Promise<{ items: AppReleaseListItem[] }> {
    return this.releases.list(actor);
  }

  @Post()
  @RequirePermissions('app_release:manage')
  @AllowedClientTypes('WEB')
  @RateLimit('upload')
  @Audit('CREATE', { severity: 'INFO', resource: 'AppRelease' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT_BYTES, files: 1 } }))
  async upload(
    @UploadedFile() file: UploadedApkFile | undefined,
    @Body() body: { releaseNotes?: string },
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<AppReleaseListItem> {
    const result = await this.releases.upload(file, body?.releaseNotes, actor);
    AuditContext.from(request)
      .setEntityId(result.id)
      .setResource('AppRelease')
      .setAfter({ versionCode: result.versionCode, versionName: result.versionName, sha256: result.sha256 });
    return result;
  }

  @Post(':id/activate')
  @RequirePermissions('app_release:manage')
  @AllowedClientTypes('WEB')
  @Audit('UPDATE', { severity: 'WARN', resource: 'AppRelease' })
  async activate(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<AppReleaseListItem> {
    const result = await this.releases.activate(id, actor);
    AuditContext.from(request)
      .setEntityId(result.id)
      .setResource('AppRelease')
      .setAfter({ versionCode: result.versionCode, isLatest: result.isLatest });
    return result;
  }
}
