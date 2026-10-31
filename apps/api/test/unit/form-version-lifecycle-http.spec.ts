/**
 * HTTP workflow nad stvarnim FormSchemasController + servisom (fake Prisma).
 */
import { randomUUID } from 'node:crypto';
import type { FormSchemaDetail, FormVersionDetail } from '@vfm/shared/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldKeysOf,
  inspectionDefinition,
  withFirstSectionFields,
} from '../helpers/form-definition-fixture.js';
import {
  apiJson,
  payloadData,
  startFormVersionHttpApp,
  taskFormPayload,
  type FormVersionHttpApp,
} from '../helpers/form-version-http-harness.js';

function editedDefinition(): Record<string, unknown> {
  return withFirstSectionFields(inspectionDefinition(), (fields) => {
    fields.splice(
      fields.findIndex((field) => field['key'] === 'napomena'),
      1,
    );
    fields.push({
      key: 'inspektor',
      type: 'TEXT',
      label: 'Inspektor',
      order: 9,
      required: false,
      visibleWhen: null,
      disabled: false,
      visibleOnForm: true,
      storeInFormData: true,
    });
  });
}

describe('HTTP form-schemas — kompletan workflow verzija', () => {
  let harness: FormVersionHttpApp;

  beforeAll(async () => {
    harness = await startFormVersionHttpApp();
  }, 30_000);

  afterAll(async () => {
    await harness.app.close();
  });

  it('copy → PUT izmjena polja → publish → active nije klon', async () => {
    const { baseUrl } = harness;
    const created = payloadData<FormSchemaDetail>(
      (
        await apiJson(baseUrl, 'POST', '/form-schemas', taskFormPayload(harness.prisma, {
          key: `pregled_${randomUUID().slice(0, 8)}`,
          name: 'Pregled HTTP',
          definition: inspectionDefinition(),
        }))
      ).payload,
    );
    const firstId = created.versions[0]!.id;
    await apiJson(baseUrl, 'POST', `/form-schemas/${created.id}/versions/${firstId}/publish`, {
      changeNote: 'Prva verzija',
    });

    const draft = payloadData<FormVersionDetail>(
      (
        await apiJson(baseUrl, 'POST', `/form-schemas/${created.id}/versions`, {
          copyFromVersionId: firstId,
        })
      ).payload,
    );
    expect(draft.status).toBe('DRAFT');
    expect(fieldKeysOf(draft.definition)).toEqual(['napomena', 'ocjena']);

    const cachedDraft = await apiJson(
      baseUrl,
      'GET',
      `/form-schemas/${created.id}/versions/${draft.id}`,
      undefined,
      { 'if-none-match': `"${draft.contentHash ?? ''}"` },
    );
    expect(cachedDraft.status).toBe(200);
    expect(cachedDraft.headers.get('cache-control')).toBe('no-store');

    const saved = payloadData<FormVersionDetail>(
      (
        await apiJson(baseUrl, 'PUT', `/form-schemas/${created.id}/versions/${draft.id}`, {
          definition: editedDefinition(),
        })
      ).payload,
    );
    expect(fieldKeysOf(saved.definition).sort()).toEqual(['inspektor', 'ocjena']);

    const published = payloadData<FormVersionDetail>(
      (
        await apiJson(baseUrl, 'POST', `/form-schemas/${created.id}/versions/${draft.id}/publish`, {
          changeNote: 'Izmjena polja nakon kopije',
        })
      ).payload,
    );
    const active = payloadData<{ formSchemaVersionId: string; definition: Record<string, unknown> }>(
      (await apiJson(baseUrl, 'GET', `/form-schemas/active?subject=TASK&taskTypeId=${created.taskTypeId}&role=ORDER`)).payload,
    );
    const previous = payloadData<FormVersionDetail>(
      (await apiJson(baseUrl, 'GET', `/form-schemas/${created.id}/versions/${firstId}`)).payload,
    );

    expect(published.status).toBe('PUBLISHED');
    expect(fieldKeysOf(published.definition).sort()).toEqual(['inspektor', 'ocjena']);
    expect(fieldKeysOf(active.definition).sort()).toEqual(['inspektor', 'ocjena']);
    expect(active.formSchemaVersionId).toBe(draft.id);
    expect(published.contentHash).not.toBe(previous.contentHash);
  });

  it('PUT nad objavljenom verzijom je 409', async () => {
    const { baseUrl } = harness;
    const created = payloadData<FormSchemaDetail>(
      (
        await apiJson(baseUrl, 'POST', '/form-schemas', taskFormPayload(harness.prisma, {
          key: `immut_${randomUUID().slice(0, 8)}`,
          name: 'Immutable',
          definition: inspectionDefinition(),
        }))
      ).payload,
    );
    const versionId = created.versions[0]!.id;
    await apiJson(baseUrl, 'POST', `/form-schemas/${created.id}/versions/${versionId}/publish`, {
      changeNote: 'Prva verzija',
    });
    const update = await apiJson(baseUrl, 'PUT', `/form-schemas/${created.id}/versions/${versionId}`, {
      definition: inspectionDefinition(),
    });
    expect(update.status).toBe(409);
  });
});
