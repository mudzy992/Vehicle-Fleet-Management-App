import { defineConfig } from 'vitest/config';

/**
 * Unit testovi (bez Redis-a i bez Postgresa).
 *
 * ⚠️ Testovi importuju **izgrađeni** kod (`dist/…`) jer je build target
 * CommonJS s `.js` ekstenzijama u importima — time se testira upravo onaj
 * artefakt koji ide u Docker sliku.
 *
 * Integracijski testovi (zahtijevaju `DATABASE_URL`/`REDIS_URL`) su u
 * `vitest.integration.config.ts` i automatski se preskaču kad infrastrukture
 * nema (u sandboxu nema Docker-a → `docker-compose.dev.yml` se ne može podići).
 */
export default defineConfig({
  test: {
    // ENV profil za unit testove: ništa nije obavezno (vidi
    // `@vfm/shared/env-schema` → `validateEnvProfile`).
    env: {
      ENV_PROFILE: 'test',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      REDIS_ENABLED: 'false',
      QUEUE_ENABLED: 'false',
      STORAGE_PATH: '/tmp/vfm-test-attachments',
    },
    include: ['test/**/*.spec.ts'],
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/tools/**',
        'src/**/*.d.ts',
        'src/prisma/**',
        // Generisani Prisma client (45 modela) nije naš kod i nije u Git-u:
        // bez ovog izuzeća globalni pragovi padaju na ~60% bez ikakve poruke.
        'src/generated/**',
      ],
      reporter: ['text', 'lcov'],
      /**
       * docs/09-TEST_PLAN.md §7: ≥80% linija, ≥70% grana — za **domenske** module.
       *
       * Globalni pragovi su niži dok infrastrukturni kod (`infra/queue`,
       * `infra/redis`, `config`, bootstrap `health`) nema integracijske testove:
       * oni se ne mogu smisleno testirati bez Redis-a/Postgresa, a u sandboxu
       * ih nema. Kako moduli dobijaju testove, globalni prag se diže nazad na
       * 80/70 (Faza 2+). Pragovi po glob-u čuvaju DoD za auth/guards odmah.
       */
      thresholds: {
        lines: 60,
        statements: 60,
        branches: 50,
        functions: 60,
        'src/modules/auth/**': { lines: 80, statements: 80, branches: 70, functions: 80 },
        'src/common/guards/**': { lines: 80, statements: 80, branches: 70, functions: 80 },
        'src/common/pipes/**': { lines: 80, statements: 80, branches: 70, functions: 80 },
        'src/common/audit/**': { lines: 80, statements: 80, branches: 70, functions: 80 },
      },
    },
  },
});
