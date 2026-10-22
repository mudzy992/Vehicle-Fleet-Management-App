/**
 * `AuditLogService` — čitanje audit traga (docs/07 §7, docs/05 §9).
 *
 * Provjerava:
 * - **P14**: SECURITY zapisi (prijave, odbijanja, promjene prava) nisu vidljivi
 *   bez `audit:view_security` — ni u listi (tada `securityHidden: true`) ni
 *   direktnim `GET /audit-logs/:id`;
 * - paginaciju/filtere (akcija, akter, entitet, period) rade u bazi, pa je
 *   `total` tačan i kad su SECURITY redovi sakriveni;
 * - `BIGINT` ID se vraća kao **string** (bez gubitka preciznosti), a smeće u
 *   putanji daje `404` (nikad 500).
 */
import { describe, expect, it } from 'vitest';
import { evaluateEffectivePermissions } from '@vfm/shared';
import type { AuditLogQuery } from '@vfm/shared/schemas';
import { auditLogQuerySchema } from '@vfm/shared/schemas';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { AuditLogService } from '../../src/modules/audit-logs/audit-log.service.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';
import { ADMIN_SNAPSHOT, ROLE_ADMIN_ID, USER_ADMIN } from '../helpers/rbac-fakes.js';

function auditor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ADMIN,
    email: 'ana.anic@vfm.test',
    roles: ['ADMINISTRATOR'],
    roleIds: [ROLE_ADMIN_ID],
    clientType: 'WEB',
    sessionId: '018f0000-0000-7000-8000-0000000000aa',
    jti: '018f0000-0000-7000-8000-0000000000ab',
    tokenVersion: ADMIN_SNAPSHOT.tokenVersion,
    permissionsVersion: 1,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    ...overrides,
  };
}

const ENTITY_ID = '018f0000-0000-7000-8000-0000000000b1';

function build() {
  const prisma = new FakePrismaClient();

  prisma.addAuditLog({
    action: 'CREATE',
    severity: 'INFO',
    actorId: USER_ADMIN,
    actorEmail: 'ana.anic@vfm.test',
    entityType: 'Role',
    entityId: ENTITY_ID,
    changedFields: ['name'],
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
  });
  prisma.addAuditLog({
    action: 'LOGIN',
    severity: 'SECURITY',
    actorId: USER_ADMIN,
    actorEmail: 'ana.anic@vfm.test',
    entityType: 'auth',
    createdAt: new Date('2026-02-02T10:00:00.000Z'),
  });
  prisma.addAuditLog({
    action: 'DELETE',
    severity: 'CRITICAL',
    actorId: '018f0000-0000-7000-8000-000000000001',
    actorEmail: 'super@vfm.test',
    entityType: 'User',
    createdAt: new Date('2026-02-03T10:00:00.000Z'),
    before: { email: 'a@vfm.test' },
    after: { email: 'deleted@invalid' },
  });

  const service = new AuditLogService(asPrismaService(prisma));
  return { prisma, service };
}

function query(overrides: Partial<AuditLogQuery> = {}): AuditLogQuery {
  return { page: 1, pageSize: 50, ...overrides };
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<VfmException> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    expect((error as VfmException).code).toBe(code);
    return error as VfmException;
  }
  throw new Error(`Očekivana greška '${code}'.`);
}

describe('AuditLogService — list', () => {
  it('vraća zapise od najnovijeg, bez SECURITY redova bez audit:view_security', async () => {
    const { service } = build();

    const result = await service.list(query(), auditor());

    expect(result.securityHidden).toBe(true);
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.action)).toEqual(['DELETE', 'CREATE']);
    expect(result.items.every((item) => item.severity !== 'SECURITY')).toBe(true);
  });

  it('sa audit:view_security vidi i SECURITY redove i može filtrirati po severity', async () => {
    const { service } = build();
    const actor = auditor({ isSuperAdmin: true });

    const all = await service.list(query(), actor);
    expect(all.securityHidden).toBe(false);
    expect(all.total).toBe(3);

    const securityOnly = await service.list(query({ severity: 'SECURITY' }), actor);
    expect(securityOnly.items).toHaveLength(1);
    expect(securityOnly.items[0]?.action).toBe('LOGIN');
  });

  it('audit:view_security:OWN ne daje pristup cijeloj SECURITY kolekciji', async () => {
    const { service } = build();
    const ownScoped = evaluateEffectivePermissions({
      roles: [],
      grants: [{ permission: 'audit:view_security', scope: 'OWN' }],
      status: 'ACTIVE',
      clientType: 'WEB',
    });

    const result = await service.list(query(), auditor({ permissions: ownScoped }));

    expect(result.securityHidden).toBe(true);
    expect(result.items.every((item) => item.severity !== 'SECURITY')).toBe(true);
    await expectCode(() => service.get('2', auditor({ permissions: ownScoped })), 'PERMISSION_DENIED');
  });

  it('SECURITY filter bez prava ne otkriva ništa (filter se ignoriše, redovi ostaju sakriveni)', async () => {
    const { service } = build();

    const result = await service.list(query({ severity: 'SECURITY' }), auditor());

    expect(result.securityHidden).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('filtrira po akciji, akteru, entitetu i periodu', async () => {
    const { service } = build();
    const actor = auditor({ isSuperAdmin: true });

    expect((await service.list(query({ action: 'DELETE' }), actor)).items).toHaveLength(1);
    expect((await service.list(query({ actorId: USER_ADMIN }), actor)).total).toBe(2);
    expect((await service.list(query({ entityType: 'Role' }), actor)).total).toBe(1);
    expect((await service.list(query({ entityId: ENTITY_ID }), actor)).total).toBe(1);

    const period = await service.list(
      query({ from: '2026-02-02T00:00:00.000Z', to: '2026-02-02T23:59:59.000Z' }),
      actor,
    );
    expect(period.items.map((item) => item.severity)).toEqual(['SECURITY']);
  });

  it('paginacija drži `total` tačnim', async () => {
    const { service } = build();
    const actor = auditor({ isSuperAdmin: true });

    const page2 = await service.list({ page: 2, pageSize: 2 }, actor);

    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.totalPages).toBe(2);
  });

  it('mapira BIGINT ID u string i datume u ISO', async () => {
    const { service } = build();

    const result = await service.list(query(), auditor());
    const create = result.items.find((item) => item.action === 'CREATE');

    expect(create?.id).toBe('1');
    expect(create?.createdAt).toBe('2026-02-01T10:00:00.000Z');
    expect(create?.changedFields).toEqual(['name']);
    expect(create?.actorRoles).toEqual([]);
  });
});

describe('AuditLogService — get', () => {
  it('vraća before/after diff za zapis', async () => {
    const { service } = build();

    const detail = await service.get('3', auditor({ isSuperAdmin: true }));

    expect(detail).toMatchObject({ id: '3', action: 'DELETE', severity: 'CRITICAL' });
    expect(detail.before).toEqual({ email: 'a@vfm.test' });
    expect(detail.after).toEqual({ email: 'deleted@invalid' });
  });

  it('SECURITY zapis traži audit:view_security i preko direktnog ID-a', async () => {
    const { service } = build();

    await expectCode(() => service.get('2', auditor()), 'PERMISSION_DENIED');

    const allowed = await service.get('2', auditor({ isSuperAdmin: true }));
    expect(allowed.action).toBe('LOGIN');
    expect(allowed.severity).toBe('SECURITY');
  });

  it('nepostojeći i neispravni ID daju 404 (nikad 500)', async () => {
    const { service } = build();

    await expectCode(() => service.get('999', auditor({ isSuperAdmin: true })), 'NOT_FOUND');
    await expectCode(() => service.get('1e3', auditor({ isSuperAdmin: true })), 'NOT_FOUND');
    await expectCode(() => service.get('-1', auditor({ isSuperAdmin: true })), 'NOT_FOUND');
    await expectCode(() => service.get('abc', auditor({ isSuperAdmin: true })), 'NOT_FOUND');
  });
});

describe('auditLogQuerySchema', () => {
  it('coerce-uje paginaciju iz query stringa i odbija neispravan period', async () => {
    const parsed = auditLogQuerySchema.safeParse({ page: '2', pageSize: '25', severity: 'SECURITY' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ page: 2, pageSize: 25 });

    const invalidRange = auditLogQuerySchema.safeParse({
      from: '2026-02-05T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
    expect(invalidRange.success).toBe(false);

    const badAction = auditLogQuerySchema.safeParse({ action: 'NEPOSTOJECA' });
    expect(badAction.success).toBe(false);
  });
});
