/**
 * Statička provjera `select` polja prema `schema.prisma`.
 *
 * Zašto ovaj test postoji: Prisma **ne** prijavi nepostojeće polje u `select`
 * kad je objekat sastavljen spread-om (`{ ...DRIVER_SELECT, categories }`) —
 * `tsc` prođe, jedinični testovi s lažnim Prisma klijentom prođu, a u produkciji
 * prvi upit padne (`column Driver.archivedAt does not exist`) i klijent dobije
 * `500 INTERNAL_ERROR`. Tačno to se dogodilo na `GET /drivers` (Faza 3).
 *
 * Test čita šemu i izvore servisa kao tekst (nema baze, nema generisanog
 * klijenta), pa hvata grešku prije deploy-a:
 * 1. svaki `*_SELECT` iz registra smije sadržavati samo polja svog modela;
 * 2. registar mora pokriti **svaki** `*_SELECT` u `src/modules/**` (novi select
 *    ne može proći nezapaženo);
 * 3. svako `select: { …: true }` u servisima mora koristiti polje koje postoji
 *    na bar jednom modelu (hvata tipfelere u inline select-ima).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = join(__dirname, '..', '..');
const SCHEMA_PATH = join(API_ROOT, 'prisma', 'schema.prisma');
const SRC_ROOT = join(API_ROOT, 'src');

/** `select` konstanta → model čiji red vraća. */
const SELECT_REGISTRY: ReadonlyArray<{ file: string; constant: string; model: string }> = [
  { file: 'modules/attachments/attachments.service.ts', constant: 'SELECT', model: 'Attachment' },
  { file: 'modules/audit-logs/audit-log.service.ts', constant: 'LIST_SELECT', model: 'AuditLog' },
  { file: 'modules/auth/auth.service.ts', constant: 'USER_SELECT', model: 'User' },
  { file: 'modules/drivers/drivers.service.ts', constant: 'DRIVER_SELECT', model: 'Driver' },
  { file: 'modules/insurances/insurances.service.ts', constant: 'SELECT', model: 'InsuranceRecord' },
  {
    file: 'modules/registrations/registrations.service.ts',
    constant: 'SELECT',
    model: 'RegistrationRecord',
  },
  { file: 'modules/services/services.service.ts', constant: 'SERVICE_SELECT', model: 'ServiceRecord' },
  { file: 'modules/task-types/task-types.service.ts', constant: 'TASK_TYPE_SELECT', model: 'TaskType' },
  {
    file: 'modules/task-types/task-types.service.ts',
    constant: 'COMPLETION_REQUIREMENT_SELECT',
    model: 'TaskCompletionRequirement',
  },
  { file: 'modules/tasks/tasks.service.ts', constant: 'TASK_SELECT', model: 'Task' },
  {
    file: 'modules/tasks/tasks.service.ts',
    constant: 'TASK_ASSIGNMENT_SELECT',
    model: 'TaskAssignment',
  },
  { file: 'modules/tasks/tasks.service.ts', constant: 'TASK_EVENT_SELECT', model: 'TaskEvent' },
  {
    file: 'modules/tasks/tasks.service.ts',
    constant: 'TASK_ATTACHMENT_SELECT',
    model: 'Attachment',
  },
  { file: 'modules/tires/tires.service.ts', constant: 'TIRE_SET_SELECT', model: 'TireSet' },
  { file: 'modules/tires/tires.service.ts', constant: 'TIRE_SELECT', model: 'Tire' },
  {
    file: 'modules/tires/tires.service.ts',
    constant: 'TIRE_SET_USAGE_SELECT',
    model: 'TireInstallation',
  },
  { file: 'modules/reminders/reminders.service.ts', constant: 'SELECT', model: 'ScheduledReminder' },
  { file: 'modules/users/users.service.ts', constant: 'USER_SELECT', model: 'User' },
  { file: 'modules/vehicles/vehicles.service.ts', constant: 'VEHICLE_SELECT', model: 'Vehicle' },
];

/** Parsira `schema.prisma` → `{ Model: Set<polje> }` (skalari i relacije). */
function schemaFields(): Map<string, Set<string>> {
  const source = readFileSync(SCHEMA_PATH, 'utf8');
  const models = new Map<string, Set<string>>();
  const modelPattern = /^model (\w+) \{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(modelPattern)) {
    const fields = new Set<string>();
    for (const line of (match[2] ?? '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
      fields.add(trimmed.split(/\s+/)[0]!);
    }
    models.set(match[1]!, fields);
  }
  return models;
}

/** Ključevi `const <NAME> = { … } as const;` (samo `true` polja, ne `select`). */
function selectKeys(file: string, constant: string): string[] {
  const source = readFileSync(join(API_ROOT, 'src', file), 'utf8');
  const pattern = new RegExp(
    `const ${constant} = \\{([\\s\\S]*?)\\n\\} as const(?: satisfies [\\w.]+)?;`,
    'u',
  );
  const match = pattern.exec(source);
  expect(match, `Konstanta ${constant} nije nađena u ${file}`).not.toBeNull();
  return [...(match?.[1] ?? '').matchAll(/^\s+(\w+):/gmu)].map((item) => item[1]!);
}

/** Sve `.ts` datoteke pod `src/` (bez generisanog klijenta). */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'generated') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
}

describe('Prisma select polja', () => {
  const models = schemaFields();
  const allFields = new Set([...models.values()].flatMap((fields) => [...fields]));

  it('šema sadrži modele iz registra', () => {
    expect(models.size).toBeGreaterThan(20);
    for (const entry of SELECT_REGISTRY) {
      expect(models.has(entry.model), `Model ${entry.model} ne postoji u šemi`).toBe(true);
    }
  });

  it('svaki `*_SELECT` koristi samo polja svog modela', () => {
    const problems: string[] = [];
    for (const entry of SELECT_REGISTRY) {
      const fields = models.get(entry.model)!;
      for (const key of selectKeys(entry.file, entry.constant)) {
        if (!fields.has(key)) problems.push(`${entry.file} (${entry.model}): nepostojeće polje "${key}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('registar pokriva svaki `*_SELECT` u servisima', () => {
    const known = new Set(SELECT_REGISTRY.map((entry) => entry.constant));
    const missing: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^const (\w*SELECT\w*) = \{/gmu)) {
        if (!known.has(match[1]!)) missing.push(`${relative(API_ROOT, file)}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('inline `select` polja postoje na bar jednom modelu', () => {
    const problems: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/select:\s*\{([\s\S]*?)\},?\s*\n/gu)) {
        for (const key of (match[1] ?? '').matchAll(/(?:^|[,{]\s*)(\w+):\s*true/gu)) {
          if (!allFields.has(key[1]!)) problems.push(`${relative(API_ROOT, file)}: "${key[1]}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('`Driver` nema `archivedAt` (regresija: `GET /drivers` je vraćao 500)', () => {
    expect(models.get('Driver')?.has('archivedAt')).toBe(false);
    expect(selectKeys('modules/drivers/drivers.service.ts', 'DRIVER_SELECT')).not.toContain('archivedAt');
  });
});
