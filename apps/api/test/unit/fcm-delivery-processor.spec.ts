import { describe, expect, it, vi } from 'vitest';
import { processFcmDeliveryBatch, type FcmMessage } from '../../src/infra/queue/fcm-delivery-processor.js';

const DELIVERY = {
  id: '11111111-1111-4111-8111-111111111111',
  notificationId: '22222222-2222-4222-8222-222222222222',
  deviceTokenId: '33333333-3333-4333-8333-333333333333',
  attempts: 1,
  title: 'Zadatak preuzet',
  body: 'Zadatak T-1 je preuzet.',
  data: { taskId: '44444444-4444-4444-8444-444444444444' },
  linkToType: 'TASK',
  linkToId: '44444444-4444-4444-8444-444444444444',
  token: 'test-token-only',
};

function harness() {
  const tx = {
    notificationDelivery: { updateMany: vi.fn(async () => ({ count: 1 })) },
    deviceToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
    notification: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    $queryRaw: vi.fn(async () => [DELIVERY]),
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, tx };
}

describe('FCM delivery processor', () => {
  it('označi potvrđenu dostavu kao SENT i ažurira Notification', async () => {
    const { prisma, tx } = harness();
    const gateway = { send: vi.fn(async (_message: FcmMessage) => 'projects/test/messages/123') };
    const result = await processFcmDeliveryBatch(prisma as never, gateway, {
      batchSize: 20,
      maxAttempts: 5,
      workerId: 'worker-1',
    });

    expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, invalid: 0, dead: 0 });
    expect(gateway.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'test-token-only' }));
    expect(tx.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DELIVERY.id, status: 'PROCESSING', lockedBy: 'worker-1' },
        data: expect.objectContaining({ status: 'SENT', providerMessageId: 'projects/test/messages/123' }),
      }),
    );
    expect(tx.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DELIVERY.notificationId } }),
    );
  });

  it('označi nevažeći token kao INVALID i ne zakazuje retry', async () => {
    const { prisma, tx } = harness();
    const invalidTokenError = Object.assign(new Error('registration token is not registered'), {
      code: 'messaging/registration-token-not-registered',
    });
    const gateway = { send: vi.fn(async () => Promise.reject(invalidTokenError)) };

    const result = await processFcmDeliveryBatch(prisma as never, gateway, {
      batchSize: 20,
      maxAttempts: 5,
      workerId: 'worker-2',
    });

    expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, invalid: 1, dead: 0 });
    expect(tx.deviceToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DELIVERY.deviceTokenId, status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'INVALID', failureCount: { increment: 1 } }),
      }),
    );
    expect(tx.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'TOKEN_INVALID', errorCode: 'INVALID_TOKEN' }),
      }),
    );
  });

  it('retry-a privremenu grešku uz backoff, a nakon pet pokušaja ostavlja FAILED', async () => {
    const { prisma, tx } = harness();
    const gateway = { send: vi.fn(async () => Promise.reject(new Error('FCM timeout'))) };
    const retry = await processFcmDeliveryBatch(prisma as never, gateway, {
      batchSize: 20,
      maxAttempts: 5,
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      workerId: 'worker-3',
    });
    expect(retry).toEqual({ claimed: 1, sent: 0, retried: 1, invalid: 0, dead: 0 });
    expect(tx.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          availableAt: new Date('2026-10-25T12:00:01.000Z'),
        }),
      }),
    );

    prisma.$queryRaw.mockResolvedValueOnce([{ ...DELIVERY, attempts: 5 }] as never);
    const exhausted = await processFcmDeliveryBatch(prisma as never, gateway, {
      batchSize: 20,
      maxAttempts: 5,
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      workerId: 'worker-4',
    });
    expect(exhausted).toEqual({ claimed: 1, sent: 0, retried: 0, invalid: 0, dead: 1 });
    expect(tx.notificationDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DEAD' }) }),
    );
  });

  it('terminaleza istekli lease bez pokušaja nakon maksimalnog broja pokušaja', async () => {
    const { prisma } = harness();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    prisma.$executeRaw.mockResolvedValueOnce(2);
    const gateway = { send: vi.fn(async () => 'unused') };

    const result = await processFcmDeliveryBatch(prisma as never, gateway, {
      batchSize: 20,
      maxAttempts: 5,
      workerId: 'worker-5',
    });

    expect(result).toEqual({ claimed: 0, sent: 0, retried: 0, invalid: 0, dead: 2 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(gateway.send).not.toHaveBeenCalled();
  });
});
