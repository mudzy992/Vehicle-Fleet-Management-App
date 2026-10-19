/**
 * `ClientTypeGuard` — drugi sloj: smije li ovaj klijent uopće koristiti rutu
 * (docs/05 §6, N-05, P1).
 *
 * Pravila:
 * 1. **Super Admin je web-only.** Zahtjev s mobilnog klijenta (`MOBILE_ANDROID`,
 *    `MOBILE_IOS`) → `403 MOBILE_ACCESS_FORBIDDEN` + `SECURITY_EVENT` u audit.
 *    Provjera je i pri loginu (`AuthService`), ali se **ponavlja na svakom
 *    zahtjevu** — token izdat prije promjene uloge ne smije zaobići pravilo.
 * 2. Ruta može suziti tipove klijenta (`@AllowedClientTypes('WEB')`).
 * 3. Inače važe `allowedClientTypes` korisnikovih uloga iz baze (`Role`), uz
 *    fallback na `ROLE_ALLOWED_CLIENT_TYPES` iz `@vfm/shared`.
 *
 * Izvor istine je **potpisani claim `ct`**, ne `X-Client-Type` zaglavlje:
 * zaglavlje se čita samo pri loginu (kad token još ne postoji), pa ga klijent ne
 * može naknadno krivotvoriti bez novog tokena.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
// ⚠️ Value import: `Reflector` se injektira, pa mora biti u DI metadata.
import { Reflector } from '@nestjs/core';
import { ROLE_ALLOWED_CLIENT_TYPES, SUPER_ADMIN_ROLE, type ClientType } from '@vfm/shared';
import { isClientTypeAllowed } from '@vfm/shared/schemas';
import { VfmErrors } from '../errors/vfm-error.js';
import { allowedClientTypesForRoute, isPublicRoute } from '../decorators/auth.decorators.js';
import type { VfmRequest } from '../types/authenticated-user.js';
import {
  SECURITY_EVENT_SINK,
  reportSecurityEvent,
  securityContextFromRequest,
  type SecurityEventSink,
} from '../audit/security-event.js';

/** Da li je tip klijenta mobilni (Android/iOS). */
export function isMobileClientType(clientType: ClientType | undefined): boolean {
  return clientType === 'MOBILE_ANDROID' || clientType === 'MOBILE_IOS';
}

/** Fallback lista dozvoljenih klijenata iz kodova uloga (ako baza nema podatak). */
export function fallbackAllowedClientTypes(roles: readonly string[]): readonly ClientType[] {
  const allowed = new Set<ClientType>();
  for (const role of roles) {
    for (const clientType of ROLE_ALLOWED_CLIENT_TYPES[role as keyof typeof ROLE_ALLOWED_CLIENT_TYPES] ??
      []) {
      allowed.add(clientType);
    }
  }
  return allowed.size > 0 ? [...allowed] : ['WEB'];
}

@Injectable()
export class ClientTypeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(SECURITY_EVENT_SINK) private readonly security?: SecurityEventSink,
  ) {}

  // `async` (iako je logika sinhrona): guard-ovi se u Nest-u pozivaju uniformno, a
  // caller-i (uključujući testove) ne smiju morati razlikovati sync/async bacanje.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;

    const request = context.switchToHttp().getRequest<VfmRequest>();
    const user = request.user;
    // Bez korisnika nema šta provjeravati — `JwtAuthGuard` je već bacio 401.
    if (!user) return true;

    const eventContext = securityContextFromRequest(request);

    // 1) Super Admin + mobilni klijent → 403 (P1) + SECURITY_EVENT
    if (user.roles.includes(SUPER_ADMIN_ROLE) && isMobileClientType(user.clientType)) {
      reportSecurityEvent(this.security, {
        type: 'MOBILE_ACCESS_FORBIDDEN',
        ...eventContext,
        userId: user.id,
        clientType: user.clientType,
        roles: user.roles,
        reason: 'Super Admin pokušao pristup s mobilnog klijenta',
      });
      throw VfmErrors.mobileAccessForbidden();
    }

    // 2) ograničenje rute ima prednost nad ulogama
    const routeAllowed = allowedClientTypesForRoute(this.reflector, context);
    const allowed =
      routeAllowed ??
      (user.allowedClientTypes.length > 0 ? user.allowedClientTypes : fallbackAllowedClientTypes(user.roles));

    // 3) klijent nije u dozvoljenoj listi → 403
    if (!isClientTypeAllowed(user.clientType, allowed)) {
      reportSecurityEvent(this.security, {
        type: 'MOBILE_SCOPE_NOT_ALLOWED',
        ...eventContext,
        userId: user.id,
        clientType: user.clientType,
        roles: user.roles,
        reason: `dozvoljeni klijenti: ${allowed.join(', ')}`,
      });
      throw VfmErrors.mobileScopeNotAllowed();
    }

    return true;
  }
}
