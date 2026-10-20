/**
 * `FormMigrationsController` — `/api/v1/form-migrations` (docs/07 §2.9, P12).
 *
 * | Ruta                          | Permisija              | Audit         |
 * | ----------------------------- | ---------------------- | ------------- |
 * | `GET /form-migrations`        | `form:view`            | —             |
 * | `POST /form-migrations`       | `form:migrate_records` | `FORM_MIGRATE`|
 * | `GET /form-migrations/:id`    | `form:view`            | —             |
 * | `POST .../:id/preview`        | `form:migrate_records` | —             |
 * | `POST .../:id/apply`          | `form:migrate_records` | `FORM_MIGRATE`|
 * | `POST .../:id/rollback`       | `form:migrate_records` | `FORM_MIGRATE`|
 *
 * Migracija je **uvijek eksplicitna**: `preview` ništa ne mijenja, `apply` traži
 * bilješku, a `rollback` vraća `before` snapshot iz `FormMigrationItem`.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type {
  CreateFormMigrationInput,
  FormMigrationJob,
  FormMigrationPreview,
  RollbackFormMigrationInput,
  RunFormMigrationInput,
} from '@vfm/shared/schemas';
import {
  createFormMigrationSchema,
  rollbackFormMigrationSchema,
  runFormMigrationSchema,
  uuidSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { FormMigrationsService } from './form-migrations.service.js';

@Controller('form-migrations')
export class FormMigrationsController {
  constructor(private readonly migrations: FormMigrationsService) {}

  @Get()
  @RequirePermissions('form:view')
  list(
    @Query('formSchemaId', new ZodValidationPipe(uuidSchema.optional(), 'query'))
    formSchemaId: string | undefined,
  ): Promise<FormMigrationJob[]> {
    return this.migrations.list(formSchemaId);
  }

  @Post()
  @RequirePermissions('form:migrate_records')
  @Audit('FORM_MIGRATE', { resource: 'FormMigrationJob' })
  async create(
    @Body(new ZodValidationPipe(createFormMigrationSchema, 'body')) input: CreateFormMigrationInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<FormMigrationJob> {
    const job = await this.migrations.create(input, user?.id);
    AuditContext.from(request).setEntityId(job.id).setAfter({
      formSchemaId: job.formSchemaId,
      fromVersionId: job.fromVersionId,
      toVersionId: job.toVersionId,
      targetEntityType: job.targetEntityType,
      status: job.status,
    });
    return job;
  }

  @Get(':id')
  @RequirePermissions('form:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string): Promise<FormMigrationPreview> {
    return this.migrations.get(id);
  }

  @Post(':id/preview')
  @RequirePermissions('form:migrate_records')
  @HttpCode(HttpStatus.OK)
  preview(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
  ): Promise<FormMigrationPreview> {
    return this.migrations.preview(id);
  }

  @Post(':id/apply')
  @RequirePermissions('form:migrate_records')
  @HttpCode(HttpStatus.OK)
  @Audit('FORM_MIGRATE', { resource: 'FormMigrationJob' })
  async apply(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Body(new ZodValidationPipe(runFormMigrationSchema, 'body')) input: RunFormMigrationInput,
    @Req() request: VfmRequest,
  ): Promise<FormMigrationJob> {
    const job = await this.migrations.apply(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setAfter({ status: job.status, summary: job.summary, changeNote: input.changeNote.trim() });
    return job;
  }

  @Post(':id/rollback')
  @RequirePermissions('form:migrate_records')
  @HttpCode(HttpStatus.OK)
  @Audit('FORM_MIGRATE', { resource: 'FormMigrationJob' })
  async rollback(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Body(new ZodValidationPipe(rollbackFormMigrationSchema, 'body')) input: RollbackFormMigrationInput,
    @Req() request: VfmRequest,
  ): Promise<FormMigrationJob> {
    const job = await this.migrations.rollback(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setAfter({ status: job.status, changeNote: input.changeNote.trim(), rollback: true });
    return job;
  }
}
