import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const profiles = new Set(['production', 'developer', 'preview']);
const profile = process.argv[2];

if (!profiles.has(profile)) {
  console.error('Usage: node scripts/eas-build.mjs <production|developer|preview>');
  process.exit(1);
}

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (profile === 'production') {
  const bump = spawnSync(process.execPath, ['scripts/bump-release.mjs'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if ((bump.status ?? 1) !== 0) process.exit(bump.status ?? 1);
  delete process.env.ANDROID_VERSION_CODE;
  delete process.env.ANDROID_VERSION_NAME;
}
const result = spawnSync(
  'npx',
  ['eas-cli', 'build', '-p', 'android', '--profile', profile, '--local'],
  { cwd, stdio: 'inherit', shell: true, env: process.env },
);

process.exit(result.status ?? 1);
