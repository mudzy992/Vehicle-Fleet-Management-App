/**
 * `AuditLogModule` — read-only API nad `AuditLog` tabelom (docs/07 §7).
 * Upis ide kroz `AuditInterceptor` + `PrismaAuditSink` (`common/audit`).
 */
import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogService } from './audit-log.service.js';

@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
