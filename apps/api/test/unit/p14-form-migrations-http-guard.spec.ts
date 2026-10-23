import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateEffectivePermissions, type PermissionGrant } from '@vfm/shared';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { FormMigrationsController } from '../../src/modules/form-migrations/form-migrations.controller.js';
import { FormMigrationsService } from '../../src/modules/form-migrations/form-migrations.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
type Scenario = 'MIGRATION_VIEW' | 'NO_MIGRATION_VIEW';
function actorFor(scenario: Scenario): AuthenticatedUser {
  const grants: readonly PermissionGrant[] = scenario === 'MIGRATION_VIEW'
    ? [{ permission: 'form:migrate_records', scope: 'ALL', scopeVehicleIds: [] }]
    : [];
  return {
    id: `p14-form-migration-${scenario.toLowerCase()}`, roles: ['CUSTOM'], roleIds: [], clientType: 'WEB',
    sessionId: 'p14-form-migration-session', jti: `p14-form-migration-${scenario.toLowerCase()}`,
    tokenVersion: 1, permissionsVersion: 0, isSuperAdmin: false, mustChangePassword: false,
    status: 'ACTIVE', allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: ['CUSTOM'], grants, clientType: 'WEB' }),
  };
}

describe('P14 — zaštita podataka form-migrations kroz HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const preview = { id: JOB_ID, status: 'PREVIEW', items: [{ before: { confidential: true } }] };
  const service = {
    get: vi.fn(async () => preview),
    preview: vi.fn(async () => preview),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FormMigrationsController],
      providers: [
        Reflector, PermissionsGuard,
        { provide: FormMigrationsService, useValue: service },
        { provide: PrismaService, useValue: {} },
        { provide: PermissionsService, useValue: {
          snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
          currentPermissionsVersion: vi.fn(async () => 0),
        } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
      const rawScenario = request.headers['x-sweep-role'];
      if (rawScenario) request.user = actorFor((Array.isArray(rawScenario) ? rawScenario[0] : rawScenario) as Scenario);
      next();
    });
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => { await app?.close(); });

  it('form:migrate_records štiti detalj i preview koji mogu sadržavati before/after podatke', async () => {
    const deniedDetail = await fetch(`${baseUrl}/form-migrations/${JOB_ID}`, {
      headers: { 'x-sweep-role': 'NO_MIGRATION_VIEW' },
    });
    expect(deniedDetail.status).toBe(403);
    expect(((await deniedDetail.json()) as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED');
    expect(service.get).not.toHaveBeenCalled();

    const authorizedDetail = await fetch(`${baseUrl}/form-migrations/${JOB_ID}`, {
      headers: { 'x-sweep-role': 'MIGRATION_VIEW' },
    });
    expect(authorizedDetail.status).toBe(200);
    expect(await authorizedDetail.json()).toEqual(preview);
    expect(service.get).toHaveBeenCalledWith(JOB_ID);

    const deniedPreview = await fetch(`${baseUrl}/form-migrations/${JOB_ID}/preview`, {
      method: 'POST', headers: { 'x-sweep-role': 'NO_MIGRATION_VIEW' },
    });
    expect(deniedPreview.status).toBe(403);
    expect(service.preview).not.toHaveBeenCalled();

    const authorizedPreview = await fetch(`${baseUrl}/form-migrations/${JOB_ID}/preview`, {
      method: 'POST', headers: { 'x-sweep-role': 'MIGRATION_VIEW' },
    });
    expect(authorizedPreview.status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith(JOB_ID);
  });
});
