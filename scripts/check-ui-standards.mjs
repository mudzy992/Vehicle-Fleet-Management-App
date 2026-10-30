#!/usr/bin/env node
/** Enforce the web UI token contract: no one-off design utilities or inline styling. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const findings = [];
const sourceRoots = ['apps/web/src/app', 'apps/web/src/components', 'apps/web/src/features'];
const files = [];
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(?:tsx|ts)$/u.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/u.test(entry.name))
      files.push(file);
  }
}
for (const directory of sourceRoots) await walk(directory);

const oneOffUtility =
  /\b(?:[\w-]+:)*-?(?:p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy]|scroll-[mp][xytrbl]?|text|leading|tracking|rounded|shadow|w|min-w|max-w|h|min-h|max-h|size|top|bottom|left|right|inset|grid-cols|grid-rows|font|ring|outline|outline-offset|opacity|z|order|col|row|basis|grow|shrink|translate-[xy]|rotate|scale|duration|delay|ease|blur|backdrop-blur|border|decoration|underline-offset|aspect|object|overflow|cursor|pointer-events|fill|stroke|flex)-\[[^\]]+\]/gu;
const hardcodedPalette =
  /\b(?:text|bg|border|ring|ring-offset|outline|fill|stroke|from|via|to|placeholder|caret|accent|decoration|divide|shadow)-(?:white|black)(?:\/\d{1,3})?\b|\b(?:text|bg|border|ring|ring-offset|outline|fill|stroke|from|via|to|placeholder|caret|accent|decoration|divide|shadow)-(?:red|blue|gray|slate|lime|emerald|amber|yellow|orange|green|cyan|purple|pink|zinc|stone|neutral|indigo|violet|fuchsia|rose|teal|sky)-(?:[1-9]00|50|950)(?:\/\d{1,3})?\b/gu;
const rawColor = /#[\da-f]{3,8}\b|(?:rgb|hsl)a?\s*\(/giu;

for (const file of files) {
  const source = await readFile(path.join(root, file), 'utf8');
  const lines = source.split(/\r?\n/u);
  const addMatches = (regex, message) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source))) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line}: ${message}: ${match[0]}`);
    }
  };
  addMatches(
    oneOffUtility,
    'Koristi standardni token/alias ili imenovanu layout klasu; ne koristi arbitrary-value stil',
  );
  addMatches(hardcodedPalette, 'Koristi semantički color token umjesto Tailwind palete');
  if (file !== 'apps/web/src/features/design-system/design-system-page.tsx') {
    addMatches(/\bstyle\s*=/gu, 'Inline stil nije dozvoljen izvan galerije dizajn tokena');
    addMatches(rawColor, 'Boja mora biti semantički dizajn token, nikad literalna vrijednost');
  } else {
    // The design-system gallery is the only allowed runtime consumer of color values;
    // it must render values sourced from the token catalog, never author new literals.
    for (let index = 0; index < lines.length; index += 1) {
      if (
        /style=\{\{\s*backgroundColor:/u.test(lines[index]) &&
        !/token\.(?:variable|soft)/u.test(lines[index])
      ) {
        findings.push(
          `${file}:${index + 1}: galerija smije prikazati samo postojeći token.variable/token.soft.`,
        );
      }
    }
  }
}

// CSS is centralized in globals.css; raw colors are allowed only as semantic token values.
const css = await readFile(path.join(root, 'apps/web/src/styles/globals.css'), 'utf8');
for (const [index, line] of css.split(/\r?\n/u).entries()) {
  if (/(?:#[\da-f]{3,8}\b|(?:rgb|hsl)a?\s*\()/iu.test(line) && !/^\s*--[\w-]+\s*:/u.test(line)) {
    findings.push(
      `apps/web/src/styles/globals.css:${index + 1}: sirova boja je dozvoljena samo kao vrijednost semantic CSS tokena.`,
    );
  }
}

const shell = await readFile(path.join(root, 'apps/web/src/app/shell.tsx'), 'utf8');
if (/item\.phase|vfm-nav-phase/u.test(shell))
  findings.push('apps/web/src/app/shell.tsx: fazne oznake ne smiju biti dio korisničkog sidebara.');
const nav = await readFile(path.join(root, 'apps/web/src/app/nav.ts'), 'utf8');
if (/readonly phase\s*:/u.test(nav))
  findings.push('apps/web/src/app/nav.ts: ukloniti razvojni phase metapodatak iz navigacijskog ugovora.');

if (findings.length) {
  console.error(
    `❌ UI standard audit: ${findings.length} odstupanja:\n${findings.map((item) => ` - ${item}`).join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `✅ UI standard audit: ${files.length} web source datoteka bez arbitrary-value stilova, direktnih paleta ili inline stilova; CSS boje su tokenizovane; sidebar bez faznih oznaka.`,
  );
}
