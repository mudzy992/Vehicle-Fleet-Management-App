/**
 * `JwtAuthGuard` — prvi sloj: ima li zahtjev važeći access token (docs/05 §5).
 *
 * Redoslijed provjera (svaka odbija zahtjev prije bilo kakvog pristupa podacima):
 * 1. `@Public` rute prolaze bez tokena (`/auth/login`, `/auth/refresh`, `/health/*`),
 * 2. `Authorization: Bearer <jwt>` → potpis, `exp`, `iss`, `aud`, obavezni claimovi
 *    (`TokenService`),
 * 3. korisnik postoji i nalog je `ACTIVE`,
 * 4. `tokenVersion` (claim `tv`) ≥ trenutne verzije → inače `401 TOKEN_REVOKED`
 *    (trenutno odjavljivanje svih sesija, docs/05 §5.4),
 * 5. izračunaju se efektivna prava **s tipom klijenta iz claima `ct`** i prikače na
 *    `request.user` (koriste ih `ClientTypeGuard`, `PermissionsGuard` i servisi).
 *
 * Bez Prisme (`PermissionsLoader`) koraci 3–5 bacaju `503 DEPENDENCY_UNAVAILABLE`
 * — fail closed: nikad se ne dozvoljava pristup bez provjere prava (bloker 1).
 *
 * ⚠️ 2FA se NE implementira (R-05).
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
// ⚠️ Value import: `Reflector` se injektira, pa mora biti u DI metadata.
import { Reflector } from '@nestjs/core';
import { evaluateEffectivePermissions } from '@vfm/shared';
import { TokenService } from '../../modules/auth/services/token.service.js';
import { PermissionsService } from '../../modules/auth/permissions/permissions.service.js';
import { VfmErrors } from '../errors/vfm-error.js';
import { isPublicRoute } from '../decorators/auth.decorators.js';
import type { AuthenticatedUser, VfmRequest } from '../types/authenticated-user.js';
import {
  SECURITY_EVENT_SINK,
  reportSecurityEvent,
  securityContextFromRequest,
  type SecurityEvent,
  type SecurityEventSink,
  type SecurityEventType,
} from '../audit/security-event.js';

/** Podaci zahtjeva koji idu u svaki sigurnosni događaj. */
type SecurityEventContext = ReturnType<typeof securityContextFromRequest>;

/** Izdvaja token iz `Authorization: Bearer …`. */
export function extractBearerToken(request: VfmRequest): string | undefined {
  const header = request.headers.authorization ?? request.headers.Authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(value.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    @Optional() @Inject(SECURITY_EVENT_SINK) private readonly security?: SecurityEventSink,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;

    const request = context.switchToHttp().getRequest<VfmRequest>();
    const eventContext = securityContextFromRequest(request);

    const token = extractBearerToken(request);
    if (!token) {
      this.report('UNAUTHENTICATED', eventContext, { reason: 'nedostaje Bearer token' });
      throw VfmErrors.unauthenticated();
    }

    const claims = this.tokens.verifyAccessToken(token);

    const snapshot = await this.permissions.snapshot(claims.sub);
    if (!snapshot) {
      this.report('UNAUTHENTICATED', eventContext, {
        userId: claims.sub,
        reason: 'korisnik ne postoji',
      });
      throw VfmErrors.unauthenticated();
    }

    if (snapshot.status !== 'ACTIVE') {
      this.report('UNAUTHENTICATED', eventContext, {
        userId: claims.sub,
        clientType: claims.ct,
        roles: snapshot.roles,
        reason: `nalog nije aktivan (${snapshot.status})`,
      });
      throw VfmErrors.accountInactive();
    }

    // Trenutno odjavljivanje: Redis brojač ima prednost nad bazom.
    const currentTokenVersion = (await this.permissions.tokenVersion(claims.sub)) ?? snapshot.tokenVersion;
    if (claims.tv < currentTokenVersion) {
      this.report('TOKEN_REVOKED', eventContext, {
        userId: claims.sub,
        clientType: claims.ct,
        roles: snapshot.roles,
        reason: `tv=${claims.tv} < ${currentTokenVersion}`,
      });
      throw VfmErrors.tokenRevoked();
    }

    const effective = evaluateEffectivePermissions({
      roles: snapshot.roles,
      grants: snapshot.grants,
      status: snapshot.status,
      clientType: claims.ct,
    });

    const user: AuthenticatedUser = {
      id: claims.sub,
      roles: snapshot.roles,
      roleIds: snapshot.roleIds,
      clientType: claims.ct,
      sessionId: claims.sid,
      jti: claims.jti,
      tokenVersion: claims.tv,
      permissionsVersion: claims.pv,
      isSuperAdmin: snapshot.roles.includes('SUPER_ADMIN'),
      mustChangePassword: snapshot.mustChangePassword,
      status: snapshot.status,
      allowedClientTypes: snapshot.allowedClientTypes,
      permissions: effective,
    };
    request.user = user;

    return true;
  }

  private report(
    type: SecurityEventType,
    eventContext: SecurityEventContext,
    extra: Partial<Omit<SecurityEvent, 'type'>> = {},
  ): void {
    reportSecurityEvent(this.security, { type, ...eventContext, ...extra });
  }
}
