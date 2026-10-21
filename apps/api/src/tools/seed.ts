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
 * 5. **Početne forme** (`SEED_FORMS`) — `vehicle`, `pranje_vozila` (default za
 *    `TASK`) i `registracija_vozila`; svaka dobija objavljenu verziju 1 s
 *    `contentHash` iz kanonizacije, prolazi sve provjere pri objavi i puni
 *    `FieldKeyRegistry` (U-16). Postojeća objavljena verzija se **ne dira**.
 * 6. **Početne vrste zadataka** (`SEED_TASK_TYPES`) — 8 konfiguracijskih vrsta;
 *    postojeći kod se ne prepisuje ni ne vraća iz arhive.
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
import { checkPublishable, parseDefinition } from '@vfm/form-engine';
import { inspectEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDatabaseDate } from '../common/dates.js';
import { PasswordService } from '../modules/auth/services/password.service.js';
import { prismaConnectionOptions } from '../prisma/prisma.service.js';
import { syncFieldKeys, type FieldKeyRegistryClient } from '../modules/form-schemas/field-key-registry.js';
import { SEED_FORMS } from './seed-forms.js';
import { SEED_TASK_TYPES } from './seed-task-types.js';

/** Sistemske role koje seed uvijek postavlja (P-01: tri role). */
const SEED_ROLES: readonly Exclude<RoleCode, 'CUSTOM'>[] = [
  'SUPER_ADMIN',
  'ADMINISTRATOR',
  'OBICNI_KORISNIK',
];

const ROLE_META: Record<
  Exclude<RoleCode, 'CUSTOM'>,
  { name: string; priority: number; description: string }
> = {
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
  {
    internalNo: 'VFM-001',
    make: 'Volkswagen',
    model: 'Golf 7',
    year: 2019,
    fuelType: 'DIESEL',
    odometerKm: 148_320,
    plateNumber: 'A00-M-001',
  },
  {
    internalNo: 'VFM-002',
    make: 'Volkswagen',
    model: 'Caddy',
    year: 2020,
    fuelType: 'DIESEL',
    odometerKm: 96_540,
    plateNumber: 'A00-M-002',
  },
  {
    internalNo: 'VFM-003',
    make: 'Škoda',
    model: 'Octavia',
    year: 2021,
    fuelType: 'DIESEL',
    odometerKm: 62_110,
    plateNumber: 'A00-M-003',
  },
  {
    internalNo: 'VFM-004',
    make: 'Renault',
    model: 'Kangoo',
    year: 2018,
    fuelType: 'PETROL',
    odometerKm: 212_780,
    plateNumber: 'A00-M-004',
  },
  {
    internalNo: 'VFM-005',
    make: 'Ford',
    model: 'Transit',
    year: 2022,
    fuelType: 'DIESEL',
    odometerKm: 34_900,
    plateNumber: 'A00-M-005',
  },
  {
    internalNo: 'VFM-006',
    make: 'Toyota',
    model: 'Corolla Hybrid',
    year: 2023,
    fuelType: 'HYBRID',
    odometerKm: 21_450,
    plateNumber: 'A00-M-006',
  },
  {
    internalNo: 'VFM-007',
    make: 'Dacia',
    model: 'Duster',
    year: 2020,
    fuelType: 'LPG',
    odometerKm: 88_200,
    plateNumber: 'A00-M-007',
  },
  {
    internalNo: 'VFM-008',
    make: 'Fiat',
    model: 'Ducato',
    year: 2017,
    fuelType: 'DIESEL',
    odometerKm: 268_410,
    plateNumber: 'A00-M-008',
  },
  {
    internalNo: 'VFM-009',
    make: 'Nissan',
    model: 'Leaf',
    year: 2021,
    fuelType: 'ELECTRIC',
    odometerKm: 41_600,
    plateNumber: 'A00-M-009',
  },
  {
    internalNo: 'VFM-010',
    make: 'Peugeot',
    model: 'Boxer',
    year: 2019,
    fuelType: 'DIESEL',
    odometerKm: 173_050,
    plateNumber: 'A00-M-010',
  },
] as const;

/**
 * Fiktivni vozači (5). Jedna dozvola je **istekla** i jedna ističe za 10 dana —
 * da UI i podsjetnici imaju šta prikazati odmah nakon seed-a.
 */
const DEMO_DRIVERS = [
  {
    firstName: 'Amar',
    lastName: 'Begić',
    employeeNumber: 'EMP-001',
    licenseNumber: 'BA-100001',
    categories: ['B', 'C'],
  },
  {
    firstName: 'Lejla',
    lastName: 'Delić',
    employeeNumber: 'EMP-002',
    licenseNumber: 'BA-100002',
    categories: ['B'],
  },
  {
    firstName: 'Mirza',
    lastName: 'Kovačević',
    employeeNumber: 'EMP-003',
    licenseNumber: 'BA-100003',
    categories: ['B', 'CE'],
  },
  {
    firstName: 'Selma',
    lastName: 'Hodžić',
    employeeNumber: 'EMP-004',
    licenseNumber: 'BA-100004',
    categories: ['B'],
  },
  {
    firstName: 'Damir',
    lastName: 'Softić',
    employeeNumber: 'EMP-005',
    licenseNumber: 'BA-100005',
    categories: ['C'],
  },
] as const;

/** Političke vrste koje skener poznaje — sve dobijaju default prag 5 dana. */
const REMINDER_POLICY_KINDS = [
  'REGISTRATION',
  'INSURANCE',
  'SERVICE_DATE',
  'SERVICE_KM',
  'DRIVER_LICENSE',
  'TECHNICAL_INSPECTION',
  'TIRE_ROTATION',
  'CUSTOM',
] as const;

/** `YYYY-MM-DD` pomjeren za N dana od danas (UTC, dovoljno za demo). */
function dateFromNow(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface SeedSummary {
  readonly permissions: { created: number; updated: number };
  readonly roles: { created: number; updated: number };
  readonly grantsAdded: number;
  readonly demoUsers: Array<{ email: string; password: string }>;
  readonly demoUsersSkipped: boolean;
  readonly vehiclesCreated: number;
  readonly driversCreated: number;
  /** Demo registracije: jedna istekla, jedna ističe za 3 dana. */
  readonly registrationsCreated: number;
  readonly reminderPoliciesCreated: number;
  readonly formSchemaCreated: boolean;
  /** Koje su forme kreirane, a koje su već imale objavljenu verziju. */
  readonly forms: { created: string[]; existing: string[] };
  readonly taskTypesCreated: number;
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
  const existing = await prisma.role.findMany({
    where: { code: { in: [...SEED_ROLES] } },
    select: { code: true },
  });
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

  return {
    created: SEED_ROLES.filter((code) => !known.has(code)).length,
    updated: SEED_ROLES.length - known.size,
  };
}

/** Dodaje grantove iz default matrice — bez diranja postojećih. */
async function seedGrants(prisma: PrismaClient): Promise<number> {
  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permissionIdByCode = new Map(permissions.map((row) => [row.code, row.id]));
  const roles = await prisma.role.findMany({
    where: { code: { in: [...SEED_ROLES] } },
    select: { id: true, code: true },
  });

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

/**
 * Osigurava početne forme iz `SEED_FORMS`.
 *
 * Redoslijed po formi: validiraj definiciju → ako forma već ima objavljenu
 * verziju, preskoči (ručne izmjene kroz Builder se ne prepisuju) → kreiraj formu
 * i verziju 1 → postavi aktivnu verziju → uskladi registar ključeva.
 *
 * Definicija koja ne prolazi meta-shemu ili provjere pri objavi **pada seed**
 * (exit 1): bolje je da deploy stane nego da u bazu uđe forma koja ne prolazi
 * P11 validaciju zapisa.
 */
async function seedForms(prisma: PrismaClient): Promise<{
  created: string[];
  existing: string[];
  byKey: Map<string, { formSchemaId: string; versionId: string }>;
}> {
  const created: string[] = [];
  const existing: string[] = [];
  const byKey = new Map<string, { formSchemaId: string; versionId: string }>();

  for (const form of SEED_FORMS) {
    const parsed = parseDefinition(form.definition);
    if (!parsed.ok) {
      throw new Error(
        `Seed forma "${form.key}" nije validna: ${parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
      );
    }

    const checks = checkPublishable({
      definition: parsed.definition,
      changeNote: 'Seed: početna verzija forme.',
    });
    if (!checks.ok) {
      throw new Error(
        `Seed forma "${form.key}" ne prolazi provjere pri objavi: ${checks.issues.map((issue) => `${issue.code} (${issue.path})`).join('; ')}`,
      );
    }

    const existingRow = await prisma.formSchema.findUnique({
      where: { key: form.key },
      select: { id: true, currentPublishedVersionId: true },
    });

    if (existingRow?.currentPublishedVersionId) {
      existing.push(form.key);
      byKey.set(form.key, {
        formSchemaId: existingRow.id,
        versionId: existingRow.currentPublishedVersionId,
      });
      continue;
    }

    const formSchemaId = existingRow?.id ?? randomUUID();
    if (!existingRow) {
      await prisma.formSchema.create({
        data: {
          id: formSchemaId,
          key: form.key,
          name: form.name,
          subject: form.subject,
          description: form.description,
          status: 'ACTIVE',
          ownerModule: form.ownerModule,
        },
      });
    }

    const versionId = randomUUID();
    await prisma.formSchemaVersion.create({
      data: {
        id: versionId,
        formSchemaId,
        version: 1,
        status: 'PUBLISHED',
        definition: parsed.definition as unknown as Prisma.InputJsonValue,
        normalizedName: (parsed.definition.normalizedName ?? []) as unknown as Prisma.InputJsonValue,
        contentHash: checks.contentHash,
        mobileCompatible: checks.mobileCompatible,
        publishedAt: new Date(),
        changeNote: 'Seed: početna verzija forme.',
      },
    });

    await prisma.formSchema.update({
      where: { id: formSchemaId },
      data: { currentPublishedVersionId: versionId },
    });

    // Prisma delegat ima strože tipove od minimalnog interfejsa registra.
    await syncFieldKeys(prisma as unknown as FieldKeyRegistryClient, parsed.definition, formSchemaId, {
      onTypeConflict: (conflict) =>
        log(
          `U-16: ključ "${conflict.key}" je u formi "${form.key}" tipa ${conflict.expected}, ` +
            `a registar ga vodi kao ${conflict.actual} — tip se ne prepisuje.`,
        ),
    });

    created.push(form.key);
    byKey.set(form.key, { formSchemaId, versionId });
  }

  return { created, existing, byKey };
}

/**
 * Početne vrste zadataka su konfiguracija, pa se seeduju i u produkciji.
 * Postojeći kod — uključujući arhiviranu vrstu — ostavlja se netaknutim.
 */
async function seedTaskTypes(
  prisma: PrismaClient,
  formsByKey: ReadonlyMap<string, { formSchemaId: string; versionId: string }>,
): Promise<number> {
  let created = 0;

  for (const taskType of SEED_TASK_TYPES) {
    const existing = await prisma.taskType.findUnique({
      where: { code: taskType.code },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.taskType.create({
      data: {
        id: randomUUID(),
        code: taskType.code,
        name: taskType.name,
        description: taskType.description,
        iconName: taskType.iconName,
        colorHex: taskType.colorHex,
        requiresVehicle: taskType.requiresVehicle,
        requiresOdometer: taskType.requiresOdometer,
        requiresPhotos: taskType.requiresPhotos,
        defaultPriority: taskType.defaultPriority,
        defaultAssignMode: taskType.defaultAssignMode,
        allowMultipleClaimants: false,
        dueOffsetHours: taskType.dueOffsetHours,
        formSchemaId: taskType.formKey ? (formsByKey.get(taskType.formKey)?.formSchemaId ?? null) : null,
        active: true,
        sortOrder: taskType.sortOrder,
      },
    });
    created += 1;
  }

  return created;
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
    const exists = await prisma.vehicle.findUnique({
      where: { internalNo: vehicle.internalNo },
      select: { id: true },
    });
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

async function seedDemoDrivers(
  prisma: PrismaClient,
  form: { formSchemaId: string; versionId: string },
): Promise<number> {
  let created = 0;

  for (const [index, driver] of DEMO_DRIVERS.entries()) {
    const exists = await prisma.driver.findFirst({
      where: { employeeNumber: driver.employeeNumber },
      select: { id: true },
    });
    if (exists) continue;

    // Prva dozvola je istekla, druga ističe za 10 dana — ostale su važeće.
    const licenseExpiresAt =
      index === 0 ? dateFromNow(-20) : index === 1 ? dateFromNow(10) : dateFromNow(420);

    const row = await prisma.driver.create({
      data: {
        id: randomUUID(),
        firstName: driver.firstName,
        lastName: driver.lastName,
        employeeNumber: driver.employeeNumber,
        employmentStatus: 'STALNI',
        licenseNumber: driver.licenseNumber,
        // `@db.Date` u Prismi traži DateTime, ne `YYYY-MM-DD` (vidi common/dates.ts).
        licenseIssuedAt: toDatabaseDate(dateFromNow(-1500)),
        licenseExpiresAt: toDatabaseDate(licenseExpiresAt),
        licenseIssuingAuthority: 'KS Sarajevo',
        status: 'ACTIVE',
        formSchemaId: form.formSchemaId,
        formSchemaVersionId: form.versionId,
        formData: {},
        notes: 'Fiktivan vozač iz seed-a (bez stvarnih podataka).',
      },
      select: { id: true },
    });

    for (const category of driver.categories) {
      await prisma.driverLicenseCategory.create({
        data: {
          id: randomUUID(),
          driverId: row.id,
          category,
          issuedAt: toDatabaseDate(dateFromNow(-1500)),
          expiresAt: toDatabaseDate(licenseExpiresAt),
        },
      });
    }

    created += 1;
  }

  return created;
}

/**
 * Demo registracije za dva vozila: jedna **istekla** i jedna koja ističe za
 * **3 dana** (zahtjev Faze 3). Denormalizovani rok se postavlja na vozilu, isto
 * kao u servisu — bez toga lista vozila ne bi pokazivala rokove.
 */
async function seedDemoRegistrations(
  prisma: PrismaClient,
  form: { formSchemaId: string; versionId: string },
  vehicles: ReadonlyArray<{ id: string; internalNo: string }>,
): Promise<number> {
  const demo = [
    { internalNo: 'VFM-001', validFrom: dateFromNow(-395), validUntil: dateFromNow(-30) },
    { internalNo: 'VFM-002', validFrom: dateFromNow(-362), validUntil: dateFromNow(3) },
  ];
  let created = 0;

  for (const [index, entry] of demo.entries()) {
    const vehicle = vehicles.find((row) => row.internalNo === entry.internalNo);
    if (!vehicle) continue;

    const exists = await prisma.registrationRecord.findFirst({
      // Poređenje mora ići istim tipom kao kolona (`@db.Date` → `Date`).
      where: { vehicleId: vehicle.id, validFrom: toDatabaseDate(entry.validFrom)! },
      select: { id: true },
    });
    if (exists) continue;

    await prisma.registrationRecord.create({
      data: {
        id: randomUUID(),
        vehicleId: vehicle.id,
        formSchemaId: form.formSchemaId,
        formSchemaVersionId: form.versionId,
        formData: {},
        registrationNumber: `REG-DEMO-${index + 1}`,
        validFrom: toDatabaseDate(entry.validFrom)!,
        validUntil: toDatabaseDate(entry.validUntil)!,
        issuedBy: 'Demo osiguranje',
        costAmount: 25_000,
        status: 'ACTIVE',
        notes: 'Fiktivna registracija iz seed-a.',
      },
    });

    await prisma.vehicle.updateMany({
      where: { id: vehicle.id },
      data: { registrationExpiresAt: toDatabaseDate(entry.validUntil) },
    });

    created += 1;
  }

  return created;
}

/** Default politike podsjetnika (prag 5 dana) — bez njih skener nema šta raditi. */
async function seedReminderPolicies(prisma: PrismaClient): Promise<number> {
  let created = 0;

  for (const kind of REMINDER_POLICY_KINDS) {
    const exists = await prisma.reminderPolicy.findUnique({ where: { kind } });
    if (exists) continue;

    await prisma.reminderPolicy.create({
      data: {
        id: randomUUID(),
        kind,
        enabled: true,
        thresholdsDays: kind === 'SERVICE_KM' ? [] : [5],
        thresholdsKm: kind === 'SERVICE_KM' ? [1000] : [],
        channels: ['IN_APP'],
        escalate: false,
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
  const forms = await seedForms(prisma);
  const taskTypesCreated = await seedTaskTypes(prisma, forms.byKey);
  const vehicleForm = forms.byKey.get('vehicle');
  if (!vehicleForm) {
    throw new Error('Seed: forma "vehicle" nije dostupna — vozila se ne mogu vezati na formu.');
  }

  const driverForm = forms.byKey.get('vozac');
  const registrationForm = forms.byKey.get('registracija_vozila');

  const allowDemo = demoAllowed(env);
  const demoUsers = allowDemo ? await seedDemoUsers(prisma, passwords) : [];
  const vehiclesCreated = allowDemo ? await seedDemoVehicles(prisma, vehicleForm) : 0;

  const driversCreated = allowDemo && driverForm ? await seedDemoDrivers(prisma, driverForm) : 0;

  const demoVehicles = allowDemo
    ? await prisma.vehicle.findMany({
        where: { deletedAt: null },
        select: { id: true, internalNo: true },
      })
    : [];
  const registrationsCreated =
    allowDemo && registrationForm ? await seedDemoRegistrations(prisma, registrationForm, demoVehicles) : 0;

  // Politike nisu demo podaci — skener ih treba i u produkciji.
  const reminderPoliciesCreated = await seedReminderPolicies(prisma);

  return {
    permissions,
    roles,
    grantsAdded,
    demoUsers,
    demoUsersSkipped: !allowDemo,
    vehiclesCreated,
    driversCreated,
    registrationsCreated,
    reminderPoliciesCreated,
    formSchemaCreated: forms.created.includes('vehicle'),
    forms: { created: forms.created, existing: forms.existing },
    taskTypesCreated,
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
    log(
      `Role: ${summary.roles.created} novih, ${summary.roles.updated} postojećih; grantova dodano: ${summary.grantsAdded}.`,
    );
    log(
      `Forme: ${summary.forms.created.length} novih (${summary.forms.created.join(', ') || '—'}), ` +
        `${summary.forms.existing.length} već objavljenih (${summary.forms.existing.join(', ') || '—'}).`,
    );
    log(`Vrste zadataka: ${summary.taskTypesCreated} novih (od 8 početnih).`);
    log(`Vozila: ${summary.vehiclesCreated} novih (od 10 fiktivnih).`);
    log(`Vozači: ${summary.driversCreated} novih (od 5 fiktivnih).`);
    log(`Registracije (demo): ${summary.registrationsCreated} novih.`);
    log(`Politike podsjetnika: ${summary.reminderPoliciesCreated} novih.`);

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
