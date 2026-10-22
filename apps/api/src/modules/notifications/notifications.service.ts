import { Injectable } from '@nestjs/common';
import type { NotificationListQuery, NotificationListResponse, NotificationMarkAllRead, NotificationUnreadCount, NotificationView } from '@vfm/shared/schemas';
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

  async list(userId: string, query: NotificationListQuery): Promise<NotificationListResponse> {
    const where = { userId, ...(query.unreadOnly ? { isRead: false } : {}) };
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
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  async markAllRead(userId: string): Promise<NotificationMarkAllRead> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date(), status: 'READ' },
    });
    return { updatedCount: result.count };
  }

  async markRead(userId: string, id: string): Promise<NotificationView> {
    const current = await this.prisma.notification.findFirst({ where: { id, userId }, select: { id: true, isRead: true } });
    if (!current) throw VfmErrors.notFound('obavijest');
    if (!current.isRead) {
      await this.prisma.notification.updateMany({
        where: { id, userId, isRead: false },
        data: { isRead: true, readAt: new Date(), status: 'READ' },
      });
    }
    const updated = await this.prisma.notification.findFirst({ where: { id, userId }, select: NOTIFICATION_SELECT });
    if (!updated) throw VfmErrors.notFound('obavijest');
    return toView(updated as NotificationRow);
  }
}
