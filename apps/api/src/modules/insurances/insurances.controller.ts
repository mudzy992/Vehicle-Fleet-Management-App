/**
 * `InsurancesController` — `/api/v1/insurances` (docs/07 §2.6).
 *
 * | Ruta                        | Permisija            | Audit                |
 * | --------------------------- | -------------------- | -------------------- |
 * | `GET /insurances`        | `insurance:view`  | —                    |
 * | `POST /insurances`       | `insurance:create`| `CREATE`             |
 * | `GET /insurances/:id`    | `insurance:view`  | —                    |
 * | `PATCH /insurances/:id`  | `insurance:update`| `UPDATE`             |
 * | `DELETE /insurances/:id` | `insurance:delete`| `DELETE` (CRITICAL)  |
 *
 * Preklapanje perioda je `409 PERIOD_OVERLAP` (servis + `EXCLUDE` u bazi).
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
  CreateInsuranceInput,
  InsuranceListQuery,
  InsuranceListResponse,
  InsuranceRecord,
  UpdateInsuranceInput,
} from '@vfm/shared/schemas';
import {
  createInsuranceSchema,
  insuranceListQuerySchema,
  updateInsuranceSchema,
  uuidSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { InsurancesService } from './insurances.service.js';

@Controller('insurances')
export class InsurancesController {
  constructor(private readonly insurances: InsurancesService) {}

  @Get()
  @RequirePermissions('insurance:view')
  list(
    @Query(new ZodValidationPipe(insuranceListQuerySchema, 'query')) query: InsuranceListQuery,
  ): Promise<InsuranceListResponse> {
    return this.insurances.list(query);
  }

  @Post()
  @RequirePermissions('insurance:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'InsuranceRecord' })
  async create(
    @Body(new ZodValidationPipe(createInsuranceSchema, 'body')) input: CreateInsuranceInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<InsuranceRecord> {
    const outcome = await this.insurances.create(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(outcome.data.id)
      .setAfter(outcome.after)
      .setResource('InsuranceRecord')
      .set('vehicleId', outcome.data.vehicleId);
    return outcome.data;
  }

  @Get(':id')
  @RequirePermissions('insurance:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string): Promise<InsuranceRecord> {
    return this.insurances.get(id);
  }

  @Patch(':id')
  @RequirePermissions('insurance:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'InsuranceRecord' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateInsuranceSchema, 'body')) input: UpdateInsuranceInput,
    @Req() request: VfmRequest,
  ): Promise<InsuranceRecord> {
    const outcome = await this.insurances.update(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('InsuranceRecord');
    return outcome.data;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('insurance:delete')
  @Audit('DELETE', { severity: 'CRITICAL', resource: 'InsuranceRecord' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.insurances.remove(id, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('InsuranceRecord');
  }
}
