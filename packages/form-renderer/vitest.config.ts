import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testovi importuju **izvor** (`src`), kao i `apps/api`: tada `typecheck` i
    // `test` ne zavise od prethodno izgrađenog `dist`-a (turbo `typecheck` ima
    // samo `^build`, ne i vlastiti `build`, pa bi čist checkout padao).
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    //  CI mašina je sporija od lokalne, a testovi rade paralelno po paketima:
    //  default 5 s je pravio povremene padove bez stvarnog nalaza.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
