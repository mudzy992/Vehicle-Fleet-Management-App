/**
 * Učitavanje i validacija okruženja (fail-fast).
 *
 * Izvor istine za šemu: `@vfm/shared/env` (sinhronizovano s `.env.example`).
 *
 * `ENV_PROFILE` određuje šta je obavezno:
 * - `api`  → JWT tajne + `DATABASE_URL` (+ `REDIS_PASSWORD` u produkciji)
 * - `tool` → `DATABASE_URL` (migrate/seed/backup alati)
 * - `test` → ništa (testovi koriste fiksne vrijednosti ili se preskaču)
 *
 * Greška pri validaciji **prekida proces** s jasnom porukom — Coolify logovi
 * tada odmah pokazuju koja varijabla nedostaje.
 */
import { loadEnv, parseEnv, validateEnvProfile } from '@vfm/shared/env';
import type { BaseEnv, EnvProfile } from '@vfm/shared/env';

let cached: BaseEnv | undefined;
let cachedErrors: readonly string[] | undefined;

/** Parsira ENV bez profilne provjere (korisno za health/dijagnostiku). */
export function getRawEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  return parseEnv(source);
}

/**
 * Parsira ENV i validira profil. Baca grešku ako konfiguracija nije kompletna.
 * Rezultat se kešira (singleton) — ponovni pozivi su jeftini.
 */
export function getEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  if (cached && source === process.env) return cached;
  const env = loadEnv(source);
  if (source === process.env) {
    cached = env;
    cachedErrors = [];
  }
  return env;
}

/**
 * "Mekša" varijanta: vraća parsiran ENV i listu profilnih grešaka umjesto
 * bacanja. Koristi se u `tools/*` gdje želimo ispisati sve probleme odjednom.
 */
export function inspectEnv(source: NodeJS.ProcessEnv = process.env): {
  env: BaseEnv;
  errors: readonly string[];
  profile: EnvProfile;
} {
  if (cached && cachedErrors && source === process.env) {
    return { env: cached, errors: cachedErrors, profile: cached.ENV_PROFILE };
  }
  const env = parseEnv(source);
  const errors = validateEnvProfile(env);
  if (source === process.env) {
    cached = env;
    cachedErrors = errors;
  }
  return { env, errors, profile: env.ENV_PROFILE };
}

/** Reset keša — samo za testove. */
export function __resetEnvCache(): void {
  cached = undefined;
  cachedErrors = undefined;
}
