import { describe, expect, it } from 'vitest';
import type { FormSchemaDetail, FormVersionDetail } from '@vfm/shared/schemas';
import { appendVersionToDetail, versionSummaryFromDetail } from './forms-model.js';

const published: FormVersionDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  status: 'PUBLISHED',
  changeNote: 'Prva',
  contentHash: 'abc',
  mobileCompatible: true,
  publishedAt: '2026-01-01T00:00:00.000Z',
  publishedById: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  retiredAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  recordCount: 2,
  formSchemaId: '22222222-2222-4222-8222-222222222222',
  definition: { $schema: 'vfm-form/1' },
  normalizedName: null,
};

const draft: FormVersionDetail = {
  ...published,
  id: '33333333-3333-4333-8333-333333333333',
  version: 2,
  status: 'DRAFT',
  changeNote: null,
  contentHash: 'def',
  publishedAt: null,
  publishedById: null,
  recordCount: 0,
};

const detail: FormSchemaDetail = {
  id: published.formSchemaId,
  key: 'pregled',
  name: 'Pregled',
  subject: 'TASK',
  taskTypeId: null,
  description: null,
  ownerModule: null,
  status: 'PUBLISHED',
  currentPublishedVersionId: published.id,
  currentPublishedVersion: 1,
  versionCount: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  versions: [versionSummaryFromDetail(published)],
};

describe('appendVersionToDetail', () => {
  it('ubacuje novi nacrt na vrh liste verzija', () => {
    const next = appendVersionToDetail(detail, draft);
    expect(next.versionCount).toBe(2);
    expect(next.versions.map((version) => version.id)).toEqual([draft.id, published.id]);
    expect(next.versions[0]).not.toHaveProperty('definition');
  });

  it('ne duplira istu verziju', () => {
    const once = appendVersionToDetail(detail, draft);
    expect(appendVersionToDetail(once, draft).versions).toHaveLength(2);
  });
});
