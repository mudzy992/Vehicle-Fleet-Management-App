#!/usr/bin/env node
/**
 * Static guard for shared frontend design tokens. Checks the dark default palette
 * (web/mobile), browser chrome color, WCAG AA foreground pairs, and raw hex colors
 * in UI source. CSS and the mobile token declaration are the only color sources;
 * task-type colors remain runtime user data, not UI tokens.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), 'utf8');
const css = await read('apps/web/src/styles/globals.css');
const html = await read('apps/web/index.html');
const mobile = await read('apps/mobile/src/lib/theme.ts');
const cssRoot = css.match(/:root\s*\{([^}]+)\}/)?.[1];
const mobileRoot = mobile.match(/export const colors = \{([^}]+)\}/)?.[1];
const tailwindTheme = css.match(/@theme inline\s*\{([^}]+)\}/)?.[1];
const failures = [];

if (!cssRoot || !mobileRoot || !tailwindTheme) {
  throw new Error('Nisu pronađeni korijenski tokeni web/mobile teme ili Tailwind alias blok.');
}

const requiredThemeAliases = [
  ['--spacing', 'var(--space-1)'],
  ...['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'].map((size) => [`--text-${size}`, `var(--text-${size})`]),
  ...['tight', 'normal', 'relaxed'].map((name) => [`--leading-${name}`, `var(--leading-${name})`]),
  ...['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'pill'].map((size) => [
    `--radius-${size}`,
    `var(--radius-${size})`,
  ]),
  ...['sm', 'md', 'card', 'popover'].map((name) => [`--shadow-${name}`, `var(--shadow-${name})`]),
];
for (const [token, expected] of requiredThemeAliases) {
  const actual = tailwindTheme.match(new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, 'm'))?.[1]?.trim();
  if (actual !== expected)
    failures.push(`Tailwind alias ${token} mora biti ${expected} (trenutno ${actual ?? 'nedostaje'}).`);
}

const pairs = [
  ['primary', '--primary'],
  ['primarySoft', '--primary-soft'],
  ['primaryFg', '--primary-fg'],
  ['background', '--bg'],
  ['surface', '--surface'],
  ['surfaceMuted', '--surface-muted'],
  ['border', '--border'],
  ['ink', '--fg'],
  ['muted', '--fg-muted'],
  ['success', '--success'],
  ['successSoft', '--success-soft'],
  ['info', '--info'],
  ['infoSoft', '--info-soft'],
  ['warning', '--warning'],
  ['warningSoft', '--warning-soft'],
  ['danger', '--danger'],
  ['dangerSoft', '--danger-soft'],
  ['neutral', '--neutral'],
  ['neutralSoft', '--neutral-soft'],
];

function getMobile(name) {
  return mobileRoot.match(new RegExp(`^\\s*${name}:\\s*'(#[0-9a-fA-F]{6})'`, 'm'))?.[1];
}
function getWeb(name) {
  return cssRoot.match(new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm'))?.[1];
}
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const [mobileName, webName] of pairs) {
  const m = getMobile(mobileName);
  const w = getWeb(webName);
  if (!m || !w) failures.push(`Nedostaje token ${mobileName}/${webName}.`);
  else if (m.toLowerCase() !== w.toLowerCase())
    failures.push(`Neusklađen token ${mobileName}/${webName}: ${m} ≠ ${w}.`);
}
const themeColor = html.match(/<meta\s+name=["']theme-color["']\s+content=["'](#[0-9a-fA-F]{6})["']/i)?.[1];
if (!themeColor || themeColor.toLowerCase() !== getWeb('--bg')?.toLowerCase()) {
  failures.push(`theme-color mora odgovarati --bg (trenutno ${themeColor ?? 'nedostaje'}).`);
}

const contrastPairs = [
  ['primaryFg', 'primary'],
  ['ink', 'background'],
  ['ink', 'surface'],
  ['muted', 'background'],
  ['muted', 'surface'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['success', 'successSoft'],
  ['info', 'infoSoft'],
  ['warning', 'warningSoft'],
  ['danger', 'dangerSoft'],
];
for (const [foreground, background] of contrastPairs) {
  const foregroundColor = getMobile(foreground);
  const backgroundColor = getMobile(background);
  if (!foregroundColor || !backgroundColor) continue;
  const ratio = contrast(foregroundColor, backgroundColor);
  if (ratio < 4.5)
    failures.push(`Kontrast ${foreground}/${background} je ${ratio.toFixed(2)}:1 (potrebno ≥ 4.5:1).`);
}

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relative)));
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name)) files.push(relative);
  }
  return files;
}
for (const directory of ['apps/web/src', 'apps/mobile/app', 'apps/mobile/src']) {
  for (const file of await walk(directory)) {
    if (file === 'apps/mobile/src/lib/theme.ts') continue;
    const source = await read(file);
    if (/#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/i.test(source)) {
      failures.push(`Hardcoded hex UI color in ${file}; use a design token or keep it as domain data.`);
    }
  }
}

if (failures.length) {
  console.error('❌ Design-token audit failed:\n' + failures.map((item) => ` - ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `✅ Design-token audit passed: ${pairs.length} cross-platform pairs, ${contrastPairs.length} WCAG AA pairs, ${requiredThemeAliases.length} Tailwind scale aliases, browser chrome, and raw-color scan.`,
  );
}
