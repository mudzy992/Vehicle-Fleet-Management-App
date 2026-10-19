/**
 * Queue modul (BullMQ) + outbox servis.
 */
import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({
  providers: [QueueService, OutboxService],
  exports: [QueueService, OutboxService],
})
export class QueueModule {}
