/** Modul priloga (docs/07 §2.12) — `AttachmentsService` + `/api/v1/attachments`. */
import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
