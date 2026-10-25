import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import type {
  NotificationListQuery,
  NotificationListResponse,
  NotificationMarkAllRead,
  NotificationPreferenceInput,
  NotificationPreferenceList,
  NotificationPreferenceView,
  NotificationUnreadCount,
  NotificationView,
} from '@vfm/shared/schemas';
import {
  notificationListQuerySchema,
  notificationPreferenceInputSchema,
  uuidSchema,
} from '@vfm/shared/schemas';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('preferences')
  @RequirePermissions('notification:manage_preferences')
  listPreferences(@CurrentUser() actor: AuthenticatedUser | undefined): Promise<NotificationPreferenceList> {
    return this.notifications.listPreferences(actor!.id);
  }

  @Put('preferences')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification:manage_preferences')
  upsertPreference(
    @Body(new ZodValidationPipe(notificationPreferenceInputSchema)) input: NotificationPreferenceInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<NotificationPreferenceView> {
    return this.notifications.upsertPreference(actor!.id, input);
  }

  @Get()
  @RequirePermissions('notification:view')
  list(
    @Query(new ZodValidationPipe(notificationListQuerySchema, 'query')) query: NotificationListQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(actor!.id, query);
  }

  @Get('unread-count')
  @RequirePermissions('notification:view')
  unreadCount(@CurrentUser() actor: AuthenticatedUser | undefined): Promise<NotificationUnreadCount> {
    return this.notifications.unreadCount(actor!.id);
  }

  @Sse('stream')
  @RequirePermissions('notification:view')
  stream(
    @Headers('last-event-id') lastEventId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    return this.notifications.stream(actor!.id, lastEventId, actor!.clientType);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification:mark_read')
  markAllRead(@CurrentUser() actor: AuthenticatedUser | undefined): Promise<NotificationMarkAllRead> {
    return this.notifications.markAllRead(actor!.id);
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
