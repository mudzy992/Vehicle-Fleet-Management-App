import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import type { AppSettingList, AppSettingView, UpdateAppSettingInput } from '@vfm/shared/schemas';
import { updateAppSettingSchema } from '@vfm/shared/schemas';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings:view')
  async list(): Promise<AppSettingList> {
    return { items: await this.settings.list(true) };
  }

  @Patch(':key')
  @RequirePermissions('settings:update')
  update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(updateAppSettingSchema, 'body')) input: UpdateAppSettingInput,
  ): Promise<AppSettingView> {
    return this.settings.update(key, input.value);
  }
}
