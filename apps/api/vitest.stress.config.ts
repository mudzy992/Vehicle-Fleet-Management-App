import { defineConfig } from 'vitest/config';

/** Stress scenariji se izvršavaju samo eksplicitnim `test:stress` pozivom. */
export default defineConfig({
  test: {
    include: ['test/stress/**/*.stress.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    sequence: { concurrent: false },
  },
});
