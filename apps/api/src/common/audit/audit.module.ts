/**
 * `AuditModule` (docs/05 §9) — globalno dostupan sink za audit zapise.
 *
 * `AUDIT_SINK` je sada `PrismaAuditSink` (upis u `AuditLog`); `LoggingAuditSink`
 * ostaje u repou kao zamjena za rad bez baze (degradirani režim, testovi).
 * `AuditInterceptor` i `AuditContext` su nepromijenjeni — rade nad portom.
 *
 * `SECURITY_EVENT_SINK` registruje `AuthModule` istom klasom, pa sigurnosni
 * događaji (guard-ovi, `AuthService`) završavaju u istoj, immutabilnoj tabeli.
 */
import { Global, Module } from '@nestjs/common';
import { PrismaAuditSink } from './prisma-audit.sink.js';
import { AUDIT_SINK } from './audit.types.js';

@Global()
@Module({
  providers: [{ provide: AUDIT_SINK, useClass: PrismaAuditSink }],
  exports: [AUDIT_SINK],
})
export class AuditModule {}
