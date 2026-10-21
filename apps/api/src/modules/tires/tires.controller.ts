/** Faza 4 — kompleti guma i historija montaža. */
import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import {
  createTireSetSchema,
  tireInstallationListQuerySchema,
  tireSetListQuerySchema,
  type CreateTireSetInput,
  type TireInstallationListQuery,
  type TireSetListQuery,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { TiresService } from './tires.service.js';

@Controller()
export class TiresController {
  constructor(private readonly tires: TiresService) {}

  @Get('tire-sets')
  @RequirePermissions('tire:view')
  listSets(@Query(new ZodValidationPipe(tireSetListQuerySchema, 'query')) query: TireSetListQuery) {
    return this.tires.listSets(query);
  }

  @Post('tire-sets')
  @RequirePermissions('tire:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'TireSet' })
  async createSet(
    @Body(new ZodValidationPipe(createTireSetSchema, 'body')) input: CreateTireSetInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tires.createSet(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(result.data.id)
      .setAfter(result.after)
      .setResource('TireSet')
      .set('code', result.data.code);
    return result.data;
  }

  @Get('tire-installations')
  @RequirePermissions('tire:view')
  list(
    @Query(new ZodValidationPipe(tireInstallationListQuerySchema, 'query')) query: TireInstallationListQuery,
  ) {
    return this.tires.listInstallations(query);
  }
}
