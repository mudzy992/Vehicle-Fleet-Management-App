// =============================================================================
//  VFM — zajednička ESLint flat konfiguracija (Node + browser)
//  Koristi se iz apps/* i packages/* preko:
//      import { vfmBase } from '@vfm/config/eslint/base';
//  Cilj: 0 grešaka u CI-u (docs/09-TEST_PLAN.md §7).
// =============================================================================
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Osnovna flat konfiguracija za TypeScript pakete/aplikacije.
 * @param {object} [opts]
 * @param {string[]} [opts.ignore] dodatni glob uzorci za ignorisanje
 * @param {boolean}  [opts.typeChecked] uključi pravila koja zahtijevaju type info (sporije)
 */
export function vfmBase(opts = {}) {
  const { ignore = [], typeChecked = false } = opts;

  return tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**', ...ignore] },
    js.configs.recommended,
    ...(typeChecked ? tseslint.configs.recommendedTypeChecked : tseslint.configs.recommended),
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: {
          console: 'readonly',
          process: 'readonly',
          setTimeout: 'readonly',
          clearTimeout: 'readonly',
          setInterval: 'readonly',
          clearInterval: 'readonly',
          Buffer: 'readonly',
          URL: 'readonly',
          fetch: 'readonly',
        },
      },
      rules: {
        // Kvalitet koda
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        'no-debugger': 'error',
        eqeqeq: ['error', 'smart'],
        'prefer-const': 'error',
        'no-var': 'error',

        // TypeScript
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
        ],
        '@typescript-eslint/no-floating-promises': typeChecked ? 'error' : 'off',
        '@typescript-eslint/no-misused-promises': typeChecked ? 'error' : 'off',

        // Sigurnost (osnove; puni security lint ide u Fazi 8)
        'no-eval': 'error',
        'no-implied-eval': 'error',
      },
    },
    prettier,
  );
}

export default vfmBase;
