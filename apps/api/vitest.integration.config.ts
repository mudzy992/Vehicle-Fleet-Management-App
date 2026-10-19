import { defineConfig } from 'vitest/config';

/**
 * Integracijski testovi — zahtijevaju stvarnu infrastrukturu:
 *
 * ```bash
 * docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d vfm-postgres vfm-redis
 * export DATABASE_URL="postgresql://vfm:vfm@localhost:5433/vfm?schema=public"
 * export REDIS_HOST=localhost REDIS_PORT=6380 REDIS_PASSWORD=vfm-redis-pass
 * pnpm --filter @vfm/api test:integration
 * ```
 *
 * Ako `DATABASE_URL`/`REDIS_*` nisu postavljeni, testovi se **preskaču**
 * (ne padaju) — CI i sandbox bez Docker-a ostaju zeleni. Cilj: 100% P-kriterija
 * iz `docs/09-TEST_PLAN.md` koji zahtijevaju bazu/Redis.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    sequence: { concurrent: false },
  },
});
