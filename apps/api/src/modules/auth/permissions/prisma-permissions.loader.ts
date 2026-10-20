/**
 * `PrismaPermissionsLoader` — stvarni izvor RBAC snapshot-a (docs/05 §1–§5).
 *
 * Zamjenjuje `UnavailablePermissionsLoader` (fail-closed zamjena koja je vraćala
 * `503 DEPENDENCY_UNAVAILABLE` dok Prisma sloj nije postojao). Guard-ovi,
 * `PermissionsService` i testovi rade nad interfejsom `PermissionsLoader`, pa ova
 * zamjena ne mijenja ništa osim izvora podataka.
 *
 * Šta se čita (jedan upit, bez N+1):
 * - `User` (status, `tokenVersion`, `mustChangePassword`, soft delete),
 * - `UserRole` **koji važi sada**: `revokedAt IS NULL`, `validFrom <= sad`,
 *   `validUntil > sad` (ili NULL) i uloga nije obrisana,
 * - `Role` (code, `permissionsVersion`, `allowedClientTypes` — N-05/P1),
 * - `RolePermission` + `Permission.code` (grantovi s opsegom i ID listama).
 *
 * `permissionsVersion` u snapshot-u je **najveći** `Role.permissionsVersion` među
 * važećim ulogama; `PermissionsService` ga upoređuje s Redis brojačem
 * (`vfm:permver:role:{roleId}`) i tako otkriva revokaciju unutar ≤ 5 s (P3).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ROLE_CODES, type ClientType, type PermissionGrant, type PermissionScope, type RoleCode } from '@vfm/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PermissionsLoader, UserPermissionsSnapshot } from './permissions.types.js';

/** Pretvara `Role.code` iz baze u `RoleCode`; nepoznat kod se odbacuje uz WARN. */
function asRoleCode(code: string, logger: Logger): RoleCode | undefined {
  if ((ROLE_CODES as readonly string[]).includes(code)) return code as RoleCode;
  logger.warn(
    `Uloga s nepoznatim kodom '${code}' u bazi — ignorišem je u JWT claimu 'roles'. ` +
      `Dozvoljeni kodovi: ${ROLE_CODES.join(', ')}.`,
  );
  return undefined;
}

/** `RolePermission.conditions` je JSONB — u grant ide samo objekat ili null. */
function asConditions(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

@Injectable()
export class PrismaPermissionsLoader implements PermissionsLoader {
  private readonly logger = new Logger(PrismaPermissionsLoader.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadSnapshot(userId: string): Promise<UserPermissionsSnapshot | undefined> {
    const now = new Date();

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        tokenVersion: true,
        mustChangePassword: true,
        roles: {
          where: {
            revokedAt: null,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            ],
            role: { deletedAt: null },
          },
          select: {
            role: {
              select: {
                id: true,
                code: true,
                permissionsVersion: true,
                allowedClientTypes: true,
                permissions: {
                  select: {
                    scope: true,
                    scopeVehicleIds: true,
                    scopeDriverIds: true,
                    conditions: true,
                    permission: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) return undefined;

    const roles = user.roles.map((entry) => entry.role);
    const roleCodes: RoleCode[] = [];
    for (const role of roles) {
      const code = asRoleCode(role.code, this.logger);
      if (code && !roleCodes.includes(code)) roleCodes.push(code);
    }

    const allowedClientTypes: ClientType[] = [];
    for (const role of roles) {
      for (const clientType of role.allowedClientTypes) {
        if (!allowedClientTypes.includes(clientType)) allowedClientTypes.push(clientType);
      }
    }

    const grants: PermissionGrant[] = roles.flatMap((role) =>
      role.permissions.map((grant) => {
        const scope: PermissionScope = grant.scope;
        return {
          permission: grant.permission.code,
          scope,
          ...(scope === 'VEHICLE_IDS' ? { scopeVehicleIds: [...grant.scopeVehicleIds] } : {}),
          ...(scope === 'DRIVER_IDS' ? { scopeDriverIds: [...grant.scopeDriverIds] } : {}),
          conditions: asConditions(grant.conditions),
        } satisfies PermissionGrant;
      }),
    );

    return {
      userId: user.id,
      status: user.status,
      roles: roleCodes,
      roleIds: roles.map((role) => role.id),
      grants,
      tokenVersion: user.tokenVersion,
      allowedClientTypes,
      permissionsVersion: roles.reduce((max, role) => Math.max(max, role.permissionsVersion), 0),
      mustChangePassword: user.mustChangePassword,
    };
  }
}
