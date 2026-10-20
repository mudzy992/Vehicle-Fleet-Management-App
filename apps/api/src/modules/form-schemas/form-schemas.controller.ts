/**
 * `FormSchemasController` — `/api/v1/form-schemas/*` (docs/07 §2.9, docs/04 §12).
 *
 * | Ruta                                              | Permisija               | Audit         |
 * | ------------------------------------------------- | ----------------------- | ------------- |
 * | `GET /form-schemas`                               | `form:view`             | —             |
 * | `GET /form-schemas/active`                        | `form:view`             | —             |
 * | `POST /form-schemas`                              | `form:create`           | `CREATE`      |
 * | `GET /form-schemas/:id`                           | `form:view`             | —             |
 * | `PATCH /form-schemas/:id`                         | `form:update`           | `UPDATE`      |
 * | `POST /form-schemas/:id/versions`                 | `form:update`           | `CREATE`      |
 * | `GET /form-schemas/:id/versions/:vid`             | `form:view`             | —             |
 * | `PUT /form-schemas/:id/versions/:vid`             | `form:manage_schema`    | `UPDATE`      |
 * | `DELETE /form-schemas/:id/versions/:vid`          | `form:manage_schema`    | `DELETE`      |
 * | `POST .../versions/:vid/validate`                 | `form:view`             | —             |
 * | `POST .../versions/:vid/publish`                  | `form:publish_version`  | `FORM_PUBLISH`|
 * | `POST .../versions/:vid/retire`                   | `form:retire_version`   | `FORM_RETIRE` |
 * | `GET /form-schemas/:id/diff?from=&to=`            | `form:view`             | —             |
 *
 * ⚠️ `active` mora biti deklarisan **prije** `:id`, inače ga Nest tretira kao
 * UUID (docs/07 §2.3 ista zamka).
 *
 * `GET .../versions/:vid` i `GET /form-schemas/active` nose `ETag` =
 * `"<contentHash>"`; uz `If-None-Match` isti tag se vraća `304` bez tijela —
 * objavljena definicija je nepromjenjiva, pa je keš na klijentu siguran
 * (docs/04 §11, mobilna kešira po `contentHash`).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  ActiveFormSchema,
  ActiveFormSchemaQuery,
  CreateFormSchemaInput,
  CreateFormVersionInput,
  FormSchemaDetail,
  FormSchemaListQuery,
  FormSchemaSummary,
  FormValidationResponse,
  FormVersionDetail,
  FormVersionDiff,
  PublishFormVersionInput,
  RetireFormVersionInput,
  UpdateFormSchemaInput,
  UpdateFormVersionInput,
  ValidateFormValuesInput,
} from '@vfm/shared/schemas';
import {
  activeFormSchemaQuerySchema,
  createFormSchemaSchema,
  createFormVersionSchema,
  formSchemaListQuerySchema,
  publishFormVersionSchema,
  retireFormVersionSchema,
  updateFormSchemaSchema,
  updateFormVersionSchema,
  uuidSchema,
  validateFormValuesSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { FormSchemasService } from './form-schemas.service.js';

/** `true` kad klijentov `If-None-Match` pokriva dati ETag (`*` ili lista). */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const normalized = etag.replace(/^W\//u, '').replace(/"/gu, '');
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//u, '').replace(/"/gu, ''))
    .some((part) => part === '*' || part === normalized);
}

@Controller('form-schemas')
export class FormSchemasController {
  constructor(private readonly forms: FormSchemasService) {}

  @Get()
  @RequirePermissions('form:view')
  list(
    @Query(new ZodValidationPipe(formSchemaListQuerySchema, 'query')) query: FormSchemaListQuery,
  ): Promise<FormSchemaSummary[]> {
    return this.forms.list(query);
  }

  /** Aktivna verzija za subject/tip zadatka (renderer i mobilna keširaju po ETag-u). */
  @Get('active')
  @RequirePermissions('form:view')
  async active(
    @Query(new ZodValidationPipe(activeFormSchemaQuerySchema, 'query')) query: ActiveFormSchemaQuery,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ActiveFormSchema | undefined> {
    const active = await this.forms.active(query);
    const etag = FormSchemasService.etagOf(active.contentHash);
    response.setHeader('ETag', etag);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return active;
  }

  @Post()
  @RequirePermissions('form:create')
  @Audit('CREATE', { resource: 'FormSchema' })
  async create(
    @Body(new ZodValidationPipe(createFormSchemaSchema, 'body')) input: CreateFormSchemaInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<FormSchemaDetail> {
    const outcome = await this.forms.create(input, user?.id);
    AuditContext.from(request)
      .setAfter(outcome.after)
      .setEntityId(outcome.data.id)
      .set('key', outcome.data.key);
    return outcome.data;
  }

  @Get(':id')
  @RequirePermissions('form:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string): Promise<FormSchemaDetail> {
    return this.forms.get(id);
  }

  @Patch(':id')
  @RequirePermissions('form:update')
  @Audit('UPDATE', { resource: 'FormSchema' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Body(new ZodValidationPipe(updateFormSchemaSchema, 'body')) input: UpdateFormSchemaInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<FormSchemaDetail> {
    const outcome = await this.forms.update(id, input, user?.id);
    AuditContext.from(request).setBefore(outcome.before).setAfter(outcome.after).set('formSchemaId', id);
    return outcome.data;
  }

  @Post(':id/versions')
  @RequirePermissions('form:update')
  @Audit('CREATE', { resource: 'FormSchemaVersion' })
  async createVersion(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Body(new ZodValidationPipe(createFormVersionSchema, 'body')) input: CreateFormVersionInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<FormVersionDetail> {
    const outcome = await this.forms.createVersion(id, input, user?.id);
    AuditContext.from(request)
      .setAfter(outcome.after)
      .set('formSchemaId', id)
      .set('formSchemaVersionId', outcome.data.id);
    return outcome.data;
  }

  /** Definicija verzije s `ETag`-om (`If-None-Match` → `304`). */
  @Get(':id/versions/:vid')
  @RequirePermissions('form:view')
  async getVersion(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Param('vid', new ZodValidationPipe(uuidSchema, 'param')) vid: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FormVersionDetail | undefined> {
    const version = await this.forms.getVersion(id, vid);
    const etag = FormSchemasService.etagOf(version.contentHash ?? '');
    response.setHeader('ETag', etag);
    if (version.contentHash && matchesIfNoneMatch(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return version;
  }

  @Put(':id/versions/:vid')
  @RequirePermissions('form:manage_schema')
  @Audit('UPDATE', { resource: 'FormSchemaVersion' })
  async updateVersion(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Param('vid', new ZodValidationPipe(uuidSchema, 'param')) vid: string,
    @Body(new ZodValidationPipe(updateFormVersionSchema, 'body')) input: UpdateFormVersionInput,
    @Req() request: VfmRequest,
  ): Promise<FormVersionDetail> {
    const outcome = await this.forms.updateVersion(id, vid, input);
    AuditContext.from(request)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .set('formSchemaId', id)
      .set('formSchemaVersionId', vid);
    return outcome.data;
  }

  @Delete(':id/versions/:vid')
  @RequirePermissions('form:manage_schema')
  @Audit('DELETE', { resource: 'FormSchemaVersion' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVersion(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Param('vid', new ZodValidationPipe(uuidSchema, 'param')) vid: string,
    @Req() request: VfmRequest,
  ): Promise<void> {
    await this.forms.deleteVersion(id, vid);
    AuditContext.from(request)
      .setBefore({ formSchemaVersionId: vid })
      .set('formSchemaId', id)
      .set('formSchemaVersionId', vid);
  }

  /** Provjera `formValues` prema verziji — isti engine koji koristi svaki zapis. */
  @Post(':id/versions/:vid/validate')
  @RequirePermissions('form:view')
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Param('vid', new ZodValidationPipe(uuidSchema, 'param')) vid: string,
    @Body(new ZodValidationPipe(validateFormValuesSchema, 'body')) input: ValidateFormValuesInput,
  ): Promise<FormValidationResponse> {
    return this.forms.validateValues(id, vid, input);
  }

  @Post(':id/versions/:vid/publish')
  @RequirePermissions('form:publish_version')
  @HttpCode(HttpStatus.OK)
  @Audit('FORM_PUBLISH', { resource: 'FormSchemaVersion' })
  async publish(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Param('vid', new ZodValidationPipe(uuidSchema, 'param')) vid: string,
    @Body(new ZodValidationPipe(publishFormVersionSchema, 'body')) input: PublishFormVersionInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<FormVersionDetail> {
    const outcome = await this.forms.publish(id, vid, input, user?.id);
    AuditContext.from(request)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .set('formSchemaId', id)
      .set('formSchemaVersionId', vid)
      .set('contentHash', outcome.data.contentHash);
    return outcome.data;
  }

  @Post(':id/versions/:vid/retire')
  @RequirePermissions('form:retire_version')
  @HttpCode(HttpStatus.OK)
  @Audit('FORM_RETIRE', { resource: 'FormSchemaVersion' })
  async retire(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Param('vid', new ZodValidationPipe(uuidSchema, 'param')) vid: string,
    @Body(new ZodValidationPipe(retireFormVersionSchema, 'body')) input: RetireFormVersionInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<FormVersionDetail> {
    const outcome = await this.forms.retire(id, vid, input, user?.id);
    AuditContext.from(request)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .set('formSchemaId', id)
      .set('formSchemaVersionId', vid);
    return outcome.data;
  }

  @Get(':id/diff')
  @RequirePermissions('form:view')
  diff(
    @Param('id', new ZodValidationPipe(uuidSchema, 'param')) id: string,
    @Query('from', new ZodValidationPipe(uuidSchema, 'query')) from: string,
    @Query('to', new ZodValidationPipe(uuidSchema, 'query')) to: string,
  ): Promise<FormVersionDiff> {
    return this.forms.diff(id, from, to);
  }
}
