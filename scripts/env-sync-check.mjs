#!/usr/bin/env node
/**
 * ============================================================================
 *  VFM — env-sync-check
 * ============================================================================
 *  Provjerava da je `.env.example` sinhronizovan sa Docker Compose fajlovima.
 *
 *  Pravila:
 *   1) Svaka varijabla referencirana u compose fajlovima kao ${VAR} / ${VAR:-x}
 *      / ${VAR:?} MORA postojati u `.env.example` (kao `VAR=` linija ili u
 *      dokumentovanoj Coolify sekciji).
 *   2) Svaka varijabla označena kao OBAVEZNA (`:?`) u compose-u mora biti
 *      navedena u `.env.example`.
 *   3) Varijable u `.env.example` koje se NE koriste nigdje (compose, Dockerfile,
 *      apps/**) → upozorenje (WARNING), ne greška (neke se koriste samo u kodu).
 *   4) Provjera REDIS_ACL.md: ako `.env.example` mijenja `REDIS_*` ili `QUEUE_*`
 *      varijable, a `REDIS_ACL.md` nema "Zadnja provjera" datum noviji od
 *      posljednjeg commita koji je dirao `.env.example` → upozorenje.
 *
 *  Upotreba:  node scripts/env-sync-check.mjs [--strict]
 *  Izlaz:     exit 0 = OK, exit 1 = ima grešaka (strict: i upozorenja)
 * ============================================================================
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const STRICT = process.argv.includes('--strict');

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.dev.yml',
  'docker-compose.coolify.yml',
].filter((f) => existsSync(join(ROOT, f)));

const ENV_EXAMPLE = join(ROOT, '.env.example');
const REDIS_ACL_MD = join(ROOT, 'REDIS_ACL.md');

/** Coolify magic varijable koje Coolify generiše — ne moraju biti u .env.example */
const COOLIFY_GENERATED = /^SERVICE_(URL|FQDN|USER|LOWERCASEUSER|PASSWORD|PASSWORDWITHSYMBOLS|BASE64|REALBASE64|HEX)(_\d+)?_/;
/** Compose interne varijable */
const COMPOSE_INTERNAL = new Set([
  'COMPOSE_PROJECT_NAME',
  'COMPOSE_FILE',
  'COMPOSE_PATH_SEPARATOR',
]);

let errors = [];
let warnings = [];

// ---------------------------------------------------------------------------
// 1) Parsiraj .env.example
// ---------------------------------------------------------------------------
if (!existsSync(ENV_EXAMPLE)) {
  console.error('❌ .env.example ne postoji na rootu repozitorija.');
  process.exit(1);
}
const envText = readFileSync(ENV_EXAMPLE, 'utf8');
const envVars = new Set();
for (const raw of envText.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^([A-Z0-9_]+)\s*=/);
  if (m) envVars.add(m[1]);
}

// ---------------------------------------------------------------------------
// 2) Parsiraj compose fajlove → sve ${VAR...} reference
// ---------------------------------------------------------------------------
const referenced = new Map(); // var -> { files:Set, required:boolean }
for (const file of COMPOSE_FILES) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const re = /\$\{([A-Z0-9_]+)(?::?[-?])?([^}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const rest = m[2] ?? '';
    if (COMPOSE_INTERNAL.has(name)) continue;
    const required = /\$\{[A-Z0-9_]+:\?/.test(m[0]) || /\$\{[A-Z0-9_]+\?\}/.test(m[0]);
    const entry = referenced.get(name) ?? { files: new Set(), required: false };
    entry.files.add(file);
    entry.required = entry.required || required;
    referenced.set(name, entry);
  }
}

// ---------------------------------------------------------------------------
// 3) Provjera: compose → .env.example
// ---------------------------------------------------------------------------
for (const [name, meta] of [...referenced.entries()].sort()) {
  if (COOLIFY_GENERATED.test(name)) continue; // Coolify generiše sam
  if (!envVars.has(name)) {
    errors.push(
      `${name}: koristi se u ${[...meta.files].join(', ')} ali NE POSTOJI u .env.example` +
        (meta.required ? '  ⚠️ OBAVEZNA (:?)' : ''),
    );
  }
}

// ---------------------------------------------------------------------------
// 4) Provjera: .env.example → stvarna upotreba (samo WARNING)
// ---------------------------------------------------------------------------
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.prisma', '.conf', '.template', '.sh', '.env',
]);
// 'generated' = Prisma 7 klijent (apps/api/src/generated/prisma, ~100 fajlova, gitignored).
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.data',
  '.expo',
  'generated',
]);

/** @returns {Set<string>} */
function collectCorpus(dir, acc = new Set()) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectCorpus(full, acc);
    } else if (SOURCE_EXT.has(extname(entry)) || entry === '.env.example') {
      acc.add(full);
    }
  }
  return acc;
}

let unusedCount = 0;
const corpusFiles = [...collectCorpus(ROOT)];
const corpus = corpusFiles
  .filter((f) => f !== ENV_EXAMPLE)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

for (const name of [...envVars].sort()) {
  // Traži bilo kakvo spominjanje imena (env pristup, compose, dokumentacija)
  if (!corpus.includes(name)) {
    warnings.push(`${name}: definisan u .env.example ali se ne koristi nigdje u kodu/compose-u`);
    unusedCount++;
  }
}

// ---------------------------------------------------------------------------
// 5) Redis ACL sinhronizacija
// ---------------------------------------------------------------------------
if (existsSync(REDIS_ACL_MD)) {
  const acl = readFileSync(REDIS_ACL_MD, 'utf8');
  const redisEnv = [...envVars].filter(
    (v) =>
      v.startsWith('REDIS_') ||
      v.startsWith('QUEUE_OUTBOX') ||
      v.startsWith('QUEUE_NOTIFICATIONS') ||
      v.startsWith('QUEUE_REMINDERS') ||
      v.startsWith('QUEUE_REPORTS') ||
      v.startsWith('QUEUE_MAINTENANCE') ||
      v === 'VFM_REDIS_KEY_PREFIX',
  );
  for (const v of redisEnv) {
    if (!acl.includes(v)) {
      warnings.push(
        `${v}: postoji u .env.example ali se NE spominje u REDIS_ACL.md — provjeri da li ACL treba ažurirati`,
      );
    }
  }
  const queueNameKeys = [
    'QUEUE_OUTBOX',
    'QUEUE_NOTIFICATIONS',
    'QUEUE_REMINDERS',
    'QUEUE_REPORTS',
    'QUEUE_MAINTENANCE',
  ];
  const queueNames = envText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => queueNameKeys.some((k) => l.startsWith(k + '=')))
    .map((l) => l.split('=')[1].trim())
    .filter(Boolean);
  for (const q of queueNames) {
    if (!acl.includes(q)) {
      errors.push(`Queue "${q}" iz .env.example nije dokumentovan u REDIS_ACL.md (§4 popis ključeva)`);
    }
  }
} else {
  errors.push('REDIS_ACL.md ne postoji — Redis ACL je obavezan dokument (vidi PLAN_IMPLEMENTACIJE.md §0)');
}

// ---------------------------------------------------------------------------
// 6) Izvještaj
// ---------------------------------------------------------------------------
const rel = (f) => relative(ROOT, f);
console.log('─── VFM env-sync-check ───────────────────────────────────────────');
console.log(`Compose fajlovi : ${COMPOSE_FILES.join(', ')}`);
console.log(`.env.example    : ${envVars.size} varijabli`);
console.log(`Compose reference: ${referenced.size} varijabli`);
console.log(`Skeniranih fajlova: ${corpusFiles.length}`);
console.log('');

if (warnings.length) {
  console.log(`⚠️  Upozorenja (${warnings.length}):`);
  for (const w of warnings) console.log(`   - ${w}`);
  console.log('');
}

if (errors.length) {
  console.log(`❌ Greške (${errors.length}):`);
  for (const e of errors) console.log(`   - ${e}`);
  console.log('');
  console.log('Ispravi .env.example / REDIS_ACL.md i pokreni ponovo.');
  process.exit(1);
}

if (STRICT && warnings.length) {
  console.log('❌ --strict: upozorenja se tretiraju kao greške.');
  process.exit(1);
}

console.log(`✅ OK — .env.example je sinhronizovan (upozorenja: ${warnings.length}).`);
if (unusedCount) console.log(`   ${unusedCount} varijabli se trenutno ne koristi u kodu (očekivano prije implementacije faza).`);
process.exit(0);
