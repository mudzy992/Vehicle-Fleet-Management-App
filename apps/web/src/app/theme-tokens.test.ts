import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
const mobileThemeSource = readFileSync(resolve(process.cwd(), '../mobile/src/lib/theme.ts'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const webRoot = css.match(/:root\s*\{([^}]+)\}/)?.[1];
const mobileRoot = mobileThemeSource.match(/export const colors = \{([^}]+)\}/)?.[1];

if (!webRoot || !mobileRoot) {
  throw new Error('Nisu pronađeni osnovni tokeni u web CSS-u i mobilnoj temi.');
}

const tokenPairs = [
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
] as const;

function mobileColor(name: string): string {
  const value = mobileRoot!.match(new RegExp(`^\\s*${name}:\\s*'(#[0-9a-fA-F]{6})'`, 'm'))?.[1];
  if (!value) throw new Error(`Nedostaje mobilni token: ${name}`);
  return value;
}

function webColor(name: string): string {
  const value = webRoot!.match(new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm'))?.[1];
  if (!value) throw new Error(`Nedostaje web token: ${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe('Web/mobile design tokens', () => {
  it.each(tokenPairs)('%s matches between platforms', (mobileName, webName) => {
    expect(mobileColor(mobileName).toLowerCase()).toBe(webColor(webName).toLowerCase());
  });

  it('keeps the shared graphite-and-lime palette as the web default', () => {
    expect(webColor('--bg').toLowerCase()).toBe('#0b0f0c');
    expect(webColor('--primary').toLowerCase()).toBe('#c6f75a');
    expect(mobileColor('background').toLowerCase()).toBe('#0b0f0c');
    expect(mobileColor('primary').toLowerCase()).toBe('#c6f75a');
  });

  it.each([
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-6',
    '--space-8',
    '--space-12',
    '--space-16',
    '--text-xs',
    '--text-sm',
    '--text-base',
    '--text-lg',
    '--text-xl',
    '--text-2xl',
    '--text-3xl',
    '--leading-tight',
    '--leading-normal',
    '--leading-relaxed',
    '--radius-xs',
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-xl',
    '--radius-2xl',
    '--radius-pill',
    '--shadow-card',
    '--shadow-popover',
    '--focus-ring',
    '--motion-fast',
    '--motion-normal',
    '--motion-slow',
    '--sidebar-width',
    '--content-max',
    '--control-height',
  ])('defines the web foundation token %s', (token) => {
    expect(css).toMatch(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`));
  });

  it('matches browser chrome to the shared dark background token', () => {
    const themeColor = html.match(
      /<meta\s+name=["']theme-color["']\s+content=["'](#[0-9a-fA-F]{6})["']/i,
    )?.[1];
    expect(themeColor?.toLowerCase()).toBe(webColor('--bg').toLowerCase());
  });

  it.each([
    ['primaryFg', 'primary'],
    ['primaryFg', 'danger'],
    ['ink', 'background'],
    ['ink', 'surface'],
    ['muted', 'background'],
    ['muted', 'surface'],
    ['primary', 'background'],
    ['primary', 'surface'],
    ['primary', 'primarySoft'],
    ['success', 'successSoft'],
    ['info', 'infoSoft'],
    ['warning', 'warningSoft'],
    ['danger', 'dangerSoft'],
    ['muted', 'neutralSoft'],
  ])('%s on %s meets WCAG AA normal-text contrast', (foreground, background) => {
    expect(contrast(mobileColor(foreground), mobileColor(background))).toBeGreaterThanOrEqual(4.5);
  });
});
