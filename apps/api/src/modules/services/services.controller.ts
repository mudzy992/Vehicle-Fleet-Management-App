/** Faza 4 — pregled servisnih evidencija (unos se uvodi odvojeno). */
import { Controller, Get, Param, Query } from '@nestjs/common';
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
  @Get(':id')
  @RequirePermissions('service:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string) {
    return this.services.get(id);
  }
}
