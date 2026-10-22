/**
 * `DriversController` — `/api/v1/drivers/*` (docs/07 §2.4).
 *
 * | Ruta                                          | Permisija        | Audit                |
 * | --------------------------------------------- | ---------------- | -------------------- |
 * | `GET /drivers`                                | `driver:view`    | —                    |
 * | `POST /drivers`                               | `driver:create`  | `CREATE`             |
 * | `GET /drivers/:id`                            | `driver:view`    | —                    |
 * | `PATCH /drivers/:id`                          | `driver:update`  | `UPDATE`             |
 * | `POST /drivers/:id/archive` · `/restore`      | `driver:archive` | `ARCHIVE`/`RESTORE`  |
 * | `DELETE /drivers/:id`                         | `driver:delete`  | `DELETE` (CRITICAL)  |
 * | `GET /drivers/:id/license-categories`         | `driver:view`    | —                    |
 * | `POST /drivers/:id/license-categories`        | `driver:update`  | `UPDATE`             |
 * | `PATCH .../license-categories/:catId`         | `driver:update`  | `UPDATE`             |
 * | `DELETE .../license-categories/:catId`        | `driver:update`  | `DELETE` (WARN)      |
 *
 * PII (`phone`, `email`, `dateOfBirth`, `address`, `licenseNumber`) se vraća
 * samo uz `driver:view_pii` (B-20, R-07); servis odlučuje na osnovu aktera, pa
 * kontroler samo prosljeđuje `AuthenticatedUser`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type {
  ArchiveDriverInput,
  CreateDriverInput,
  CreateDriverLicenseCategoryInput,
  DriverDetail,
  DriverLicenseCategory,
  DriverLicenseCategoryList,
  DriverListQuery,
  DriverListResponse,
  UpdateDriverInput,
  UpdateDriverLicenseCategoryInput,
} from '@vfm/shared/schemas';
import {
  archiveDriverSchema,
  createDriverLicenseCategorySchema,
  createDriverSchema,
  driverListQuerySchema,
  updateDriverLicenseCategorySchema,
  updateDriverSchema,
  uuidSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { DriversService } from './drivers.service.js';

@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermissions('driver:view')
  list(
    @Query(new ZodValidationPipe(driverListQuerySchema, 'query')) query: DriverListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DriverListResponse> {
    return this.drivers.list(query, actor);
  }

  @Post()
  @RequirePermissions('driver:create')
  // PII se upisuje, ali se u audit log ne stavlja (docs/05 §8).
  @Audit('CREATE', { severity: 'INFO', resource: 'Driver' })
  async create(
    @Body(new ZodValidationPipe(createDriverSchema, 'body')) input: CreateDriverInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<DriverDetail> {
    const outcome = await this.drivers.create(input, actor);
    AuditContext.from(request).setEntityId(outcome.data.id).setAfter(outcome.after).setResource('Driver');
    return outcome.data;
  }

  @Get(':id')
  @RequirePermissions('driver:view')
  get(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DriverDetail> {
    return this.drivers.get(id, actor);
  }

  @Patch(':id')
  @RequirePermissions('driver:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Driver' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateDriverSchema, 'body')) input: UpdateDriverInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<DriverDetail> {
    const outcome = await this.drivers.update(id, input, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Driver');
    return outcome.data;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('driver:archive')
  @Audit('ARCHIVE', { severity: 'WARN', resource: 'Driver' })
  async archive(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(archiveDriverSchema, 'body', { allowEmpty: true }))
    input: ArchiveDriverInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.drivers.archive(id, input, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Driver')
      .set('reason', input.reason ?? null);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('driver:archive')
  @Audit('RESTORE', { severity: 'WARN', resource: 'Driver' })
  async restore(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.drivers.restore(id, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Driver');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('driver:delete')
  @Audit('DELETE', { severity: 'CRITICAL', resource: 'Driver' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.drivers.remove(id, actor.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Driver');
  }

  // --- Kategorije dozvole ----------------------------------------------------

  @Get(':id/license-categories')
  @RequirePermissions('driver:view')
  listLicenseCategories(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DriverLicenseCategoryList> {
    return this.drivers.listLicenseCategories(id, actor);
  }

  @Post(':id/license-categories')
  @RequirePermissions('driver:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Driver' })
  async addLicenseCategory(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(createDriverLicenseCategorySchema, 'body'))
    input: CreateDriverLicenseCategoryInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<DriverLicenseCategory> {
    const outcome = await this.drivers.addLicenseCategory(id, input, actor.id, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Driver')
      .setAfter(outcome.after)
      .set('categoryId', outcome.data.id);
    return outcome.data;
  }

  @Patch(':id/license-categories/:categoryId')
  @RequirePermissions('driver:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Driver' })
  async updateLicenseCategory(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Param('categoryId', new ZodValidationPipe(uuidSchema, 'params')) categoryId: string,
    @Body(new ZodValidationPipe(updateDriverLicenseCategorySchema, 'body'))
    input: UpdateDriverLicenseCategoryInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<DriverLicenseCategory> {
    const outcome = await this.drivers.updateLicenseCategory(id, categoryId, input, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Driver')
      .setBefore(outcome.before)
      .setAfter(outcome.after);
    return outcome.data;
  }

  @Delete(':id/license-categories/:categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('driver:update')
  @Audit('DELETE', { severity: 'WARN', resource: 'Driver' })
  async removeLicenseCategory(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Param('categoryId', new ZodValidationPipe(uuidSchema, 'params')) categoryId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.drivers.removeLicenseCategory(id, categoryId, actor);
    AuditContext.from(request).setEntityId(id).setResource('Driver').setBefore(outcome.before);
  }
}
