import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testovi se izvršavaju nad **izgrađenim** paketom (dist) — turbo garantuje
    // `^build` prije `test`, pa se provjerava i javni API paketa.
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      /**
       * Testovi importuju **izgrađeni** paket (`dist/`), pa se pokrivenost mjeri
       * nad njim; `tsc` emituje source mape, a v8 provajder ih mapira nazad na
       * `src/` u izvještaju. (Mjerenje `src/**` dalo bi 0 % — moduli se u
       * testovima ne učitavaju direktno.)
       */
      include: ['dist/**/*.js'],
      exclude: ['dist/**/*.d.ts', 'dist/**/*.js.map', 'dist/test/**'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
