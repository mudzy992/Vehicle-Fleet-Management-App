import { updateServiceSchema, type UpdateServiceInput } from '@vfm/shared/schemas';
import { createServiceSchema, type CreateServiceInput } from '@vfm/shared/schemas';
import { Audit, CurrentUser } from '../../common/decorators/auth.decorators.js';
import { AuditContext } from '../../common/audit/audit.types.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
/** Faza 4 — pregled i auditovani unos servisnih evidencija. */
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { serviceListQuerySchema, uuidSchema, type ServiceListQuery } from '@vfm/shared/schemas';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ServicesService } from './services.service.js';

@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}
  @Get()
  @RequirePermissions('service:view')
  list(@Query(new ZodValidationPipe(serviceListQuerySchema, 'query')) query: ServiceListQuery) {
    return this.services.list(query);
  }
  @Post()
  @RequirePermissions('service:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'ServiceRecord' })
  async create(
    @Body(new ZodValidationPipe(createServiceSchema, 'body')) input: CreateServiceInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.services.create(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(result.data.id)
      .setAfter(result.after)
      .setResource('ServiceRecord')
      .set('vehicleId', result.data.vehicleId);
    return result.data;
  }
  @Patch(':id')
  @RequirePermissions('service:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'ServiceRecord' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateServiceSchema, 'body')) input: UpdateServiceInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.services.update(id, input, actor?.id);
    const audit = AuditContext.from(request)
      .setEntityId(id)
      .setResource('ServiceRecord')
      .setBefore(result.before)
      .setAfter(result.after)
      .set('vehicleId', result.data.vehicleId);
    if (result.vehicleBefore && result.vehicleAfter) {
      audit.set('vehicleBefore', result.vehicleBefore).set('vehicleAfter', result.vehicleAfter);
    }
    return result.data;
  }
  @Get(':id')
  @RequirePermissions('service:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string) {
    return this.services.get(id);
  }
}
