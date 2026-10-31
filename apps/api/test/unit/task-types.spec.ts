/** Vrste zadataka: konfiguracija, zadane forme, zahtjevi završetka i arhiva. */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import {
  createTaskTypeSchema,
  replaceTaskCompletionRequirementsSchema,
  taskTypeDetailSchema,
  taskTypeListQuerySchema,
  taskTypeListResponseSchema,
  updateTaskTypeSchema,
} from '@vfm/shared/schemas';
import { TaskTypesController } from '../../src/modules/task-types/task-types.controller.js';
import { TaskTypesService } from '../../src/modules/task-types/task-types.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const washTypeId = '22222222-2222-4222-8222-222222222222';
const customTypeId = '33333333-3333-4333-8333-333333333333';
const archivedTypeId = '44444444-4444-4444-8444-444444444444';
const genericFormId = '55555555-5555-4555-8555-555555555555';
const genericVersionId = '66666666-6666-4666-8666-666666666666';
const otherFormId = '77777777-7777-4777-8777-777777777777';
const otherVersionId = '88888888-8888-4888-8888-888888888888';

type Row = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return String(a) < String(b) ? -1 : 1;
}

class FakeTaskTypesPrisma {
  readonly types = new Map<string, Row>();
  readonly forms = new Map<string, Row>();
  readonly versions = new Map<string, Row>();
  readonly requirements: Row[] = [];
  readonly calls: string[] = [];
  private sequence = 0;

  constructor() {
    const washDefinition = SEED_FORMS.find((form) => form.key === 'pranje_vozila')!.definition;
    this.forms.set(genericFormId, {
      id: genericFormId,
      key: 'pranje_vozila',
      name: 'Pranje vozila',
      subject: 'TASK',
      taskTypeId: null,
      role: 'ORDER',
      currentPublishedVersionId: genericVersionId,
      deletedAt: null,
    });
    this.versions.set(genericVersionId, {
      id: genericVersionId,
      formSchemaId: genericFormId,
      version: 3,
      definition: clone(washDefinition),
    });

    this.types.set(
      washTypeId,
      this.typeRow({
        id: washTypeId,
        code: 'WASH',
        name: 'Pranje vozila',
        description: 'Vanjsko i unutrašnje pranje',
        requiresOdometer: true,
        requiresPhotos: true,
        formSchemaId: genericFormId,
        sortOrder: 10,
      }),
    );
    this.types.set(
      customTypeId,
      this.typeRow({
        id: customTypeId,
        code: 'CUSTOM',
        name: 'Prilagođeni zadatak',
        description: 'Bez zadanog vozila',
        requiresVehicle: false,
        active: false,
        sortOrder: 20,
      }),
    );
    this.types.set(
      archivedTypeId,
      this.typeRow({
        id: archivedTypeId,
        code: 'OLD_TYPE',
        name: 'Stara vrsta',
        active: false,
        deletedAt: new Date('2026-10-01T10:00:00Z'),
        sortOrder: 1,
      }),
    );

    this.requirements.push(
      {
        id: '99999999-9999-4999-8999-999999999991',
        taskTypeId: washTypeId,
        fieldKey: 'photosAfter',
        required: true,
        stage: 'ON_COMPLETE',
        minPhotos: 1,
      },
      {
        id: '99999999-9999-4999-8999-999999999992',
        taskTypeId: washTypeId,
        fieldKey: 'washType',
        required: true,
        stage: 'ON_COMPLETE',
        minPhotos: 0,
      },
    );
  }

  private typeRow(patch: Row): Row {
    return {
      description: null,
      iconName: null,
      colorHex: null,
      requiresVehicle: true,
      requiresOdometer: false,
      requiresPhotos: false,
      defaultPriority: 'NORMAL',
      defaultAssignMode: 'OPEN_CLAIM',
      allowMultipleClaimants: false,
      dueOffsetHours: null,
      active: true,
      sortOrder: 100,
      createdById: null,
      createdAt: new Date('2026-10-01T08:00:00Z'),
      updatedAt: new Date('2026-10-01T08:00:00Z'),
      deletedAt: null,
      ...patch,
      orderFormSchemaId: patch.orderFormSchemaId ?? patch.formSchemaId ?? null,
      realizationFormSchemaId: patch.realizationFormSchemaId ?? null,
      formSchemaId: patch.orderFormSchemaId ?? patch.formSchemaId ?? null,
    };
  }

  addForm(form: Row, definition?: unknown): void {
    this.forms.set(String(form.id), {
      key: `forma-${this.forms.size}`,
      name: 'Dodatna forma',
      subject: 'TASK',
      taskTypeId: null,
      role: 'ORDER',
      currentPublishedVersionId: null,
      deletedAt: null,
      ...form,
    });
    const versionId = form.currentPublishedVersionId;
    if (typeof versionId === 'string') {
      this.versions.set(versionId, {
        id: versionId,
        formSchemaId: String(form.id),
        version: 1,
        definition: clone(definition ?? SEED_FORMS.find((item) => item.key === 'pranje_vozila')!.definition),
      });
    }
  }

  private sortedRequirements(taskTypeId: string): Row[] {
    return this.requirements
      .filter((row) => row.taskTypeId === taskTypeId)
      .sort((a, b) => compare(a.stage, b.stage) || compare(a.fieldKey, b.fieldKey) || compare(a.id, b.id))
      .map(clone);
  }

  private enrich(row: Row, detail = false): Row {
    const orderId =
      row.orderFormSchemaId !== undefined ? row.orderFormSchemaId : row.formSchemaId;
    const form = orderId ? this.forms.get(String(orderId)) : null;
    const version = form?.currentPublishedVersionId
      ? this.versions.get(String(form.currentPublishedVersionId))
      : null;
    const realization = row.realizationFormSchemaId
      ? this.forms.get(String(row.realizationFormSchemaId))
      : null;
    const formRel = form
      ? {
          key: form.key,
          name: form.name,
          currentPublishedVersion: version ? { version: version.version } : null,
        }
      : null;
    return {
      ...clone(row),
      orderFormSchemaId: (orderId as string | null) ?? null,
      realizationFormSchemaId: row.realizationFormSchemaId ?? null,
      formSchemaId: orderId ?? null,
      orderFormSchema: formRel,
      realizationFormSchema: realization
        ? { key: realization.key, name: realization.name, currentPublishedVersion: null }
        : null,
      formSchema: formRel,
      _count: { completionRequirements: this.sortedRequirements(String(row.id)).length },
      ...(detail ? { completionRequirements: this.sortedRequirements(String(row.id)) } : {}),
    };
  }

  private matches(row: Row, where: Row = {}): boolean {
    if (where.deletedAt === null && row.deletedAt !== null) return false;
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.active !== undefined && row.active !== where.active) return false;
    if (where.requiresVehicle !== undefined && row.requiresVehicle !== where.requiresVehicle) return false;
    if (Array.isArray(where.OR)) {
      const hit = where.OR.some((condition) => {
        const [field, filter] = Object.entries(condition as Row)[0] ?? [];
        if (!field || typeof filter !== 'object' || filter === null) return false;
        const contains = (filter as Row).contains;
        return String(row[field] ?? '')
          .toLowerCase()
          .includes(String(contains).toLowerCase());
      });
      if (!hit) return false;
    }
    return true;
  }

  private sort(rows: Row[], orderBy: Row[] = []): Row[] {
    return [...rows].sort((a, b) => {
      for (const criterion of orderBy) {
        const [field, direction] = Object.entries(criterion)[0] ?? [];
        if (!field) continue;
        const result = compare(a[field], b[field]);
        if (result !== 0) return direction === 'desc' ? -result : result;
      }
      return 0;
    });
  }

  readonly taskType = {
    count: async (args: { where?: Row } = {}) =>
      [...this.types.values()].filter((row) => this.matches(row, args.where)).length,
    findMany: async (
      args: { where?: Row; orderBy?: Row[]; skip?: number; take?: number; select?: Row } = {},
    ) => {
      const rows = this.sort(
        [...this.types.values()].filter((row) => this.matches(row, args.where)),
        args.orderBy,
      );
      const skip = args.skip ?? 0;
      return rows.slice(skip, skip + (args.take ?? rows.length)).map((row) => this.enrich(row));
    },
    findFirst: async (args: { where?: Row; select?: Row } = {}) => {
      const row = [...this.types.values()].find((candidate) => this.matches(candidate, args.where));
      return row ? this.enrich(row, Boolean(args.select?.completionRequirements)) : null;
    },
    findUnique: async (args: { where: { id?: string; code?: string } }) => {
      const row = [...this.types.values()].find(
        (candidate) =>
          (args.where.id === undefined || candidate.id === args.where.id) &&
          (args.where.code === undefined || candidate.code === args.where.code),
      );
      return row ? clone(row) : null;
    },
    create: async (args: { data: Row }) => {
      this.calls.push('taskType.create');
      const now = new Date(Date.UTC(2026, 9, 21, 12, 0, this.sequence++));
      const row = this.typeRow({ ...args.data, createdAt: now, updatedAt: now });
      this.types.set(String(row.id), row);
      return this.enrich(row);
    },
    update: async (args: { where: { id: string }; data: Row; select?: Row }) => {
      this.calls.push('taskType.update');
      const row = this.types.get(args.where.id);
      if (!row) throw new Error('Fake: vrsta ne postoji.');
      Object.assign(row, args.data, {
        updatedAt: new Date(Date.UTC(2026, 9, 21, 13, 0, this.sequence++)),
      });
      return this.enrich(row, Boolean(args.select?.completionRequirements));
    },
  };

  readonly formSchema = {
    findFirst: async (args: { where?: Row } = {}) => {
      const where = args.where ?? {};
      const row = [...this.forms.values()].find((candidate) => {
        if (where.deletedAt === null && candidate.deletedAt !== null) return false;
        if (where.id !== undefined && candidate.id !== where.id) return false;
        if (where.subject !== undefined && candidate.subject !== where.subject) return false;
        if (where.taskTypeId !== undefined && candidate.taskTypeId !== where.taskTypeId) return false;
        const current = where.currentPublishedVersionId as Row | undefined;
        if (current?.not === null && candidate.currentPublishedVersionId === null) return false;
        return true;
      });
      return row ? clone(row) : null;
    },
  };

  readonly formSchemaVersion = {
    findUnique: async (args: { where: { id: string } }) => {
      const row = this.versions.get(args.where.id);
      return row ? clone(row) : null;
    },
  };

  readonly taskCompletionRequirement = {
    findMany: async (args: { where?: { taskTypeId?: string } } = {}) =>
      this.sortedRequirements(String(args.where?.taskTypeId)),
    deleteMany: async (args: { where: { taskTypeId: string } }) => {
      this.calls.push('requirements.deleteMany');
      const before = this.requirements.length;
      for (let index = this.requirements.length - 1; index >= 0; index--) {
        if (this.requirements[index]?.taskTypeId === args.where.taskTypeId)
          this.requirements.splice(index, 1);
      }
      return { count: before - this.requirements.length };
    },
    createMany: async (args: { data: Row[] }) => {
      this.calls.push('requirements.createMany');
      this.requirements.push(...clone(args.data));
      return { count: args.data.length };
    },
  };

  async $transaction<T>(callback: (tx: this) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    return callback(this);
  }

  async $queryRaw(_strings: TemplateStringsArray, id: unknown): Promise<Row[]> {
    this.calls.push('lock');
    const row = this.types.get(String(id));
    return row ? [{ id: row.id, deletedAt: row.deletedAt }] : [];
  }
}

function setup() {
  const fake = new FakeTaskTypesPrisma();
  const service = new TaskTypesService(fake as unknown as PrismaService);
  return { fake, service };
}

describe('Vrste zadataka', () => {
  it('lista isključuje arhivirane, podrazumijevano sortira po redoslijedu i serijalizuje formu', async () => {
    const { service } = setup();
    const result = await service.list(taskTypeListQuerySchema.parse({ pageSize: 1 }));

    expect(taskTypeListResponseSchema.parse(result)).toMatchObject({
      total: 2,
      totalPages: 2,
      items: [
        {
          id: washTypeId,
          code: 'WASH',
          formSchemaKey: 'pranje_vozila',
          formSchemaVersion: 3,
          completionRequirementCount: 2,
        },
      ],
    });
  });

  it('lista primjenjuje q, activeOnly i requiresVehicle, a nepoznat sort ne ide u upit', async () => {
    const { service } = setup();

    const filtered = await service.list(
      taskTypeListQuerySchema.parse({
        q: 'prilagođeni',
        activeOnly: 'false',
        requiresVehicle: 'false',
        sortBy: 'nepoznato',
      }),
    );
    expect(filtered.items.map((item) => item.code)).toEqual(['CUSTOM']);

    const active = await service.list(taskTypeListQuerySchema.parse({ activeOnly: 'true' }));
    expect(active.items.map((item) => item.code)).toEqual(['WASH']);
  });

  it('detalj vraća zahtjeve sortirane po fazi i ključu; arhiviran zapis je 404', async () => {
    const { service } = setup();
    const detail = await service.get(washTypeId);

    expect(taskTypeDetailSchema.parse(detail).completionRequirements.map((row) => row.fieldKey)).toEqual([
      'photosAfter',
      'washType',
    ]);
    await expect(service.get(archivedTypeId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('kreira vrstu s DTO defaultima, velikim slovima boje i akterom', async () => {
    const { fake, service } = setup();
    const input = createTaskTypeSchema.parse({
      code: 'DELIVERY',
      name: 'Dostava dokumentacije',
      colorHex: '#abc123',
      formSchemaId: genericFormId,
    });

    const result = await service.create(input, actorId);

    expect(result.data).toMatchObject({
      code: 'DELIVERY',
      colorHex: '#ABC123',
      requiresVehicle: true,
      requiresOdometer: false,
      defaultPriority: 'NORMAL',
      defaultAssignMode: 'OPEN_CLAIM',
      active: true,
      sortOrder: 100,
      completionRequirements: [],
    });
    expect(fake.types.get(result.data.id)).toMatchObject({ createdById: actorId });
    expect(result.after).toMatchObject({ id: result.data.id, code: 'DELIVERY' });
  });

  it('kod arhivirane vrste i konkurentni P2002 vraćaju DUPLICATE_ENTRY', async () => {
    const { fake, service } = setup();
    await expect(
      service.create(createTaskTypeSchema.parse({ code: 'OLD_TYPE', name: 'Ponovna stara vrsta' })),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });

    fake.taskType.create = async () => {
      throw Object.assign(new Error('P2002'), { code: 'P2002' });
    };
    await expect(
      service.create(createTaskTypeSchema.parse({ code: 'NEW_TYPE', name: 'Nova vrsta' })),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
  });

  it('odbija nepostojeću, tuđu, pogrešnog subjecta i neobjavljenu zadanu formu', async () => {
    const { fake, service } = setup();
    const missing = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      service.create(createTaskTypeSchema.parse({ code: 'A_TEST', name: 'Test A', formSchemaId: missing })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    fake.addForm({
      id: otherFormId,
      key: 'vozilo_forma',
      subject: 'VEHICLE',
      currentPublishedVersionId: otherVersionId,
    });
    await expect(
      service.create(
        createTaskTypeSchema.parse({ code: 'B_TEST', name: 'Test B', formSchemaId: otherFormId }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const other = fake.forms.get(otherFormId)!;
    other.subject = 'TASK';
    other.taskTypeId = customTypeId;
    await expect(
      service.create(
        createTaskTypeSchema.parse({ code: 'C_TEST', name: 'Test C', formSchemaId: otherFormId }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    other.taskTypeId = null;
    other.role = 'ORDER';
    other.currentPublishedVersionId = null;
    await expect(
      service.create(
        createTaskTypeSchema.parse({ code: 'D_TEST', name: 'Test D', formSchemaId: otherFormId }),
      ),
    ).rejects.toMatchObject({ code: 'FORM_VERSION_NOT_PUBLISHED' });
  });

  it('PATCH provjerava efektivnu vezu vozila i kilometraže te null briše opciona polja', async () => {
    const { fake, service } = setup();

    await expect(
      service.update(washTypeId, updateTaskTypeSchema.parse({ requiresVehicle: false })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.types.get(washTypeId)).toMatchObject({ requiresVehicle: true, requiresOdometer: true });

    const result = await service.update(
      washTypeId,
      updateTaskTypeSchema.parse({
        requiresVehicle: false,
        requiresOdometer: false,
        description: null,
        formSchemaId: null,
      }),
    );
    expect(result.data).toMatchObject({
      requiresVehicle: false,
      requiresOdometer: false,
      description: null,
      formSchemaId: null,
    });
    expect(result.before).toMatchObject({ code: 'WASH', formSchemaId: genericFormId });
  });

  it('promjena forme je blokirana dok postojeći zahtjevi ne odgovaraju novoj definiciji', async () => {
    const { fake, service } = setup();
    const definition = clone(SEED_FORMS.find((form) => form.key === 'pranje_vozila')!.definition) as {
      sections: Array<{ fields: Array<{ key: string }> }>;
    };
    for (const section of definition.sections) {
      section.fields = section.fields.filter((field) => field.key !== 'photosAfter');
    }
    fake.addForm(
      { id: otherFormId, key: 'druga_task_forma', currentPublishedVersionId: otherVersionId },
      definition,
    );

    await expect(
      service.update(washTypeId, updateTaskTypeSchema.parse({ formSchemaId: otherFormId })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.types.get(washTypeId)).toMatchObject({ formSchemaId: genericFormId });
  });

  it('arhiviranje zaključava red, deaktivira vrstu i drugi pokušaj vraća 404', async () => {
    const { fake, service } = setup();
    const result = await service.archive(washTypeId, { reason: 'Vrsta se više ne koristi' }, actorId);

    expect(fake.calls.slice(0, 2)).toEqual(['transaction', 'lock']);
    expect(result.data).toMatchObject({ id: washTypeId, code: 'WASH' });
    expect(result.after).toMatchObject({ active: false, deletedById: actorId });
    expect(fake.types.get(washTypeId)).toMatchObject({ active: false });
    expect(fake.types.get(washTypeId)?.deletedAt).toBeInstanceOf(Date);
    await expect(service.archive(washTypeId, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('zahtjevi se atomski zamjenjuju i validiraju prema objavljenoj formi', async () => {
    const { fake, service } = setup();
    const input = replaceTaskCompletionRequirementsSchema.parse({
      requirements: [
        { fieldKey: 'photosAfter', minPhotos: 2 },
        { fieldKey: 'washDurationMin', required: false, stage: 'ON_COMPLETE' },
      ],
    });

    const result = await service.replaceCompletionRequirements(washTypeId, input);
    expect(result.data.requirements).toEqual([
      expect.objectContaining({ fieldKey: 'photosAfter', minPhotos: 2, required: true }),
      expect.objectContaining({ fieldKey: 'washDurationMin', required: false, minPhotos: 0 }),
    ]);

    await expect(
      service.replaceCompletionRequirements(
        washTypeId,
        replaceTaskCompletionRequirementsSchema.parse({
          requirements: [{ fieldKey: 'nePostoji' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.replaceCompletionRequirements(
        washTypeId,
        replaceTaskCompletionRequirementsSchema.parse({
          requirements: [{ fieldKey: 'washType', minPhotos: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.requirements.filter((row) => row.taskTypeId === washTypeId)).toHaveLength(2);
  });

  it('prazna lista zahtjeva briše postojeće, a pregled arhivirane vrste je 404', async () => {
    const { service } = setup();
    const result = await service.replaceCompletionRequirements(washTypeId, { requirements: [] });
    expect(result.data.requirements).toEqual([]);
    await expect(service.listCompletionRequirements(archivedTypeId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('strict DTO-i odbijaju neispravan kod, boju, nepoznata polja i duple zahtjeve', () => {
    expect(createTaskTypeSchema.safeParse({ code: 'niska_slova', name: 'Test' }).success).toBe(false);
    expect(createTaskTypeSchema.safeParse({ code: 'TEST', name: 'Test', colorHex: 'plava' }).success).toBe(
      false,
    );
    expect(
      createTaskTypeSchema.safeParse({
        code: 'TEST',
        name: 'Test',
        requiresVehicle: false,
        requiresOdometer: true,
      }).success,
    ).toBe(false);
    expect(createTaskTypeSchema.safeParse({ code: 'TEST', name: 'Test', active: false }).success).toBe(false);
    expect(updateTaskTypeSchema.safeParse({}).success).toBe(false);
    expect(updateTaskTypeSchema.safeParse({ code: 'NOVI_KOD' }).success).toBe(false);
    expect(
      replaceTaskCompletionRequirementsSchema.safeParse({
        requirements: [{ fieldKey: 'photosAfter' }, { fieldKey: 'photosAfter' }],
      }).success,
    ).toBe(false);
    expect(
      replaceTaskCompletionRequirementsSchema.safeParse({
        requirements: [{ fieldKey: 'photosAfter', required: false, minPhotos: 1 }],
      }).success,
    ).toBe(false);
  });

  it('kontroler ima odvojene permisije, audit i HTTP statuse po ruti', () => {
    const permissions = (method: unknown): unknown =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).permissions;

    expect(permissions(TaskTypesController.prototype.list)).toEqual(['task_type:view']);
    expect(permissions(TaskTypesController.prototype.get)).toEqual(['task_type:view']);
    expect(permissions(TaskTypesController.prototype.create)).toEqual(['task_type:create']);
    expect(permissions(TaskTypesController.prototype.update)).toEqual(['task_type:update']);
    expect(permissions(TaskTypesController.prototype.archive)).toEqual(['task_type:archive']);
    expect(permissions(TaskTypesController.prototype.listCompletionRequirements)).toEqual(['task_type:view']);
    expect(permissions(TaskTypesController.prototype.replaceCompletionRequirements)).toEqual([
      'task_type:update',
    ]);

    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TaskTypesController.prototype.create)).toBe(201);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TaskTypesController.prototype.archive)).toBe(204);
    expect(Reflect.getMetadata('vfm:audit', TaskTypesController.prototype.archive)).toMatchObject({
      action: 'ARCHIVE',
      severity: 'WARN',
      resource: 'TaskType',
    });
  });
});
