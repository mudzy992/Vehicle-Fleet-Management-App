import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DeviceTokenInput, DeviceTokenList, DeviceTokenView } from '@vfm/shared/schemas';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const DEVICE_TOKEN_SELECT = {
  id: true,
  platform: true,
  appVersion: true,
  deviceModel: true,
  osVersion: true,
  locale: true,
  status: true,
  lastSeenAt: true,
  failureCount: true,
  createdAt: true,
  revokedAt: true,
} as const;

interface DeviceTokenRow {
  id: string;
  platform: 'android' | 'ios' | 'web';
  appVersion: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  locale: string | null;
  status: DeviceTokenView['status'];
  lastSeenAt: Date | null;
  failureCount: number;
  createdAt: Date;
  revokedAt: Date | null;
}

function toView(row: DeviceTokenRow): DeviceTokenView {
  return {
    ...row,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<DeviceTokenList> {
    const rows = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: DEVICE_TOKEN_SELECT,
      orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    });
    return { items: rows.map((row) => toView(row as DeviceTokenRow)) };
  }

  async register(userId: string, input: DeviceTokenInput): Promise<DeviceTokenView> {
    const hash = tokenHash(input.token);
    const existing = await this.prisma.deviceToken.findUnique({
      where: { tokenHash: hash },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== userId) throw VfmErrors.permissionDenied();

    const now = new Date();
    const data = {
      token: input.token,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      deviceModel: input.deviceModel ?? null,
      osVersion: input.osVersion ?? null,
      locale: input.locale ?? null,
      status: 'ACTIVE' as const,
      lastSeenAt: now,
      lastError: null,
      failureCount: 0,
      revokedAt: null,
    };

    if (existing) {
      const row = await this.prisma.deviceToken.update({
        where: { id: existing.id, userId },
        data,
        select: DEVICE_TOKEN_SELECT,
      });
      return toView(row as DeviceTokenRow);
    }

    try {
      const row = await this.prisma.deviceToken.create({
        data: { id: randomUUID(), userId, tokenHash: hash, ...data },
        select: DEVICE_TOKEN_SELECT,
      });
      return toView(row as DeviceTokenRow);
    } catch (error) {
      // A parallel registration may win the global tokenHash unique constraint.
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.prisma.deviceToken.findUnique({
        where: { tokenHash: hash },
        select: { id: true, userId: true },
      });
      if (!raced || raced.userId !== userId) throw VfmErrors.permissionDenied();
      const row = await this.prisma.deviceToken.update({
        where: { id: raced.id, userId },
        data,
        select: DEVICE_TOKEN_SELECT,
      });
      return toView(row as DeviceTokenRow);
    }
  }

  async revoke(userId: string, id: string): Promise<void> {
    // Cancel retryable deliveries atomically; deleting the token then detaches
    // historical rows (FK ON DELETE SET NULL) and preserves notification history.
    await this.prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.updateMany({
        where: { deviceTokenId: id, channel: 'FCM', status: { in: ['QUEUED', 'FAILED'] } },
        data: {
          status: 'DEAD',
          errorCode: 'DEVICE_TOKEN_REVOKED',
          errorMessage: 'FCM dostava je prekinuta opozivom uređaja.',
          lockedAt: null,
          lockedBy: null,
        },
      });
      const result = await tx.deviceToken.deleteMany({ where: { id, userId } });
      if (result.count !== 1) throw VfmErrors.notFound('uređaj');
    });
  }
}
