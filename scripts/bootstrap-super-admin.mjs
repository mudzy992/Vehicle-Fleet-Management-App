#!/usr/bin/env node
/**
 * ============================================================================
 *  VFM — bootstrap prvog Super Admina
 * ============================================================================
 *  Kreira prvi nalog s rolom SUPER_ADMIN i ispisuje generisanu lozinku JEDNOM.
 *
 *  Upotreba:
 *    node scripts/bootstrap-super-admin.mjs --email super@firma.ba --name "Ime Prezime"
 *
 *  Zahtjevi:
 *    - baza je migrirana (`prisma migrate deploy`) i seed je pokrenut
 *      (rola SUPER_ADMIN mora postojati),
 *    - `DATABASE_URL` je postavljen (Coolify env ili lokalni `.env`).
 *
 *  Skripta odbija rad ako Super Admin već postoji. Nema `--force`: dodatni
 *  Super Admin se kreira kroz aplikaciju (Users → novi korisnik), uz audit.
 *
 *  Implementacija je u `apps/api/src/tools/bootstrap-super-admin.ts` (dijeli
 *  tipove, politiku lozinke i Prisma klijent s API-jem). Ovaj fajl je samo
 *  ulazna tačka: koristi `dist` ako postoji, inače `tsx` iz dev zavisnosti.
 * ============================================================================
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(rootDir, 'apps', 'api');
const compiled = join(apiDir, 'dist', 'tools', 'bootstrap-super-admin.js');
const source = join(apiDir, 'src', 'tools', 'bootstrap-super-admin.ts');

const args = process.argv.slice(2);
const useCompiled = existsSync(compiled);

const command = useCompiled ? process.execPath : 'pnpm';
const commandArgs = useCompiled
  ? [compiled, ...args]
  : ['--filter', '@vfm/api', 'exec', 'tsx', source, ...args];

if (!useCompiled) {
  console.log('[bootstrap] dist/ ne postoji — pokrećem iz izvora (tsx).');
}

const result = spawnSync(command, commandArgs, {
  cwd: useCompiled ? apiDir : rootDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`[bootstrap] Ne mogu pokrenuti skriptu: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
