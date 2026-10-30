#!/usr/bin/env node
/** Repeatable frontend audit: static matrices by default; full web quality gates with --ci. */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageManager = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const pnpmPrefix = ['pnpm'];
const full = process.argv.includes('--ci');
const commands = [
  ['Design-token parity and source scan', ['design-tokens:check']],
  ['Navigation / route / permission matrix', ['exec', 'node', 'scripts/check-frontend-route-matrix.mjs']],
  ['Dark + light WCAG contrast matrix', ['exec', 'node', 'scripts/check-frontend-contrast.mjs']],
  ...(full
    ? [
        ['Web lint', ['--filter', '@vfm/web', 'lint']],
        ['Web typecheck', ['--filter', '@vfm/web', 'typecheck']],
        ['Web unit/component suite', ['--filter', '@vfm/web', 'test']],
        ['Production web build', ['--filter', '@vfm/web', 'build']],
        ['Playwright Chromium + axe runtime suite', ['--filter', '@vfm/web', 'test:e2e']],
      ]
    : []),
];

let failed = false;
for (const [label, args] of commands) {
  console.log(`\n${'='.repeat(72)}\n${label}\n$ corepack pnpm ${args.join(' ')}\n${'='.repeat(72)}`);
  const result = spawnSync(packageManager, [...pnpmPrefix, ...args], { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`${label}: nije moguće pokrenuti pnpm: ${result.error.message}`);
    failed = true;
    break;
  }
  if (result.status !== 0) {
    console.error(`${label}: FAIL (exit ${result.status ?? 'signal'})`);
    failed = true;
    if (full) break;
  }
}

if (failed) {
  console.error('\n❌ Frontend audit nije u potpunosti prošao. Sačuvati izlaz i evidentirati nalaz; ne zatvarati ga bez dokaza.');
  process.exitCode = 1;
} else if (full) {
  console.log('\n✅ Sve lokalne frontend kapije su prošle. To ne zamjenjuje produkcijski vizuelni acceptance korisnika.');
} else {
  console.log('\n✅ Statičke frontend matrice su prošle. Za pune test/build/browser kapije pokrenuti: pnpm audit:frontend:ci');
}
