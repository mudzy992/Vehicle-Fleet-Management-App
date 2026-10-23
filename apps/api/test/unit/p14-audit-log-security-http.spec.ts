import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { AuditLogController } from '../../src/modules/audit-logs/audit-log.controller.js';
import { AuditLogService } from '../../src/modules/audit-logs/audit-log.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

type Scenario = 'AUDIT_VIEW' | 'NO_VIEW';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'AUDIT_VIEW'
    ? [{ permission: 'audit:view', scope: 'ALL', scopeVehicleIds: [] }]
    : [];
  return {
    id: 'p14-audit-user', roles: ['CUSTOM'], roleIds: [], clientType: 'WEB', sessionId: 'p14-audit-session',
    jti: 'p14-audit-token', tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false,
    mustChangePassword: false, status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — SECURITY audit zapisi kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => []);
  const count = vi.fn(async () => 0);
  const findUnique = vi.fn(async () => ({
    id: 9007199254740993n, action: 'LOGIN', severity: 'SECURITY', actorId: null,
    actorEmail: null, actorRoles: [], entityType: 'auth', entityId: null,
    changedFields: [], reason: null, requestId: null, ipAddress: null,
    userAgent: null, clientType: 'WEB', createdAt: new Date('2026-10-20T12:00:00Z'),
    before: null, after: null, metadata: null,
  }));

  beforeAll(async () => {
    const prisma = { auditLog: { findMany, count, findUnique } } as unknown as PrismaService;
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        Reflector, PermissionsGuard, AuditLogService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: {
          snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
          currentPermissionsVersion: vi.fn(async () => 0),
        } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
      const scenario = request.headers['x-sweep-role'];
      if (scenario) request.user = actorFor((Array.isArray(scenario) ? scenario[0] : scenario) as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('audit:view ALL skriva SECURITY iz liste i direktnog GET-a bez audit:view_security', async () => {
    const listResponse = await fetch(`${baseUrl}/audit-logs?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'AUDIT_VIEW' },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({ items: [], securityHidden: true });
    expect(findMany.mock.calls.at(-1)?.[0].where).toMatchObject({ severity: { not: 'SECURITY' } });

    const detailResponse = await fetch(`${baseUrl}/audit-logs/9007199254740993`, {
      headers: { 'x-sweep-role': 'AUDIT_VIEW' },
    });
    expect(detailResponse.status).toBe(403);
    expect(((await detailResponse.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
  });

  it('bez audit:view endpoint vraća 403 prije upita prema bazi', async () => {
    const callsBefore = findMany.mock.calls.length;
    const response = await fetch(`${baseUrl}/audit-logs?page=1&pageSize=20`, {
      headers: { 'x-sweep-role': 'NO_VIEW' },
    });
    expect(response.status).toBe(403);
    expect(findMany).toHaveBeenCalledTimes(callsBefore);
  });
});
