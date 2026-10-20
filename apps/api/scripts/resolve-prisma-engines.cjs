#!/usr/bin/env node
/**
 * Pronalazi direktorij paketa `@prisma/engines` i ispisuje njegovu putanju.
 *
 * Zašto posebna skripta: pod pnpm-ovim `node-linker=isolated` `@prisma/engines`
 * NIJE direktna zavisnost `apps/api` (dolazi kroz `prisma`), pa
 * `require.resolve('@prisma/engines/package.json', { paths: [...] })` baca
 * "Cannot find module". Zato se kreće od lokacije paketa `prisma` i traži
 * sibling/roditeljski `node_modules/@prisma/engines`.
 *
 * Upotreba (build-time, Dockerfile korak 1b):
 *   node scripts/resolve-prisma-engines.cjs   → stdout: apsolutna putanja
 *   izlaz 1 ako paket nije pronađen
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER = path.join('scripts', 'postinstall.js');

/** Direktorij paketa `@prisma/engines` ako sadrži postinstall skriptu. */
function isEnginesDir(candidate) {
  try {
    return fs.statSync(path.join(candidate, MARKER)).isFile();
  } catch {
    return false;
  }
}

function resolveEnginesDir(startDir) {
  let dir = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidates = [
      path.join(dir, 'node_modules', '@prisma', 'engines'),
      // pnpm: …/.pnpm/prisma@x/node_modules/prisma  →  …/node_modules/@prisma/engines
      path.join(path.dirname(dir), '@prisma', 'engines'),
      path.join(dir, '@prisma', 'engines'),
    ];
    for (const candidate of candidates) {
      if (isEnginesDir(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function main() {
  const start = process.argv[2] ?? process.cwd();
  let prismaPackageJson;
  try {
    prismaPackageJson = require.resolve('prisma/package.json', { paths: [start] });
  } catch {
    prismaPackageJson = null;
  }

  const startDirs = [
    ...(prismaPackageJson ? [path.dirname(prismaPackageJson)] : []),
    path.resolve(start, 'node_modules', 'prisma'),
    path.resolve(start),
  ];

  for (const startDir of startDirs) {
    const found = resolveEnginesDir(startDir);
    if (found) {
      process.stdout.write(found);
      return 0;
    }
  }

  process.stderr.write(
    `@prisma/engines nije pronađen iz ${start}\n` +
      'Provjeri da je `prisma` u dependencies (ne devDependencies) apps/api/package.json.\n',
  );
  return 1;
}

process.exitCode = main();
