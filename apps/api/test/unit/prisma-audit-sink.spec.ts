/**
 * `PrismaAuditSink` — upis audita i sigurnosnih događaja u `AuditLog`.
 *
 * Ključne tvrdnje:
 * - mapiranje `AuditRecord` → kolone (uključujući `changedFields` iz diffa),
 * - normalizacija tipiziranih kolona: neispravan `uuid`/`inet` postaje `null`
 *   umjesto da odbije cijeli red,
 * - `SecurityEvent` → `action='SECURITY'`, `severity='SECURITY'` (docs/05 §9),
 * - **audit nikad ne baca** — greška upisa se logira i guta,
 * - DI: `AuditModule` i `AuthModule` registruju istu klasu za svoja dva porta.
 */
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AUDIT_SINK, type AuditRecord } from '../../src/common/audit/audit.types.js';
import { PrismaAuditSink } from '../../src/common/audit/prisma-audit.sink.js';
import { SECURITY_EVENT_SINK, type SecurityEvent } from '../../src/common/audit/security-event.js';
import { AuditModule } from '../../src/common/audit/audit.module.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { PrismaModule } from '../../src/prisma/prisma.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RedisModule } from '../../src/infra/redis/redis.module.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';
import { FakeRedis, ROLE_ADMIN_ID, USER_ADMIN, fakeRedisService } from '../helpers/rbac-fakes.js';

/**
 * `ROLE_ADMIN_ID` iz fixture-a namjerno NIJE heksadecimalni UUID (zadnji segment
 * `…r01`) — koristi se kao neprovidan string. `AuditLog.entityId` je `@db.Uuid`,
 * pa sink takvu vrijednost odbacuje (test dolje to i provjerava).
 */
const VALID_ENTITY_ID = '018f0000-0000-7000-8000-0000000000a1';

const RECORD: AuditRecord = {
  action: 'UPDATE',
  severity: 'SECURITY',
  resource: 'Role',
  entityId: VALID_ENTITY_ID,
  userId: USER_ADMIN,
  userEmail: 'ana.anic@vfm.test',
  roles: ['ADMINISTRATOR'],
  clientType: 'WEB',
  requestId: '018f0000-0000-7000-8000-00000000req1',
  ip: '203.0.113.9',
  userAgent: 'vitest-audit',
  method: 'PUT',
  path: '/api/v1/roles/matrix',
  before: { permissionsVersion: 1, updatedAt: new Date('2026-01-01T00:00:00.000Z') },
  after: { permissionsVersion: 2 },
  meta: { diff: [{ field: 'permissionsVersion', before: 1, after: 2 }], revokedSessions: 3 },
  success: true,
  durationMs: 42,
  at: '2026-10-20T10:00:00.000Z',
};

const EVENT: SecurityEvent = {
  type: 'MOBILE_ACCESS_FORBIDDEN',
  userId: USER_ADMIN,
  email: 'ana.anic@vfm.test',
  clientType: 'MOBILE_ANDROID',
  roles: ['SUPER_ADMIN'],
  permission: 'task:create',
  scope: 'ALL',
  requestId: '018f0000-0000-7000-8000-00000000req2',
  ip: '2001:db8::7',
  userAgent: 'vitest-audit',
  reason: 'SUPER_ADMIN_WEB_ONLY',
  path: '/api/v1/auth/login',
  method: 'POST',
};

function build(options: { failAuditLog?: boolean } = {}) {
  const prisma = new FakePrismaClient();
  if (options.failAuditLog) prisma.failures.auditLog = new Error('audit insert failed');
  return { prisma, sink: new PrismaAuditSink(asPrismaService(prisma)) };
}

describe('PrismaAuditSink — AuditRecord', () => {
  it('mapira sve kolone i izvuče changedFields iz diffa', async () => {
    const { prisma, sink } = build();

    await sink.record(RECORD);

    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({
      actorId: USER_ADMIN,
      actorEmail: 'ana.anic@vfm.test',
      actorRoles: ['ADMINISTRATOR'],
      action: 'UPDATE',
      severity: 'SECURITY',
      entityType: 'Role',
      entityId: VALID_ENTITY_ID,
      changedFields: ['permissionsVersion'],
      reason: null,
      requestId: '018f0000-0000-7000-8000-00000000req1',
      ipAddress: '203.0.113.9',
      userAgent: 'vitest-audit',
      clientType: 'WEB',
    });
    expect(prisma.auditLogs[0]?.createdAt.toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });

  it('metadata nosi diff, metod, putanju, trajanje i uspjeh (JSONB)', async () => {
    const { prisma, sink } = build();

    await sink.record(RECORD);

    expect(prisma.auditLogs[0]?.metadata).toMatchObject({
      revokedSessions: 3,
      method: 'PUT',
      path: '/api/v1/roles/matrix',
      success: true,
      durationMs: 42,
    });
    expect(prisma.auditLogs[0]?.before).toMatchObject({
      permissionsVersion: 1,
      // `Date` u JSON round-tripu postaje ISO string (JSONB ne poznaje Date).
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(prisma.auditLogs[0]?.after).toEqual({ permissionsVersion: 2 });
  });

  it('neuspješan zahtjev: reason je kod greške iz kataloga', async () => {
    const { prisma, sink } = build();

    await sink.record({ ...RECORD, success: false, errorCode: 'PERMISSION_DENIED' });

    expect(prisma.auditLogs[0]?.reason).toBe('PERMISSION_DENIED');
  });

  it('neispravan UUID i IP postaju null (red se i dalje upiše)', async () => {
    const { prisma, sink } = build();

    await sink.record({ ...RECORD, userId: 'nije-uuid', entityId: ROLE_ADMIN_ID, ip: 'localhost' });

    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({ actorId: null, entityId: null, ipAddress: null });
  });

  it('prihvata IPv4 i IPv6, odbija smeće', async () => {
    const { prisma, sink } = build();

    await sink.record({ ...RECORD, ip: '192.168.1.10' });
    await sink.record({ ...RECORD, ip: '2001:db8::1' });
    await sink.record({ ...RECORD, ip: '999.999.999.999' });

    expect(prisma.auditLogs.map((row) => row.ipAddress)).toEqual(['192.168.1.10', '2001:db8::1', null]);
  });

  it('neispravan `at` ne ruši upis (koristi se trenutno vrijeme)', async () => {
    const { prisma, sink } = build();

    await sink.record({ ...RECORD, at: 'nije-datum' });

    expect(prisma.auditLogs[0]?.createdAt).toBeInstanceOf(Date);
  });
});

describe('PrismaAuditSink — SecurityEvent', () => {
  it('piše SECURITY red s tipom događaja u reason i metadata', async () => {
    const { prisma, sink } = build();

    await sink.record(EVENT);

    expect(prisma.auditLogs[0]).toMatchObject({
      action: 'SECURITY',
      severity: 'SECURITY',
      entityType: 'auth',
      actorId: USER_ADMIN,
      actorEmail: 'ana.anic@vfm.test',
      actorRoles: ['SUPER_ADMIN'],
      clientType: 'MOBILE_ANDROID',
      ipAddress: '2001:db8::7',
      reason: 'MOBILE_ACCESS_FORBIDDEN:SUPER_ADMIN_WEB_ONLY',
      before: null,
      after: null,
      changedFields: [],
    });
    expect(prisma.auditLogs[0]?.metadata).toMatchObject({
      securityEventType: 'MOBILE_ACCESS_FORBIDDEN',
      permission: 'task:create',
      scope: 'ALL',
      reason: 'SUPER_ADMIN_WEB_ONLY',
      method: 'POST',
      path: '/api/v1/auth/login',
    });
  });

  it('događaj bez poznatog korisnika (LOGIN_FAILED) upisuje se s actorId=null', async () => {
    const { prisma, sink } = build();

    await sink.record({ type: 'LOGIN_FAILED', email: 'nepoznat@vfm.test', reason: 'UNKNOWN_USER' });

    expect(prisma.auditLogs[0]).toMatchObject({
      action: 'SECURITY',
      actorId: null,
      actorEmail: 'nepoznat@vfm.test',
      reason: 'LOGIN_FAILED:UNKNOWN_USER',
    });
  });
});

describe('PrismaAuditSink — otpornost', () => {
  it('greška upisa se guta (audit nikad ne ruši zahtjev)', async () => {
    const { prisma, sink } = build({ failAuditLog: true });

    await expect(sink.record(RECORD)).resolves.toBeUndefined();
    expect(prisma.calls.auditLogCreate).toBe(1);
    expect(prisma.auditLogs).toHaveLength(0);
  });
});

describe('PrismaAuditSink — registracija u modulima', () => {
  it('AuditModule daje PrismaAuditSink za AUDIT_SINK, AuthModule za SECURITY_EVENT_SINK', async () => {
    const prisma = new FakePrismaClient();

    const moduleRef = await Test.createTestingModule({
      imports: [AuditModule, AuthModule, RedisModule, PrismaModule],
    })
      .overrideProvider(PrismaService)
      .useValue(asPrismaService(prisma))
      .overrideProvider(RedisService)
      .useValue(fakeRedisService(new FakeRedis(), false))
      .compile();

    expect(moduleRef.get(AUDIT_SINK)).toBeInstanceOf(PrismaAuditSink);
    expect(moduleRef.get(SECURITY_EVENT_SINK)).toBeInstanceOf(PrismaAuditSink);

    // Krajnji tok: guard/servis prijavi događaj → red u AuditLog.
    const sink = moduleRef.get<PrismaAuditSink>(SECURITY_EVENT_SINK);
    await sink.record({ ...EVENT, type: 'REFRESH_REUSE_DETECTED', reason: 'PORODICA_X' });
    expect(prisma.auditLogs[0]?.reason).toBe('REFRESH_REUSE_DETECTED:PORODICA_X');

    await moduleRef.close();
  });
});
