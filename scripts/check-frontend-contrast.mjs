#!/usr/bin/env node
/** Audit semantic foreground/background pairs for dark and explicit light web themes. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const css = await readFile(path.join(process.cwd(), 'apps/web/src/styles/globals.css'), 'utf8');
const failures = [];
const results = [];

function declarationBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? null;
}
function tokensFrom(block) {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[\da-f]{6})\s*;/gi)].map((match) => [match[1], match[2]]),
  );
}
function linear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}
function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

const darkBlock = declarationBlock(':root');
const lightBlock = declarationBlock("[data-theme='light']");
if (!darkBlock || !lightBlock) throw new Error('Nisu pronađeni :root i [data-theme=light] tokeni.');
const themes = { dark: tokensFrom(darkBlock), light: tokensFrom(lightBlock) };
const pairs = [
  ['primary-fg', 'primary', 4.5, 'primarni tekst na pozadini'],
  ['button-primary-fg', 'button-primary', 4.5, 'tekst na primarnom dugmetu'],
  ['fg', 'bg', 4.5, 'osnovni tekst na pozadini'],
  ['fg', 'surface', 4.5, 'osnovni tekst na kartici'],
  ['fg', 'surface-muted', 4.5, 'osnovni tekst na utišanoj površini'],
  ['fg-muted', 'bg', 4.5, 'sekundarni tekst na pozadini'],
  ['fg-muted', 'surface', 4.5, 'sekundarni tekst na kartici'],
  ['primary', 'bg', 4.5, 'primarni link/akcent na pozadini'],
  ['primary', 'surface', 4.5, 'primarni link/akcent na kartici'],
  ['success', 'success-soft', 4.5, 'tekst statusa uspjeha'],
  ['info', 'info-soft', 4.5, 'tekst statusa informacije'],
  ['warning', 'warning-soft', 4.5, 'tekst statusa upozorenja'],
  ['danger', 'danger-soft', 4.5, 'tekst statusa greške'],
];

for (const [themeName, tokens] of Object.entries(themes)) {
  for (const [foregroundKey, backgroundKey, minimum, purpose] of pairs) {
    const foreground = tokens[foregroundKey];
    const background = tokens[backgroundKey];
    if (!foreground || !background) {
      failures.push(`${themeName}: nedostaje ${foregroundKey} ili ${backgroundKey} token (${purpose}).`);
      continue;
    }
    const ratio = contrast(foreground, background);
    results.push({
      theme: themeName,
      foreground: foregroundKey,
      background: backgroundKey,
      ratio,
      minimum,
      purpose,
    });
    if (ratio < minimum)
      failures.push(
        `${themeName}: ${foregroundKey}/${backgroundKey} = ${ratio.toFixed(2)}:1; traži se ≥ ${minimum}:1 (${purpose}).`,
      );
  }
}

const taskList = await readFile(
  path.join(process.cwd(), 'apps/web/src/features/tasks/tasks-page.tsx'),
  'utf8',
);
const taskCreateTarget = taskList.indexOf('to="/zadaci/novi"');
const taskLinkStart = taskCreateTarget < 0 ? -1 : taskList.lastIndexOf('<Link', taskCreateTarget);
const taskLinkEnd = taskCreateTarget < 0 ? -1 : taskList.indexOf('</Link>', taskCreateTarget);
const newTaskAnchor =
  taskLinkStart >= 0 && taskLinkEnd >= 0 ? taskList.slice(taskLinkStart, taskLinkEnd) : '';
const ctaClass = newTaskAnchor.includes("buttonClassName('primary', 'lg')") ? 'buttonClassName' : '';
const sharedButton = await readFile(
  path.join(process.cwd(), 'apps/web/src/components/ui/button.tsx'),
  'utf8',
);
const primaryVariant = sharedButton.match(/primary:\s*'([^']+)'/)?.[1] ?? '';
const ctaStyle = {
  hasSemanticForeground: primaryVariant.includes('text-button-primary-fg'),
  hasSemanticBackground: primaryVariant.includes('bg-button-primary'),
  usesOpacityHover: primaryVariant.includes('hover:opacity-90'),
  usesSharedPrimitive: ctaClass.length > 0,
};
if (!newTaskAnchor) failures.push('Nije pronađen CTA link za /zadaci/novi; pregledati promjenu route-a.');
if (newTaskAnchor && (!ctaStyle.hasSemanticForeground || !ctaStyle.hasSemanticBackground)) {
  failures.push('CTA „Novi zadatak” ne koristi oba semantička button-primary/button-primary-fg tokena.');
}

if (failures.length) {
  console.error('❌ Frontend contrast audit nije prošao:\n' + failures.map((x) => ` - ${x}`).join('\n'));
  process.exitCode = 1;
} else {
  const primaryRows = results.filter((row) => row.foreground === 'button-primary-fg');
  console.log(
    `✅ Semantički kontrast: ${results.length} kombinacija u dark/light temi prolazi WCAG AA za obični tekst.`,
  );
  for (const row of primaryRows)
    console.log(`   ${row.theme}: tekst primarnog dugmeta ${row.ratio.toFixed(2)}:1`);
  console.log(
    `ℹ️ CTA „Novi zadatak”: tokeni bg/fg ${ctaStyle.hasSemanticBackground && ctaStyle.hasSemanticForeground ? 'ispravni' : 'nepotpuni'}; hover opacity=${ctaStyle.usesOpacityHover}; zajednički Button primitive=${ctaStyle.usesSharedPrimitive}.`,
  );
  if (!ctaStyle.usesSharedPrimitive)
    console.log(
      '⚠️ CTA koristi zasebne ručne klase; vizuelno ga uskladiti sa zajedničkim Button primitive-om tokom implementacije.',
    );
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ results, ctaStyle, failures }, null, 2));
