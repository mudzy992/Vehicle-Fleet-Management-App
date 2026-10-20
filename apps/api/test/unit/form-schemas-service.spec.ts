/**
 * `FormSchemasService` — životni ciklus verzija forme (docs/04 §8, P9/P10/P11).
 *
 * Provjerava ono što bi u produkciji skupo koštalo:
 * - nevalidna definicija ne ulazi ni u `DRAFT`;
 * - `PUBLISHED`/`RETIRED` se ne mijenjaju (`FORM_VERSION_IMMUTABLE`);
 * - objava je atomska: stara verzija → `RETIRED`, nova → `PUBLISHED`, forma
 *   pokazuje na novu, registar ključeva se dopunjuje;
 * - `active` vraća tačno jednu aktivnu verziju (i fallback na generičku formu);
 * - `validateValues` odbija `DRAFT` i vraća greške po polju za objavljenu formu.
 */
import { describe, expect, it } from 'vitest';
import type { FormValidationResponse } from '@vfm/shared/schemas';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import { matchesIfNoneMatch } from '../../src/modules/form-schemas/form-schemas.controller.js';
import { FakeFormPrisma, asPrisma } from '../helpers/form-schemas-fake.js';

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

const VALID_VALUES = {
  washType: 'FULL',
  washDurationMin: 30,
  washCost: { amount: 9000, currency: 'BAM' },
  photosAfter: ['018f0000-0000-7000-8000-0000000000f1'],
};

describe('FormSchemasService — kreiranje', () => {
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

    expect((await service.active({ subject: 'TASK', taskTypeId })).formSchemaId).toBe(specific.id);
    // Nepostojeći tip zadatka pada na generičku formu.
    expect(
      (await service.active({ subject: 'TASK', taskTypeId: '018f0000-0000-7000-8000-0000000000d9' }))
        .formSchemaId,
    ).toBe(generic.id);
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
