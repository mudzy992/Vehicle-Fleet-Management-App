/**
 * `AttachmentsController` — `/api/v1/attachments/*` (docs/07 §2.12).
 *
 * | Ruta                                     | Permisija           | Audit          |
 * | ---------------------------------------- | ------------------- | -------------- |
 * | `POST /attachments` (multipart `file`)   | `attachment:upload` | CREATE         |
 * | `POST /attachments/complete`             | `attachment:upload` | UPDATE         |
 * | `GET /attachments?ownerType=&ownerId=`   | `attachment:view`   | —              |
 * | `GET /attachments/:id`                   | `attachment:view`   | —              |
 * | `GET /attachments/:id/url`               | `attachment:view`   | —              |
 * | `GET /attachments/:id/content`           | `attachment:view`   | FILE_ACCESS    |
 * | `GET /attachments/:id/content/:token`    | potpis (HMAC)       | FILE_ACCESS    |
 * | `POST /attachments/:id/replace`          | `attachment:upload` | UPDATE         |
 * | `DELETE /attachments/:id`                | `attachment:delete` | DELETE         |
 *
 * Potpisana ruta (`/content/:token`) je jedina **javna** ruta modula: token nosi
 * `exp` i HMAC potpis, pa `<img>`/preuzimanje rade bez `Authorization` headera
 * (mobilna i web galerija). Sve ostalo ide kroz sesiju i permisije.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  Attachment,
  AttachmentListQuery,
  AttachmentListResponse,
  AttachmentSignedUrl,
  AttachmentUploadResult,
  CompleteAttachmentInput,
} from '@vfm/shared/schemas';
import { attachmentListQuerySchema, completeAttachmentSchema, uuidSchema } from '@vfm/shared/schemas';
import { MAX_FILE_SIZE_BYTES } from '@vfm/shared';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, Public, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { VfmException } from '../../common/errors/vfm-error.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { AttachmentsService } from './attachments.service.js';
import type { UploadedFileLike } from './attachments.service.js';

/**
 * Tvrda granica multer-a (5 × `MAX_FILE_SIZE_BYTES`). Ne čita ENV pri importu:
 * stvarni limit je `ATTACHMENT_MAX_SIZE_MB` i provjerava ga servis
 * (`413 PAYLOAD_TOO_LARGE` s tačnim kodom); ovo je samo zaštita od memorijskog
 * bombnog uploada prije nego handler dobije fajl.
 */
const MULTER_HARD_LIMIT_BYTES = MAX_FILE_SIZE_BYTES * 5;

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @RequirePermissions('attachment:upload')
  @Audit('CREATE', { severity: 'INFO', resource: 'Attachment' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT_BYTES, files: 1 } }))
  async upload(
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<AttachmentUploadResult> {
    const result = await this.attachments.upload(file, actor);
    AuditContext.from(request)
      .setEntityId(result.id)
      .setResource('Attachment')
      .setAfter({ fileName: result.fileName, sha256: result.sha256, sizeBytes: result.sizeBytes });
    return result;
  }

  @Post('complete')
  @RequirePermissions('attachment:upload')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Attachment' })
  async complete(
    @Body(new ZodValidationPipe(completeAttachmentSchema, 'body')) input: CompleteAttachmentInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<Attachment> {
    const outcome = await this.attachments.complete(input.id, input, actor);
    AuditContext.from(request)
      .setEntityId(input.id)
      .setResource('Attachment')
      .setBefore(outcome.before)
      .setAfter(outcome.after);
    return outcome.data;
  }

  @Get()
  @RequirePermissions('attachment:view')
  list(
    @Query(new ZodValidationPipe(attachmentListQuerySchema, 'query')) query: AttachmentListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AttachmentListResponse> {
    return this.attachments.list(query, actor);
  }

  @Get(':id/url')
  @RequirePermissions('attachment:view')
  async signedUrl(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AttachmentSignedUrl> {
    // Postojanje i opseg se provjeravaju prije potpisa — URL se ne dijeli slijepo.
    await this.attachments.get(id, actor);
    return this.attachments.signUrl(id);
  }

  @Get(':id/content/:token')
  @Public()
  @Audit('FILE_ACCESS', { severity: 'INFO', resource: 'Attachment' })
  async signedContent(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Param('token') token: string,
    @Req() request: VfmRequest,
  ): Promise<StreamableFile> {
    if (!this.attachments.verifySignedToken(id, token)) {
      throw new VfmException('UNAUTHENTICATED', 'Potpisani URL je istekao ili nije valjan.');
    }
    return this.send(id, request);
  }

  @Get(':id/content')
  @RequirePermissions('attachment:view')
  @Audit('FILE_ACCESS', { severity: 'INFO', resource: 'Attachment' })
  content(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<StreamableFile> {
    return this.send(id, request, actor);
  }

  @Get(':id')
  @RequirePermissions('attachment:view')
  get(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Attachment> {
    return this.attachments.get(id, actor);
  }

  @Post(':id/replace')
  @RequirePermissions('attachment:upload')
  @Audit('UPDATE', { severity: 'WARN', resource: 'Attachment' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT_BYTES, files: 1 } }))
  async replace(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<Attachment> {
    const outcome = await this.attachments.replace(id, file, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Attachment')
      .setBefore(outcome.before)
      .setAfter(outcome.after);
    return outcome.data;
  }

  @Delete(':id')
  @RequirePermissions('attachment:delete')
  @Audit('DELETE', { severity: 'WARN', resource: 'Attachment' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<null> {
    const outcome = await this.attachments.remove(id, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Attachment')
      .setBefore(outcome.before)
      .setAfter(outcome.after);
    return outcome.data;
  }

  /** Zajednički stream + audit metapodaci (sadržaj se nikad ne loguje). */
  private async send(id: string, request: VfmRequest, actor?: AuthenticatedUser): Promise<StreamableFile> {
    const { attachment, buffer } = await this.attachments.content(id, actor);
    AuditContext.from(request)
      .setEntityId(attachment.id)
      .setResource('Attachment')
      .setAfter({ fileName: attachment.fileName, sizeBytes: attachment.sizeBytes });

    return new StreamableFile(buffer, {
      type: attachment.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      length: buffer.length,
    });
  }
}
