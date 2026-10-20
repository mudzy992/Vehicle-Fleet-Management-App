/**
 * Čiste (bez I/O-a prema bazi) pomoćne funkcije za `tools/migrate.ts`.
 *
 * Izdvojene u zaseban modul jer `migrate.ts` pri uvozu pokreće `main()` — ovako
 * se logika može unit-testirati bez dječijih procesa i bez PostgreSQL-a.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimalni ugovor logera koji ovdje treba (pino/Nest servis). */
export interface ToolLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Rezultat jednog poziva prisma CLI-ja. */
export interface PrismaRun {
  readonly code: number;
  readonly output: string;
}

/**
 * Prepoznaje uobičajene uzroke pada `prisma migrate deploy` i vraća konkretne
 * sljedeće korake. Bez ovoga deploy padne s `exit 1` i bez objašnjenja.
 */
export function diagnosePrismaFailure(output: string): string[] {
  const text = output.toLowerCase();
  const hints: string[] = [];

  if (
    text.includes('permission denied to create extension') ||
    text.includes('must be superuser') ||
    text.includes('must be owner of database')
  ) {
    hints.push(
      'UZROK: korisnik baze nema pravo CREATE EXTENSION (pgcrypto/citext/btree_gist).\n' +
        'RJEŠENJE: u pgAdmin-u, kao VLASNIK baze, pokreni\n' +
        '  apps/api/prisma/sql/0000_bootstrap_extensions.sql\n' +
        'zatim redeployaj (0_extensions je idempotentan — IF NOT EXISTS prolazi).',
    );
  }

  if (
    text.includes('binaries.prisma.sh') ||
    text.includes('failed to fetch') ||
    text.includes('could not download') ||
    text.includes('getaddrinfo') ||
    text.includes('enotfound') ||
    text.includes('econnreset') ||
    text.includes('unable to fetch')
  ) {
    hints.push(
      'UZROK: CLI pokušava preuzeti `schema-engine` s binaries.prisma.sh i ne uspijeva\n' +
        '  (runtime kontejner nema izlaz ka internetu, ili engine nije zapečen u image).\n' +
        'RJEŠENJE: rebuilduj image — apps/api/Dockerfile korak 1b preuzima engine pri\n' +
        '  buildu. Provjera u builder logu: "PRISMA: schema-engine je preuzet".',
    );
  }

  if (text.includes('p3005') || text.includes('database schema is not empty')) {
    hints.push(
      'UZROK: baza NIJE prazna, a `_prisma_migrations` nema redova (P3005).\n' +
        '  Tipično: migracije su jednom primijenjene, pa je `_prisma_migrations` obrisan.\n' +
        'RJEŠENJE (2 koraka):\n' +
        '  1. u pgAdmin-u pokreni apps/api/prisma/sql/9000_dijagnostika_stanja_baze.sql\n' +
        '     i uporedi brojeve s očekivanim (45 tabela / 18 ck_ / 9 ux_ / 2 EXCLUDE /\n' +
        '     6 triggera / AuditLog.id identity = "a" / 0 FK-ova s različitim tipovima).\n' +
        '  2a. AKO stanje odgovara SVIM migracijama → u Coolify postavi\n' +
        '      MIGRATIONS_BASELINE=0_extensions,1_init,2_manual i redeployaj\n' +
        '      (označi ih primijenjenima BEZ izvršavanja DDL-a), zatim vrati na prazno.\n' +
        '  2b. AKO odgovara samo 0_extensions+1_init → MIGRATIONS_BASELINE=0_extensions,1_init\n' +
        '      (2_manual će se stvarno primijeniti).\n' +
        '  2c. AKO je baza PRAZNA osim ostataka → obriši ih (isti SQL fajl, sekcija B)\n' +
        '      i redeployaj bez baseline-a.',
    );
  }

  if (text.includes('incompatible types') || text.includes('cannot be implemented')) {
    hints.push(
      'UZROK: FK između kolona različitih tipova (npr. TEXT → UUID).\n' +
        'RJEŠENJE: u schema.prisma dodaj @db.Uuid na to polje i regeneriši 1_init:\n' +
        '  pnpm --filter @vfm/api exec prisma migrate diff --from-empty \\\n' +
        '    --to-schema prisma/schema.prisma --script > prisma/migrations/1_init/migration.sql\n' +
        'Zatim provjeri skriptom scripts/db-verify/apply_migrations.py.',
    );
  }

  if (text.includes('checksum')) {
    hints.push(
      'UZROK: checksum migracije se ne poklapa — već primijenjena migracija je izmijenjena.\n' +
        'RJEŠENJE: vrati sadržaj te migracije (git) ili svjesno `prisma migrate resolve`;\n' +
        '  izmjene idu u NOVU migraciju, nikad u postojeću.',
    );
  }

  if (
    text.includes('an earlier migration failed') ||
    text.includes('failed to apply') ||
    text.includes('rolled_back_at')
  ) {
    hints.push(
      'UZROK: u `_prisma_migrations` postoji red s `finished_at IS NULL` (pali pokušaj).\n' +
        'RJEŠENJE: otkloni uzrok pada, zatim u Coolify postavi\n' +
        '  MIGRATIONS_ROLLED_BACK=<naziv_migracije> i redeployaj (ili ručno:\n' +
        '  prisma migrate resolve --rolled-back <naziv>). Ako je baza prazna, dovoljno je\n' +
        '  DROP TABLE _prisma_migrations.',
    );
  }

  if (text.includes('already exists') && text.includes('relation')) {
    hints.push(
      'UZROK: migracija pokušava kreirati objekat koji već postoji — baza je djelimično\n' +
        '  primijenjena bez zapisa u `_prisma_migrations`.\n' +
        'RJEŠENJE: pgAdmin → apps/api/prisma/sql/9000_dijagnostika_stanja_baze.sql (sekcija A),\n' +
        '  zatim MIGRATIONS_BASELINE za one migracije čiji objekti zaista postoje.',
    );
  }

  if (
    text.includes('password authentication failed') ||
    text.includes('p1010') ||
    text.includes('p1001') ||
    text.includes("can't reach database server")
  ) {
    hints.push(
      'UZROK: DATABASE_URL/kredencijali/mreža — kontejner ne može otvoriti sesiju prema bazi.\n' +
        'RJEŠENJE: provjeri da je servis na mreži `db_net` i da DATABASE_URL odgovara\n' +
        '  korisniku baze (Prisma 7: SSL greške se javljaju kao P1010).',
    );
  }

  if (text.includes('citext') && text.includes('does not exist')) {
    hints.push(
      'UZROK: ekstenzija `citext` nije kreirana, a kolone je koriste.\n' +
        'RJEŠENJE: 0_extensions mora proći PRIJE 1_init — vidi hint za CREATE EXTENSION.',
    );
  }

  if (output.trim().length === 0) {
    hints.push(
      'UZROK: prisma CLI nije ispisao NIŠTA — najvjerovatnije `npx --no-install prisma`\n' +
        '  nije našao CLI u node_modules (runtime image bez `prisma` u dependencies).\n' +
        'PROVJERA: docker run --rm --entrypoint sh <image> -c "ls node_modules/prisma/build/index.js"',
    );
  }

  return hints;
}

/**
 * Iz izlaza `prisma migrate status` čita nazive migracija koje nisu primijenjene.
 *
 * Prisma ispisuje:
 * ```
 * Following migrations have not yet been applied:
 * 0_extensions
 * 1_init
 * 2_manual
 * To apply migrations in production run prisma migrate deploy.
 * ```
 * Nazivi direktorija migracija su `[0-9A-Za-z_]+`, pa ostale linije otpadaju same.
 */
export function parsePendingMigrations(statusOutput: string): string[] {
  const marker = 'have not yet been applied';
  const lines = statusOutput.split('\n').map((line) => line.trim());
  const startIndex = lines.findIndex((line) => line.includes(marker));
  if (startIndex < 0) return [];

  const pending: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.length === 0) continue;
    if (/^[0-9A-Za-z_]+$/u.test(line)) {
      pending.push(line);
      continue;
    }
    break;
  }
  return pending;
}

/** Nazivi direktorija migracija koji stvarno postoje na disku. */
export function listMigrationNames(migrationsDir: string): string[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.startsWith('.') && entry !== 'migration_lock.toml')
    .filter((entry) => existsSync(resolve(migrationsDir, entry, 'migration.sql')))
    .sort();
}

/**
 * Traži nativni `schema-engine` binarni fajl.
 *
 * Builder ga preuzima u `node_modules/@prisma/engines/` (Dockerfile korak 1b), a
 * `pnpm deploy --prod` ga preslikava u `/prod/api/node_modules/…`. Provjeravaju se
 * i pnpm `.pnpm` putanje (dev mašina), da bi alat radio i lokalno.
 */
export function findSchemaEngineBinary(cwd: string = process.cwd(), dirname: string = __dirname): string | null {
  const prefix = 'schema-engine-';
  const roots = [
    resolve(cwd, 'node_modules', '@prisma', 'engines'),
    resolve(cwd, 'node_modules', '.pnpm'),
    resolve(dirname, '..', '..', 'node_modules', '@prisma', 'engines'),
    '/prod/api/node_modules/@prisma/engines',
  ];

  const matches: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 5 || matches.length > 0) return;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry);
      if (entry.startsWith(prefix)) {
        if (existsSync(full)) matches.push(full);
        continue;
      }
      // Rekurzija samo u direktorije gdje engine može biti: pnpm virtualna
      // prodavnica (`.pnpm/@prisma+engines@x/node_modules/@prisma/engines`) i
      // klasični flat raspored (`node_modules/@prisma/engines`).
      if (
        entry.startsWith('@prisma+engines@') ||
        entry === '@prisma' ||
        entry === 'engines' ||
        entry === 'node_modules'
      ) {
        walk(full, depth + 1);
      }
    }
  };

  for (const root of roots) walk(root, 0);
  return matches[0] ?? null;
}

/** Prijavljuje neuspjeh: exit code, posljednje linije izlaza i konkretne hintove. */
export function reportFailure(message: string, run: PrismaRun, logger: ToolLogger): void {
  const lines = run.output.split('\n').filter((line) => line.trim().length > 0);
  const tail = lines.slice(-40).join('\n');
  const hints = diagnosePrismaFailure(run.output);

  logger.error(`${message} (exit ${run.code}).`);
  if (tail.length > 0) {
    logger.error(`Zadnji izlaz prisma CLI-ja (${lines.length} linija ukupno):\n${tail}`);
  }
  for (const hint of hints) logger.error(hint);
  if (hints.length === 0) {
    logger.error(
      'Nije prepoznat poznati uzrok — pošalji CIJELI log ovog kontejnera ' +
        '(`docker logs <migrate kontejner>`) uz poruku o grešci.',
    );
  }
}
