/**
 * `bootstrap-super-admin` — prvi Super Admin u praznoj bazi (docs/05 §7, docs/12).
 *
 * Pokreće se **jednom**, nakon `prisma migrate deploy` i seed-a:
 *
 * ```bash
 * node scripts/bootstrap-super-admin.mjs --email super@firma.ba --name "Ime Prezime"
 * ```
 *
 * Pravila:
 * - lozinka se **generiše** i ispisuje **samo jednom** na stdout (ručno
 *   pokretanje) **ili** dolazi iz `BOOTSTRAP_SUPER_ADMIN_PASSWORD` kad se
 *   bootstrap izvršava automatski u `migrate` kontejneru (varijanta A u
 *   docs/12) — u tom slučaju se **nikad ne ispisuje** u logove;
 * - `mustChangePassword=true` + status `PENDING_PASSWORD_CHANGE` tjeraju
 *   promjenu pri prvoj prijavi (važi za oba načina),
 * - skripta **odbija** rad ako već postoji aktivan Super Admin (`--force` ne
 *   postoji namjerno: drugi Super Admin se dodaje kroz aplikaciju, uz audit),
 * - rola `SUPER_ADMIN` mora postojati → prvo pokreni seed (`node dist/tools/seed.js`),
 * - web-only: `allowedClientTypes` se ne postavlja ovdje (dolazi iz role, N-05).
 */
/* eslint-disable no-console -- CLI alat: kredencijali se ispisuju na stdout tačno jednom. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { SUPER_ADMIN_ROLE } from '@vfm/shared';
import { inspectEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PasswordService } from '../modules/auth/services/password.service.js';
import { prismaConnectionOptions } from '../prisma/prisma.service.js';

interface BootstrapArgs {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  /**
   * Lozinka iz `BOOTSTRAP_SUPER_ADMIN_PASSWORD`. Kad je zadana, **ne** generiše
   * se nova i ne ispisuje se nigdje — koristi se u automatskom bootstrapu
   * (`migrate` kontejner, varijanta A). Bez nje se lozinka generiše.
   */
  readonly password?: string;
}

/** Kodovi zbog kojih bootstrap **ne** treba rušiti deploy (idempotentnost). */
export const BOOTSTRAP_SKIP_CODES = ['SUPER_ADMIN_EXISTS', 'EMAIL_EXISTS'] as const;

export type BootstrapErrorCode =
  | (typeof BOOTSTRAP_SKIP_CODES)[number]
  | 'ROLE_MISSING'
  | 'PASSWORD_POLICY';

/**
 * Tipizirana greška bootstrapa: `migrate` po kodu odlučuje da li je situacija
 * „preskoči uz WARN" (Super Admin već postoji — normalan redeploy) ili pravi
 * prekid (nema role, lozinka ne prolazi politiku).
 */
export class SuperAdminBootstrapError extends Error {
  constructor(
    readonly code: BootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SuperAdminBootstrapError';
  }
}

/** Rezultat uspješnog bootstrapa. `passwordGenerated=false` → lozinka je iz ENV-a. */
export interface BootstrapResult {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly passwordGenerated: boolean;
}

function parseArgs(argv: readonly string[]): BootstrapArgs {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index < 0) return undefined;
    const value = argv[index + 1];
    return value && !value.startsWith('--') ? value.trim() : undefined;
  };

  const email = valueOf('--email');
  if (!email) {
    throw new Error('Nedostaje --email (npr. --email super@firma.ba). Lozinka se generiše automatski.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error(`E-mail '${email}' nije ispravan.`);
  }

  const fullName = valueOf('--name') ?? 'Super Administrator';
  const [firstName = 'Super', ...rest] = fullName.split(/\s+/u);
  const lastName = rest.length > 0 ? rest.join(' ') : 'Administrator';

  return { email: email.toLowerCase(), firstName, lastName };
}

/** Glavni tok (izdvojen radi testiranja bez procesa). */
export async function bootstrapSuperAdmin(
  prisma: PrismaClient,
  passwords: PasswordService,
  args: BootstrapArgs,
): Promise<BootstrapResult> {
  const role = await prisma.role.findUnique({
    where: { code: SUPER_ADMIN_ROLE },
    select: { id: true },
  });
  if (!role) {
    throw new SuperAdminBootstrapError(
      'ROLE_MISSING',
      `Rola '${SUPER_ADMIN_ROLE}' ne postoji — prvo pokreni seed ` +
        '(`node dist/tools/seed.js` ili `pnpm --filter @vfm/api seed`).',
    );
  }

  // `PENDING_PASSWORD_CHANGE` se računa kao postojeći Super Admin: nalog je
  // kreiran i čeka promjenu lozinke — drugi bootstrap bi napravio duplikat.
  const existingSuperAdmin = await prisma.user.count({
    where: {
      deletedAt: null,
      status: { in: ['ACTIVE', 'PENDING_PASSWORD_CHANGE'] },
      roles: { some: { revokedAt: null, role: { code: SUPER_ADMIN_ROLE, deletedAt: null } } },
    },
  });
  if (existingSuperAdmin > 0) {
    throw new SuperAdminBootstrapError(
      'SUPER_ADMIN_EXISTS',
      'Sistem već ima aktivnog Super Admina — bootstrap se ne izvršava. ' +
        'Dodatne administratore kreiraj kroz aplikaciju (Users → novi korisnik + rola).',
    );
  }

  const existingEmail = await prisma.user.findFirst({
    where: { email: args.email, deletedAt: null },
    select: { id: true },
  });
  if (existingEmail) {
    throw new SuperAdminBootstrapError(
      'EMAIL_EXISTS',
      `Korisnik s e-mailom '${args.email}' već postoji. Odaberi drugi e-mail ili mu dodijeli ` +
        `rolu '${SUPER_ADMIN_ROLE}' kroz aplikaciju.`,
    );
  }

  // Lozinka iz ENV-a mora proći **istu** politiku kao svaka druga (docs/05 §7):
  // bootstrap je jedini put kojim se zaobilazi UI, pa slabu lozinku ne smije
  // progurati. Generisana lozinka je po konstrukciji usklađena.
  const passwordGenerated = args.password === undefined;
  let password: string;
  if (args.password === undefined) {
    password = passwords.generateTemporaryPassword({ email: args.email });
  } else {
    const policyIssues = passwords.validatePolicy(args.password, {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
    });
    if (policyIssues.length > 0) {
      throw new SuperAdminBootstrapError(
        'PASSWORD_POLICY',
        `BOOTSTRAP_SUPER_ADMIN_PASSWORD ne prolazi politiku lozinke: ` +
          policyIssues.map((issue) => issue.message).join(' '),
      );
    }
    password = args.password;
  }
  const passwordHash = await passwords.hashUnchecked(password);
  const userId = randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email: args.email,
        passwordHash,
        firstName: args.firstName,
        lastName: args.lastName,
        mustChangePassword: true,
        status: 'PENDING_PASSWORD_CHANGE',
      },
    });

    await tx.userRole.create({ data: { id: randomUUID(), userId, roleId: role.id } });
  });

  return { userId, email: args.email, password, passwordGenerated };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { env, errors } = inspectEnv();
  if (errors.length > 0) {
    throw new Error(`ENV nije ispravan (profil ${env.ENV_PROFILE}): ${errors.join('; ')}`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(prismaConnectionOptions(env)) });

  try {
    const result = await bootstrapSuperAdmin(prisma, new PasswordService(), args);

    if (!result.passwordGenerated) {
      // Lozinka je došla iz ENV-a — ispisujemo samo potvrdu, nikad tajnu.
      console.log(`[bootstrap] Super Admin je kreiran: ${result.email} (id ${result.userId}).`);
      console.log('[bootstrap] Lozinka je preuzeta iz BOOTSTRAP_SUPER_ADMIN_PASSWORD i nije ispisana.');
      return;
    }

    console.log('');
    console.log('════════════════════════════════════════════════════════════════════');
    console.log('  Super Admin je kreiran. Ove podatke zabilježi SADA — lozinka se');
    console.log('  više ne može prikazati (u bazi je samo argon2id hash).');
    console.log('════════════════════════════════════════════════════════════════════');
    console.log(`  E-mail  : ${result.email}`);
    console.log(`  Lozinka : ${result.password}`);
    console.log(`  User ID : ${result.userId}`);
    console.log('');
    console.log('  Pri prvoj prijavi sistem traži promjenu lozinke (mustChangePassword).');
    console.log('  Super Admin se prijavljuje ISKLJUČIVO s web klijenta (N-05).');
    console.log('════════════════════════════════════════════════════════════════════');
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

// Pokreće se samo kao CLI (ne i kad se modul importuje u testovima).
if (process.argv[1]?.includes('bootstrap-super-admin')) {
  main().catch((error: unknown) => {
    // „Već postoji" nije greška za skriptu koja se pušta više puta: ispiši
    // objašnjenje i izađi s 0 (inače bi svaki ponovni poziv padao u CI/deployu).
    const skipCodes: readonly BootstrapErrorCode[] = BOOTSTRAP_SKIP_CODES;
    if (error instanceof SuperAdminBootstrapError && skipCodes.includes(error.code)) {
      console.log(`[bootstrap] preskočeno — ${error.message}`);
      return;
    }
    console.error(
      `[bootstrap] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
