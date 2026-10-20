/**
 * Prisma 7 — konfiguracija CLI-ja (`generate`, `migrate`, `db seed`, `studio`).
 *
 * 🔴 Zašto ovaj fajl postoji (Prisma 7 breaking change, greška P1012):
 *   - `url` više NIJE dozvoljen u `datasource` bloku `prisma/schema.prisma`,
 *   - Prisma 7 NE učitava `.env` automatski → `import 'dotenv/config'`,
 *   - putanja šeme i direktorij migracija čitaju se odavde (CLI flag `--schema`
 *     više nije izvor istine).
 *
 * Fajl stoji u root-u paketa `apps/api` (uz `package.json`), jer Prisma CLI
 * traži `prisma.config.ts` od trenutnog radnog direktorija. Zato se sve komande
 * pokreću kao `pnpm --filter @vfm/api …` (pnpm tada postavi cwd na `apps/api`).
 *
 * ⚠️ `datasource.url` namjerno čita `process.env.DATABASE_URL`, a NE `env()`
 * helper iz `prisma/config`: `env()` baca izuzetak ako varijabla nije
 * postavljena, a `prisma generate` se pokreće u Docker build-u i na čistom
 * clone-u gdje baze nema (generate je ne treba). Komande kojima baza treba
 * (`migrate dev|deploy`, `db seed`) same prijave nedostajući URL.
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  /** Ulazna tačka šeme (45 modela, 30 enuma). */
  schema: 'prisma/schema.prisma',

  migrations: {
    /** Direktorij s migracijama — commit-uje se u Git (pravilo 2 u README-u). */
    path: 'prisma/migrations',
    // `seed` se dodaje kad `prisma/seed.ts` bude napisan (Faza 1, Users/Roles +
    // 10 fiktivnih vozila). U Prisma 7 `migrate dev` NE pokreće seed automatski,
    // nego se zove eksplicitno: `prisma db seed`.
  },

  datasource: {
    /** PostgreSQL 17 (R-02: globalni Postgres na mreži `db_net`). */
    url: process.env.DATABASE_URL,
    // `shadowDatabaseUrl` nije potreban: dev/produkcijski korisnik baze ima
    // CREATEDB, pa Prisma sama diže i gasi shadow bazu za `migrate dev`.
  },
});
