/**
 * `VehiclesController` — `/api/v1/vehicles/*` (docs/07 §2.5).
 *
 * | Ruta                          | Permisija         | Audit              |
 * | ----------------------------- | ----------------- | ------------------ |
 * | `GET /vehicles`               | `vehicle:view`    | —                  |
 * | `POST /vehicles`              | `vehicle:create`  | `CREATE`           |
 * | `GET /vehicles/:id`           | `vehicle:view`    | —                  |
 * | `PATCH /vehicles/:id`         | `vehicle:update`  | `UPDATE`           |
 * | `POST /vehicles/:id/archive`  | `vehicle:archive` | `ARCHIVE` (WARN)   |
 * | `POST /vehicles/:id/restore`  | `vehicle:archive` | `RESTORE`          |
 * | `DELETE /vehicles/:id`        | `vehicle:delete`  | `DELETE` (CRITICAL)|
 * | `GET /vehicles/:id/odometer`  | `odometer:view`   | —                  |
 * | `POST /vehicles/:id/odometer` | `odometer:create` | `UPDATE`           |
 * | `POST .../odometer/correct`   | `odometer:correct`| `UPDATE` (WARN)    |
 *
 * Vozilo se kreira **kroz dinamičku formu** (`formData`), pa je audit diff nad
 * meta podacima i normalizovanim kolonama; same vrijednosti forme ostaju u
 * `formData` uz verziju forme koja ih je validirala (P10).
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
  ArchiveVehicleInput,
  CorrectOdometerReadingInput,
  CreateOdometerReadingInput,
  CreateVehicleInput,
  OdometerListResponse,
  OdometerReading,
  UpdateVehicleInput,
  VehicleDetail,
  PaginationQuery,
  VehicleListQuery,
  VehicleListResponse,
} from '@vfm/shared/schemas';
import {
  archiveVehicleSchema,
  correctOdometerReadingSchema,
  createOdometerReadingSchema,
  createVehicleSchema,
  paginationQuerySchema,
  updateVehicleSchema,
  uuidSchema,
  vehicleListQuerySchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { VehiclesService } from './vehicles.service.js';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions('vehicle:view')
  list(
    @Query(new ZodValidationPipe(vehicleListQuerySchema, 'query')) query: VehicleListQuery,
  ): Promise<VehicleListResponse> {
    return this.vehicles.list(query);
  }

  @Post()
  @RequirePermissions('vehicle:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'Vehicle' })
  async create(
    @Body(new ZodValidationPipe(createVehicleSchema, 'body')) input: CreateVehicleInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<VehicleDetail> {
    const outcome = await this.vehicles.create(input, actor?.id);
    AuditContext.from(request).setEntityId(outcome.data.id).setAfter(outcome.after).setResource('Vehicle');
    return outcome.data;
  }

  @Get(':id')
  @RequirePermissions('vehicle:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string): Promise<VehicleDetail> {
    return this.vehicles.get(id);
  }

  @Patch(':id')
  @RequirePermissions('vehicle:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Vehicle' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema, 'body')) input: UpdateVehicleInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<VehicleDetail> {
    const outcome = await this.vehicles.update(id, input, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Vehicle');
    return outcome.data;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('vehicle:archive')
  @Audit('ARCHIVE', { severity: 'WARN', resource: 'Vehicle' })
  async archive(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(archiveVehicleSchema, 'body', { allowEmpty: true }))
    input: ArchiveVehicleInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.vehicles.archive(id, input, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Vehicle')
      .set('reason', input.reason ?? null);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('vehicle:archive')
  @Audit('RESTORE', { severity: 'WARN', resource: 'Vehicle' })
  async restore(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.vehicles.restore(id, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Vehicle');
  }

  // --- Kilometraža (docs/07 §2.5) --------------------------------------------

  @Get(':id/odometer')
  @RequirePermissions('odometer:view')
  listOdometer(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema, 'query')) query: PaginationQuery,
  ): Promise<OdometerListResponse> {
    return this.vehicles.listOdometer(id, query);
  }

  @Post(':id/odometer')
  @RequirePermissions('odometer:create')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Vehicle' })
  async addOdometer(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(createOdometerReadingSchema, 'body')) input: CreateOdometerReadingInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<OdometerReading> {
    const outcome = await this.vehicles.addOdometer(id, input, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Vehicle')
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .set('odometerReadingId', outcome.data.id);
    return outcome.data;
  }

  @Post(':id/odometer/correct')
  @RequirePermissions('odometer:correct')
  @Audit('UPDATE', { severity: 'WARN', resource: 'Vehicle' })
  async correctOdometer(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(correctOdometerReadingSchema, 'body')) input: CorrectOdometerReadingInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<OdometerReading> {
    const outcome = await this.vehicles.correctOdometer(id, input, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Vehicle')
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .set('correctionReason', input.correctionReason);
    return outcome.data;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('vehicle:delete')
  @Audit('DELETE', { severity: 'CRITICAL', resource: 'Vehicle' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.vehicles.remove(id, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Vehicle');
  }
}
