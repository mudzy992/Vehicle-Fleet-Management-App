/**
 * Copy → izmjena polja → objava mora ostaviti novu definiciju, ne klon vN-1.
 */
import { describe, expect, it, vi } from 'vitest';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import { FakeFormPrisma, asPrisma } from '../helpers/form-schemas-fake.js';
import {
  fieldKeysOf,
  inspectionDefinition,
  withFirstSectionFields,
} from '../helpers/form-definition-fixture.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const ACTOR = '018f0000-0000-7000-8000-0000000000aa';

function build(): FormSchemasService {
  return new FormSchemasService(asPrisma(new FakeFormPrisma()));
}

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

describe('FormSchemasService — copy + izmjena + objava', () => {
  it('objavljena kopija zadržava dodana i uklonjena polja', async () => {
    const service = build();
    const created = await service.create(
      { key: 'pregled_vozila', name: 'Pregled', subject: 'TASK', definition: inspectionDefinition() },
      ACTOR,
    );
    const firstId = created.data.versions[0]!.id;
    await service.publish(created.data.id, firstId, { changeNote: 'Prva verzija' }, ACTOR);

    const draft = await service.createVersion(created.data.id, { copyFromVersionId: firstId }, ACTOR);
    expect(fieldKeysOf(draft.data.definition)).toEqual(['napomena', 'ocjena']);

    const saved = await service.updateVersion(created.data.id, draft.data.id, {
      definition: editedDefinition(),
    });
    expect(fieldKeysOf(saved.data.definition).sort()).toEqual(['inspektor', 'ocjena']);
    expect(saved.data.contentHash).not.toBe(draft.data.contentHash);

    const published = await service.publish(
      created.data.id,
      draft.data.id,
      { changeNote: 'Uklonjena napomena, dodat inspektor' },
      ACTOR,
    );
    const active = await service.active({ subject: 'TASK' });
    const previous = await service.getVersion(created.data.id, firstId);
    const keys = fieldKeysOf(published.data.definition).sort();

    expect(published.data.status).toBe('PUBLISHED');
    expect(keys).toEqual(['inspektor', 'ocjena']);
    expect(keys).not.toContain('napomena');
    expect(fieldKeysOf(active.definition as Record<string, unknown>).sort()).toEqual(keys);
    expect(active.formSchemaVersionId).toBe(draft.data.id);
    expect(published.data.contentHash).not.toBe(previous.contentHash);
    expect(fieldKeysOf(previous.definition).sort()).toEqual(['napomena', 'ocjena']);
  });

  it('kopija bez PUT-a pa objava ostaje identičan klon', async () => {
    const service = build();
    const created = await service.create(
      { key: 'pregled_klon', name: 'Pregled klon', subject: 'TASK', definition: inspectionDefinition() },
      ACTOR,
    );
    const firstId = created.data.versions[0]!.id;
    await service.publish(created.data.id, firstId, { changeNote: 'Prva verzija' }, ACTOR);
    const draft = await service.createVersion(created.data.id, { copyFromVersionId: firstId }, ACTOR);
    const published = await service.publish(created.data.id, draft.data.id, { changeNote: 'Klon bez izmjene' }, ACTOR);
    const previous = await service.getVersion(created.data.id, firstId);

    expect(fieldKeysOf(published.data.definition)).toEqual(fieldKeysOf(previous.definition));
    expect(published.data.contentHash).toBe(previous.contentHash);
  });
});
