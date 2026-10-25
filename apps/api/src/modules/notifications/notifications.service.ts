import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
