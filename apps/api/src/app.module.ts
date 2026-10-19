/**
 * Korijenski Nest modul (Faza 0).
 *
 * Sadržaj: infrastruktura (Redis, redovi, health), zajednički middleware i
 * domenski moduli. `AuthModule` (Faza 1) nosi servise za lozinke/tokene;
 * `AuthService`, `AuthController`, guard-ovi i `PermissionsService` dolaze s
 * Prisma slojem (bloker 1 — vidi `docs/FAZA1_IZVJESTAJ.md`).
 */
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { ClientTypeGuard } from './common/guards/client-type.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';

@Module({
  imports: [DatabaseModule, RedisModule, QueueModule, HealthModule, AuthModule],
  controllers: [],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
    /**
     * Globalni guard-ovi (docs/05 §5.3) — redoslijed registracije je redoslijed
     * izvršavanja i **nije** proizvoljan:
     * 1. `JwtAuthGuard`     — važeći token + aktivan nalog + `tokenVersion`,
     * 2. `ClientTypeGuard`  — Super Admin web-only (N-05/P1) + dozvoljeni klijenti,
     * 3. `PermissionsGuard` — svježina prava (P3) + `@RequirePermissions`.
     *
     * Javne rute (`/health/live|ready|startup`, `/auth/login|refresh|
     * forgot-password`) označavaju se s `@Public()`.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ClientTypeGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // RequestId ide prvi (docs/05 §7): svi logovi i audit zapisi ga nasljeđuju.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
