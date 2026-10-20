/**
 * `node dist/tools/seed.js` (produkcija) / `pnpm --filter @vfm/api seed` (dev).
 *
 * Šta seed radi (P-01 iz `docs/05` §4, docs/12):
 * 1. **Katalog permisija** — `Permission` redovi iz `ALL_PERMISSIONS` (kod je izvor
 *    istine; opis se ne dira jer se održava u bazi).
 * 2. **Tri sistemske role** — `SUPER_ADMIN` (web-only), `ADMINISTRATOR`,
 *    `OBICNI_KORISNIK`; `CUSTOM` se ne seeduje jer je to šablon za korisničke role.
 * 3. **Grantovi** — `defaultGrantsForRole()` iz `@vfm/shared` (jedna matrica za kod
 *    i bazu). Postojeći grantovi se **ne** mijenjaju: `skipDuplicates` čuva ručne
 *    izmjene napravljene kroz `PUT /roles/matrix`.
 * 4. **Demo podaci** (samo van produkcije ili uz `SEED_DEMO_DATA=true`):
 *    2 korisnika s **generisanim** lozinkama (ispisane jednom) i 10 fiktivnih vozila.
 * 5. **Forma vozila** — minimalna `FormSchema` (key `vehicle`) s objavljenom
 *    verzijom v1; `Vehicle.formSchemaId` je obavezan FK, a pravi form engine je Faza 2.
 *
 * Pravila:
 * - skripta je **idempotentna** (upsert po prirodnim ključevima: `Permission.code`,
 *   `Role.code`, `User.email`, `Vehicle.internalNo`, `FormSchema.key`),
 * - **nikad fiksne lozinke** u repou: generišu se pri svakom kreiranju i ispisuju
 *   samo tada (postojeći korisnici se ne diraju, pa se lozinka ne može „izgubiti"),
 * - lozinke i hashovi se **ne** logiraju u `AuditLog` (seed nije HTTP akcija).
 */
/* eslint-disable no-console -- CLI alat: izlaz (uključujući generisane lozinke) ide na stdout. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ALL_PERMISSIONS,
  ROLE_ALLOWED_CLIENT_TYPES,
  catalogModuleOf,
  defaultGrantsForRole,
  isSensitivePermission,
  permissionAction,
  permissionModule,
  type RoleCode,
} from '@vfm/shared';
import { inspectEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PasswordService } from '../modules/auth/services/password.service.js';
import { prismaConnectionOptions } from '../prisma/prisma.service.js';

/** Sistemske role koje seed uvijek postavlja (P-01: tri role). */
const SEED_ROLES: readonly Exclude<RoleCode, 'CUSTOM'>[] = ['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK'];

const ROLE_META: Record<Exclude<RoleCode, 'CUSTOM'>, { name: string; priority: number; description: string }> = {
  SUPER_ADMIN: {
    name: 'Super Administrator',
    priority: 10,
    description: 'Puni pristup sistemu; web-only (N-05).',
  },
  ADMINISTRATOR: {
    name: 'Administrator',
    priority: 20,
    description: 'Operativno upravljanje voznim parkom; PII samo uz posebno pravo (R-07).',
  },
  OBICNI_KORISNIK: {
    name: 'Obični korisnik',
    priority: 30,
    description: 'Izvršava zadatke i unosi očitanja; vidi samo svoje i dodijeljeno.',
  },
};

/** Demo korisnici — kreiraju se samo kad demo podaci nisu zabranjeni. */
const DEMO_USERS = [
  { email: 'admin@vfm.local', firstName: 'Demo', lastName: 'Administrator', roleCode: 'ADMINISTRATOR' },
  { email: 'vozac@vfm.local', firstName: 'Demo', lastName: 'Vozač', roleCode: 'OBICNI_KORISNIK' },
] as const;

/** 10 fiktivnih vozila (bez stvarnih registracija i VIN-ova). */
const DEMO_VEHICLES = [
  { internalNo: 'VFM-001', make: 'Volkswagen', model: 'Golf 7', year: 2019, fuelType: 'DIESEL', odometerKm: 148_320, plateNumber: 'A00-M-001' },
  { internalNo: 'VFM-002', make: 'Volkswagen', model: 'Caddy', year: 2020, fuelType: 'DIESEL', odometerKm: 96_540, plateNumber: 'A00-M-002' },
  { internalNo: 'VFM-003', make: 'Škoda', model: 'Octavia', year: 2021, fuelType: 'DIESEL', odometerKm: 62_110, plateNumber: 'A00-M-003' },
  { internalNo: 'VFM-004', make: 'Renault', model: 'Kangoo', year: 2018, fuelType: 'PETROL', odometerKm: 212_780, plateNumber: 'A00-M-004' },
  { internalNo: 'VFM-005', make: 'Ford', model: 'Transit', year: 2022, fuelType: 'DIESEL', odometerKm: 34_900, plateNumber: 'A00-M-005' },
  { internalNo: 'VFM-006', make: 'Toyota', model: 'Corolla Hybrid', year: 2023, fuelType: 'HYBRID', odometerKm: 21_450, plateNumber: 'A00-M-006' },
  { internalNo: 'VFM-007', make: 'Dacia', model: 'Duster', year: 2020, fuelType: 'LPG', odometerKm: 88_200, plateNumber: 'A00-M-007' },
  { internalNo: 'VFM-008', make: 'Fiat', model: 'Ducato', year: 2017, fuelType: 'DIESEL', odometerKm: 268_410, plateNumber: 'A00-M-008' },
  { internalNo: 'VFM-009', make: 'Nissan', model: 'Leaf', year: 2021, fuelType: 'ELECTRIC', odometerKm: 41_600, plateNumber: 'A00-M-009' },
  { internalNo: 'VFM-010', make: 'Peugeot', model: 'Boxer', year: 2019, fuelType: 'DIESEL', odometerKm: 173_050, plateNumber: 'A00-M-010' },
] as const;

interface SeedSummary {
  readonly permissions: { created: number; updated: number };
  readonly roles: { created: number; updated: number };
  readonly grantsAdded: number;
  readonly demoUsers: Array<{ email: string; password: string }>;
  readonly demoUsersSkipped: boolean;
  readonly vehiclesCreated: number;
  readonly formSchemaCreated: boolean;
}

function log(message: string): void {
  console.log(`[seed] ${message}`);
}

/** Demo podaci su dozvoljeni van produkcije ili uz eksplicitni `SEED_DEMO_DATA=true`. */
function demoAllowed(env: { NODE_ENV: string }): boolean {
  if (process.env.SEED_DEMO_DATA === 'true') return true;
  if (process.env.SEED_DEMO_DATA === 'false') return false;
  return env.NODE_ENV !== 'production';
}

async function seedPermissions(prisma: PrismaClient): Promise<SeedSummary['permissions']> {
  const existing = await prisma.permission.findMany({ select: { code: true } });
  const known = new Set(existing.map((row) => row.code));

  for (const code of ALL_PERMISSIONS) {
    const module = catalogModuleOf(code) ?? permissionModule(code);
    const action = permissionAction(code);
    const isSensitive = isSensitivePermission(code);

    // `module/action/isSensitive` se usklađuju s kodom; `description` ostaje
    // onakav kakav je u bazi (opisi se održavaju kroz UI/admin alat).
    await prisma.permission.upsert({
      where: { code },
      create: { id: randomUUID(), code, module, action, isSensitive },
      update: { module, action, isSensitive },
    });
  }

  return { created: ALL_PERMISSIONS.filter((code) => !known.has(code)).length, updated: 0 };
}

async function seedRoles(prisma: PrismaClient): Promise<SeedSummary['roles']> {
  const existing = await prisma.role.findMany({ where: { code: { in: [...SEED_ROLES] } }, select: { code: true } });
  const known = new Set(existing.map((row) => row.code));

  for (const code of SEED_ROLES) {
    const meta = ROLE_META[code];
    const allowedClientTypes = [...ROLE_ALLOWED_CLIENT_TYPES[code]];

    await prisma.role.upsert({
      where: { code },
      create: {
        id: randomUUID(),
        code,
        name: meta.name,
        description: meta.description,
        isSystem: true,
        priority: meta.priority,
        allowedClientTypes,
      },
      // Naziv/opis se smiju ažurirati; `isSystem`, `priority` i klijenti ostaju
      // onakvi kakvi su u kodu (izmjena kroz UI ne smije „pobjeći" seedu).
      update: { name: meta.name, description: meta.description, isSystem: true, allowedClientTypes },
    });
  }

  return { created: SEED_ROLES.filter((code) => !known.has(code)).length, updated: SEED_ROLES.length - known.size };
}

/** Dodaje grantove iz default matrice — bez diranja postojećih. */
async function seedGrants(prisma: PrismaClient): Promise<number> {
  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permissionIdByCode = new Map(permissions.map((row) => [row.code, row.id]));
  const roles = await prisma.role.findMany({ where: { code: { in: [...SEED_ROLES] } }, select: { id: true, code: true } });

  let added = 0;

  for (const role of roles) {
    const code = role.code as Exclude<RoleCode, 'CUSTOM'>;
    if (!SEED_ROLES.includes(code)) continue;

    const grants = defaultGrantsForRole(code)
      .map((grant) => {
        const permissionId = permissionIdByCode.get(grant.permission);
        if (!permissionId) return undefined;
        return {
          id: randomUUID(),
          roleId: role.id,
          permissionId,
          scope: grant.scope,
          scopeVehicleIds: grant.scopeVehicleIds ? [...grant.scopeVehicleIds] : [],
          scopeDriverIds: grant.scopeDriverIds ? [...grant.scopeDriverIds] : [],
        };
      })
      .filter((grant): grant is NonNullable<typeof grant> => grant !== undefined);

    const result = await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
    added += result.count;
  }

  // Ako su dodani grantovi, prava su se promijenila → verzija raste (P3).
  if (added > 0) {
    await prisma.role.updateMany({
      where: { code: { in: [...SEED_ROLES] } },
      data: { permissionsVersion: { increment: 1 } },
    });
  }

  return added;
}

/** Minimalna forma vozila (Faza 2 je zamjenjuje pravim form engine-om). */
async function seedVehicleForm(prisma: PrismaClient): Promise<{ formSchemaId: string; versionId: string; created: boolean }> {
  const key = 'vehicle';
  const existing = await prisma.formSchema.findUnique({
    where: { key },
    select: { id: true, currentPublishedVersionId: true },
  });

  if (existing?.currentPublishedVersionId) {
    return { formSchemaId: existing.id, versionId: existing.currentPublishedVersionId, created: false };
  }

  const formSchemaId = existing?.id ?? randomUUID();
  if (!existing) {
    await prisma.formSchema.create({
      data: {
        id: formSchemaId,
        key,
        name: 'Vozilo',
        subject: 'VEHICLE',
        description: 'Osnovni podaci o vozilu (seed; Faza 2 dodaje form engine).',
        status: 'ACTIVE',
        ownerModule: 'vehicles',
      },
    });
  }

  const definition = {
    version: 1,
    fields: [
      { key: 'internalNo', type: 'text', required: true, label: 'Interni broj' },
      { key: 'make', type: 'text', required: true, label: 'Marka' },
      { key: 'model', type: 'text', required: true, label: 'Model' },
      { key: 'year', type: 'number', required: false, label: 'Godina' },
      { key: 'plateNumber', type: 'text', required: false, label: 'Registracija' },
      { key: 'fuelType', type: 'select', required: true, label: 'Gorivo' },
      { key: 'odometerKm', type: 'number', required: false, label: 'Kilometraža' },
    ],
  } as const;

  const versionId = randomUUID();
  const publishedAt = new Date();

  await prisma.formSchemaVersion.create({
    data: {
      id: versionId,
      formSchemaId,
      version: 1,
      status: 'PUBLISHED',
      definition,
      publishedAt,
      changeNote: 'Seed: početna verzija forme vozila.',
    },
  });

  await prisma.formSchema.update({
    where: { id: formSchemaId },
    data: { currentPublishedVersionId: versionId },
  });

  return { formSchemaId, versionId, created: existing === null };
}

async function seedDemoUsers(
  prisma: PrismaClient,
  passwords: PasswordService,
): Promise<SeedSummary['demoUsers']> {
  const created: SeedSummary['demoUsers'] = [];

  for (const demo of DEMO_USERS) {
    const existing = await prisma.user.findFirst({ where: { email: demo.email }, select: { id: true } });
    if (existing) {
      log(`Demo korisnik ${demo.email} već postoji — preskačem (lozinka ostaje nepromijenjena).`);
      continue;
    }

    const password = passwords.generateTemporaryPassword();
    const passwordHash = await passwords.hashUnchecked(password);
    const userId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          email: demo.email,
          passwordHash,
          firstName: demo.firstName,
          lastName: demo.lastName,
          mustChangePassword: true,
          status: 'PENDING_PASSWORD_CHANGE',
        },
      });

      const role = await tx.role.findUnique({ where: { code: demo.roleCode }, select: { id: true } });
      if (role) {
        await tx.userRole.create({
          data: { id: randomUUID(), userId, roleId: role.id },
        });
      }
    });

    created.push({ email: demo.email, password });
  }

  return created;
}

async function seedDemoVehicles(
  prisma: PrismaClient,
  form: { formSchemaId: string; versionId: string },
): Promise<number> {
  let created = 0;

  for (const vehicle of DEMO_VEHICLES) {
    const exists = await prisma.vehicle.findUnique({ where: { internalNo: vehicle.internalNo }, select: { id: true } });
    if (exists) continue;

    await prisma.vehicle.create({
      data: {
        id: randomUUID(),
        internalNo: vehicle.internalNo,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        fuelType: vehicle.fuelType,
        odometerKm: vehicle.odometerKm,
        plateNumber: vehicle.plateNumber,
        status: 'ACTIVE',
        formSchemaId: form.formSchemaId,
        formSchemaVersionId: form.versionId,
        formData: {},
        notes: 'Fiktivno vozilo iz seed-a (bez stvarnih podataka).',
      },
    });
    created += 1;
  }

  return created;
}

export async function runSeed(prisma: PrismaClient, env: { NODE_ENV: string }): Promise<SeedSummary> {
  const passwords = new PasswordService();

  const permissions = await seedPermissions(prisma);
  const roles = await seedRoles(prisma);
  const grantsAdded = await seedGrants(prisma);
  const form = await seedVehicleForm(prisma);

  const allowDemo = demoAllowed(env);
  const demoUsers = allowDemo ? await seedDemoUsers(prisma, passwords) : [];
  const vehiclesCreated = allowDemo ? await seedDemoVehicles(prisma, form) : 0;

  return {
    permissions,
    roles,
    grantsAdded,
    demoUsers,
    demoUsersSkipped: !allowDemo,
    vehiclesCreated,
    formSchemaCreated: form.created,
  };
}

async function main(): Promise<void> {
  const { env, errors } = inspectEnv();
  if (errors.length > 0) {
    throw new Error(`ENV nije ispravan (profil ${env.ENV_PROFILE}): ${errors.join('; ')}`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(prismaConnectionOptions(env)) });

  try {
    log(`Seed počinje (NODE_ENV=${env.NODE_ENV}).`);
    const summary = await runSeed(prisma, env);

    log(
      `Permisije: ukupno ${ALL_PERMISSIONS.length}, novo ${summary.permissions.created} ` +
        `(postojeći redovi su usklađeni s kodom).`,
    );
    log(`Role: ${summary.roles.created} novih, ${summary.roles.updated} postojećih; grantova dodano: ${summary.grantsAdded}.`);
    log(`Forma vozila: ${summary.formSchemaCreated ? 'kreirana' : 'već postoji'}.`);
    log(`Vozila: ${summary.vehiclesCreated} novih (od 10 fiktivnih).`);

    if (summary.demoUsersSkipped) {
      log('Demo podaci preskočeni (produkcija). Postavi SEED_DEMO_DATA=true za demo korisnike/vozila.');
    } else if (summary.demoUsers.length > 0) {
      log('Demo korisnici (lozinke se prikazuju SAMO sada — promijeniti pri prvoj prijavi):');
      for (const user of summary.demoUsers) {
        log(`  ${user.email}  →  ${user.password}`);
      }
    } else {
      log('Demo korisnici već postoje — lozinke nisu mijenjane.');
    }

    log('Seed završen.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] Neuspjeh:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
