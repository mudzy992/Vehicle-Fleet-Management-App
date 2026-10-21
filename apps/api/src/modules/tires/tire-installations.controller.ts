/** Faza 4 — historija, montaža, demontaža i zamjena kompleta. */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  dismountTireSetSchema,
  mountTireSetSchema,
  swapTireSetSchema,
  tireInstallationListQuerySchema,
  uuidSchema,
  type DismountTireSetInput,
  type MountTireSetInput,
  type SwapTireSetInput,
  type TireInstallationListQuery,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { TireInstallationsService } from './tire-installations.service.js';

@Controller('tire-installations')
export class TireInstallationsController {
  constructor(private readonly installations: TireInstallationsService) {}

  @Get()
  @RequirePermissions('tire:view')
  list(
    @Query(new ZodValidationPipe(tireInstallationListQuerySchema, 'query')) query: TireInstallationListQuery,
  ) {
    return this.installations.list(query);
  }

  @Post()
  @RequirePermissions('tire:mount')
  @Audit('CREATE', { severity: 'INFO', resource: 'TireInstallation' })
  async mount(
    @Body(new ZodValidationPipe(mountTireSetSchema, 'body')) input: MountTireSetInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.installations.mount(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(result.data.id)
      .setAfter(result.after)
      .setResource('TireInstallation')
      .set('vehicleId', result.data.vehicleId)
      .set('setId', result.data.setId);
    return result.data;
  }

  @Post('swap')
  @RequirePermissions('tire:swap')
  @Audit('UPDATE', { severity: 'INFO', resource: 'TireInstallation' })
  async swap(
    @Body(new ZodValidationPipe(swapTireSetSchema, 'body')) input: SwapTireSetInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.installations.swap(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(result.data.dismounted.id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TireInstallation')
      .set('vehicleId', result.data.mounted.vehicleId)
      .set('mountedInstallationId', result.data.mounted.id)
      .set('dismountedSetId', result.data.dismounted.setId)
      .set('mountedSetId', result.data.mounted.setId);
    return result.data;
  }

  @Post(':id/dismount')
  @RequirePermissions('tire:dismount')
  @Audit('UPDATE', { severity: 'INFO', resource: 'TireInstallation' })
  async dismount(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(dismountTireSetSchema, 'body')) input: DismountTireSetInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.installations.dismount(id, input, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TireInstallation')
      .set('vehicleId', result.data.vehicleId)
      .set('setId', result.data.setId);
    return result.data;
  }
}
