/**
 * `UsersService` — upravljanje korisnicima (docs/07 §2.2, P14).
 *
 * Testovi pokrivaju ono što se u produkciji ne smije tiho pokvariti:
 * - **PII redakcija** (`A***@…`) bez `user:view_pii` (docs/05 §8.2),
 * - **zadnji Super Admin** je zaštićen od deaktivacije, arhiviranja, brisanja i
 *   skidanja role (`409 LAST_SUPER_ADMIN_PROTECTED`),
 * - **revokacija**: promjena statusa/rola/lozinke diže `tokenVersion` i briše Keš
 *   → stari token više ne prolazi (P3/P14),
 * - **nikad fiksne lozinke**: kreiranje generiše privremenu lozinku koja prolazi
 *   politiku i vraća se samo u tom odgovoru,
 * - **reset token**: 30 min, SHA-256 u bazi, stari tokeni prestaju važiti,
 * - **`DELETE` = anonimizacija** (audit trag ostaje konzistentan).
 */
import { describe, expect, it } from 'vitest';
import { evaluateEffectivePermissions } from '@vfm/shared';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import { PasswordService } from '../../src/modules/auth/services/password.service.js';
import { TokenService } from '../../src/modules/auth/services/token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { FakePrismaClient, asPrismaService } from '../helpers/fake-prisma.js';
import { FakeLoader, FakeRedis, fakeRedisService } from '../helpers/rbac-fakes.js';

const ROLE_SUPER = '018f0000-0000-7000-8000-0000000000b0';
const ROLE_ADMIN = '018f0000-0000-7000-8000-0000000000b1';
const ROLE_DRIVER = '018f0000-0000-7000-8000-0000000000b2';
const USER_SUPER = '018f0000-0000-7000-8000-000000000001';
const USER_ADMIN = '018f0000-0000-7000-8000-000000000002';

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_SUPER,
    email: 'admin@vfm.test',
    roles: ['SUPER_ADMIN'],
    roleIds: [ROLE_SUPER],
    clientType: 'WEB',
    sessionId: '018f0000-0000-7000-8000-0000000000aa',
    jti: '018f0000-0000-7000-8000-0000000000ab',
    tokenVersion: 1,
    permissionsVersion: 1,
    isSuperAdmin: true,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    ...overrides,
  };
}

function build() {
  const prisma = new FakePrismaClient();
  const redis = new FakeRedis();
  const redisService = fakeRedisService(redis, true);
  const permissions = new PermissionsService(redisService, new FakeLoader([]));
  const passwords = new PasswordService();
  const tokens = new TokenService();
  const users = new UsersService(asPrismaService(prisma), passwords, tokens, permissions);

  return { prisma, redis, redisService, permissions, passwords, tokens, users };
}

/** Tri role + dva korisnika (Super Admin i Administrator). */
function seed(prisma: FakePrismaClient): void {
  prisma.addRole({ id: ROLE_SUPER, code: 'SUPER_ADMIN', name: 'Super Admin', isSystem: true, allowedClientTypes: ['WEB'] });
  prisma.addRole({ id: ROLE_ADMIN, code: 'ADMINISTRATOR', name: 'Administrator', isSystem: true });
  prisma.addRole({ id: ROLE_DRIVER, code: 'OBICNI_KORISNIK', name: 'Obični korisnik', isSystem: true });

  prisma.addUser({
    id: USER_SUPER,
    email: 'super@vfm.test',
    passwordHash: 'hash',
    firstName: 'Sara',
    lastName: 'Super',
  });
  prisma.addUserRole({ userId: USER_SUPER, roleId: ROLE_SUPER });

  prisma.addUser({
    id: USER_ADMIN,
    email: 'ana.anic@vfm.test',
    passwordHash: 'hash',
    firstName: 'Ana',
    lastName: 'Anić',
    phone: '+387 61 111 222',
  });
  prisma.addUserRole({ userId: USER_ADMIN, roleId: ROLE_ADMIN });
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<VfmException> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    const exception = error as VfmException;
    expect(exception.code).toBe(code);
    return exception;
  }
  throw new Error(`Očekivana greška '${code}', ali poziv je uspio.`);
}

describe('UsersService — list', () => {
  it('maskira PII bez user:view_pii i vraća paginaciju', async () => {
    const { prisma, users } = build();
    seed(prisma);

    const result = await users.list({ page: 1, pageSize: 20 }, actor({ isSuperAdmin: false }));

    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(1);
    const ana = result.items.find((item) => item.lastName === 'Anić');
    expect(ana).toMatchObject({ email: 'a***@vfm.test', phone: '•••••222', piiRedacted: true });
    expect(ana?.roles.map((role) => role.code)).toEqual(['ADMINISTRATOR']);
  });

  it('user:view_pii:OWN otkriva samo PII vlastitog reda', async () => {
    const { prisma, users } = build();
    seed(prisma);
    const ownScoped = evaluateEffectivePermissions({
      roles: [],
      grants: [{ permission: 'user:view_pii', scope: 'OWN' }],
      status: 'ACTIVE',
      clientType: 'WEB',
    });

    const result = await users.list({ page: 1, pageSize: 20 }, actor({ isSuperAdmin: false, permissions: ownScoped }));
    const ana = result.items.find((item) => item.lastName === 'Anić');

    expect(ana).toMatchObject({ email: 'a***@vfm.test', piiRedacted: true });
    const self = result.items.find((item) => item.id === USER_SUPER);
    expect(self).toMatchObject({ email: 'super@vfm.test', piiRedacted: false });
  });

  it('Super Admin vidi pun e-mail (R-07) i nema redakcije', async () => {
    const { prisma, users } = build();
    seed(prisma);

    const result = await users.list({ page: 1, pageSize: 20 }, actor());
    const ana = result.items.find((item) => item.lastName === 'Anić');

    expect(ana).toMatchObject({ email: 'ana.anic@vfm.test', phone: '+387 61 111 222', piiRedacted: false });
  });

  it('filtrira po statusu, roli i tekstu (q)', async () => {
    const { prisma, users } = build();
    seed(prisma);

    const byStatus = await users.list({ page: 1, pageSize: 20, status: 'SUSPENDED' }, actor());
    expect(byStatus.total).toBe(0);

    const byRole = await users.list({ page: 1, pageSize: 20, roleId: ROLE_ADMIN }, actor());
    expect(byRole.items.map((item) => item.email)).toEqual(['ana.anic@vfm.test']);

    const byText = await users.list({ page: 1, pageSize: 20, q: 'anić' }, actor());
    expect(byText.total).toBe(1);
  });

  it('paginacija poštuje page/pageSize', async () => {
    const { prisma, users } = build();
    seed(prisma);

    const first = await users.list({ page: 1, pageSize: 1 }, actor());
    const second = await users.list({ page: 2, pageSize: 1 }, actor());

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    expect(second.totalPages).toBe(2);
  });
});

describe('UsersService — get', () => {
  it('vraća detalj s rolama i brojem sesija; nepoznat ID → NOT_FOUND', async () => {
    const { prisma, users, prisma: fake } = build();
    seed(prisma);
    fake.addSession({ userId: USER_ADMIN, tokenHash: 'h1' });

    const detail = await users.get(USER_ADMIN, actor());
    expect(detail).toMatchObject({ id: USER_ADMIN, activeSessions: 1, timezone: 'Europe/Sarajevo' });
    expect(detail.roles).toHaveLength(1);

    await expectCode(() => users.get('018f0000-0000-7000-8000-0000000000ff', actor()), 'NOT_FOUND');
  });
});

describe('UsersService — create', () => {
  it('odbija duplikat e-maila i nepostojeću rolu', async () => {
    const { prisma, users } = build();
    seed(prisma);

    const duplicate = await expectCode(
      () =>
        users.create(
          { email: 'ana.anic@vfm.test', firstName: 'Ana', lastName: 'Anić', roleIds: [ROLE_ADMIN] },
          actor(),
        ),
      'VALIDATION_ERROR',
    );
    expect(duplicate.details?.[0]?.path).toEqual(['email']);

    await expectCode(
      () =>
        users.create(
          {
            email: 'novi@vfm.test',
            firstName: 'Novi',
            lastName: 'Korisnik',
            roleIds: ['018f0000-0000-7000-8000-0000000000ff'],
          },
          actor(),
        ),
      'VALIDATION_ERROR',
    );
  });

  it('generiše privremenu lozinku koja prolazi politiku i postavlja mustChangePassword', async () => {
    const { prisma, users, passwords } = build();
    seed(prisma);

    const result = await users.create(
      {
        email: 'marko@vfm.test',
        firstName: 'Marko',
        lastName: 'Marković',
        phone: '+387 62 333 444',
        roleIds: [ROLE_DRIVER],
      },
      actor(),
    );

    expect(result.temporaryPassword).toHaveLength(20);
    expect(passwords.validatePolicy(result.temporaryPassword, { email: 'marko@vfm.test' })).toEqual([]);
    expect(result.mustChangePassword).toBe(true);
    expect(result.user).toMatchObject({ email: 'marko@vfm.test', status: 'ACTIVE', mustChangePassword: true });
    expect(result.user.roles.map((role) => role.code)).toEqual(['OBICNI_KORISNIK']);

    const stored = prisma.users.get(result.user.id);
    expect(stored?.passwordHash).not.toBe(result.temporaryPassword);
    expect(prisma.calls.transaction).toBe(1);
  });
});

describe('UsersService — update/archive/remove', () => {
  it('promjena imena ne dira sesije ni tokenVersion', async () => {
    const { prisma, users } = build();
    seed(prisma);
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'h1' });

    const result = await users.update(USER_ADMIN, { firstName: 'Ana Marija' }, actor());

    expect(result.data.firstName).toBe('Ana Marija');
    // `addUser` default je `tokenVersion: 1` — promjena imena ga ne dira.
    expect(prisma.users.get(USER_ADMIN)?.tokenVersion).toBe(1);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(1);
  });

  it('deaktivacija revokuje sesije i diže tokenVersion (P3)', async () => {
    const { prisma, users, permissions } = build();
    seed(prisma);
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'h1' });

    const result = await users.update(USER_ADMIN, { status: 'SUSPENDED' }, actor());

    expect(result.data.status).toBe('SUSPENDED');
    expect(prisma.users.get(USER_ADMIN)?.tokenVersion).toBe(2);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
    expect(await permissions.tokenVersion(USER_ADMIN)).toBe(2);
  });

  it('ne dopušta deaktivirati vlastiti nalog ni zadnjeg Super Admina', async () => {
    const { prisma, users } = build();
    seed(prisma);

    await expectCode(() => users.update(USER_SUPER, { status: 'DEACTIVATED' }, actor()), 'VALIDATION_ERROR');

    // Drugi Super Admin postoji → deaktivacija trećeg lica prolazi.
    prisma.addUser({ id: '018f0000-0000-7000-8000-000000000003', email: 'drugi@vfm.test', passwordHash: 'h' });
    prisma.addUserRole({ userId: '018f0000-0000-7000-8000-000000000003', roleId: ROLE_SUPER });
    const result = await users.update(USER_SUPER, { status: 'SUSPENDED' }, actor({ id: USER_ADMIN }));
    expect(result.data.status).toBe('SUSPENDED');
  });

  it('arhiviranje: self → 400, zadnji Super Admin → 409, uspjeh → deletedAt + revokacija', async () => {
    const { prisma, users } = build();
    seed(prisma);
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'h1' });

    await expectCode(() => users.archive(USER_ADMIN, {}, actor({ id: USER_ADMIN })), 'VALIDATION_ERROR');
    await expectCode(() => users.archive(USER_SUPER, {}, actor({ id: USER_ADMIN })), 'LAST_SUPER_ADMIN_PROTECTED');

    const result = await users.archive(USER_ADMIN, { reason: 'prestanak rada' }, actor());
    expect(result.data.archivedAt).toMatch(/^\d{4}-/u);
    expect(prisma.users.get(USER_ADMIN)?.deletedAt).not.toBeNull();
    expect(prisma.users.get(USER_ADMIN)?.status).toBe('DEACTIVATED');
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
    expect(result.meta).toMatchObject({ revokedSessions: 1, reason: 'prestanak rada' });
  });

  it('DELETE anonimizira PII i gasi role (audit trag ostaje)', async () => {
    const { prisma, users } = build();
    seed(prisma);

    const result = await users.remove(USER_ADMIN, { reason: 'GDPR zahtjev' }, actor());

    const stored = prisma.users.get(USER_ADMIN);
    expect(stored).toMatchObject({
      email: `deleted-${USER_ADMIN}@invalid`,
      firstName: 'Obrisan',
      lastName: 'korisnik',
      phone: null,
      status: 'DEACTIVATED',
    });
    expect(stored?.deletedAt).not.toBeNull();
    expect(prisma.userRoles.filter((entry) => entry.userId === USER_ADMIN).every((e) => e.revokedAt)).toBe(true);
    expect(result.after).toMatchObject({ status: 'DEACTIVATED' });
  });
});

describe('UsersService — role', () => {
  it('dodjela role diže tokenVersion i briše RBAC keš', async () => {
    const { prisma, users, redis, redisService } = build();
    seed(prisma);
    redis.store.set(redisService.key('permissions', USER_ADMIN), '{"keš":true}');

    const result = await users.assignRole(USER_ADMIN, { roleId: ROLE_DRIVER }, actor());

    expect(result.data.roles.map((role) => role.code).sort()).toEqual(['ADMINISTRATOR', 'OBICNI_KORISNIK']);
    expect(prisma.users.get(USER_ADMIN)?.tokenVersion).toBe(2);
    expect(redis.store.get(redisService.key('permissions', USER_ADMIN))).toBeUndefined();
    expect(result.meta).toMatchObject({ roleCode: 'OBICNI_KORISNIK', action: 'ASSIGNED' });
  });

  it('dupla dodjela → 400, nepostojeća rola → NOT_FOUND', async () => {
    const { prisma, users } = build();
    seed(prisma);

    await expectCode(() => users.assignRole(USER_ADMIN, { roleId: ROLE_ADMIN }, actor()), 'VALIDATION_ERROR');
    await expectCode(
      () => users.assignRole(USER_ADMIN, { roleId: '018f0000-0000-7000-8000-0000000000ff' }, actor()),
      'NOT_FOUND',
    );
  });

  it('skidanje SUPER_ADMIN role zadnjem Super Adminu → 409', async () => {
    const { prisma, users } = build();
    seed(prisma);

    await expectCode(
      () => users.removeRole(USER_SUPER, ROLE_SUPER, actor({ id: USER_ADMIN })),
      'LAST_SUPER_ADMIN_PROTECTED',
    );
  });

  it('korisnik ne može sebi skinuti SUPER_ADMIN rolu; nepostojeća dodjela → NOT_FOUND', async () => {
    const { prisma, users } = build();
    seed(prisma);
    prisma.addUser({ id: '018f0000-0000-7000-8000-000000000003', email: 'drugi@vfm.test', passwordHash: 'h' });
    prisma.addUserRole({ userId: '018f0000-0000-7000-8000-000000000003', roleId: ROLE_SUPER });

    await expectCode(() => users.removeRole(USER_SUPER, ROLE_SUPER, actor()), 'VALIDATION_ERROR');
    await expectCode(() => users.removeRole(USER_ADMIN, ROLE_SUPER, actor()), 'NOT_FOUND');
  });
});

describe('UsersService — reset lozinke', () => {
  it('izdaje token od 30 min, hashira ga i gasi prethodne', async () => {
    const { prisma, users, tokens } = build();
    seed(prisma);

    const first = await users.issuePasswordReset(USER_ADMIN, { expiresInMinutes: 30 }, actor());
    expect(first.data.token).toHaveLength(43);
    expect(first.data).toMatchObject({ deliveredBy: 'ADMIN', email: 'ana.anic@vfm.test' });

    const stored = prisma.passwordResetTokens.at(-1);
    expect(stored?.tokenHash).toBe(tokens.hashToken(first.data.token));
    expect(stored?.tokenHash).not.toBe(first.data.token);

    const second = await users.issuePasswordReset(USER_ADMIN, { expiresInMinutes: 30 }, actor());
    expect(prisma.passwordResetTokens.filter((row) => row.usedAt !== null)).toHaveLength(1);
    expect(second.data.token).not.toBe(first.data.token);
    expect(prisma.passwordResetTokens).toHaveLength(2);
  });

  it('ne izdaje token za neaktivan nalog', async () => {
    const { prisma, users } = build();
    seed(prisma);
    prisma.users.get(USER_ADMIN)!.status = 'SUSPENDED';

    await expectCode(
      () => users.issuePasswordReset(USER_ADMIN, { expiresInMinutes: 30 }, actor()),
      'VALIDATION_ERROR',
    );
  });

  it('forceLogout revokuje sve sesije i diže tokenVersion', async () => {
    const { prisma, users } = build();
    seed(prisma);
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'h1' });
    prisma.addSession({ userId: USER_ADMIN, tokenHash: 'h2' });

    const result = await users.forceLogout(USER_ADMIN, actor());

    expect(result.data.revokedSessions).toBe(2);
    expect(result.data.tokenVersion).toBe(2);
    expect(prisma.activeSessions(USER_ADMIN)).toHaveLength(0);
  });
});
