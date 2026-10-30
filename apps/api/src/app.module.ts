import { TiresModule } from './modules/tires/tires.module.js';
/**
 * Korijenski Nest modul (Faza 0).
 *
 * Sadržaj: infrastruktura (Prisma, Redis, redovi, health), zajednički middleware
 * i domenski moduli. `PrismaModule` je globalan (jedan pg.Pool po procesu), a
 * `AuthModule` nosi servise za lozinke/tokene i RBAC loader nad bazom.
 * `AuthService` i `AuthController` (`/api/v1/auth`) dolaze u sljedećem koraku
 * Faze 1 — guard-ovi i `PermissionsService` su već aktivni.
 */
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { HealthModule } from './health/health.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuditLogModule } from './modules/audit-logs/audit-log.module.js';
import { FormSchemasModule } from './modules/form-schemas/form-schemas.module.js';
import { FormMigrationsModule } from './modules/form-migrations/form-migrations.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { TaskTypesModule } from './modules/task-types/task-types.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RegistrationsModule } from './modules/registrations/registrations.module.js';
import { InsurancesModule } from './modules/insurances/insurances.module.js';
import { RemindersModule } from './modules/reminders/reminders.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AttachmentsModule } from './modules/attachments/attachments.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { ClientTypeGuard } from './common/guards/client-type.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { RateLimitService } from './common/rate-limit/rate-limit.service.js';

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    HealthModule,
    AuditModule,
    AuthModule,
    // Role i matrica prava (docs/07 §2.3) — nakon AuthModule-a jer koristi
    // `PermissionsService` za Redis invalidaciju.
    RolesModule,
    // Korisnici (docs/07 §2.2) — koristi PasswordService/TokenService iz AuthModule-a.
    UsersModule,
    // Audit log — read-only API nad AuditLog tabelom (docs/07 §7).
    AuditLogModule,
    // Forme — katalog, verzije, objava/povlačenje, validacija zapisa (docs/04).
    FormSchemasModule,
    // Migracija zapisa između verzija forme (P12).
    FormMigrationsModule,
    // Vozila (docs/07 §2.5) — Faza 3.
    VehiclesModule,
    // Vozači (docs/07 §2.4) — Faza 3.
    DriversModule,
    // Registracije i osiguranje (docs/07 §2.6) — historija perioda (B-10).
    RegistrationsModule,
    ServicesModule,
    TaskTypesModule,
    TasksModule,
    ReportsModule,
    TiresModule,
    InsurancesModule,
    // Podsjetnici (docs/07 §2.14) — idempotentni skener (P-07).
    RemindersModule,
    // Obavijesti (in-app + SSE polling); FCM ostaje opcionalan do vlasničke konfiguracije.
    NotificationsModule,
    // Prilozi (docs/07 §2.12) — host bind-mount, magic bytes, potpisani URL (B-15).
    AttachmentsModule,
  ],
  controllers: [],
  providers: [
    RateLimitService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
    /**
     * Idempotency je između envelope-a i audita → replay vraća sirovi odgovor
     * envelope-u, ali ne poziva Audit ni handler drugi put.
     */
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    /**
     * Audit je **unutar** envelope-a i idempotency sloja → vidi sirove podatke
     * handler-a za `after`/diff, ne omotanu `{ data, meta }` strukturu.
     */
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    /**
     * Globalni guard-ovi (docs/05 §5.3, docs/07 §5) — redoslijed registracije je
     * redoslijed izvršavanja i **nije** proizvoljan:
     * 1. `RateLimitGuard`   — `vfm:rl:*` (global 300/60 s, login 5/900 s, upload
     *    30/60 s); ide PRVI da odbijanje bude jeftinije od argon2id verifikacije,
     * 2. `JwtAuthGuard`     — važeći token + aktivan nalog + `tokenVersion`,
     * 3. `ClientTypeGuard`  — Super Admin web-only (N-05/P1) + dozvoljeni klijenti,
     * 4. `PermissionsGuard` — svježina prava (P3) + `@RequirePermissions`.
     *
     * Javne rute (`/health/live|ready|startup`, `/auth/login|refresh|
     * forgot-password`) označavaju se s `@Public()`.
     */
    { provide: APP_GUARD, useClass: RateLimitGuard },
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
