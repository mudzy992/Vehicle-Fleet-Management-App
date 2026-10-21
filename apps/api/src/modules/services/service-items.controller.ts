/** Stavke računa servisne evidencije. */
import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { replaceServiceItemsSchema, uuidSchema, type ReplaceServiceItemsInput } from '@vfm/shared/schemas';
import { Audit, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { AuditContext } from '../../common/audit/audit.types.js';
import type { VfmRequest } from '../../common/types/authenticated-user.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ServiceItemsService } from './service-items.service.js';
@Controller('services/:id/items')
export class ServiceItemsController {
  constructor(private readonly items: ServiceItemsService) {}
  @Get()
  @RequirePermissions('service:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string) {
    return this.items.get(id);
  }
  @Put()
  @RequirePermissions('service:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'ServiceRecord' })
  async replace(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(replaceServiceItemsSchema, 'body')) input: ReplaceServiceItemsInput,
    @Req() request: VfmRequest,
  ) {
    const result = await this.items.replace(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setResource('ServiceRecord')
      .setBefore(result.before)
      .setAfter(result.after);
    return result.data;
  }
}
