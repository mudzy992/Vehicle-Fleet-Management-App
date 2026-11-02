import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = path.join(mobileRoot, 'app.json');
const packageJsonPath = path.join(mobileRoot, 'package.json');
const semverPattern = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function gitText(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error || (result.status ?? 1) !== 0) {
    fail((result.stderr || result.error?.message || `git ${args.join(' ')} nije uspio.`).trim());
  }
  return (result.stdout ?? '').trim();
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error || (result.status ?? 1) !== 0) {
    throw new Error(`git ${args[0]} nije uspio.`);
  }
}

function replaceOnce(raw, from, to, label) {
  const index = raw.indexOf(from);
  if (index < 0 || raw.indexOf(from, index + from.length) !== -1) fail(`Jedinstven zapis nije pronađen: ${label}.`);
  return `${raw.slice(0, index)}${to}${raw.slice(index + from.length)}`;
}

function replaceVersionCode(raw, current, next) {
  const pattern = new RegExp(`"versionCode": ${current}(?!\\d)`, 'g');
  const matches = raw.match(pattern) ?? [];
  if (matches.length !== 1) fail('Jedinstven zapis nije pronađen: versionCode.');
  return raw.replace(pattern, `"versionCode": ${next}`);
}

function bumpPatch(version) {
  const match = semverPattern.exec(version);
  if (!match) fail(`Verzija mora biti x.y.z, dobijeno: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function toGitPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function restoreFiles(repoRoot, files) {
  spawnSync('git', ['reset', 'HEAD', '--', ...files], { cwd: repoRoot, stdio: 'inherit' });
  const checkout = spawnSync('git', ['checkout', '--', ...files], { cwd: repoRoot, stdio: 'inherit' });
  if ((checkout.status ?? 1) !== 0) fail('Bump nije uspio i fajlovi verzije nisu vraćeni.');
}

const repoRoot = gitText(mobileRoot, ['rev-parse', '--show-toplevel']);
if (gitText(repoRoot, ['status', '--porcelain']).length > 0) {
  fail('Radno stablo nije čisto. build:production diže verziju samo na čistom stablu.');
}

const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const currentName = appJson?.expo?.version;
const currentCode = appJson?.expo?.android?.versionCode;
if (typeof currentName !== 'string') fail('app.json nema expo.version.');
if (!Number.isInteger(currentCode) || currentCode < 1) fail('versionCode mora biti pozitivan cijeli broj.');
if (packageJson.version !== currentName) {
  fail(`package.json (${packageJson.version}) i app.json (${currentName}) nemaju istu verziju.`);
}

const nextName = bumpPatch(currentName);
const nextCode = currentCode + 1;
const releaseFiles = [toGitPath(repoRoot, appJsonPath), toGitPath(repoRoot, packageJsonPath)];
const nextApp = replaceVersionCode(
  replaceOnce(readFileSync(appJsonPath, 'utf8'), `"version": "${currentName}"`, `"version": "${nextName}"`, 'expo.version'),
  currentCode,
  nextCode,
);
const nextPackage = replaceOnce(
  readFileSync(packageJsonPath, 'utf8'),
  `"version": "${currentName}"`,
  `"version": "${nextName}"`,
  'package.json version',
);

let committed = false;
try {
  writeFileSync(appJsonPath, nextApp);
  writeFileSync(packageJsonPath, nextPackage);
  runGit(repoRoot, ['add', '--', ...releaseFiles]);
  runGit(repoRoot, ['commit', '-m', `chore(mobile): release ${nextName} (${nextCode})`]);
  committed = true;
  const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  runGit(repoRoot, (upstream.status ?? 1) === 0 ? ['push'] : ['push', '-u', 'origin', 'HEAD']);
} catch (error) {
  if (committed) {
    const reset = spawnSync('git', ['reset', '--mixed', 'HEAD~1'], { cwd: repoRoot, stdio: 'inherit' });
    if ((reset.status ?? 1) !== 0) fail('Push nije uspio, a lokalni release commit nije poništen.');
  }
  restoreFiles(repoRoot, releaseFiles);
  fail(error instanceof Error ? error.message : 'Release bump nije uspio.');
}

console.log(`Release ${nextName} (${nextCode}) je commitovan i pushan.`);
