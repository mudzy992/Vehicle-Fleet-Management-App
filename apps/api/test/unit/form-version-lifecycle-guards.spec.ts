/** Matrica odbijanja nad HTTP API-jem formi. */
import { randomUUID } from 'node:crypto';
import type { FormSchemaDetail, FormVersionDetail } from '@vfm/shared/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectionDefinition } from '../helpers/form-definition-fixture.js';
import {
  apiJson,
  payloadData,
  startFormVersionHttpApp,
  taskFormPayload,
  type FormVersionHttpApp,
} from '../helpers/form-version-http-harness.js';

describe('HTTP form-schemas — matrica odbijanja', () => {
  let harness: FormVersionHttpApp;

  beforeAll(async () => {
    harness = await startFormVersionHttpApp();
  }, 30_000);

  afterAll(async () => {
    await harness.app.close();
  });

  async function publishedForm(): Promise<{ id: string; versionId: string }> {
    const created = payloadData<FormSchemaDetail>(
      (
        await apiJson(harness.baseUrl, 'POST', '/form-schemas', taskFormPayload(harness.prisma, {
          key: `guard_${randomUUID().slice(0, 8)}`,
          name: 'Guard forma',
          definition: inspectionDefinition(),
        }))
      ).payload,
    );
    const versionId = created.versions[0]!.id;
    await apiJson(harness.baseUrl, 'POST', `/form-schemas/${created.id}/versions/${versionId}/publish`, {
      changeNote: 'Prva verzija',
    });
    return { id: created.id, versionId };
  }

  it('publish bez ispravne bilješke je 400', async () => {
    const created = payloadData<FormSchemaDetail>(
      (
        await apiJson(harness.baseUrl, 'POST', '/form-schemas', taskFormPayload(harness.prisma, {
          key: `note_${randomUUID().slice(0, 8)}`,
          name: 'Bez bilješke',
          definition: inspectionDefinition(),
        }))
      ).payload,
    );
    const result = await apiJson(
      harness.baseUrl,
      'POST',
      `/form-schemas/${created.id}/versions/${created.versions[0]!.id}/publish`,
      { changeNote: 'abc' },
    );
    expect(result.status).toBe(400);
  });

  it('DELETE objavljene verzije je 409; DRAFT se briše', async () => {
    const form = await publishedForm();
    const publishedDelete = await apiJson(
      harness.baseUrl,
      'DELETE',
      `/form-schemas/${form.id}/versions/${form.versionId}`,
    );
    expect(publishedDelete.status).toBe(409);

    const draft = payloadData<FormVersionDetail>(
      (
        await apiJson(harness.baseUrl, 'POST', `/form-schemas/${form.id}/versions`, {
          copyFromVersionId: form.versionId,
        })
      ).payload,
    );
    const removed = await apiJson(
      harness.baseUrl,
      'DELETE',
      `/form-schemas/${form.id}/versions/${draft.id}`,
    );
    expect(removed.status).toBe(204);
  });

  it('createVersion zahtijeva tačno jedan izvor definicije', async () => {
    const form = await publishedForm();
    const both = await apiJson(harness.baseUrl, 'POST', `/form-schemas/${form.id}/versions`, {
      copyFromVersionId: form.versionId,
      definition: inspectionDefinition(),
    });
    const neither = await apiJson(harness.baseUrl, 'POST', `/form-schemas/${form.id}/versions`, {});
    expect(both.status).toBe(400);
    expect(neither.status).toBe(400);
  });
});
