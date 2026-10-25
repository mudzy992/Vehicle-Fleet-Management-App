import { randomUUID } from 'node:crypto';

export interface FcmMessage {
  readonly notificationId: string;
  readonly title: string;
  readonly body: string | null;
  readonly data: unknown;
  readonly linkToType: string | null;
  readonly linkToId: string | null;
  readonly token: string;
}

export interface FcmGateway {
  send(message: FcmMessage): Promise<string>;
}

interface DeliveryRow extends FcmMessage {
  readonly id: string;
  readonly deviceTokenId: string;
  readonly attempts: number;
}

interface DeliveryPrisma {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $transaction<T>(
    callback: (tx: {
      notificationDelivery: {
        updateMany(args: {
          where: { id: string; status: 'PROCESSING'; lockedBy: string };
          data: Record<string, unknown>;
        }): Promise<{ count: number }>;
      };
      deviceToken: {
        updateMany(args: {
          where: { id: string; status: 'ACTIVE' };
          data: Record<string, unknown>;
        }): Promise<{ count: number }>;
      };
      notification: {
        updateMany(args: {
          where: { id: string };
          data: Record<string, unknown>;
        }): Promise<{ count: number }>;
      };
    }) => Promise<T>,
  ): Promise<T>;
}

export interface FcmProcessorOptions {
  readonly batchSize: number;
  readonly maxAttempts: number;
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly workerId?: string;
  /** Optional fixture allowlist; normal workers omit it and process the shared queue. */
  readonly deliveryIds?: readonly string[];
}

export interface FcmBatchResult {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly invalid: number;
  readonly dead: number;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function isInvalidToken(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return (
    code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
  );
}

/**
 * Durable FCM delivery. Notification rows stay committed independently of a
 * provider outage; deliveries are claimed with SKIP LOCKED and retried separately.
 */
export async function processFcmDeliveryBatch(
  prisma: DeliveryPrisma,
  gateway: FcmGateway,
  options: FcmProcessorOptions,
): Promise<FcmBatchResult> {
  const now = options.now ?? (() => new Date());
  const workerId = options.workerId ?? randomUUID();
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const allDeliveryIds = options.deliveryIds === undefined;
  const deliveryIds = options.deliveryIds ?? [];
  const exhausted = await prisma.$executeRaw`
    UPDATE "NotificationDelivery"
       SET "status" = 'DEAD',
           "errorCode" = 'MAX_ATTEMPTS',
           "errorMessage" = COALESCE("errorMessage", 'FCM lease expired after the final attempt.'),
           "lockedAt" = NULL,
           "lockedBy" = NULL
     WHERE "channel" = 'FCM'
       AND (${allDeliveryIds} OR "id" = ANY(${deliveryIds}::uuid[]))
       AND "status" = 'PROCESSING'
       AND "attempts" >= ${options.maxAttempts}
       AND "lockedAt" < ${new Date(now().getTime() - leaseMs)}
  `;
  const rows = await prisma.$queryRaw<DeliveryRow[]>`
    WITH candidates AS (
      SELECT delivery."id"
        FROM "NotificationDelivery" AS delivery
       WHERE delivery."channel" = 'FCM'
         AND (${allDeliveryIds} OR delivery."id" = ANY(${deliveryIds}::uuid[]))
         AND EXISTS (
           SELECT 1 FROM "DeviceToken" AS active_token
            WHERE active_token."id" = delivery."deviceTokenId"
              AND active_token."status" = 'ACTIVE'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM "Notification" AS notice
             JOIN "NotificationPreference" AS preference
               ON preference."userId" = notice."userId" AND preference."type" = notice."type"
            WHERE notice."id" = delivery."notificationId"
              AND preference."channelFcm" = FALSE
         )
         AND (
           (delivery."status" IN ('QUEUED', 'FAILED')
             AND delivery."attempts" < ${options.maxAttempts}
             AND delivery."availableAt" <= ${now()})
           OR (delivery."status" = 'PROCESSING'
             AND delivery."attempts" < ${options.maxAttempts}
             AND delivery."lockedAt" < ${new Date(now().getTime() - leaseMs)})
         )
       ORDER BY delivery."availableAt" ASC, delivery."createdAt" ASC
       LIMIT ${options.batchSize}
       FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE "NotificationDelivery" AS delivery
         SET "status" = 'PROCESSING',
             "lockedAt" = ${now()},
             "lockedBy" = ${workerId},
             "attempts" = delivery."attempts" + 1
        FROM candidates
       WHERE delivery."id" = candidates."id"
      RETURNING delivery."id", delivery."notificationId", delivery."deviceTokenId", delivery."attempts"
    )
    SELECT claimed."id", claimed."notificationId", claimed."deviceTokenId", claimed."attempts",
           notification."title", notification."body", notification."data",
           notification."linkToType", notification."linkToId", token."token"
      FROM claimed
      JOIN "Notification" AS notification ON notification."id" = claimed."notificationId"
      JOIN "DeviceToken" AS token ON token."id" = claimed."deviceTokenId"
     WHERE token."status" = 'ACTIVE'
  `;

  let sent = 0;
  let retried = 0;
  let invalid = 0;
  let dead = exhausted;
  for (const row of rows) {
    try {
      const providerMessageId = await gateway.send(row);
      await prisma.$transaction(async (tx) => {
        const updated = await tx.notificationDelivery.updateMany({
          where: { id: row.id, status: 'PROCESSING', lockedBy: workerId },
          data: {
            status: 'SENT',
            providerMessageId,
            sentAt: now(),
            errorCode: null,
            errorMessage: null,
            lockedAt: null,
            lockedBy: null,
          },
        });
        if (updated.count !== 1) throw new Error(`FCM delivery lease izgubljen za ${row.id}.`);
        await tx.notification.updateMany({
          where: { id: row.notificationId },
          data: { status: 'SENT', sentAt: now() },
        });
      });
      sent += 1;
    } catch (error) {
      const message = errorMessage(error);
      if (isInvalidToken(error)) {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.notificationDelivery.updateMany({
            where: { id: row.id, status: 'PROCESSING', lockedBy: workerId },
            data: {
              status: 'TOKEN_INVALID',
              errorCode: 'INVALID_TOKEN',
              errorMessage: message,
              lockedAt: null,
              lockedBy: null,
            },
          });
          if (updated.count !== 1) throw new Error(`FCM delivery lease izgubljen za ${row.id}.`);
          await tx.deviceToken.updateMany({
            where: { id: row.deviceTokenId, status: 'ACTIVE' },
            data: {
              status: 'INVALID',
              revokedAt: now(),
              lastError: message,
              failureCount: { increment: 1 },
            },
          });
        });
        invalid += 1;
        continue;
      }

      const isDead = row.attempts >= options.maxAttempts;
      const retryDelayMs = Math.min(60_000, 1000 * 2 ** Math.min(row.attempts - 1, 6));
      await prisma.$transaction(async (tx) => {
        const updated = await tx.notificationDelivery.updateMany({
          where: { id: row.id, status: 'PROCESSING', lockedBy: workerId },
          data: {
            status: isDead ? 'DEAD' : 'FAILED',
            errorCode: 'FCM_SEND_FAILED',
            errorMessage: message,
            availableAt: isDead ? now() : new Date(now().getTime() + retryDelayMs),
            lockedAt: null,
            lockedBy: null,
          },
        });
        if (updated.count !== 1) throw new Error(`FCM delivery lease izgubljen za ${row.id}.`);
      });
      if (isDead) dead += 1;
      else retried += 1;
    }
  }

  return { claimed: rows.length, sent, retried, invalid, dead };
}
