/**
 * `AuditLogController` — `GET /api/v1/audit-logs[/:id]` (docs/07 §7).
 *
 * | Ruta                  | Permisija              |
 * | --------------------- | ---------------------- |
 * | `GET /audit-logs`     | `audit:view` (+ `audit:view_security` za SECURITY redove) |
 * | `GET /audit-logs/:id` | `audit:view` (+ `audit:view_security` za SECURITY zapis) |
 *
 * Čitanje audit traga **nije** samo po sebi auditovano (nauditovalo bi svaki
 * pregled); pristup je ograničen permisijama i svaka izmjena koju zapis opisuje
 * već ima svoj zapis. `POST /audit-logs/export` (docs/07) dolazi s izvozima
 * (Faza 7) — traži `audit:export` i xlsx/pdf pipeline.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AuditLogDetail, AuditLogListResponse, AuditLogQuery } from '@vfm/shared/schemas';
import { auditLogQuerySchema } from '@vfm/shared/schemas';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AuditLogService } from './audit-log.service.js';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  @RequirePermissions('audit:view')
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema, 'query')) query: AuditLogQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<AuditLogListResponse> {
    return this.auditLogs.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions('audit:view')
  get(
    // `AuditLog.id` je BIGINT → validira se kao cifre u servisu (404 za smeće).
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<AuditLogDetail> {
    return this.auditLogs.get(id, actor);
  }
}
