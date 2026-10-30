#!/usr/bin/env node
/** Static consistency check for web navigation, route guards, and intentionally deferred routes. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), 'utf8');
const navSource = await read('apps/web/src/app/nav.ts');
const routerSource = await read('apps/web/src/app/router.tsx');
const failures = [];
const warnings = [];

const navStart = navSource.indexOf('export const NAV_ITEMS');
const navEnd = navSource.indexOf('/** Grupisane stavke', navStart);
if (navStart < 0 || navEnd < 0) throw new Error('NAV_ITEMS blok nije pronađen.');
const navBlock = navSource.slice(navStart, navEnd);
const navLines = navBlock.split(/\r?\n/);
const navObjects = [];
for (let index = 0; index < navLines.length; index += 1) {
  if (!/^\s*\{\s*(?:to:.*)?$/.test(navLines[index])) continue;
  const objectLines = [navLines[index]];
  while (!objectLines.at(-1).trimEnd().endsWith('},') && index + 1 < navLines.length) {
    objectLines.push(navLines[++index]);
  }
  navObjects.push(objectLines.join('\n'));
}
const navItems = navObjects.map((object) => ({
  to: object.match(/\bto:\s*'([^']+)'/)?.[1] ?? '(nepoznata ruta)',
  permission: object.match(/permission:\s*'([^']+)'/)?.[1] ?? null,
  label: object.match(/label:\s*'([^']+)'/)?.[1] ?? '(bez naziva)',
  phase: object.match(/phase:\s*'([^']+)'/)?.[1] ?? '(bez faze)',
}));
if (navItems.length === 0) throw new Error('NAV_ITEMS nije moguće parsirati.');

const routeOccurrences = [...routerSource.matchAll(/\bpath:\s*'([^']+)'/g)];
const routes = routeOccurrences.map((match, index) => {
  const start = match.index;
  const end = routeOccurrences[index + 1]?.index ?? routerSource.length;
  const body = routerSource.slice(start, end);
  return {
    path: match[1],
    permission: body.match(/<RequirePermission\s+permission="([^"]+)"/)?.[1] ?? null,
    placeholder: /<PlaceholderPage\b/.test(body),
    source: body,
  };
});
const normalizeRoute = (route) => route.replace(/^\//, '').replace(/\/$/, '');
const routeMap = new Map(routes.map((route) => [normalizeRoute(route.path), route]));
const seenNav = new Set();

for (const item of navItems) {
  if (seenNav.has(item.to)) failures.push(`Navigacija ima dupliranu rutu ${item.to}.`);
  seenNav.add(item.to);
  const route = routeMap.get(normalizeRoute(item.to));
  if (!route) {
    failures.push(`Navigacija „${item.label}” (${item.to}) nema odgovarajuću React Router rutu.`);
    continue;
  }
  if (item.permission && route.permission !== item.permission) {
    failures.push(
      `${item.to}: navigacija traži ${item.permission}, ruta traži ${route.permission ?? 'nema RequirePermission'} .`,
    );
  }
  if (!item.permission && route.permission) {
    warnings.push(
      `${item.to}: ruta ima ${route.permission}, a navigacijska stavka nema permission metapodatak.`,
    );
  }
}

const notificationsRoute = routeMap.get('obavijesti');
if (!notificationsRoute) failures.push('/obavijesti: očekivana ruta nedostaje.');
else {
  if (notificationsRoute.permission !== 'notification:view')
    failures.push('/obavijesti: permission guard mora biti notification:view.');
  if (!notificationsRoute.source.includes('<NotificationsPage />'))
    failures.push('/obavijesti: ruta treba prikazati implementirani NotificationsPage.');
}
const reportsRoute = routeMap.get('izvjestaji');
if (!reportsRoute) failures.push('/izvjestaji: očekivana ruta nedostaje.');
else {
  if (reportsRoute.permission !== 'report:view')
    failures.push('/izvjestaji: permission guard mora biti report:view.');
  if (!reportsRoute.placeholder || !reportsRoute.source.includes('title="Izvještaji"'))
    failures.push('/izvjestaji: mora ostati namjerni permission-guarded placeholder.');
}

if (failures.length) {
  console.error(
    '❌ Frontend route/permission matrix nije usklađena:\n' + failures.map((x) => ` - ${x}`).join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log(
    `✅ Route matrix: ${navItems.length} navigacijskih stavki mapirano na rute; permission guardovi su usklađeni.`,
  );
  console.log(
    '✅ /obavijesti je implementiran uz notification:view; /izvjestaji ostaje namjerni report:view placeholder.',
  );
}
for (const warning of warnings) console.warn(`⚠️ ${warning}`);

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        navItems,
        routes: routes.map(({ path, permission, placeholder }) => ({ path, permission, placeholder })),
        failures,
        warnings,
      },
      null,
      2,
    ),
  );
}
