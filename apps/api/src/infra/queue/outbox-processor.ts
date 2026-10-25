import { randomUUID } from 'node:crypto';

export interface OutboxRow {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly attempts: number;
}

interface OutboxTransaction {
  readonly outboxEvent: {
    updateMany(args: {
      where: { id: string; status?: 'PROCESSING'; lockedBy?: string };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  readonly notificationPreference: {
    findMany(args: {
      where: { userId: { in: string[] }; type: string };
      select: { userId: true; channelInApp: true; channelFcm: true };
    }): Promise<Array<{ userId: string; channelInApp: boolean; channelFcm: boolean }>>;
  };
  readonly notification: {
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: true;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: { notificationKey: { in: string[] } };
      select: { id: true; userId: true; notificationKey: true };
    }): Promise<Array<{ id: string; userId: string; notificationKey: string }>>;
  };
  readonly deviceToken: {
    findMany(args: {
      where: { userId: { in: string[] }; status: 'ACTIVE' };
      select: { id: true; userId: true };
    }): Promise<Array<{ id: string; userId: string }>>;
  };
  readonly notificationDelivery: {
    findMany(args: {
      where: { notificationId: { in: string[] }; channel: 'FCM'; deviceTokenId: { not: null } };
      select: { notificationId: true; deviceTokenId: true };
    }): Promise<Array<{ notificationId: string; deviceTokenId: string | null }>>;
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
}

export interface OutboxPrisma extends OutboxTransaction {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(callback: (tx: OutboxTransaction) => Promise<T>): Promise<T>;
}

export interface OutboxProcessorOptions {
  readonly batchSize: number;
  readonly maxAttempts: number;
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly workerId?: string;
}

export interface OutboxBatchResult {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
  readonly dead: number;
}

const TASK_EVENT_COPY: Readonly<Record<string, { title: string; action: string }>> = {
  TASK_CREATED: { title: 'Novi zadatak', action: 'je kreiran' },
  TASK_CLAIMED: { title: 'Zadatak preuzet', action: 'je preuzet' },
  TASK_COMPLETED: { title: 'Zadatak završen', action: 'je završen' },
  TASK_RELEASED: { title: 'Zadatak ponovo dostupan', action: 'je vraćen među slobodne zadatke' },
  TASK_ASSIGNED: { title: 'Dodjela zadatka promijenjena', action: 'ima novu dodjelu' },
  TASK_CANCELLED: { title: 'Zadatak otkazan', action: 'je otkazan' },
  TASK_REOPENED: { title: 'Zadatak ponovo otvoren', action: 'je ponovo otvoren' },
};

function payloadObject(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function taskCopy(event: Pick<OutboxRow, 'eventType' | 'aggregateType' | 'aggregateId' | 'payload'>) {
  const content = TASK_EVENT_COPY[event.eventType];
  const payload = payloadObject(event.payload);
  const code = typeof payload.code === 'string' ? payload.code : event.aggregateId;
  return {
    title: content?.title ?? 'Obavijest o promjeni',
    body: `${event.aggregateType === 'TASK' ? 'Zadatak' : event.aggregateType} ${code} ${content?.action ?? 'je ažuriran'}.`,
  };
}

/** Pomoćna funkcija je izvezena da tekstovi događaja imaju regresijsko pokriće bez baze. */
export function notificationCopy(
  event: Pick<OutboxRow, 'eventType' | 'aggregateType' | 'aggregateId' | 'payload'>,
) {
  return taskCopy(event);
}

/**
 * Uzimanje i obrada trajnih OutboxEvent redova.
 *
 * Claim koristi `FOR UPDATE SKIP LOCKED`, a obrada događaja i kreiranje
 * idempotentnih in-app obavijesti + status PROCESSED su jedna transakcija.
 * Istekli PROCESSING lease-ovi mogu se ponovo preuzeti nakon pada workera.
 */
export async function processOutboxBatch(
  prisma: OutboxPrisma,
  options: OutboxProcessorOptions,
): Promise<OutboxBatchResult> {
  const now = options.now ?? (() => new Date());
  const workerId = options.workerId ?? randomUUID();
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const claimed = await prisma.$queryRaw<OutboxRow[]>`
    WITH candidates AS (
      SELECT "id"
        FROM "OutboxEvent"
       WHERE ("status" IN ('PENDING', 'FAILED') AND "availableAt" <= ${now()})
          OR ("status" = 'PROCESSING' AND "lockedAt" < ${new Date(now().getTime() - leaseMs)})
       ORDER BY "availableAt" ASC, "createdAt" ASC
       LIMIT ${options.batchSize}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS event
       SET "status" = 'PROCESSING',
           "lockedAt" = ${now()},
           "lockedBy" = ${workerId},
           "attempts" = event."attempts" + 1
      FROM candidates
     WHERE event."id" = candidates."id"
    RETURNING event."id", event."aggregateType", event."aggregateId", event."eventType",
              event."payload", event."idempotencyKey", event."attempts"
  `;

  let processed = 0;
  let failed = 0;
  let dead = 0;
  for (const event of claimed) {
    try {
      await prisma.$transaction(async (tx) => {
        const isTaskEvent = event.aggregateType === 'TASK';
        const payload = payloadObject(event.payload);
        const recipientUserIds =
          isTaskEvent && Array.isArray(payload.recipientUserIds)
            ? [...new Set(payload.recipientUserIds.filter((id): id is string => typeof id === 'string'))]
            : [];
        const prefs =
          recipientUserIds.length > 0
            ? await tx.notificationPreference.findMany({
                where: { userId: { in: recipientUserIds }, type: event.eventType },
                select: { userId: true, channelInApp: true, channelFcm: true },
              })
            : [];
        const preferenceByUser = new Map(prefs.map((preference) => [preference.userId, preference]));
        const fcmEnabledUserIds = recipientUserIds.filter(
          (userId) => preferenceByUser.get(userId)?.channelFcm ?? true,
        );
        const activeTokens =
          fcmEnabledUserIds.length > 0
            ? await tx.deviceToken.findMany({
                where: { userId: { in: fcmEnabledUserIds }, status: 'ACTIVE' },
                select: { id: true, userId: true },
              })
            : [];
        const usersWithActiveTokens = new Set(activeTokens.map((token) => token.userId));
        const copy = notificationCopy(event);
        const notificationData = recipientUserIds
          .filter((userId) => {
            const preference = preferenceByUser.get(userId);
            return (preference?.channelInApp ?? true) || usersWithActiveTokens.has(userId);
          })
          .map((userId) => ({
            id: randomUUID(),
            userId,
            type: event.eventType,
            title: copy.title,
            body: copy.body,
            data: payload,
            linkToType: event.aggregateType,
            linkToId: event.aggregateId,
            priority: typeof payload.priority === 'string' ? payload.priority : 'NORMAL',
            status: 'PENDING',
            isRead: false,
            inAppVisible: preferenceByUser.get(userId)?.channelInApp ?? true,
            outboxEventId: event.id,
            notificationKey: `${event.id}:${userId}`,
            dedupeKey: `${event.id}:${userId}`,
          }));
        if (notificationData.length > 0) {
          await tx.notification.createMany({ data: notificationData, skipDuplicates: true });
          const notifications = await tx.notification.findMany({
            where: {
              notificationKey: { in: notificationData.map((notification) => notification.notificationKey) },
            },
            select: { id: true, userId: true, notificationKey: true },
          });
          const notificationIds = notifications.map((notification) => notification.id);
          const existingDeliveries =
            notificationIds.length > 0
              ? await tx.notificationDelivery.findMany({
                  where: {
                    notificationId: { in: notificationIds },
                    channel: 'FCM',
                    deviceTokenId: { not: null },
                  },
                  select: { notificationId: true, deviceTokenId: true },
                })
              : [];
          const existingKeys = new Set(
            existingDeliveries.map((delivery) => `${delivery.notificationId}:${delivery.deviceTokenId}`),
          );
          const notificationByUser = new Map(
            notifications.map((notification) => [notification.userId, notification]),
          );
          const deliveries = activeTokens.flatMap((token) => {
            const notification = notificationByUser.get(token.userId);
            if (!notification) return [];
            const key = `${notification.id}:${token.id}`;
            return existingKeys.has(key)
              ? []
              : [
                  {
                    id: randomUUID(),
                    notificationId: notification.id,
                    channel: 'FCM',
                    deviceTokenId: token.id,
                    status: 'QUEUED',
                    attempts: 0,
                  },
                ];
          });
          if (deliveries.length > 0) {
            await tx.notificationDelivery.createMany({ data: deliveries, skipDuplicates: true });
          }
        }
        const updated = await tx.outboxEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING', lockedBy: workerId },
          data: { status: 'PROCESSED', processedAt: now(), lockedAt: null, lockedBy: null, lastError: null },
        });
        if (updated.count !== 1) throw new Error(`Outbox lease izgubljen za događaj ${event.id}.`);
      });
      processed += 1;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const isDead = event.attempts >= options.maxAttempts;
      const retryDelayMs = Math.min(60_000, 1000 * 2 ** Math.min(event.attempts - 1, 6));
      await prisma.$transaction(async (tx) => {
        await tx.outboxEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING', lockedBy: workerId },
          data: {
            status: isDead ? 'DEAD' : 'FAILED',
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            availableAt: isDead ? now() : new Date(now().getTime() + retryDelayMs),
          },
        });
      });
      if (isDead) dead += 1;
      else failed += 1;
    }
  }

  return { claimed: claimed.length, processed, failed, dead };
}
