/**
 * Seed i bootstrap prvog Super Admina (docs/12, docs/05 §7).
 *
 * Zašto ovi testovi postoje: seed se pokreće na **svakom deployu**, pa greška
 * (duplikati, obrisana ručna prava, demo korisnici u produkciji, fiksna lozinka)
 * ima posljedice koje se ne vide u CI-ju. Testira se:
 * - idempotentnost (dva prolaza = isto stanje, bez duplikata),
 * - 3 role + katalog + grantovi iz `defaultGrantsForRole` (jedna matrica za kod i bazu),
 * - demo podaci se **ne** kreiraju u produkciji (osim uz `SEED_DEMO_DATA=true`),
 * - generisane lozinke prolaze politiku i nikad nisu fiksne,
 * - bootstrap odbija rad ako Super Admin već postoji ili rola nedostaje.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, TASK_TYPE_CODES, defaultGrantsForRole } from '@vfm/shared';
import { PasswordService } from '../../src/modules/auth/services/password.service.js';
import { bootstrapSuperAdmin, SuperAdminBootstrapError } from '../../src/tools/bootstrap-super-admin.js';
import { runSeed } from '../../src/tools/seed.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { FakePrismaClient } from '../helpers/fake-prisma.js';

function asClient(fake: FakePrismaClient): PrismaClient {
  return fake as unknown as PrismaClient;
}

const passwords = new PasswordService();

afterEach(() => {
  delete process.env.SEED_DEMO_DATA;
});

describe('seed', () => {
  it('prazna baza: katalog, 3 role, grantovi iz matrice, forma, 10 vozila i demo korisnici', async () => {
    const fake = new FakePrismaClient();
    const summary = await runSeed(asClient(fake), { NODE_ENV: 'development' });

    expect(summary.permissions.created).toBe(ALL_PERMISSIONS.length);
    expect(fake.permissions).toHaveLength(ALL_PERMISSIONS.length);

    expect(summary.roles.created).toBe(3);
    expect(fake.roles.size).toBe(3);
    const codes = [...fake.roles.values()].map((role) => role.code).sort();
    expect(codes).toEqual(['ADMINISTRATOR', 'OBICNI_KORISNIK', 'SUPER_ADMIN']);
    expect([...fake.roles.values()].find((role) => role.code === 'SUPER_ADMIN')?.allowedClientTypes).toEqual([
      'WEB',
    ]);

    // Grantovi: ADMINISTRATOR + OBICNI_KORISNIK po matrici, SUPER_ADMIN eksplicitno sve.
    const expectedGrants = (['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK'] as const)
      .map((role) => defaultGrantsForRole(role).length)
      .reduce((total, count) => total + count, 0);
    expect(summary.grantsAdded).toBe(expectedGrants);
    expect(fake.rolePermissions).toHaveLength(summary.grantsAdded);
    expect(new Set(fake.rolePermissions.map((grant) => grant.scope))).toEqual(new Set(['ALL', 'OWN']));

    expect(summary.formSchemaCreated).toBe(true);
    // Početne forme iz `SEED_FORMS`, svaka s objavljenom verzijom 1.
    expect(summary.forms.created).toEqual([
      'servis_vozila',
      'vehicle',
      'vozac',
      'pranje_vozila',
      'osiguranje_vozila',
      'registracija_vozila',
      'komplet_guma',
      'montaza_guma',
    ]);
    expect(fake.formSchemas.size).toBe(8);
    expect(fake.formSchemaVersions).toHaveLength(8);
    expect(fake.formSchemaVersions.every((version) => version.status === 'PUBLISHED')).toBe(true);
    expect(
      fake.formSchemaVersions.every((version) => /^[0-9a-f]{64}$/u.test(version.contentHash ?? '')),
    ).toBe(true);
    // Registar ključeva je popunjen (U-16) — npr. `washCost` je MONEY.
    expect(fake.fieldKeys.get('washCost')?.dataType).toBe('MONEY');
    expect(fake.fieldKeys.get('odometerKm')?.dataType).toBe('INTEGER');

    // Faza 5: 8 početnih vrsta zadataka; samo WASH već ima seedovanu formu.
    expect(summary.taskTypesCreated).toBe(8);
    expect(fake.taskTypes.size).toBe(8);
    expect([...fake.taskTypes.values()].map((row) => row.code).sort()).toEqual([...TASK_TYPE_CODES].sort());
    const washForm = [...fake.formSchemas.values()].find((form) => form.key === 'pranje_vozila');
    const washType = [...fake.taskTypes.values()].find((row) => row.code === 'WASH');
    expect(washType?.formSchemaId).toBe(washForm?.id);
    expect(
      [...fake.taskTypes.values()].filter((row) => row.code !== 'WASH' && row.formSchemaId !== null),
    ).toEqual([]);

    expect(summary.vehiclesCreated).toBe(10);
    expect(fake.vehicles.size).toBe(10);
    expect([...fake.vehicles.values()].every((vehicle) => vehicle.formSchemaId.length > 0)).toBe(true);

    // Faza 3: 5 fiktivnih vozača (jedna istekla dozvola) i kategorije.
    expect(summary.driversCreated).toBe(5);
    expect(fake.drivers.size).toBe(5);
    expect([...fake.drivers.values()].every((driver) => driver.formSchemaVersionId)).toBe(true);
    expect(fake.driverCategories.length).toBeGreaterThanOrEqual(5);
    // Datumi su u bazi `Date` (ne string) — upoređujemo ISO datum.
    const licenses = [...fake.drivers.values()].map((driver) =>
      (driver.licenseExpiresAt as Date).toISOString().slice(0, 10),
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(licenses.some((date) => date < today)).toBe(true);

    // Demo registracije: jedna istekla, jedna ističe za 3 dana.
    expect(summary.registrationsCreated).toBe(2);
    const untils = fake.registrations
      .map((row) => (row.validUntil as Date).toISOString().slice(0, 10))
      .sort();
    expect(untils.filter((date) => date < today)).toHaveLength(1);
    expect(untils[1]! > today).toBe(true);

    // Politike podsjetnika postoje i van demo režima (skener ih treba).
    expect(summary.reminderPoliciesCreated).toBe(8);
    expect(fake.reminderPolicies.get('REGISTRATION')?.thresholdsDays).toEqual([5]);

    expect(summary.demoUsers).toHaveLength(2);
    const [admin, driver] = summary.demoUsers;
    expect(admin?.email).toBe('admin@vfm.local');
    expect(passwords.validatePolicy(admin?.password ?? '', { email: admin?.email })).toEqual([]);
    expect(passwords.validatePolicy(driver?.password ?? '', { email: driver?.email })).toEqual([]);
    expect(admin?.password).not.toBe(driver?.password);

    // Lozinke se čuvaju kao hash, nikad u čistom obliku.
    const stored = [...fake.users.values()].find((user) => user.email === 'admin@vfm.local');
    expect(stored?.passwordHash).not.toBe(admin?.password);
    expect(stored?.mustChangePassword).toBe(true);
    expect(stored?.status).toBe('PENDING_PASSWORD_CHANGE');
    expect(await passwords.verify(stored?.passwordHash ?? '', admin?.password ?? '')).toBe(true);
  });

  it('drugi prolaz ne pravi duplikate i ne vraća lozinke ponovo', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'development' });

    const grantsAfterFirst = fake.rolePermissions.length;
    const second = await runSeed(asClient(fake), { NODE_ENV: 'development' });

    expect(second.permissions.created).toBe(0);
    expect(second.roles.created).toBe(0);
    expect(second.grantsAdded).toBe(0);
    expect(second.vehiclesCreated).toBe(0);
    expect(second.driversCreated).toBe(0);
    expect(second.registrationsCreated).toBe(0);
    expect(second.taskTypesCreated).toBe(0);
    expect(second.reminderPoliciesCreated).toBe(0);
    expect(second.demoUsers).toEqual([]);
    expect(second.formSchemaCreated).toBe(false);

    expect(fake.permissions).toHaveLength(ALL_PERMISSIONS.length);
    expect(fake.roles.size).toBe(3);
    expect(fake.rolePermissions).toHaveLength(grantsAfterFirst);
    expect(fake.vehicles.size).toBe(10);
    expect(fake.drivers.size).toBe(5);
    expect(fake.registrations).toHaveLength(2);
    expect(fake.taskTypes.size).toBe(8);
    expect(fake.users.size).toBe(2);
    // Nema duplih dodjela rola.
    expect(fake.userRoles).toHaveLength(2);
  });

  it('prvi prolaz diže permissionsVersion tačno jednom (P3)', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'development' });

    const afterFirst = [...fake.roles.values()].map((role) => role.permissionsVersion);
    expect(afterFirst.every((version) => version === 1)).toBe(true);

    await runSeed(asClient(fake), { NODE_ENV: 'development' });
    expect([...fake.roles.values()].map((role) => role.permissionsVersion)).toEqual(afterFirst);
  });

  it('produkcija bez SEED_DEMO_DATA: nema demo korisnika ni vozila', async () => {
    const fake = new FakePrismaClient();
    const summary = await runSeed(asClient(fake), { NODE_ENV: 'production' });

    expect(summary.demoUsersSkipped).toBe(true);
    expect(summary.demoUsers).toEqual([]);
    expect(summary.vehiclesCreated).toBe(0);
    expect(summary.driversCreated).toBe(0);
    expect(summary.registrationsCreated).toBe(0);
    // Politike podsjetnika se seeduju i u produkciji (nisu demo podaci).
    expect(summary.reminderPoliciesCreated).toBe(8);
    // Vrste zadataka su konfiguracija, pa se seeduju i u produkciji.
    expect(summary.taskTypesCreated).toBe(8);
    expect(fake.taskTypes.size).toBe(8);
    expect(fake.users.size).toBe(0);
    expect(fake.vehicles.size).toBe(0);

    // Katalog i role se i u produkciji moraju seedovati.
    expect(fake.roles.size).toBe(3);
    expect(fake.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('SEED_DEMO_DATA=true dozvoljava demo podatke i u produkciji (demo okruženja)', async () => {
    process.env.SEED_DEMO_DATA = 'true';
    const fake = new FakePrismaClient();
    const summary = await runSeed(asClient(fake), { NODE_ENV: 'production' });

    expect(summary.demoUsersSkipped).toBe(false);
    expect(summary.demoUsers).toHaveLength(2);
    expect(summary.vehiclesCreated).toBe(10);
  });
});

describe('bootstrap-super-admin', () => {
  it('kreira prvog Super Admina s generisanom lozinkom i rolom', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'production' });

    const result = await bootstrapSuperAdmin(asClient(fake), passwords, {
      email: 'super@firma.ba',
      firstName: 'Amar',
      lastName: 'Super',
    });

    expect(result.email).toBe('super@firma.ba');
    expect(result.password).toHaveLength(20);
    expect(passwords.validatePolicy(result.password, { email: result.email })).toEqual([]);

    const stored = fake.users.get(result.userId);
    expect(stored).toMatchObject({
      email: 'super@firma.ba',
      status: 'PENDING_PASSWORD_CHANGE',
      mustChangePassword: true,
      deletedAt: null,
    });
    expect(await passwords.verify(stored?.passwordHash ?? '', result.password)).toBe(true);

    const role = [...fake.userRoles.values()].find((entry) => entry.userId === result.userId);
    const superRole = [...fake.roles.values()].find((candidate) => candidate.code === 'SUPER_ADMIN');
    expect(role?.roleId).toBe(superRole?.id);
    expect(role?.revokedAt).toBeNull();
  });

  it('odbija rad ako Super Admin već postoji (nema --force)', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'production' });
    await bootstrapSuperAdmin(asClient(fake), passwords, {
      email: 'prvi@firma.ba',
      firstName: 'Prvi',
      lastName: 'Admin',
    });

    await expect(
      bootstrapSuperAdmin(asClient(fake), passwords, {
        email: 'drugi@firma.ba',
        firstName: 'Drugi',
        lastName: 'Admin',
      }),
    ).rejects.toThrow(/već ima aktivnog Super Admina/u);
  });

  it('lozinka iz ENV-a (varijanta A): koristi se bez generisanja i prolazi politiku', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'production' });

    const result = await bootstrapSuperAdmin(asClient(fake), passwords, {
      email: 'super@firma.ba',
      firstName: 'Amar',
      lastName: 'Super',
      password: 'Bootstrap!Vfm2026',
    });

    expect(result.passwordGenerated).toBe(false);
    expect(result.password).toBe('Bootstrap!Vfm2026');
    const stored = fake.users.get(result.userId);
    expect(await passwords.verify(stored?.passwordHash ?? '', 'Bootstrap!Vfm2026')).toBe(true);
    expect(stored?.mustChangePassword).toBe(true);
  });

  it('odbija slabu lozinku iz ENV-a prije nego što išta upiše u bazu', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'production' });
    const usersBefore = fake.users.size;

    await expect(
      bootstrapSuperAdmin(asClient(fake), passwords, {
        email: 'super@firma.ba',
        firstName: 'Amar',
        lastName: 'Super',
        password: 'sifra123',
      }),
    ).rejects.toThrow(/politiku lozinke/u);

    expect(fake.users.size).toBe(usersBefore);
    await expect(
      bootstrapSuperAdmin(asClient(fake), passwords, {
        email: 'super@firma.ba',
        firstName: 'Amar',
        lastName: 'Super',
        password: 'Amar-Super-1990',
      }),
    ).rejects.toThrow(/politiku/u);
  });

  it('greške nose kod (migrate po njemu odlučuje skip vs. prekid)', async () => {
    const fake = new FakePrismaClient();

    await expect(
      bootstrapSuperAdmin(asClient(fake), passwords, { email: 'a@b.ba', firstName: 'A', lastName: 'B' }),
    ).rejects.toMatchObject({ code: 'ROLE_MISSING' });

    await runSeed(asClient(fake), { NODE_ENV: 'production' });
    await bootstrapSuperAdmin(asClient(fake), passwords, {
      email: 'prvi@firma.ba',
      firstName: 'Prvi',
      lastName: 'Admin',
      password: 'Bootstrap!Vfm2026',
    });

    const second = bootstrapSuperAdmin(asClient(fake), passwords, {
      email: 'drugi@firma.ba',
      firstName: 'Drugi',
      lastName: 'Admin',
      password: 'Bootstrap!Vfm2026',
    });
    await expect(second).rejects.toBeInstanceOf(SuperAdminBootstrapError);
    await expect(second).rejects.toMatchObject({ code: 'SUPER_ADMIN_EXISTS' });
  });

  it('traži da seed prethodi bootstrapu (rola mora postojati)', async () => {
    const fake = new FakePrismaClient();

    await expect(
      bootstrapSuperAdmin(asClient(fake), passwords, {
        email: 'super@firma.ba',
        firstName: 'Amar',
        lastName: 'Super',
      }),
    ).rejects.toThrow(/seed/u);
  });

  it('odbija e-mail koji već postoji', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'development' });

    await expect(
      bootstrapSuperAdmin(asClient(fake), passwords, {
        email: 'admin@vfm.local',
        firstName: 'Demo',
        lastName: 'Admin',
      }),
    ).rejects.toThrow(/već postoji/u);
  });

  it('lozinka se ne izvodi iz e-maila ni imena (nema fiksnih obrazaca)', async () => {
    const fake = new FakePrismaClient();
    await runSeed(asClient(fake), { NODE_ENV: 'production' });

    const first = await bootstrapSuperAdmin(new FakePrismaClient() as unknown as PrismaClient, passwords, {
      email: 'x@firma.ba',
      firstName: 'X',
      lastName: 'Y',
    }).catch(() => undefined);
    expect(first).toBeUndefined(); // bez seed-a nema role → očekivana greška

    const result = await bootstrapSuperAdmin(asClient(fake), passwords, {
      email: 'super@firma.ba',
      firstName: 'Amar',
      lastName: 'Super',
    });
    const digest = createHash('sha256').update(result.password).digest('hex');
    expect(digest).not.toContain('super');
    expect(result.password.toLowerCase()).not.toContain('amar');
  });
});
