import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';

function makeHarness() {
  const prisma = {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { prisma, service: new NotificationsService(prisma as never) };
}

const ROW = {
  id: '018f0000-0000-7000-8000-000000000001',
  type: 'TASK_ASSIGNED',
  title: 'Novi zadatak',
  body: null,
  data: null,
  linkToType: 'TASK',
  linkToId: '018f0000-0000-7000-8000-000000000002',
  priority: 'NORMAL',
  status: 'SENT',
  isRead: false,
  readAt: null,
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
};

describe('NotificationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vraća samo obavijesti korisnika i filtrira nepročitane uz paginaciju', async () => {
    const { prisma, service } = makeHarness();
    prisma.notification.findMany.mockResolvedValue([ROW]);
    prisma.notification.count.mockResolvedValue(1);
    await expect(service.list('user-1', { page: 2, pageSize: 10, sortOrder: 'desc', unreadOnly: true })).resolves.toEqual({
      items: [{ ...ROW, createdAt: ROW.createdAt.toISOString() }],
      page: 2,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', isRead: false },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    }));
  });

  it('vraća broj nepročitanih samo za prijavljenog korisnika', async () => {
    const { prisma, service } = makeHarness();
    prisma.notification.count.mockResolvedValue(7);
    await expect(service.unreadCount('user-1')).resolves.toEqual({ count: 7 });
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'user-1', isRead: false } });
  });

  it('označava sve vlastite nepročitane kao pročitane', async () => {
    const { prisma, service } = makeHarness();
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });
    await expect(service.markAllRead('user-1')).resolves.toEqual({ updatedCount: 4 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', isRead: false },
      data: expect.objectContaining({ isRead: true, status: 'READ' }),
    }));
  });

  it('označava samo vlastitu obavijest kao pročitanu i ponavlja sigurno', async () => {
    const { prisma, service } = makeHarness();
    prisma.notification.findFirst.mockResolvedValueOnce({ id: ROW.id, isRead: false }).mockResolvedValueOnce({ ...ROW, isRead: true, status: 'READ', readAt: new Date('2026-01-02T00:00:00.000Z') });
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.markRead('user-1', ROW.id)).resolves.toMatchObject({ isRead: true, status: 'READ', readAt: '2026-01-02T00:00:00.000Z' });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ROW.id, userId: 'user-1', isRead: false } }));
  });

  it('ne otkriva tuđu/nepostojeću obavijest', async () => {
    const { prisma, service } = makeHarness();
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead('user-1', ROW.id)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });
});
