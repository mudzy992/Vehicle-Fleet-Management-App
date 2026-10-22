import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { NotificationListQuery, NotificationListResponse, NotificationView } from '@vfm/shared/schemas';
import { notificationListQuerySchema, uuidSchema } from '@vfm/shared/schemas';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('notification:view')
  list(
    @Query(new ZodValidationPipe(notificationListQuerySchema, 'query')) query: NotificationListQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(actor!.id, query);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification:mark_read')
  markRead(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<NotificationView> {
    return this.notifications.markRead(actor!.id, id);
  }
}
