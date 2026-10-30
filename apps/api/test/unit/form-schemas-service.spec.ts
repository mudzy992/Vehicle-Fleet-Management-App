/**
 * `FormSchemasService` — životni ciklus verzija forme (docs/04 §8, P9/P10/P11).
 *
 * Provjerava ono što bi u produkciji skupo koštalo:
 * - nevalidna definicija ne ulazi ni u `DRAFT`;
 * - `PUBLISHED`/`RETIRED` se ne mijenjaju (`FORM_VERSION_IMMUTABLE`);
 * - objava je atomska: stara verzija → `RETIRED`, nova → `PUBLISHED`, forma
 *   pokazuje na novu, registar ključeva se dopunjuje;
 * - `active` vraća tačno jednu aktivnu verziju, a za TASK poštuje zadanu formu vrste;
 * - `validateValues` odbija `DRAFT` i vraća greške po polju za objavljenu formu.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FormValidationResponse } from '@vfm/shared/schemas';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';
import { matchesIfNoneMatch } from '../../src/modules/form-schemas/form-schemas.controller.js';
import { FakeFormPrisma, asPrisma } from '../helpers/form-schemas-fake.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({
  PrismaService: class PrismaService {},
}));

/**
 * Minimalna kopija primjera „Pranje vozila" (docs/04 §2) — dovoljna za
 * životni ciklus i P11: obavezna polja, uslovna vidljivost, MONEY i COMPUTED.
 */
function freshWashDefinition(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: { title: 'Pranje vozila', subject: 'TASK' },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovni podaci',
        order: 1,
        fields: [
          {
            key: 'washType',
            type: 'SINGLE_CHOICE',
            label: 'Vrsta pranja',
            required: true,
            order: 1,
            optionsSource: {
              kind: 'STATIC',
              items: [
                { value: 'EXTERNAL', label: 'Vanjsko' },
                { value: 'INTERNAL', label: 'Unutrašnje' },
                { value: 'FULL', label: 'Kompletno' },
              ],
            },
          },
          {
            key: 'washDurationMin',
            type: 'INTEGER',
            label: 'Trajanje (min)',
            order: 2,
            validation: { min: 1, max: 480 },
          },
          {
            key: 'washCost',
            type: 'MONEY',
            label: 'Trošak pranja',
            order: 3,
            validation: { min: 0, max: 100000, currency: 'BAM' },
          },
          {
            key: 'photosAfter',
            type: 'PHOTO',
            label: 'Fotografije nakon pranja',
            required: true,
            order: 4,
            visibleWhen: { field: 'washType', op: 'IN', value: ['EXTERNAL', 'FULL'] },
          },
        ],
      },
      {
        key: 'racun',
        title: 'Obračun',
        order: 2,
        fields: [
          {
            key: 'costPerMinute',
            type: 'COMPUTED',
            label: 'Cijena po minuti',
            order: 1,
            computed: {
              expression: 'if(washDurationMin > 0, round(washCost / washDurationMin, 2), 0)',
              resultType: 'DECIMAL',
              precision: 2,
            },
          },
        ],
      },
    ],
  };
}

const ACTOR = '018f0000-0000-7000-8000-0000000000aa';

function build(): { prisma: FakeFormPrisma; service: FormSchemasService } {
  const prisma = new FakeFormPrisma();
  return { prisma, service: new FormSchemasService(asPrisma(prisma)) };
}

async function errorOf(action: () => Promise<unknown>): Promise<VfmException> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException.');
}

function freshVehicleDefinition(): Record<string, unknown> {
  const definition = SEED_FORMS.find((form) => form.key === 'vehicle')?.definition;
  if (!definition) throw new Error('seed forma `vehicle` nedostaje');
  return structuredClone(definition);
}

async function createWashForm(service: FormSchemasService) {
  return (
    await service.create(
      {
        key: 'pranje_vozila',
        name: 'Pranje vozila',
        subject: 'TASK',
        definition: freshWashDefinition(),
      },
      ACTOR,
    )
  ).data;
}

describe('FormSchemasService — LIST opcije', () => {
  it('vraća samo aktivne stavke sortirane i s vrijednošću stabilnog koda', async () => {
    const { prisma, service } = build();
    prisma.formOptionLists.set('WORKSHOP', [
      { code: 'Z', label: 'Zadnja', active: true, deletedAt: null, sortOrder: 20 },
      { code: 'A', label: 'Prva', active: true, deletedAt: null, sortOrder: 10 },
      { code: 'OFF', label: 'Neaktivna', active: false, deletedAt: null, sortOrder: 1 },
      { code: null, label: 'Bez koda', active: true, deletedAt: null, sortOrder: 30 },
    ]);
    await expect(service.listFormOptions('WORKSHOP')).resolves.toEqual([
      { value: 'A', label: 'Prva' },
      { value: 'Z', label: 'Zadnja' },
      { value: 'Bez koda', label: 'Bez koda' },
    ]);
  });
});

const VALID_VALUES = {
  washType: 'FULL',
  washDurationMin: 30,
  washCost: { amount: 9000, currency: 'BAM' },
  photosAfter: ['018f0000-0000-7000-8000-0000000000f1'],
};

describe('FormSchemasService — kreiranje', () => {
  it('odbija drugi identitet za isti subject, bez sprečavanja task-type formi', async () => {
    const { service } = build();
    const first = await service.create({
      key: 'vozilo-prvo',
      name: 'Vozilo',
      subject: 'VEHICLE',
      definition: freshVehicleDefinition(),
    });
    expect(first.data.subject).toBe('VEHICLE');

    const duplicate = await errorOf(() =>
      service.create({
        key: 'vozilo-drugo',
        name: 'Drugo vozilo',
        subject: 'VEHICLE',
        definition: freshVehicleDefinition(),
      }),
    );
    expect(duplicate.code).toBe('VALIDATION_ERROR');

    const typeA = '018f0000-0000-7000-8000-0000000000d1';
    const typeB = '018f0000-0000-7000-8000-0000000000d2';
    await service.create({
      key: 'task-a',
      name: 'Task A',
      subject: 'TASK',
      taskTypeId: typeA,
      definition: freshWashDefinition(),
    });
    await service.create({
      key: 'task-b',
      name: 'Task B',
      subject: 'TASK',
      taskTypeId: typeB,
      definition: freshWashDefinition(),
    });
  });

  it('kreira formu s prvom DRAFT verzijom i stabilnim contentHash', async () => {
    const { service } = build();
    const detail = await createWashForm(service);

    expect(detail.key).toBe('pranje_vozila');
    expect(detail.status).toBe('DRAFT');
    expect(detail.currentPublishedVersionId).toBeNull();
    expect(detail.versionCount).toBe(1);
    expect(detail.versions[0]?.status).toBe('DRAFT');
    expect(detail.versions[0]?.version).toBe(1);
    expect(detail.versions[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('odbija duplikat ključa', async () => {
    const { service } = build();
    await createWashForm(service);

    const error = await errorOf(() =>
      service.create(
        { key: 'pranje_vozila', name: 'Duplikat', subject: 'TASK', definition: freshWashDefinition() },
        ACTOR,
      ),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.[0]?.path).toEqual(['key']);
  });

  it('nevalidna definicija ne ulazi ni u DRAFT', async () => {
    const { prisma, service } = build();

    const error = await errorOf(() =>
      service.create(
        {
          key: 'neispravna_forma',
          name: 'Neispravna',
          subject: 'TASK',
          definition: { $schema: 'vfm-form/1', meta: { title: 'X', subject: 'TASK' }, sections: [] },
        },
        ACTOR,
      ),
    );

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect(error.httpStatus).toBe(422);
    expect(prisma.schemas.size).toBe(0);
    expect(prisma.versions.size).toBe(0);
  });
});

describe('FormSchemasService — verzije', () => {
  it('kopira postojeću verziju u novi DRAFT s inkrementiranim brojem', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const firstVersionId = detail.versions[0]!.id;

    const created = await service.createVersion(detail.id, { copyFromVersionId: firstVersionId }, ACTOR);

    expect(created.data.version).toBe(2);
    expect(created.data.status).toBe('DRAFT');
    expect((await service.get(detail.id)).versionCount).toBe(2);
  });

  it('objavljena verzija se ne mijenja ni ne briše', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const versionId = detail.versions[0]!.id;
    await service.publish(detail.id, versionId, { changeNote: 'Prva verzija' }, ACTOR);

    const update = await errorOf(() =>
      service.updateVersion(detail.id, versionId, { definition: freshWashDefinition() }),
    );
    expect(update.code).toBe('FORM_VERSION_IMMUTABLE');
    expect(update.httpStatus).toBe(409);

    const remove = await errorOf(() => service.deleteVersion(detail.id, versionId));
    expect(remove.code).toBe('FORM_VERSION_IMMUTABLE');
  });

  it('DRAFT se briše, a broj verzija se smanjuje', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const draft = await service.createVersion(detail.id, { definition: freshWashDefinition() }, ACTOR);

    await service.deleteVersion(detail.id, draft.data.id);

    expect((await service.get(detail.id)).versionCount).toBe(1);
  });
});

describe('FormSchemasService — objava (P9/P10)', () => {
  it('objava bez ispravne bilješke ne prolazi', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const versionId = detail.versions[0]!.id;

    const error = await errorOf(() => service.publish(detail.id, versionId, { changeNote: 'abc' }, ACTOR));

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect(error.details?.some((issue) => issue.message.includes('CHANGE_NOTE_REQUIRED'))).toBe(true);
  });

  it('objava postavlja status, hash, bilješku i aktivnu verziju forme', async () => {
    const { prisma, service } = build();
    const detail = await createWashForm(service);
    const versionId = detail.versions[0]!.id;

    const published = await service.publish(detail.id, versionId, { changeNote: 'Prva verzija' }, ACTOR);

    expect(published.data.status).toBe('PUBLISHED');
    expect(published.data.changeNote).toBe('Prva verzija');
    expect(published.data.publishedAt).not.toBeNull();
    expect(published.data.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(published.before).toEqual({ publishedVersion: null });

    const fresh = await service.get(detail.id);
    expect(fresh.status).toBe('PUBLISHED');
    expect(fresh.currentPublishedVersionId).toBe(versionId);
    expect(fresh.currentPublishedVersion).toBe(1);

    // Registar ključeva je dopunjen tipovima iz objavljene definicije (U-16).
    expect(prisma.fieldKeys.get('washCost')?.dataType).toBe('MONEY');
    expect(prisma.fieldKeys.get('washType')?.dataType).toBe('SINGLE_CHOICE');
    expect(prisma.fieldKeys.get('washCost')?.usedByFormSchemaIds).toEqual([detail.id]);
  });

  it('nova objava povlači prethodnu i postaje aktivna', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const first = detail.versions[0]!.id;
    await service.publish(detail.id, first, { changeNote: 'Prva verzija' }, ACTOR);

    const second = await service.createVersion(detail.id, { definition: freshWashDefinition() }, ACTOR);
    const published = await service.publish(
      detail.id,
      second.data.id,
      { changeNote: 'Druga verzija' },
      ACTOR,
    );

    expect(published.before).toEqual({ publishedVersion: 1 });

    const fresh = await service.get(detail.id);
    expect(fresh.currentPublishedVersion).toBe(2);
    expect(fresh.versions.find((version) => version.id === first)?.status).toBe('RETIRED');
    expect(fresh.versions.find((version) => version.id === first)?.retiredAt).not.toBeNull();

    const active = await service.active({ subject: 'TASK' });
    expect(active.formSchemaVersionId).toBe(second.data.id);
    expect(active.version).toBe(2);
    expect(active.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('odbija objavu kad registar već ima isti fieldKey pod drugim tipom', async () => {
    const { prisma, service } = build();
    const detail = await createWashForm(service);
    const versionId = detail.versions[0]!.id;
    await prisma.fieldKeyRegistry.create({
      data: {
        key: 'washType',
        dataType: 'TEXT',
        unit: null,
        normalizedColumn: null,
        usedByFormSchemaIds: [],
      },
    });

    const error = await errorOf(() =>
      service.publish(detail.id, versionId, { changeNote: 'Prva verzija' }, ACTOR),
    );

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect(error.message).toContain('U-16');
    const fresh = await service.get(detail.id);
    expect(fresh.currentPublishedVersionId).toBeNull();
    expect(fresh.versions[0]?.status).toBe('DRAFT');
  });

  it('konkurentne objave ne ostavljaju više od jedne PUBLISHED verzije', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const first = detail.versions[0]!.id;
    await service.publish(detail.id, first, { changeNote: 'Prva verzija' }, ACTOR);

    const second = await service.createVersion(detail.id, { definition: freshWashDefinition() }, ACTOR);
    const third = await service.createVersion(detail.id, { definition: freshWashDefinition() }, ACTOR);
    const results = await Promise.allSettled([
      service.publish(detail.id, second.data.id, { changeNote: 'Druga verzija' }, ACTOR),
      service.publish(detail.id, third.data.id, { changeNote: 'Treća verzija' }, ACTOR),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const fresh = await service.get(detail.id);
    expect(fresh.versions.filter((version) => version.status === 'PUBLISHED')).toHaveLength(1);
    expect(fresh.currentPublishedVersionId).toBe(
      results[0]?.status === 'fulfilled' ? second.data.id : third.data.id,
    );
  });

  it('povlačenje aktivne verzije bez zamjene je odbijeno', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const versionId = detail.versions[0]!.id;
    await service.publish(detail.id, versionId, { changeNote: 'Prva verzija' }, ACTOR);

    const error = await errorOf(() =>
      service.retire(detail.id, versionId, { changeNote: 'Povlačim' }, ACTOR),
    );

    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect(error.httpStatus).toBe(422);
  });
});

describe('FormSchemasService — aktivna forma i keširanje', () => {
  it('preskače legacy VEHICLE definiciju i bira objavljenu verziju validne šeme', async () => {
    const { prisma, service } = build();
    const valid = await service.create({
      key: 'vehicle-current',
      name: 'Vozilo',
      subject: 'VEHICLE',
      definition: freshVehicleDefinition(),
    });
    await service.publish(valid.data.id, valid.data.versions[0]!.id, { changeNote: 'Validna forma' }, ACTOR);

    const sourceSchema = [...prisma.schemas.values()][0]!;
    const sourceVersion = [...prisma.versions.values()][0]!;
    prisma.schemas.set('legacy-schema', {
      ...sourceSchema,
      id: 'legacy-schema',
      key: 'legacy-vehicle',
      name: 'Legacy vehicle',
      currentPublishedVersionId: 'legacy-version',
      updatedAt: new Date('2026-10-30T12:00:00.000Z'),
    });
    prisma.versions.set('legacy-version', {
      ...sourceVersion,
      id: 'legacy-version',
      formSchemaId: 'legacy-schema',
      definition: { version: 1, fields: [{ name: 'legacy' }] },
    });

    const active = await service.active({ subject: 'VEHICLE' });
    expect(active.formSchemaId).toBe(valid.data.id);
  });

  it('bez objavljene verzije nema aktivne forme', async () => {
    const { service } = build();
    await createWashForm(service);

    const error = await errorOf(() => service.active({ subject: 'TASK' }));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.httpStatus).toBe(404);
  });

  it('specifična forma za tip zadatka ima prednost pred generičkom', async () => {
    const { prisma, service } = build();
    const taskTypeId = '018f0000-0000-7000-8000-0000000000d1';

    // Generička forma (bez tipa zadatka).
    const generic = await createWashForm(service);
    await service.publish(generic.id, generic.versions[0]!.id, { changeNote: 'Generička' }, ACTOR);

    // Specifična forma za tip zadatka.
    const specific = (
      await service.create(
        {
          key: 'pranje_tipa',
          name: 'Pranje (tip)',
          subject: 'TASK',
          taskTypeId,
          definition: freshWashDefinition(),
        },
        ACTOR,
      )
    ).data;
    await service.publish(specific.id, specific.versions[0]!.id, { changeNote: 'Specifična' }, ACTOR);

    prisma.addTaskType({ id: taskTypeId });
    expect((await service.active({ subject: 'TASK', taskTypeId })).formSchemaId).toBe(specific.id);

    // Eksplicitno zadana forma vrste ima prednost pred formom vezanom za vrstu.
    const explicitTypeId = '018f0000-0000-7000-8000-0000000000d2';
    prisma.addTaskType({ id: explicitTypeId, formSchemaId: generic.id });
    expect((await service.active({ subject: 'TASK', taskTypeId: explicitTypeId })).formSchemaId).toBe(
      generic.id,
    );

    // Poznata vrsta bez vlastite forme i nepostojeća vrsta ne padaju na generičku.
    const withoutFormTypeId = '018f0000-0000-7000-8000-0000000000d3';
    prisma.addTaskType({ id: withoutFormTypeId });
    expect(
      (await errorOf(() => service.active({ subject: 'TASK', taskTypeId: withoutFormTypeId }))).code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await errorOf(() =>
          service.active({ subject: 'TASK', taskTypeId: '018f0000-0000-7000-8000-0000000000d9' }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(prisma.schemas.size).toBe(2);
  });

  it('matchesIfNoneMatch prihvata quoted, unquoted, weak i wildcard tag', () => {
    const etag = '"abc123"';

    expect(matchesIfNoneMatch('"abc123"', etag)).toBe(true);
    expect(matchesIfNoneMatch('abc123', etag)).toBe(true);
    expect(matchesIfNoneMatch('W/"abc123"', etag)).toBe(true);
    expect(matchesIfNoneMatch('"xyz", "abc123"', etag)).toBe(true);
    expect(matchesIfNoneMatch('*', etag)).toBe(true);
    expect(matchesIfNoneMatch('"xyz"', etag)).toBe(false);
    expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
  });
});

describe('FormSchemasService — validacija zapisa (P11)', () => {
  it('DRAFT verzija ne prima zapise', async () => {
    const { service } = build();
    const detail = await createWashForm(service);

    const result = await service.validateValues(detail.id, detail.versions[0]!.id, {
      values: VALID_VALUES,
      isNew: true,
    });

    expect(result.versionError).toBe('FORM_VERSION_NOT_PUBLISHED');
    expect(result.errors).toEqual([]);
  });

  it('P11 provjerava dinamički LIST izbor prema trenutnim server vrijednostima', async () => {
    const { prisma, service } = build();
    prisma.formOptionLists.set('WORKSHOP', [
      { code: 'GARAGE_A', label: 'Radionica A', active: true, deletedAt: null, sortOrder: 1 },
    ]);
    const definition = freshWashDefinition();
    const sections = definition.sections as Array<Record<string, unknown>>;
    const fields = sections[0]!.fields as Array<Record<string, unknown>>;
    fields.push({
      key: 'workshop',
      type: 'SINGLE_CHOICE',
      label: 'Radionica',
      order: 5,
      optionsSource: { kind: 'LIST', listCode: 'WORKSHOP' },
    });
    const form = (
      await service.create(
        { key: 'pranje_dinamicno', name: 'Pranje dinamično', subject: 'TASK', definition },
        ACTOR,
      )
    ).data;
    const versionId = form.versions[0]!.id;
    await service.publish(form.id, versionId, { changeNote: 'Objava dinamičkog izbora' }, ACTOR);

    const accepted = await service.validateValues(form.id, versionId, {
      values: { ...VALID_VALUES, workshop: 'GARAGE_A' },
      isNew: true,
    });
    const rejected = await service.validateValues(form.id, versionId, {
      values: { ...VALID_VALUES, workshop: 'NOT_ALLOWED' },
      isNew: true,
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.errors.map((error) => error.code)).toContain('OPTION');
  });

  it('objavljena verzija vraća očišćene vrijednosti, izračunata polja i greške', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const versionId = detail.versions[0]!.id;
    await service.publish(detail.id, versionId, { changeNote: 'Prva verzija' }, ACTOR);

    const ok: FormValidationResponse = await service.validateValues(detail.id, versionId, {
      values: { ...VALID_VALUES, washType: ' FULL ' },
      isNew: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.values['washType']).toBe('FULL');
    expect(ok.computed['costPerMinute']).toBe(300);
    expect(ok.formSchemaVersion).toBe(1);

    const failed = await service.validateValues(detail.id, versionId, {
      values: { washType: 'FULL', nepoznato: 1 },
      isNew: true,
    });
    expect(failed.ok).toBe(false);
    expect(failed.errors.map((error) => error.code)).toContain('UNKNOWN_FIELD');
    expect(failed.errors.map((error) => error.code)).toContain('REQUIRED');
  });
});

describe('FormSchemasService — diff i lista', () => {
  it('diff prikazuje dodana i uklonjena polja između verzija', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    const firstId = detail.versions[0]!.id;

    const changed = JSON.parse(JSON.stringify(freshWashDefinition())) as Record<string, unknown>;
    const sections = changed['sections'] as Array<Record<string, unknown>>;
    const fields = sections[0]!['fields'] as Array<Record<string, unknown>>;
    fields.splice(1, 1);
    fields.push({ key: 'novoPolje', type: 'TEXT', label: 'Novo polje', order: 9 });

    const second = await service.createVersion(detail.id, { definition: changed }, ACTOR);
    const diff = await service.diff(detail.id, firstId, second.data.id);

    expect(diff.from.version).toBe(1);
    expect(diff.to.version).toBe(2);
    expect(diff.addedFields).toEqual(['novoPolje']);
    expect(diff.removedFields).toEqual(['washDurationMin']);
    expect(diff.empty).toBe(false);
  });

  it('lista filtrira po subjektu, statusu i tekstu', async () => {
    const { service } = build();
    const detail = await createWashForm(service);
    await service.create(
      { key: 'druga_forma', name: 'Druga forma', subject: 'VEHICLE', definition: freshWashDefinition() },
      ACTOR,
    );
    await service.publish(detail.id, detail.versions[0]!.id, { changeNote: 'Prva verzija' }, ACTOR);

    expect((await service.list({})).length).toBe(2);
    expect((await service.list({ subject: 'TASK' })).map((form) => form.key)).toEqual(['pranje_vozila']);
    expect((await service.list({ status: 'PUBLISHED' })).map((form) => form.key)).toEqual(['pranje_vozila']);
    expect((await service.list({ status: 'DRAFT' })).map((form) => form.key)).toEqual(['druga_forma']);
    expect((await service.list({ q: 'druga' })).map((form) => form.key)).toEqual(['druga_forma']);
  });
});
