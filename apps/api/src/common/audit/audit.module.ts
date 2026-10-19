/**
 * `AuditModule` (docs/05 §9) — globalno dostupan sink za audit zapise.
 *
 * ⛔ BLOKER 1: `AuditLog` se piše preko Prisme, pa je `AUDIT_SINK` za sada
 * `LoggingAuditSink` (pino). Čim migracija `init` bude u repou:
 * 1. dodati `PrismaAuditSink` (upis u `AuditLog` + `XADD vfm:stream:audit` za SSE),
 * 2. zamijeniti provider ispod,
 * 3. `AuditInterceptor` i `AuditContext` ostaju **isti** (rade nad portom).
 */
import { Global, Module } from '@nestjs/common';
import { AUDIT_SINK, LoggingAuditSink } from './audit.types.js';

@Global()
@Module({
  providers: [{ provide: AUDIT_SINK, useClass: LoggingAuditSink }],
  exports: [AUDIT_SINK],
})
export class AuditModule {}
