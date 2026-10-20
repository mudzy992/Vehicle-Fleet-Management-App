import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testovi se izvršavaju nad **izgrađenim** paketom (dist) — turbo već
    // garantuje `^build` prije `test`, pa se time provjerava i javni API paketa.
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    //  CI mašina je sporija od lokalne, a testovi rade paralelno po paketima:
    //  default 5 s je pravio povremene padove bez stvarnog nalaza.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      //  Testovi u ovom paketu importuju **izgrađeni** paket (`../dist/index.js`),
      //  pa se mjeri `dist`, ne `src` — inače je pokrivenost uvijek 0 % i prag
      //  pada bez ijednog stvarnog nalaza.
      include: ['dist/**/*.js'],
      exclude: ['dist/**/*.d.ts', 'dist/**/*.map'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
