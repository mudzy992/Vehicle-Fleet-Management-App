import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

import { DeviceTokensService } from '../../src/modules/notifications/device-tokens.service.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const TOKEN_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const TOKEN = 'mock-device-registration-token-only';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const CREATED_AT = new Date('2026-10-25T08:00:00.000Z');

const ROW = {
  id: TOKEN_ID,
  platform: 'android' as const,
  appVersion: '1.2.3',
  deviceModel: 'test device',
  osVersion: 'test os',
  locale: 'bs-BA',
  status: 'ACTIVE' as const,
  lastSeenAt: CREATED_AT,
  failureCount: 0,
  createdAt: CREATED_AT,
  revokedAt: null,
};

function harness() {
  const deleteMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    notificationDelivery: { updateMany: vi.fn(async () => ({ count: 0 })) },
    deviceToken: { deleteMany },
  };
  const prisma = {
    deviceToken: {
      findMany: vi.fn(async () => [ROW]),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ROW),
      update: vi.fn(async () => ROW),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, tx, service: new DeviceTokensService(prisma as never) };
}

describe('DeviceTokensService', () => {
  it('vraća samo sigurne metapodatke i filtrira listu po authenticated owneru', async () => {
    const { prisma, service } = harness();
    const result = await service.list(USER_ID);

    expect(prisma.deviceToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
    expect(result.items[0]).toMatchObject({ id: TOKEN_ID, platform: 'android', status: 'ACTIVE' });
    expect(result.items[0]).not.toHaveProperty('token');
    expect(result.items[0]).not.toHaveProperty('tokenHash');
  });

  it('hashira token, uzima userId samo iz aktera i ne vraća sirovi token ni hash', async () => {
    const { prisma, service } = harness();
    const result = await service.register(USER_ID, { token: TOKEN, platform: 'ios' });

    expect(prisma.deviceToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          token: TOKEN,
          tokenHash: TOKEN_HASH,
          platform: 'ios',
        }),
      }),
    );
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('tokenHash');
  });

  it('ponovo aktivira vlastiti invalid token i resetuje grešku, opoziv i brojač', async () => {
    const { prisma, service } = harness();
    prisma.deviceToken.findUnique.mockResolvedValueOnce({ id: TOKEN_ID, userId: USER_ID });
    const result = await service.register(USER_ID, {
      token: TOKEN,
      platform: 'android',
      appVersion: '2.0.0',
    });

    expect(prisma.deviceToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TOKEN_ID, userId: USER_ID },
        data: expect.objectContaining({
          status: 'ACTIVE',
          failureCount: 0,
          lastError: null,
          revokedAt: null,
          appVersion: '2.0.0',
        }),
      }),
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('odbija registraciju tokena koji je već vezan za drugog korisnika', async () => {
    const { prisma, service } = harness();
    prisma.deviceToken.findUnique.mockResolvedValueOnce({ id: TOKEN_ID, userId: OTHER_USER_ID });

    await expect(service.register(USER_ID, { token: TOKEN, platform: 'android' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(prisma.deviceToken.create).not.toHaveBeenCalled();
    expect(prisma.deviceToken.update).not.toHaveBeenCalled();
  });

  it('opoziva samo zapis aktera i vraća 404 za tuđi ili nepostojeći ID', async () => {
    const { prisma, tx, service } = harness();
    await service.revoke(USER_ID, TOKEN_ID);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: { deviceTokenId: TOKEN_ID, channel: 'FCM', status: { in: ['QUEUED', 'FAILED'] } },
      data: expect.objectContaining({ status: 'DEAD', errorCode: 'DEVICE_TOKEN_REVOKED' }),
    });
    expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { id: TOKEN_ID, userId: USER_ID } });

    tx.deviceToken.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.revoke(USER_ID, TOKEN_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
