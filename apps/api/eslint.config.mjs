import { vfmBase } from '@vfm/config/eslint/base';

/**
 * NestJS koristi `emitDecoratorMetadata`: tipovi iz konstruktora se pretvaraju u
 * runtime metadata za DI. Ako ESLint pretvori `import { RedisService }` u
 * `import type`, metadata postaje `Function` i aplikacija padne pri bootu
 * („Nest can't resolve dependencies … Function at index [0]“).
 *
 * Zato se `consistent-type-imports` isključuje **samo za API** — sve ostale
 * provjere (unused vars, no-explicit-any, prettier…) ostaju aktivne.
 */
export default [
  ...vfmBase({
    ignore: [
      'dist/**',
      'coverage/**',
      'prisma/**',
      // Prisma 7 generiše TypeScript klijent (fajlovi već nose `/* eslint-disable */`
      // i `// @ts-nocheck`), ali ga ne treba ni parsirati pri svakom lintu (5 MB).
      'src/generated/**',
      // CommonJS helperi koji se pokreću PRIJE builda (npr. u Docker buildu, korak
      // 1b: `resolve-prisma-engines.cjs`). Moraju biti čisti CJS bez TS toolchaina
      // (`require`), pa ESLint pravila za ESM/TS ovdje ne važe.
      'scripts/**',
      'node_modules/**',
    ],
  }),
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
