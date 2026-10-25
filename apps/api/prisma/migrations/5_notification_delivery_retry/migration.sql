-- Durable FCM delivery lifecycle: workers can claim rows with SKIP LOCKED,
-- recover expired leases, and retry failures independently from OutboxEvent.
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'DEAD';

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ADD COLUMN "lockedAt" TIMESTAMPTZ(6),
  ADD COLUMN "lockedBy" TEXT;

-- A notification can be sent at most once per registered device token.
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_deviceTokenId_key"
  ON "NotificationDelivery"("notificationId", "channel", "deviceTokenId");

CREATE INDEX "NotificationDelivery_status_availableAt_idx"
  ON "NotificationDelivery"("status", "availableAt");

-- A persisted Notification can serve FCM-only preferences without surfacing in the in-app inbox.
ALTER TABLE "Notification" ADD COLUMN "inAppVisible" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Notification_userId_inAppVisible_isRead_createdAt_idx"
  ON "Notification"("userId", "inAppVisible", "isRead", "createdAt" DESC);
