/**
 * `AuthModule` (Faza 1 — Identitet).
 *
 * Sadržaj:
 * - `PasswordService` (argon2id + politika lozinki, docs/05 §7),
 * - `TokenService` (access JWT HS256 + refresh token/cookie, docs/05 §5),
 * - `PermissionsService` + `PrismaPermissionsLoader` (RBAC nad bazom, docs/05 §1–§5).
 *
 * Guard-ovi (`RateLimitGuard`, `JwtAuthGuard`, `ClientTypeGuard`,
 * `PermissionsGuard`) registrovani su globalno u `AppModule`. `AuthService` i
 * `AuthController` (`/api/v1/auth`: login/refresh/logout/me) dolaze u sljedećem
 * koraku Faze 1 — modul ih prihvata bez izmjene strukture.
 */
import { Module } from '@nestjs/common';
import { PASSWORD_BLOCKLIST, PasswordService } from './services/password.service.js';
import { TokenService } from './services/token.service.js';
import { PermissionsService } from './permissions/permissions.service.js';
import { PERMISSIONS_LOADER } from './permissions/permissions.types.js';
import { PrismaPermissionsLoader } from './permissions/prisma-permissions.loader.js';
import { LoggingSecurityEventSink, SECURITY_EVENT_SINK } from '../../common/audit/security-event.js';

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
     * Sigurnosni događaji se za sada logiraju (pino). `AuditModule` (chunk C)
     * prepisuje ovaj provider sink-om koji piše u `AuditLog` (severity SECURITY).
     */
    { provide: SECURITY_EVENT_SINK, useClass: LoggingSecurityEventSink },
    /**
     * Stvarni izvor RBAC snapshot-a (baza). Guard-ovi i `PermissionsService` rade
     * nad interfejsom `PermissionsLoader`, pa testovi i dalje ubacuju fake
     * (`test/helpers/rbac-fakes.ts`) bez izmjene ovog modula.
     * `UnavailablePermissionsLoader` (fail-closed `503`) ostaje u repou kao
     * zamjena za degradirani rad bez baze.
     */
    { provide: PERMISSIONS_LOADER, useClass: PrismaPermissionsLoader },
  ],
  exports: [PasswordService, TokenService, PermissionsService, SECURITY_EVENT_SINK],
})
export class AuthModule {}
