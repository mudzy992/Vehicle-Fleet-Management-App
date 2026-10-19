import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testovi se izvršavaju nad **izgrađenim** paketom (dist) — turbo već
    // garantuje `^build` prije `test`, pa se time provjerava i javni API paketa.
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
