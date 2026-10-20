/**
 * `AuthModule` (Faza 1 — Identitet).
 *
 * Sadržaj:
 * - `PasswordService` (argon2id + politika lozinki, docs/05 §7),
 * - `TokenService` (access JWT HS256 + refresh token/cookie, docs/05 §5),
 * - `PermissionsService` + `PrismaPermissionsLoader` (RBAC nad bazom, docs/05 §1–§5),
 * - `AuthService` + `AuthController` (`/api/v1/auth`: login, refresh, logout,
 *   me, change-password, sessions — docs/07 §7).
 *
 * Guard-ovi (`RateLimitGuard`, `JwtAuthGuard`, `ClientTypeGuard`,
 * `PermissionsGuard`) registrovani su globalno u `AppModule`, pa `/auth/login`
 * i `/auth/refresh` nose `@Public()`, a ostale rute prolaze puni lanac provjera.
 * `PrismaService` dolazi iz globalnog `PrismaModule` (jedan pg.Pool po procesu).
 */
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PASSWORD_BLOCKLIST, PasswordService } from './services/password.service.js';
import { TokenService } from './services/token.service.js';
import { PermissionsService } from './permissions/permissions.service.js';
import { PERMISSIONS_LOADER } from './permissions/permissions.types.js';
import { PrismaPermissionsLoader } from './permissions/prisma-permissions.loader.js';
import { PrismaAuditSink } from '../../common/audit/prisma-audit.sink.js';
import { SECURITY_EVENT_SINK } from '../../common/audit/security-event.js';

@Module({
  providers: [
    /**
     * Dodatna blocklista čestih lozinki: prazna po defaultu (koristi se ugrađena
     * lista iz `PasswordService`). Deploy može prepisati ovaj provider
     * (`useFactory` koji čita datoteku) bez izmjene domenskog koda.
     */
    { provide: PASSWORD_BLOCKLIST, useValue: [] as readonly string[] },
    PasswordService,
    TokenService,
    PermissionsService,
    /**
     * Sigurnosni događaji (LOGIN_FAILED, MOBILE_ACCESS_FORBIDDEN,
     * REFRESH_REUSE_DETECTED, …) pišu se u `AuditLog` s `action='SECURITY'` i
     * `severity='SECURITY'` (docs/05 §9). `LoggingSecurityEventSink` ostaje kao
     * zamjena bez baze.
     */
    { provide: SECURITY_EVENT_SINK, useClass: PrismaAuditSink },
    /**
     * Stvarni izvor RBAC snapshot-a (baza). Guard-ovi i `PermissionsService` rade
     * nad interfejsom `PermissionsLoader`, pa testovi i dalje ubacuju fake
     * (`test/helpers/rbac-fakes.ts`) bez izmjene ovog modula.
     * `UnavailablePermissionsLoader` (fail-closed `503`) ostaje u repou kao
     * zamjena za degradirani rad bez baze.
     */
    { provide: PERMISSIONS_LOADER, useClass: PrismaPermissionsLoader },
    AuthService,
  ],
  controllers: [AuthController],
  exports: [AuthService, PasswordService, TokenService, PermissionsService, SECURITY_EVENT_SINK],
})
export class AuthModule {}
