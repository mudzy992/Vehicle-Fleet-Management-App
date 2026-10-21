/** Faza 4 — evidencija kompleta i pojedinačnih guma. */
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
import {
  createTireSchema,
  createTireSetSchema,
  tireSetListQuerySchema,
  updateTireSetSchema,
  uuidSchema,
  type CreateTireInput,
  type CreateTireSetInput,
  type TireSetListQuery,
  type UpdateTireSetInput,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { TiresService } from './tires.service.js';

@Controller('tire-sets')
export class TireSetsController {
  constructor(private readonly tires: TiresService) {}

  @Get()
  @RequirePermissions('tire:view')
  listSets(@Query(new ZodValidationPipe(tireSetListQuerySchema, 'query')) query: TireSetListQuery) {
    return this.tires.listSets(query);
  }

  @Post()
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

  @Get(':id')
  @RequirePermissions('tire:view')
  getSet(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string) {
    return this.tires.getSet(id);
  }

  @Get(':id/usage')
  @RequirePermissions('tire:view')
  getSetUsage(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string) {
    return this.tires.getSetUsage(id);
  }

  @Get(':id/tires')
  @RequirePermissions('tire:view')
  listTires(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string) {
    return this.tires.listTires(id);
  }

  @Post(':id/tires')
  @RequirePermissions('tire:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'Tire' })
  async createTire(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(createTireSchema, 'body')) input: CreateTireInput,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tires.createTire(id, input);
    AuditContext.from(request)
      .setEntityId(result.data.id)
      .setAfter(result.after)
      .setResource('Tire')
      .set('tireSetId', id)
      .set('tireSetCode', result.setCode);
    return result.data;
  }

  @Patch(':id')
  @RequirePermissions('tire:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'TireSet' })
  async updateSet(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateTireSetSchema, 'body')) input: UpdateTireSetInput,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tires.updateSet(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TireSet')
      .set('code', result.data.code);
    return result.data;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('tire:delete')
  @Audit('DELETE', { severity: 'CRITICAL', resource: 'TireSet' })
  async removeSet(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const result = await this.tires.removeSet(id, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TireSet')
      .set('code', result.before.code);
  }
}
