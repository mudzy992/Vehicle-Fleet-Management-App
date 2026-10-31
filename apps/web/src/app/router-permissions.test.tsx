import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { RequirePermission } from './guards.js';
import { NAV_ITEMS } from './nav.js';
import { appRoutes } from './router.js';

function expectRoutePermission(path: string, permission: string): void {
  const root = appRoutes.find((route) => route.path === '/');
  const route = root?.children?.find((child) => child.path === path);
  const element = route?.element as ReactElement<{ permission: string }> | undefined;

  expect(element?.type, `${path} mora biti obavijen RequirePermission`).toBe(RequirePermission);
  expect(element?.props.permission, `${path} mora tražiti ${permission}`).toBe(permission);
}

describe('P14 — dozvole za direktne web rute', () => {
  it.each(NAV_ITEMS.filter((item) => item.permission).map(({ to, permission }) => [to, permission!]))(
    'ruta %s traži pravo %s i pri direktnom pristupu',
    (path, permission) => {
      expectRoutePermission(path.slice(1), permission);
    },
  );
});
