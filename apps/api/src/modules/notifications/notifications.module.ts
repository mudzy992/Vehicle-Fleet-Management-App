import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceTokensController } from './device-tokens.controller.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, DeviceTokensController],
  providers: [NotificationsService, DeviceTokensService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
