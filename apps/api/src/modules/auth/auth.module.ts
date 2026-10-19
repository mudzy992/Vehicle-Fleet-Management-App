/**
 * `AuthModule` (Faza 1 — Identitet).
 *
 * Trenutni sadržaj: servisi bez zavisnosti od baze —
 * - `PasswordService` (argon2id + politika lozinki, docs/05 §7),
 * - `TokenService` (access JWT HS256 + refresh token/cookie, docs/05 §5).
 *
 * `AuthService`, `AuthController`, `SessionService` i guard-ovi
 * (`JwtAuthGuard`, `ClientTypeGuard`, `PermissionsGuard`) biće dodati čim Prisma
 * sloj bude dostupan (bloker 1: `prisma generate` + migracija `init` se ne mogu
 * izvršiti u sandboxu). Modul ih je pripremljen prihvatiti bez izmjene strukture.
 *
 * ⚠️ 2FA se NE implementira (R-05).
 */
import { Module } from '@nestjs/common';
import { PASSWORD_BLOCKLIST, PasswordService } from './services/password.service.js';
import { TokenService } from './services/token.service.js';
import { PermissionsService } from './permissions/permissions.service.js';
import { PERMISSIONS_LOADER } from './permissions/permissions.types.js';
import { UnavailablePermissionsLoader } from './permissions/unavailable-permissions.loader.js';
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
     * ⛔ BLOKER 1: `PERMISSIONS_LOADER` je privremeno fail-closed zamjena
     * (`503 DEPENDENCY_UNAVAILABLE`). Čim `prisma generate` + migracija `init`
     * budu u repou, zamijeniti s `PrismaPermissionsLoader` — guard-ovi, servisi i
     * testovi ostaju isti jer rade nad interfejsom.
     */
    { provide: PERMISSIONS_LOADER, useClass: UnavailablePermissionsLoader },
  ],
  exports: [PasswordService, TokenService, PermissionsService, SECURITY_EVENT_SINK],
})
export class AuthModule {}
