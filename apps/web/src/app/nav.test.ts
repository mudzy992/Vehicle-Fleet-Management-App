import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, navByGroup, visibleNavItems } from './nav.js';
import { isKnownPermission } from '@vfm/shared';

/**
 * Navigacija (docs/06 §5.5) + pravilo da backend ostaje autoritet:
 * stavke nose `permission` iz kataloga, pa se filtriraju prema `/auth/me`.
 */
describe('NAV_ITEMS', () => {
  it('svaka stavka ima putanju, naziv i grupu; fazni metapodaci nisu dio korisničke navigacije', () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(8);
    for (const item of NAV_ITEMS) {
      expect(item.to.startsWith('/'), `${item.to} mora počinjati s /`).toBe(true);
      expect(item.label.length).toBeGreaterThan(1);
      expect(NAV_GROUPS).toContain(item.group);
      expect('phase' in item).toBe(false);
    }
  });

  it('putanje su jedinstvene', () => {
    const paths = NAV_ITEMS.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('svaka permisija u navigaciji postoji u katalogu (@vfm/shared)', () => {
    for (const item of NAV_ITEMS) {
      if (!item.permission) continue;
      expect(isKnownPermission(item.permission), `${item.to} → ${item.permission}`).toBe(true);
    }
  });

  it('Super Admin sekcije su označene (web-only, N-05)', () => {
    const superAdminOnly = NAV_ITEMS.filter((item) => item.superAdminOnly).map((item) => item.to);
    expect(superAdminOnly).toContain('/administracija/prava');
    expect(superAdminOnly).toContain('/administracija/korisnici');
    expect(superAdminOnly).toContain('/forme');
  });

  it('nazivi su na bosanskom', () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    expect(labels).toContain('Nadzorna tabla');
    expect(labels).toContain('Vozila');
    expect(labels).toContain('Zadaci');
    expect(labels).toContain('Matrica prava');
    expect(labels).toContain('Izvještaji');
    expect(labels).toContain('Zdravlje sistema');
  });
});

describe('navByGroup', () => {
  it('vraća sve grupe, svaka s barem jednom stavkom', () => {
    const grouped = navByGroup();
    expect(grouped.map((group) => group.group)).toEqual([...NAV_GROUPS]);
    for (const group of grouped) {
      expect(group.items.length, `${group.group} je prazna`).toBeGreaterThan(0);
    }
  });

  it('ukupni broj stavki je jednak NAV_ITEMS', () => {
    const total = navByGroup().reduce((sum, group) => sum + group.items.length, 0);
    expect(total).toBe(NAV_ITEMS.length);
  });
});

describe('visibleNavItems — filtriranje po pravima', () => {
  it('bez prava (Faza 0, nema prijave) prikazuje sve', () => {
    expect(visibleNavItems(undefined, false)).toEqual(NAV_ITEMS);
    expect(visibleNavItems([], false)).toEqual(NAV_ITEMS);
  });

  it('Super Admin vidi sve uključujući superAdminOnly sekcije (R-07)', () => {
    const items = visibleNavItems(['task:view', 'auth:login'], true);
    expect(items.map((item) => item.to)).toContain('/administracija/prava');
    expect(items.map((item) => item.to)).toContain('/forme');
  });

  it('Administrator bez superAdminOnly pristupa ne vidi matricu prava', () => {
    const permissions = ['task:view', 'vehicle:view', 'report:view', 'auth:login'];
    const items = visibleNavItems(permissions, false);
    const paths = items.map((item) => item.to);

    expect(paths).toContain('/zadaci');
    expect(paths).toContain('/vozila');
    expect(paths).not.toContain('/administracija/prava');
    expect(paths).not.toContain('/administracija/korisnici');
    expect(paths).not.toContain('/forme');
  });

  it('stavka bez potrebne permisije se ne prikazuje', () => {
    const items = visibleNavItems(['auth:login'], false);
    const paths = items.map((item) => item.to);
    expect(paths).not.toContain('/zadaci'); // traži task:view
    expect(paths).not.toContain('/izvjestaji'); // traži report:view
    expect(paths).toContain('/profil');
  });

  it('stavke bez permisije su uvijek vidljive (npr. dizajn sistem)', () => {
    const items = visibleNavItems(['auth:login'], false);
    expect(items.map((item) => item.to)).toContain('/dizajn-sistem');
  });
});
