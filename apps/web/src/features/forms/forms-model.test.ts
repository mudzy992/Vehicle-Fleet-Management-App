/**
 * Builder — čista logika (W17). Provjerava da UI ne nudi akcije koje server
 * odbija i da je prikaz statusa/hash-a dosljedan.
 */
import { describe, expect, it } from 'vitest';
import type { FormVersionDiff, FormVersionSummary } from '@vfm/shared/schemas';
import {
  FORM_STATUS_LABELS,
  SUBJECT_LABELS,
  availableActions,
  buildDiffLines,
  formatDateTime,
  shortHash,
  suggestedVersionId,
  toParseResult,
  type FormPermissions,
} from './forms-model.js';

const ALL: FormPermissions = {
  canUpdate: true,
  canManageSchema: true,
  canPublish: true,
  canRetire: true,
};

const NONE: FormPermissions = {
  canUpdate: false,
  canManageSchema: false,
  canPublish: false,
  canRetire: false,
};

function version(status: FormVersionSummary['status'], id = 'v1'): Pick<FormVersionSummary, 'id' | 'status'> {
  return { id, status };
}

describe('forme — labeli i prikaz', () => {
  it('statusi i subjekti imaju bosanske nazive', () => {
    expect(FORM_STATUS_LABELS).toEqual({
      DRAFT: 'Nacrt',
      PUBLISHED: 'Objavljena',
      RETIRED: 'Povučena',
    });
    expect(SUBJECT_LABELS['VEHICLE']).toBe('Vozilo');
    expect(SUBJECT_LABELS['TASK']).toBe('Zadatak');
  });

  it('shortHash skraćuje hash i radi s praznom vrijednošću', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef01');
    expect(shortHash(null)).toBe('—');
    expect(shortHash(undefined)).toBe('—');
  });

  it('formatDateTime koristi Europe/Sarajevo i vraća crticu za null', () => {
    expect(formatDateTime(null)).toBe('—');
    // 12:00 UTC = 14:00 ljeti (CEST), format bez „u" i bez razmaka u datumu.
    expect(formatDateTime('2026-07-01T12:00:00.000Z')).toBe('01.07.2026. 14:00');
  });
});

describe('availableActions', () => {
  it('DRAFT: uređivanje, objava, brisanje i nova verzija', () => {
    expect(
      availableActions({ version: version('DRAFT'), currentPublishedVersionId: null, permissions: ALL }),
    ).toEqual(['edit', 'publish', 'delete', 'newVersion']);
  });

  it('DRAFT: poštuje permisije', () => {
    expect(
      availableActions({
        version: version('DRAFT'),
        currentPublishedVersionId: null,
        permissions: { ...ALL, canPublish: false, canManageSchema: false },
      }),
    ).toEqual(['newVersion']);

    expect(
      availableActions({ version: version('DRAFT'), currentPublishedVersionId: null, permissions: NONE }),
    ).toEqual([]);
  });

  it('PUBLISHED: aktivna verzija se ne povlači, samo kopira', () => {
    expect(
      availableActions({
        version: version('PUBLISHED', 'active'),
        currentPublishedVersionId: 'active',
        permissions: ALL,
      }),
    ).toEqual(['newVersion']);

    expect(
      availableActions({
        version: version('PUBLISHED', 'old'),
        currentPublishedVersionId: 'active',
        permissions: ALL,
      }),
    ).toEqual(['retire', 'newVersion']);
  });

  it('RETIRED: samo historija i kopiranje u novu verziju', () => {
    expect(
      availableActions({
        version: version('RETIRED'),
        currentPublishedVersionId: 'active',
        permissions: ALL,
      }),
    ).toEqual(['newVersion']);
  });

  it('bez odabrane verzije nema akcija', () => {
    expect(availableActions({ version: null, currentPublishedVersionId: null, permissions: ALL })).toEqual(
      [],
    );
  });
});

describe('suggestedVersionId', () => {
  const versions = [
    { id: 'v3', version: 3, status: 'DRAFT' },
    { id: 'v2', version: 2, status: 'PUBLISHED' },
    { id: 'v1', version: 1, status: 'RETIRED' },
  ] as FormVersionSummary[];

  it('predlaže najnoviji nacrt', () => {
    expect(suggestedVersionId(versions, 'v2')).toBe('v3');
  });

  it('bez nacrta predlaže aktivnu, pa najnoviju verziju', () => {
    const noDraft = versions.filter((item) => item.status !== 'DRAFT');
    expect(suggestedVersionId(noDraft, 'v2')).toBe('v2');
    expect(suggestedVersionId(noDraft, null)).toBe('v2');
    expect(suggestedVersionId([], null)).toBeNull();
  });
});

describe('toParseResult', () => {
  it('uspjeh vraća definiciju bez grešaka', () => {
    const result = toParseResult({ ok: true, definition: { $schema: 'vfm-form/1' } });

    expect(result.ok).toBe(true);
    expect(result.definition).toEqual({ $schema: 'vfm-form/1' });
    expect(result.issues).toEqual([]);
  });

  it('greške se kopiraju s putanjom i porukom', () => {
    const result = toParseResult({
      ok: false,
      issues: [{ path: '$.sections', message: 'Najmanje jedna sekcija.' }],
    });

    expect(result.ok).toBe(false);
    expect(result.definition).toBeNull();
    expect(result.issues).toEqual([{ path: '$.sections', message: 'Najmanje jedna sekcija.' }]);
  });
});

describe('buildDiffLines', () => {
  const diff: FormVersionDiff = {
    from: { id: 'v1', version: 1 },
    to: { id: 'v2', version: 2 },
    meta: [{ path: 'meta.title', before: 'Staro', after: 'Novo' }],
    addedFields: ['radionica'],
    removedFields: ['napomena'],
    changedFields: [
      {
        key: 'km',
        label: 'Kilometraža',
        changes: [{ path: 'validation.max', before: 100, after: 200 }],
      },
    ],
    addedSections: ['dodatno'],
    removedSections: [],
    normalizationChanged: true,
    empty: false,
  };

  it('prikazuje sve vrste promjena čitljivo', () => {
    expect(buildDiffLines(diff)).toEqual([
      '+ polje radionica',
      '− polje napomena',
      '~ km.validation.max: 100 → 200',
      '~ meta.title: Staro → Novo',
      '~ mapiranje na normalizovane kolone',
      '+ sekcija dodatno',
    ]);
  });

  it('prazan diff nema linija', () => {
    expect(
      buildDiffLines({
        ...diff,
        meta: [],
        addedFields: [],
        removedFields: [],
        changedFields: [],
        addedSections: [],
        normalizationChanged: false,
        empty: true,
      }),
    ).toEqual([]);
  });
});
