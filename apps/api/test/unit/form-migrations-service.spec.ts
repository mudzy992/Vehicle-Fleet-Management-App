/**
 * `FormMigrationsService` — P12: eksplicitna, auditovana i povrativa migracija.
 *
 * Provjerava scenario iz `docs/09` (P12): preview (before/after, summary) →
 * apply (promijenjen `formSchemaVersionId`, sačuvan `before`) → rollback (vraćeno
 * originalno stanje), uz pravilo da zapisi koji ne prolaze novu verziju ostaju
 * na staroj (`skipped`), nikad se ne gube.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import { FormMigrationsController } from '../../src/modules/form-migrations/form-migrations.controller.js';
import {
  FormMigrationsService,
  MIGRATION_BATCH_SIZE,
} from '../../src/modules/form-migrations/form-migrations.service.js';
import { FakeFormPrisma, asPrisma } from '../helpers/form-schemas-fake.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const ACTOR = '018f0000-0000-7000-8000-0000000000aa';

function baseDefinition(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: { title: 'Servis', subject: 'TASK' },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovno',
        order: 1,
        fields: [
          {
            key: 'opis',
            type: 'TEXT',
            label: 'Opis',
            required: true,
            order: 1,
            validation: { maxLength: 200 },
          },
          { key: 'km', type: 'INTEGER', label: 'Kilometraža', order: 2, validation: { min: 0 } },
        ],
      },
    ],
    normalizedName: [{ fieldKey: 'km', column: 'odometerKm', transform: 'TO_INT' }],
  };
}

function nextDefinition(): Record<string, unknown> {
  const definition = baseDefinition();
  const sections = definition['sections'] as Array<Record<string, unknown>>;
  const fields = sections[0]!['fields'] as Array<Record<string, unknown>>;
  fields.push({ key: 'radionica', type: 'TEXT', label: 'Radionica', required: true, order: 3 });
  return definition;
}

/** Forma s dvije objavljene verzije (v1 `RETIRED`, v2 `PUBLISHED`). */
async function publishedForm() {
  const prisma = new FakeFormPrisma();
  const schemas = new FormSchemasService(asPrisma(prisma));
  const migrations = new FormMigrationsService(asPrisma(prisma));

  const detail = (
    await schemas.create(
      { key: 'servis_vozila', name: 'Servis', subject: 'TASK', definition: baseDefinition() },
      ACTOR,
    )
  ).data;
  const v1 = detail.versions[0]!.id;
  await schemas.publish(detail.id, v1, { changeNote: 'Prva verzija' }, ACTOR);

  const second = await schemas.createVersion(detail.id, { definition: nextDefinition() }, ACTOR);
  await schemas.publish(detail.id, second.data.id, { changeNote: 'Dodana radionica' }, ACTOR);

  return { prisma, migrations, formSchemaId: detail.id, v1, v2: second.data.id };
}

function addTask(
  prisma: FakeFormPrisma,
  formSchemaId: string,
  versionId: string,
  id: string,
  formData: Record<string, unknown>,
): void {
  prisma.addRecord('task', {
    id,
    formSchemaId,
    formSchemaVersionId: versionId,
    formData,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    odometerKm: null,
  });
}

const TASK_A = '018f0000-0000-7000-8000-0000000000a1';
const TASK_B = '018f0000-0000-7000-8000-0000000000a2';
const TASK_C = '018f0000-0000-7000-8000-0000000000a3';

describe('FormMigrationsService — kreiranje joba', () => {
  it('zahtijeva objavljenu ciljnu verziju i objavljenu izvornu', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    const schemas = new FormSchemasService(asPrisma(prisma));

    // Ciljna verzija mora biti PUBLISHED.
    const draft = await schemas.createVersion(formSchemaId, { definition: nextDefinition() }, ACTOR);
    const error = await errorOf(() =>
      migrations.create({
        formSchemaId,
        fromVersionId: v2,
        toVersionId: draft.data.id,
        targetEntityType: 'TASK',
      }),
    );
    expect(error.code).toBe('FORM_VERSION_NOT_PUBLISHED');

    // Ispravan par prolazi; job je PENDING i ne dira zapise.
    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    expect(job.status).toBe('PENDING');
    expect(job.requestedById).toBe(ACTOR);
    expect(prisma.migrationItems.size).toBe(0);
  });

  it('odbija verzije iz druge forme', async () => {
    const { prisma, migrations, formSchemaId, v1 } = await publishedForm();
    const schemas = new FormSchemasService(asPrisma(prisma));
    const other = (
      await schemas.create(
        { key: 'druga_forma', name: 'Druga', subject: 'TASK', definition: baseDefinition() },
        ACTOR,
      )
    ).data;
    const otherVersion = other.versions[0]!.id;
    await schemas.publish(other.id, otherVersion, { changeNote: 'Prva verzija' }, ACTOR);

    const error = await errorOf(() =>
      migrations.create({
        formSchemaId,
        fromVersionId: v1,
        toVersionId: otherVersion,
        targetEntityType: 'TASK',
      }),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(error.httpStatus).toBe(404);
  });
});

describe('FormMigrationsService — preview', () => {
  it('računa summary i vraća uzorak s before/after', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'Mali servis', km: 120000, radionica: 'Vulkanizer' });
    addTask(prisma, formSchemaId, v1, TASK_B, { opis: 'Veliki servis', km: 150000 });
    addTask(prisma, formSchemaId, v1, TASK_C, { opis: '', km: 10 });

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    const preview = await migrations.preview(job.id);

    expect(preview.status).toBe('PREVIEW');
    expect(preview.summary).toEqual({ total: 3, ok: 1, failed: 2, skipped: 0 });
    expect(preview.items).toHaveLength(3);

    const ok = preview.items.find((item) => item.entityId === TASK_A);
    expect(ok?.status).toBe('OK');
    expect(ok?.after).toMatchObject({ opis: 'Mali servis', km: 120000, radionica: 'Vulkanizer' });
    expect(ok?.before).toMatchObject({ opis: 'Mali servis' });

    const missingField = preview.items.find((item) => item.entityId === TASK_B);
    expect(missingField?.status).toBe('ERROR');
    expect(missingField?.errors.map((error) => error.code)).toContain('REQUIRED');
    expect(missingField?.after).toBeNull();

    // Preview ne mijenja zapise.
    expect(prisma.records.get('task')?.every((row) => row.formSchemaVersionId === v1)).toBe(true);
  });

  it('poštuje eksplicitan izbor zapisa', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', radionica: 'X' });
    addTask(prisma, formSchemaId, v1, TASK_B, { opis: 'B', radionica: 'Y' });

    const job = await migrations.create(
      {
        formSchemaId,
        fromVersionId: v1,
        toVersionId: v2,
        targetEntityType: 'TASK',
        entityIds: [TASK_B],
      },
      ACTOR,
    );
    const preview = await migrations.preview(job.id);

    expect(preview.summary.total).toBe(1);
    expect(preview.items[0]?.entityId).toBe(TASK_B);
  });
});

describe('FormMigrationsService — apply i rollback', () => {
  it('primjenjuje prolazne zapise, preskače ostale i čuva before snapshot', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', km: 100, radionica: 'X' });
    addTask(prisma, formSchemaId, v1, TASK_B, { opis: 'B', km: 200 });

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);
    const applied = await migrations.apply(job.id, { changeNote: 'Migracija na v2' });

    expect(applied.status).toBe('COMPLETED');
    expect(applied.summary).toEqual({ total: 2, ok: 1, failed: 1, skipped: 1 });

    const tasks = prisma.records.get('task') ?? [];
    const migrated = tasks.find((row) => row.id === TASK_A);
    expect(migrated?.formSchemaVersionId).toBe(v2);
    expect(migrated?.formData).toMatchObject({ opis: 'A', radionica: 'X' });
    // Normalizovana kolona se popunjava iz `normalizedName`.
    expect(migrated?.['odometerKm']).toBe(100);

    // Neprolazni zapis ostaje na staroj verziji i ima `SKIPPED` stavku.
    const kept = tasks.find((row) => row.id === TASK_B);
    expect(kept?.formSchemaVersionId).toBe(v1);
    expect([...prisma.migrationItems.values()].find((item) => item.entityId === TASK_B)?.status).toBe(
      'SKIPPED',
    );

    // `before` čuva i vrijednost normalizovane kolone za tačan rollback.
    const item = [...prisma.migrationItems.values()].find((entry) => entry.entityId === TASK_A);
    expect(item?.before).toMatchObject({
      formSchemaVersionId: v1,
      normalized: { odometerKm: null },
    });
  });

  it('ne prepisuje zapis koji se promijeni između čitanja i primjene', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'Prije', km: 100, radionica: 'X' });
    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);
    prisma.beforeNextRecordUpdateMany = () => {
      const row = (prisma.records.get('task') ?? []).find((record) => record.id === TASK_A)!;
      row['version'] = 1;
      row.formData = { opis: 'Izmijenjeno korisnikom', km: 110, radionica: 'X' };
    };

    const applied = await migrations.apply(job.id, { changeNote: 'Migracija na v2' });
    const row = (prisma.records.get('task') ?? []).find((record) => record.id === TASK_A);
    const item = [...prisma.migrationItems.values()].find((entry) => entry.entityId === TASK_A);

    expect(applied.summary).toEqual({ total: 1, ok: 0, failed: 1, skipped: 1 });
    expect(row?.formSchemaVersionId).toBe(v1);
    expect(row?.formData).toEqual({ opis: 'Izmijenjeno korisnikom', km: 110, radionica: 'X' });
    expect(item?.status).toBe('SKIPPED');
    expect(item?.error).toContain('promijenio tokom apply-a');
  });

  it('apply traži preview stanje i bilješku', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', radionica: 'X' });

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    const missingPreview = await errorOf(() => migrations.apply(job.id, { changeNote: 'Bez preview-a' }));
    expect(missingPreview.code).toBe('VALIDATION_ERROR');
    expect((await migrations.get(job.id)).status).toBe('PENDING');

    const completed = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(completed.id);
    const shortNote = await errorOf(() => migrations.apply(completed.id, { changeNote: 'x' }));
    expect(shortNote.httpStatus).toBe(400);
  });

  it('rollback vraća formData i verziju, te označi stavke', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', km: 100, radionica: 'X' });

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);
    await migrations.apply(job.id, { changeNote: 'Migracija na v2' });

    await migrations.rollback(job.id, { changeNote: 'Vraćam na v1' });

    const task = (prisma.records.get('task') ?? []).find((row) => row.id === TASK_A);
    expect(task?.formSchemaVersionId).toBe(v1);
    expect(task?.formData).toMatchObject({ opis: 'A', km: 100, radionica: 'X' });
    expect(task?.['odometerKm']).toBeNull();

    const item = [...prisma.migrationItems.values()].find((entry) => entry.entityId === TASK_A);
    expect(item?.status).toBe('ROLLED_BACK');

    const jobRow = await migrations.get(job.id);
    expect(jobRow.status).toBe('ROLLED_BACK');
    expect(jobRow.notes).toBe('Vraćam na v1');
  });

  it('djelimični rollback ne zatvara job dok postoje primijenjene stavke', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', km: 100, radionica: 'X' });
    addTask(prisma, formSchemaId, v1, TASK_B, { opis: 'B', km: 200, radionica: 'X' });

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);
    await migrations.apply(job.id, { changeNote: 'Migracija na v2' });

    await migrations.rollback(job.id, { changeNote: 'Vraćam prvi zapis', entityIds: [TASK_A] });
    expect((await migrations.get(job.id)).status).toBe('COMPLETED');
    expect((prisma.records.get('task') ?? []).find((row) => row.id === TASK_A)?.formSchemaVersionId).toBe(v1);
    expect((prisma.records.get('task') ?? []).find((row) => row.id === TASK_B)?.formSchemaVersionId).toBe(v2);

    await migrations.rollback(job.id, { changeNote: 'Vraćam preostali zapis' });
    expect((await migrations.get(job.id)).status).toBe('ROLLED_BACK');
    expect((prisma.records.get('task') ?? []).find((row) => row.id === TASK_B)?.formSchemaVersionId).toBe(v1);
  });

  it('greška tokom apply označi job FAILED radi sigurnog rollback-a', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', km: 100, radionica: 'X' });
    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);
    prisma.beforeNextRecordUpdateMany = () => {
      throw new Error('Simulirana greška baze');
    };

    await expect(migrations.apply(job.id, { changeNote: 'Migracija na v2' })).rejects.toThrow(
      'Simulirana greška baze',
    );
    const failed = await migrations.get(job.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.notes).toContain('Apply nije dovršen');
  });

  it('konkurentni apply iste migracije prihvata samo jednom', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    addTask(prisma, formSchemaId, v1, TASK_A, { opis: 'A', km: 100, radionica: 'X' });
    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);

    const results = await Promise.allSettled([
      migrations.apply(job.id, { changeNote: 'Migracija 1' }),
      migrations.apply(job.id, { changeNote: 'Migracija 2' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await migrations.get(job.id)).summary?.ok).toBe(1);
    expect(prisma.migrationItems.size).toBe(1);
  });

  it('rollback samo za završenu migraciju', async () => {
    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    void prisma;

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );

    const error = await errorOf(() => migrations.rollback(job.id, { changeNote: 'Prerano' }));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('radi u batch-evima od 500 zapisa', async () => {
    expect(MIGRATION_BATCH_SIZE).toBe(500);

    const { prisma, migrations, formSchemaId, v1, v2 } = await publishedForm();
    for (let index = 0; index < 12; index += 1) {
      const id = `018f0000-0000-7000-8000-0000000001${index.toString().padStart(2, '0')}`;
      addTask(prisma, formSchemaId, v1, id, { opis: `Zadatak ${index}`, radionica: 'X' });
    }

    const job = await migrations.create(
      { formSchemaId, fromVersionId: v1, toVersionId: v2, targetEntityType: 'TASK' },
      ACTOR,
    );
    await migrations.preview(job.id);
    const applied = await migrations.apply(job.id, { changeNote: 'Migracija 12 zapisa' });

    expect(applied.summary?.ok).toBe(12);
    expect((prisma.records.get('task') ?? []).every((row) => row.formSchemaVersionId === v2)).toBe(true);
  });
});

describe('FormMigrationsController — autorizacija čitanja', () => {
  it('štiti listu i uzorak before/after permisijom form:migrate_records', () => {
    for (const handler of [FormMigrationsController.prototype.list, FormMigrationsController.prototype.get]) {
      expect(Reflect.getMetadata('vfm:requiredPermissions', handler).permissions).toEqual([
        'form:migrate_records',
      ]);
    }
  });
});

async function errorOf(action: () => Promise<unknown>): Promise<VfmException> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException.');
}
