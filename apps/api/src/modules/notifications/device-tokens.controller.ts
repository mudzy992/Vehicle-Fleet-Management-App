import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { DeviceTokenInput, DeviceTokenList, DeviceTokenView } from '@vfm/shared/schemas';
import { deviceTokenInputSchema, uuidSchema } from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { DeviceTokensService } from './device-tokens.service.js';

@Controller('devices/tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  @Get()
  @RequirePermissions('notification:manage_preferences')
  list(@CurrentUser() actor: AuthenticatedUser | undefined): Promise<DeviceTokenList> {
    return this.deviceTokens.list(actor!.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('notification:manage_preferences')
  @Audit('CREATE', { severity: 'INFO', resource: 'DeviceToken' })
  async register(
    @Body(new ZodValidationPipe(deviceTokenInputSchema)) input: DeviceTokenInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<DeviceTokenView> {
    const result = await this.deviceTokens.register(actor!.id, input);
    AuditContext.from(request)
      .setEntityId(result.id)
      .setResource('DeviceToken')
      .set('platform', result.platform);
    return result;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification:manage_preferences')
  @Audit('DELETE', { severity: 'INFO', resource: 'DeviceToken' })
  async revoke(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    await this.deviceTokens.revoke(actor!.id, id);
    AuditContext.from(request).setEntityId(id).setResource('DeviceToken');
  }
}
