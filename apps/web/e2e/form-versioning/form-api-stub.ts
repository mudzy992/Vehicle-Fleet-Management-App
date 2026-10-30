import type { Page, Route } from '@playwright/test';

export const FORM_ID = '88888888-8888-4888-8888-888888888888';
export const V1_ID = '99999999-9999-4999-8999-999999999999';
export const V2_ID = '77777777-7777-4777-8777-777777777777';

type Status = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type Definition = {
  $schema: string;
  meta: { title: string; subject: string; language: string };
  layout: { columns: number; sectionsCollapsible: boolean; stickySubmit: boolean };
  sections: Array<{ key: string; title: string; order: number; visibleWhen: null; fields: Array<Record<string, unknown>> }>;
};

function field(key: string, label: string, order: number): Record<string, unknown> {
  return {
    key, type: 'TEXT', label, order, required: false, visibleWhen: null,
    disabled: false, visibleOnForm: true, storeInFormData: true,
  };
}

export function inspectionDefinition(
  keys: Array<[string, string]> = [['napomena', 'Napomena'], ['ocjena', 'Ocjena']],
): Definition {
  return {
    $schema: 'vfm-form/1',
    meta: { title: 'Pregled vozila', subject: 'VEHICLE', language: 'bs' },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [{
      key: 'osnovno', title: 'Osnovno', order: 1, visibleWhen: null,
      fields: keys.map(([key, label], index) => field(key, label, index + 1)),
    }],
  };
}

const envelope = (data: unknown) => ({ data, meta: {} });

function summary(id: string, version: number, status: Status, extra: Record<string, unknown> = {}) {
  return {
    id, version, status, changeNote: extra.changeNote ?? null, contentHash: extra.contentHash ?? `hash-${version}`,
    mobileCompatible: true, publishedAt: status === 'PUBLISHED' ? '2026-01-01T00:00:00.000Z' : null,
    publishedById: status === 'PUBLISHED' ? '11111111-1111-4111-8111-111111111111' : null,
    retiredAt: status === 'RETIRED' ? '2026-01-02T00:00:00.000Z' : null,
    createdAt: '2026-01-01T00:00:00.000Z', recordCount: 0,
  };
}

type VersionRow = ReturnType<typeof summary> & { definition: Definition };

export interface FormApiStub {
  lastPutDefinition: Definition | null;
  lastCopyFromVersionId: string | null;
  lastPublishNote: string | null;
  publishedPuts: number;
  handle(route: Route): Promise<void>;
}

export function createFormApiStub(start: 'empty' | 'draft' | 'published'): FormApiStub {
  const versions = new Map<string, VersionRow>();
  let hasForm = start !== 'empty';
  let formName = 'Pregled vozila';
  let formKey = 'pregled_vozila';
  let formSubject = 'VEHICLE';
  let currentPublished: string | null = start === 'published' ? V1_ID : null;
  if (hasForm) {
    versions.set(V1_ID, { ...summary(V1_ID, 1, start === 'published' ? 'PUBLISHED' : 'DRAFT'), definition: inspectionDefinition() });
  }
  const stub: FormApiStub = {
    lastPutDefinition: null, lastCopyFromVersionId: null, lastPublishNote: null, publishedPuts: 0,
    handle: async () => undefined,
  };
  const catalog = () => ({
    id: FORM_ID, key: formKey, name: formName, subject: formSubject, taskTypeId: null, description: null,
    ownerModule: 'vehicles', status: currentPublished ? 'PUBLISHED' : 'DRAFT',
    currentPublishedVersionId: currentPublished,
    currentPublishedVersion: currentPublished ? versions.get(currentPublished)?.version ?? null : null,
    versionCount: versions.size, updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  });
  const listVersions = () => [...versions.values()].map(({ definition: _d, ...row }) => row).sort((a, b) => b.version - a.version);
  stub.handle = async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    const fail = async (status: number, code: string, message: string) => {
      await route.fulfill({ status, json: { error: { code, message } } });
    };
    if (path === '/api/v1/form-schemas' && method === 'GET') {
      await route.fulfill({ status: 200, json: envelope(hasForm ? [catalog()] : []) });
      return;
    }
    if (path === '/api/v1/form-schemas' && method === 'POST') {
      const body = route.request().postDataJSON() as { key: string; name: string; subject: string; definition: Definition };
      formKey = body.key; formName = body.name; formSubject = body.subject; hasForm = true;
      versions.set(V1_ID, { ...summary(V1_ID, 1, 'DRAFT'), definition: body.definition });
      await route.fulfill({ status: 201, json: envelope({ ...catalog(), versions: listVersions() }) });
      return;
    }
    if (path === `/api/v1/form-schemas/${FORM_ID}` && method === 'GET') {
      await route.fulfill({ status: 200, json: envelope({ ...catalog(), versions: listVersions() }) });
      return;
    }
    if (path === `/api/v1/form-schemas/${FORM_ID}/diff` && method === 'GET') {
      const from = versions.get(url.searchParams.get('from') ?? '');
      const to = versions.get(url.searchParams.get('to') ?? '');
      if (!from || !to) { await fail(404, 'NOT_FOUND', 'Nema verzije za diff'); return; }
      const fromKeys = fieldKeysOf(from.definition);
      const toKeys = fieldKeysOf(to.definition);
      const addedFields = toKeys.filter((key) => !fromKeys.includes(key));
      const removedFields = fromKeys.filter((key) => !toKeys.includes(key));
      await route.fulfill({
        status: 200,
        json: envelope({
          from: { id: from.id, version: from.version }, to: { id: to.id, version: to.version },
          meta: [], addedFields, removedFields, changedFields: [], addedSections: [], removedSections: [],
          normalizationChanged: false, empty: addedFields.length === 0 && removedFields.length === 0,
        }),
      });
      return;
    }
    const versionMatch = path.match(/^\/api\/v1\/form-schemas\/[^/]+\/versions\/([^/]+)$/u);
    if (versionMatch && method === 'GET') {
      const row = versions.get(versionMatch[1]!);
      if (!row) { await fail(404, 'NOT_FOUND', 'Nema verzije'); return; }
      await route.fulfill({ status: 200, json: envelope({ ...row, formSchemaId: FORM_ID, normalizedName: null }) });
      return;
    }
    if (versionMatch && method === 'PUT') {
      const row = versions.get(versionMatch[1]!);
      if (!row || row.status !== 'DRAFT') {
        stub.publishedPuts += 1;
        await fail(409, 'FORM_VERSION_IMMUTABLE', 'Verzija je nepromjenjiva');
        return;
      }
      const body = route.request().postDataJSON() as { definition: Definition };
      stub.lastPutDefinition = body.definition;
      row.definition = body.definition;
      row.contentHash = `hash-edited-${row.version}`;
      await route.fulfill({ status: 200, json: envelope({ ...row, formSchemaId: FORM_ID, normalizedName: null }) });
      return;
    }
    if (versionMatch && method === 'DELETE') {
      const row = versions.get(versionMatch[1]!);
      if (!row || row.status !== 'DRAFT') { await fail(409, 'FORM_VERSION_IMMUTABLE', 'Ne može se brisati'); return; }
      versions.delete(row.id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === `/api/v1/form-schemas/${FORM_ID}/versions` && method === 'POST') {
      const body = route.request().postDataJSON() as { copyFromVersionId?: string; definition?: Definition };
      const hasCopy = Boolean(body.copyFromVersionId);
      const hasDefinition = Boolean(body.definition);
      if (hasCopy === hasDefinition) { await fail(400, 'VALIDATION_ERROR', 'copyFromVersionId xor definition'); return; }
      const source = hasCopy ? versions.get(body.copyFromVersionId!) : undefined;
      if (hasCopy && !source) { await fail(404, 'NOT_FOUND', 'Izvor ne postoji'); return; }
      stub.lastCopyFromVersionId = body.copyFromVersionId ?? null;
      const nextVersion = Math.max(0, ...[...versions.values()].map((row) => row.version)) + 1;
      const draft = {
        ...summary(V2_ID, nextVersion, 'DRAFT', { contentHash: source?.contentHash ?? `hash-${nextVersion}` }),
        definition: structuredClone(source?.definition ?? body.definition!),
      };
      versions.set(V2_ID, draft);
      await route.fulfill({ status: 200, json: envelope({ ...draft, formSchemaId: FORM_ID, normalizedName: null }) });
      return;
    }
    const publishMatch = path.match(/^\/api\/v1\/form-schemas\/[^/]+\/versions\/([^/]+)\/publish$/u);
    if (publishMatch && method === 'POST') {
      const body = route.request().postDataJSON() as { changeNote?: string };
      stub.lastPublishNote = body.changeNote ?? null;
      if ((body.changeNote?.trim().length ?? 0) < 5) {
        await fail(400, 'VALIDATION_ERROR', 'Bilješka je obavezna');
        return;
      }
      const row = versions.get(publishMatch[1]!);
      if (!row || row.status !== 'DRAFT') { await fail(409, 'FORM_VERSION_IMMUTABLE', 'Nije nacrt'); return; }
      if (currentPublished) {
        const previous = versions.get(currentPublished);
        if (previous) { previous.status = 'RETIRED'; previous.retiredAt = '2026-01-02T00:00:00.000Z'; }
      }
      row.status = 'PUBLISHED';
      row.changeNote = body.changeNote!.trim();
      row.publishedAt = '2026-01-02T00:00:00.000Z';
      currentPublished = row.id;
      await route.fulfill({ status: 200, json: envelope({ ...row, formSchemaId: FORM_ID, normalizedName: null }) });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { message: `Unexpected ${method} ${path}` } } });
  };
  return stub;
}

export async function mountFormApi(page: Page, stub: FormApiStub): Promise<void> {
  await page.route('**/api/v1/form-schemas**', (route) => stub.handle(route));
}
export function fieldKeysOf(definition: Definition | null): string[] {
  return definition?.sections[0]?.fields.map((item) => String(item.key)) ?? [];
}
