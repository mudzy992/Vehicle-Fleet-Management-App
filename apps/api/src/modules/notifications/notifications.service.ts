import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
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
import { VfmErrors } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionsService } from '../auth/permissions/permissions.service.js';
import type { ClientType } from '@vfm/shared';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  linkToType: string | null;
  linkToId: string | null;
  priority: string;
  status: NotificationView['status'];
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

function toView(row: NotificationRow): NotificationView {
  return {
    ...row,
    priority: row.priority as NotificationView['priority'],
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  linkToType: true,
  linkToId: true,
  priority: true,
  status: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} as const;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private preferenceView(row: {
    id: string;
    type: string;
    channelFcm: boolean;
    channelInApp: boolean;
    channelEmail: boolean;
    updatedAt: Date;
  }): NotificationPreferenceView {
    return { ...row, updatedAt: row.updatedAt.toISOString() };
  }

  async listPreferences(userId: string): Promise<NotificationPreferenceList> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        channelFcm: true,
        channelInApp: true,
        channelEmail: true,
        updatedAt: true,
      },
      orderBy: { type: 'asc' },
    });
    return { items: rows.map((row) => this.preferenceView(row)) };
  }

  async upsertPreference(
    userId: string,
    input: NotificationPreferenceInput,
  ): Promise<NotificationPreferenceView> {
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: input.type } },
      create: { id: randomUUID(), userId, ...input },
      update: {
        channelFcm: input.channelFcm,
        channelInApp: input.channelInApp,
        channelEmail: input.channelEmail,
      },
      select: {
        id: true,
        type: true,
        channelFcm: true,
        channelInApp: true,
        channelEmail: true,
        updatedAt: true,
      },
    });
    return this.preferenceView(row);
  }

  async stream(
    userId: string,
    lastEventId?: string,
    clientType: ClientType = 'WEB',
  ): Promise<Observable<MessageEvent>> {
    if (!(await this.permissions.hasPermission(userId, 'notification:view', 'OWN', clientType))) {
      throw VfmErrors.permissionDenied([
        {
          path: ['notification:view'],
          message: 'Nemate pravo: notification:view.',
          code: 'permission_denied',
        },
      ]);
    }
    if (lastEventId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(lastEventId)) {
      throw VfmErrors.validationError([
        { path: ['Last-Event-ID'], message: 'Mora biti ispravan UUID obavijesti.', code: 'invalid_format' },
      ]);
    }

    const lastEvent = lastEventId
      ? await this.prisma.notification.findFirst({
          where: { id: lastEventId, userId, inAppVisible: true },
          select: { id: true, createdAt: true },
        })
      : null;
    let cursor = lastEvent ?? { id: '', createdAt: new Date() };

    return new Observable<MessageEvent>((subscriber) => {
      let active = true;
      let polling = false;
      let lastUnreadCount: number | undefined;
      const poll = async () => {
        if (!active || polling) return;
        polling = true;
        try {
          if (!(await this.permissions.hasPermission(userId, 'notification:view', 'OWN', clientType))) {
            throw VfmErrors.permissionDenied([
              {
                path: ['notification:view'],
                message: 'Nemate pravo: notification:view.',
                code: 'permission_denied',
              },
            ]);
          }
          const rows = await this.prisma.notification.findMany({
            where: {
              userId,
              inAppVisible: true,
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                ...(cursor.id ? [{ createdAt: cursor.createdAt, id: { gt: cursor.id } }] : []),
              ],
            },
            select: NOTIFICATION_SELECT,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 100,
          });
          for (const row of rows) {
            const notification = toView(row as NotificationRow);
            subscriber.next({ id: notification.id, type: 'notification', data: notification });
            cursor = { id: notification.id, createdAt: row.createdAt };
          }
          const count = await this.prisma.notification.count({
            where: { userId, inAppVisible: true, isRead: false },
          });
          if (count !== lastUnreadCount) {
            lastUnreadCount = count;
            subscriber.next({ type: 'unread-count', data: { count } });
          }
          subscriber.next({ type: 'keepalive', data: {} });
        } catch (error) {
          subscriber.error(error);
        } finally {
          polling = false;
        }
      };
      void poll();
      const timer = setInterval(() => void poll(), 5_000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    });
  }

  async list(userId: string, query: NotificationListQuery): Promise<NotificationListResponse> {
    const where = { userId, inAppVisible: true, ...(query.unreadOnly ? { isRead: false } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: rows.map((row) => toView(row as NotificationRow)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async unreadCount(userId: string): Promise<NotificationUnreadCount> {
    const count = await this.prisma.notification.count({
      where: { userId, inAppVisible: true, isRead: false },
    });
    return { count };
  }

  async markAllRead(userId: string): Promise<NotificationMarkAllRead> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, inAppVisible: true, isRead: false },
      data: { isRead: true, readAt: new Date(), status: 'READ' },
    });
    return { updatedCount: result.count };
  }

  async markRead(userId: string, id: string): Promise<NotificationView> {
    const current = await this.prisma.notification.findFirst({
      where: { id, userId, inAppVisible: true },
      select: { id: true, isRead: true },
    });
    if (!current) throw VfmErrors.notFound('obavijest');
    if (!current.isRead) {
      await this.prisma.notification.updateMany({
        where: { id, userId, inAppVisible: true, isRead: false },
        data: { isRead: true, readAt: new Date(), status: 'READ' },
      });
    }
    const updated = await this.prisma.notification.findFirst({
      where: { id, userId, inAppVisible: true },
      select: NOTIFICATION_SELECT,
    });
    if (!updated) throw VfmErrors.notFound('obavijest');
    return toView(updated as NotificationRow);
  }
}
