import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  diagnosePrismaFailure,
  findSchemaEngineBinary,
  listMigrationNames,
  parsePendingMigrations,
  reportFailure,
} from '../../src/tools/migrate-diagnostics.js';

/**
 * Dijagnostika `migrate` alata.
 *
 * Ovi testovi postoje jer je deploy u produkciji pao s `exit 1` bez objašnjenja:
 * prisma CLI je ispisala razlog (P3005), ali je izlaz djeteta ostao izvan
 * Coolify prikaza. Sve funkcije su čiste (bez baze i bez dječijih procesa), pa se
 * ponašanje može zakucati ovdje.
 */

/** Stvarni izlaz `prisma migrate status` s produkcijskog deploya (2026-10-20). */
const STATUS_PENDING = [
  'Loaded Prisma config from prisma.config.ts.',
  'Prisma schema loaded from prisma/schema.prisma.',
  'Datasource "db": PostgreSQL database "vehicle", schema "public" at "host:5432"',
  '3 migrations found in prisma/migrations',
  'Following migrations have not yet been applied:',
  '',
  '0_extensions',
  '1_init',
  '2_manual',
  '',
  'To apply migrations in development run prisma migrate dev.',
  'To apply migrations in production run prisma migrate deploy.',
].join('\n');

/** Stvarni izlaz `prisma migrate deploy` pri P3005. */
const DEPLOY_P3005 = [
  'Datasource "db": PostgreSQL database "vehicle", schema "public" at "host:5432"',
  '3 migrations found in prisma/migrations',
  'Error: P3005',
  'The database schema is not empty. Read more about how to baseline an existing',
  'production database: https://pris.ly/d/migrate-baseline',
].join('\n');

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfm-migrate-diag-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Logger koji pamti poruke (umjesto pina). */
function fakeLogger(): {
  logs: string[];
  warns: string[];
  errors: string[];
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
} {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    warns,
    errors,
    log: (msg) => logs.push(msg),
    warn: (msg) => warns.push(msg),
    error: (msg) => errors.push(msg),
  };
}

describe('parsePendingMigrations', () => {
  it('čita nazive neprimijenjenih migracija iz stvarnog izlaza', () => {
    expect(parsePendingMigrations(STATUS_PENDING)).toEqual(['0_extensions', '1_init', '2_manual']);
  });

  it('preskače prazne linije i staje na uputstvu "To apply migrations…"', () => {
    const pending = parsePendingMigrations(STATUS_PENDING);
    expect(pending).not.toContain('To');
    expect(pending.every((name) => /^[0-9A-Za-z_]+$/u.test(name))).toBe(true);
  });

  it('vraća praznu listu kada je šema ažurirana', () => {
    expect(
      parsePendingMigrations('3 migrations found in prisma/migrations\nDatabase schema is up to date!'),
    ).toEqual([]);
  });

  it('vraća praznu listu kada izlaz ne sadrži marker', () => {
    expect(parsePendingMigrations('')).toEqual([]);
    expect(parsePendingMigrations('Error: P1001 Can\'t reach database server')).toEqual([]);
  });

  it('radi i s timestamp-prefiksom (pravi naziv direktorija migracije)', () => {
    const output = 'Following migrations have not yet been applied:\n20261020120000_add_index\nRun something.';
    expect(parsePendingMigrations(output)).toEqual(['20261020120000_add_index']);
  });
});

describe('listMigrationNames', () => {
  it('navodi stvarne migracije u repo-u (0_extensions, 1_init, 2_manual)', () => {
    // vitest se pokreće iz `apps/api` (turbo/pnpm postavljaju cwd paketa).
    const dir = resolve(process.cwd(), 'prisma', 'migrations');
    expect(listMigrationNames(dir)).toEqual(['0_extensions', '1_init', '2_manual']);
  });

  it('ignoriše direktorije bez migration.sql i migration_lock.toml', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '1_ok'));
    writeFileSync(join(dir, '1_ok', 'migration.sql'), 'SELECT 1;');
    mkdirSync(join(dir, '2_prazan'));
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
    expect(listMigrationNames(dir)).toEqual(['1_ok']);
  });

  it('vraća praznu listu za nepostojeći direktorij', () => {
    expect(listMigrationNames(join(makeTempDir(), 'nema-ga'))).toEqual([]);
  });
});

describe('findSchemaEngineBinary', () => {
  it('nalazi engine u node_modules/@prisma/engines', () => {
    const dir = makeTempDir();
    const engines = join(dir, 'node_modules', '@prisma', 'engines');
    mkdirSync(engines, { recursive: true });
    const binary = join(engines, 'schema-engine-linux-musl-openssl-3.0.x');
    writeFileSync(binary, 'bin');

    expect(findSchemaEngineBinary(dir, dir)).toBe(binary);
  });

  it('nalazi engine i u pnpm .pnpm stablu', () => {
    const dir = makeTempDir();
    const engines = join(dir, 'node_modules', '.pnpm', '@prisma+engines@7.10.1', 'node_modules', '@prisma', 'engines');
    mkdirSync(engines, { recursive: true });
    const binary = join(engines, 'schema-engine-debian-openssl-3.0.x');
    writeFileSync(binary, 'bin');

    expect(findSchemaEngineBinary(dir, dir)).toBe(binary);
  });

  it('vraća null kada engine-a nema (uzrok pada deploya prije popravke)', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'node_modules', '@prisma', 'engines'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '@prisma', 'engines', 'package.json'), '{}');
    expect(findSchemaEngineBinary(dir, dir)).toBeNull();
  });
});

describe('diagnosePrismaFailure', () => {
  it('za P3005 upućuje na dijagnostiku i MIGRATIONS_BASELINE', () => {
    const hints = diagnosePrismaFailure(DEPLOY_P3005).join('\n');
    expect(hints).toContain('MIGRATIONS_BASELINE');
    expect(hints).toContain('9000_dijagnostika_stanja_baze.sql');
    expect(hints).toContain('0_extensions,1_init,2_manual');
  });

  it('za nedostatak prava na CREATE EXTENSION upućuje na bootstrap SQL', () => {
    const hints = diagnosePrismaFailure(
      'Migration `0_extensions` failed to apply to the database: ERROR: permission denied to create extension "citext"',
    ).join('\n');
    expect(hints).toContain('0000_bootstrap_extensions.sql');
  });

  it('za neuspjelo preuzimanje engine-a upućuje na Dockerfile korak 1b', () => {
    const hints = diagnosePrismaFailure(
      'Error: Failed to fetch the engine at https://binaries.prisma.sh/all_commits/x/schema-engine.gz',
    ).join('\n');
    expect(hints).toContain('schema-engine');
    expect(hints).toContain('Dockerfile');
  });

  it('za FK s neusklađenim tipovima upućuje na @db.Uuid i regenerisanje 1_init', () => {
    const hints = diagnosePrismaFailure(
      'foreign key constraint "Attachment_uploadedById_fkey" cannot be implemented: ' +
        'Key columns "uploadedById" and "id" are of incompatible types: text and uuid',
    ).join('\n');
    expect(hints).toContain('@db.Uuid');
    expect(hints).toContain('migrate diff --from-empty');
  });

  it('za red s finished_at IS NULL upućuje na MIGRATIONS_ROLLED_BACK', () => {
    const hints = diagnosePrismaFailure(
      'Error: P3004 ... An earlier migration failed to apply. Rješava se preko rolled_back_at.',
    ).join('\n');
    expect(hints).toContain('MIGRATIONS_ROLLED_BACK');
  });

  it('za potpuno prazan izlaz javlja da CLI nije pokrenut', () => {
    const hints = diagnosePrismaFailure('').join('\n');
    expect(hints).toContain('nije ispisao NIŠTA');
  });

  it('ne izmišlja uzroke za nepoznatu grešku', () => {
    expect(diagnosePrismaFailure('Error: nešto sasvim novo i nepoznato')).toEqual([]);
  });

  it('za probleme s konekcijom navodi DATABASE_URL i mrežu', () => {
    const hints = diagnosePrismaFailure('Error: P1001: Can\'t reach database server at `host`:5432').join('\n');
    expect(hints).toContain('DATABASE_URL');
    expect(hints).toContain('db_net');
  });
});

describe('reportFailure', () => {
  it('logira exit code, zadnji izlaz i prepoznate hintove', () => {
    const logger = fakeLogger();
    reportFailure('Migracije nisu uspjele', { code: 1, output: DEPLOY_P3005 }, logger);

    expect(logger.errors[0]).toBe('Migracije nisu uspjele (exit 1).');
    const joined = logger.errors.join('\n');
    expect(joined).toContain('Zadnji izlaz prisma CLI-ja');
    expect(joined).toContain('P3005');
    expect(joined).toContain('MIGRATIONS_BASELINE');
  });

  it('za nepoznat uzrok traži cijeli log kontejnera', () => {
    const logger = fakeLogger();
    reportFailure('Seed nije uspio', { code: 2, output: 'nepoznata greška bez obrasca' }, logger);

    expect(logger.errors[0]).toBe('Seed nije uspio (exit 2).');
    expect(logger.errors.join('\n')).toContain('Nije prepoznat poznati uzrok');
  });

  it('ne ispisuje prazan "zadnji izlaz"', () => {
    const logger = fakeLogger();
    reportFailure('Migracije nisu uspjele', { code: 1, output: '' }, logger);

    expect(logger.errors.join('\n')).not.toContain('Zadnji izlaz prisma CLI-ja');
  });
});
