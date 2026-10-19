/**
 * `PermissionsGuard` — treći sloj: svježina prava + tražene permisije
 * (docs/05 §5.3, P3, P14).
 *
 * Redoslijed (bitan — pogrešan red bi otkrio postojanje resursa bez prava):
 * 1. **Svježina prava**: claim `pv` < trenutne verzije → `401 PERMISSIONS_STALE`
 *    + `Retry-After: 0`. Klijent tada zove `/auth/refresh` (bez ponovnog logina)
 *    i dobija token s novom `pv` — tako opoziv prava važi ≤ 5 s (P3).
 * 2. Rute bez `@RequirePermissions` prolaze (npr. `/auth/me`).
 * 3. Tražene permisije: `mode: 'ALL'` (default) ili `'ANY'`, uz minimalan opseg
 *    iz dekoratora (`@RequireScope('report:view', 'ALL')`). Nedostaje li koja →
 *    `403 PERMISSION_DENIED` s tačnim kodovima u `details[]` + SECURITY_EVENT.
 *
 * Opseg nad **konkretnim zapisom** (`OWN`, `VEHICLE_IDS`, `DRIVER_IDS`) ne može se
 * provjeriti u guard-u jer zapis još nije učitan — to radi servis kroz
 * `PermissionsService.assertScope(...)` (P14: bez podataka preko direktnog URL-a).
 *
 * ⚠️ 2FA se NE implementira (R-05).
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
// ⚠️ Value import: `Reflector` se injektira, pa mora biti u DI metadata.
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@vfm/shared';
import { PermissionsService } from '../../modules/auth/permissions/permissions.service.js';
import { VfmErrors } from '../errors/vfm-error.js';
import {
  isPublicRoute,
  requiredPermissions,
  type RequiredPermissionsMetadata,
} from '../decorators/auth.decorators.js';
import type { AuthenticatedUser, VfmRequest } from '../types/authenticated-user.js';
import {
  SECURITY_EVENT_SINK,
  reportSecurityEvent,
  securityContextFromRequest,
  type SecurityEventSink,
} from '../audit/security-event.js';

/** `Retry-After` uz `401 PERMISSIONS_STALE` — klijent odmah smije refresh-ovati. */
export const PERMISSIONS_STALE_RETRY_AFTER = '0';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
    @Optional() @Inject(SECURITY_EVENT_SINK) private readonly security?: SecurityEventSink,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<VfmRequest>();
    const user = request.user;
    if (!user) return true; // `JwtAuthGuard` je već odbio zahtjev

    const eventContext = securityContextFromRequest(request);

    // 1) Svježina prava (P3)
    await this.assertFreshPermissions(user, http.getResponse<RetryAfterResponse>(), eventContext);

    // 2) Ruta bez eksplicitnog zahtjeva
    const metadata = requiredPermissions(this.reflector, context);
    if (!metadata || metadata.permissions.length === 0) return true;

    // 3) Tražene permisije
    const missing = missingFor(user, metadata);
    if (missing.length === 0) return true;

    reportSecurityEvent(this.security, {
      type: 'PERMISSION_DENIED',
      ...eventContext,
      userId: user.id,
      clientType: user.clientType,
      roles: user.roles,
      permission: missing.join(','),
      scope: metadata.scope,
      reason: `nedostaje: ${missing.join(', ')}`,
    });

    throw VfmErrors.permissionDenied(
      missing.map((permission) => ({
        path: [permission],
        message: `Nemate pravo: ${permission}.`,
        code: 'permission_denied',
      })),
    );
  }

  /**
   * Upoređuje `pv` iz tokena s trenutnom verzijom permisija
   * (`max(Redis brojači, Role.permissionsVersion iz baze)`).
   */
  private async assertFreshPermissions(
    user: AuthenticatedUser,
    response: RetryAfterResponse | undefined,
    eventContext: ReturnType<typeof securityContextFromRequest>,
  ): Promise<void> {
    const snapshot = await this.permissions.snapshot(user.id);
    const current = await this.permissions.currentPermissionsVersion(
      user.roleIds,
      snapshot?.permissionsVersion ?? 0,
    );

    if (user.permissionsVersion >= current) return;

    // Klijent mora odmah refresh-ovati token (bez ponovnog logina).
    response?.setHeader?.('Retry-After', PERMISSIONS_STALE_RETRY_AFTER);

    reportSecurityEvent(this.security, {
      type: 'PERMISSIONS_STALE',
      ...eventContext,
      userId: user.id,
      clientType: user.clientType,
      roles: user.roles,
      reason: `pv=${user.permissionsVersion} < ${current}`,
    });

    throw VfmErrors.permissionsStale();
  }
}

/** Permisije koje nedostaju za dati zahtjev (poštuje `mode` i minimalan opseg). */
export function missingFor(
  user: AuthenticatedUser,
  metadata: RequiredPermissionsMetadata,
): readonly string[] {
  const result = user.permissions;
  if (!result) return metadata.permissions;

  const satisfied = (permission: string): boolean => hasPermission(result, permission, metadata.scope);

  if (metadata.mode === 'ANY') {
    return metadata.permissions.some(satisfied) ? [] : metadata.permissions;
  }
  return metadata.permissions.filter((permission) => !satisfied(permission));
}

/** HTTP odgovor s opcionim `setHeader` (express ima, test fake može imati). */
export interface RetryAfterResponse {
  setHeader?: (name: string, value: string) => void;
}
