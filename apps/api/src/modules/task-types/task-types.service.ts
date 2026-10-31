/**
 * Vrste zadataka i zahtjevi završetka (Faza 5, docs/07 §2.10).
 *
 * Vrsta zadatka je konfiguracija budućih zadataka: zadani prioritet i način
 * dodjele, da li zadatak traži vozilo/kilometražu/fotografije, zadana TASK forma
 * i polja koja moraju biti ispunjena pri završetku. Sam zadatak u sljedećoj
 * cjelini snapshotuje tačnu objavljenu verziju forme, pa izmjena vrste ne
 * mijenja historiju već kreiranih zadataka.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ArchiveTaskTypeInput,
  CreateTaskTypeInput,
  ReplaceTaskCompletionRequirementsInput,
  TaskCompletionRequirementInput,
  TaskCompletionRequirementView,
  TaskCompletionRequirementsResponse,
  TaskTypeDetail,
  TaskTypeListQuery,
  TaskTypeListResponse,
  TaskTypeView,
  UpdateTaskTypeInput,
} from '@vfm/shared/schemas';
import { VfmErrors, VfmException } from '../../common/errors/vfm-error.js';
import { detail, parseStoredDefinition } from '../../common/form-record-support.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const TASK_TYPE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  iconName: true,
  colorHex: true,
  requiresVehicle: true,
  requiresOdometer: true,
  requiresPhotos: true,
  defaultPriority: true,
  defaultAssignMode: true,
  allowMultipleClaimants: true,
  dueOffsetHours: true,
  orderFormSchemaId: true,
  realizationFormSchemaId: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TaskTypeSelect;

const COMPLETION_REQUIREMENT_SELECT = {
  id: true,
  taskTypeId: true,
  fieldKey: true,
  required: true,
  stage: true,
  minPhotos: true,
} as const satisfies Prisma.TaskCompletionRequirementSelect;

const FORM_SCHEMA_META = {
  select: {
    key: true,
    name: true,
    currentPublishedVersion: { select: { version: true } },
  },
} as const;

type TaskTypeSelectWithForm = typeof TASK_TYPE_SELECT & {
  orderFormSchema: typeof FORM_SCHEMA_META;
  realizationFormSchema: typeof FORM_SCHEMA_META;
  _count: { select: { completionRequirements: true } };
};

type TaskTypeDetailSelect = TaskTypeSelectWithForm & {
  completionRequirements: {
    select: typeof COMPLETION_REQUIREMENT_SELECT;
    orderBy: [{ stage: 'asc' }, { fieldKey: 'asc' }, { id: 'asc' }];
  };
};

type TaskTypeRow = Prisma.TaskTypeGetPayload<{ select: TaskTypeSelectWithForm }>;
type TaskTypeDetailRow = Prisma.TaskTypeGetPayload<{ select: TaskTypeDetailSelect }>;
type RequirementRow = Prisma.TaskCompletionRequirementGetPayload<{
  select: typeof COMPLETION_REQUIREMENT_SELECT;
}>;
type Tx = Prisma.TransactionClient;
type Client = PrismaService | Tx;

/** Efektivna objavljena TASK forma (jedna uloga) sa mapom polja iz definicije. */
interface EffectiveTaskForm {
  readonly id: string;
  readonly key: string;
  readonly role: 'ORDER' | 'REALIZATION';
  readonly version: number;
  readonly fields: ReadonlyMap<string, string>;
}

function roleLabel(role: 'ORDER' | 'REALIZATION'): string {
  return role === 'ORDER' ? 'NALOG' : 'REALIZACIJA';
}

export interface TaskTypeMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

function taskTypeSelect(): TaskTypeSelectWithForm {
  return {
    ...TASK_TYPE_SELECT,
    orderFormSchema: FORM_SCHEMA_META,
    realizationFormSchema: FORM_SCHEMA_META,
    _count: { select: { completionRequirements: true } },
  };
}

function taskTypeDetailSelect(): TaskTypeDetailSelect {
  return {
    ...taskTypeSelect(),
    completionRequirements: {
      select: COMPLETION_REQUIREMENT_SELECT,
      orderBy: [{ stage: 'asc' }, { fieldKey: 'asc' }, { id: 'asc' }],
    },
  };
}

function serializeRequirement(row: RequirementRow): TaskCompletionRequirementView {
  return {
    id: row.id,
    taskTypeId: row.taskTypeId,
    fieldKey: row.fieldKey,
    required: row.required,
    stage: row.stage,
    minPhotos: row.minPhotos,
  };
}

function serialize(row: TaskTypeRow): TaskTypeView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    iconName: row.iconName,
    colorHex: row.colorHex,
    requiresVehicle: row.requiresVehicle,
    requiresOdometer: row.requiresOdometer,
    requiresPhotos: row.requiresPhotos,
    defaultPriority: row.defaultPriority,
    defaultAssignMode: row.defaultAssignMode,
    allowMultipleClaimants: row.allowMultipleClaimants,
    dueOffsetHours: row.dueOffsetHours,
    orderFormSchemaId: row.orderFormSchemaId,
    orderFormSchemaKey: row.orderFormSchema?.key ?? null,
    orderFormSchemaName: row.orderFormSchema?.name ?? null,
    realizationFormSchemaId: row.realizationFormSchemaId,
    realizationFormSchemaKey: row.realizationFormSchema?.key ?? null,
    realizationFormSchemaName: row.realizationFormSchema?.name ?? null,
    formSchemaId: row.orderFormSchemaId,
    formSchemaKey: row.orderFormSchema?.key ?? null,
    formSchemaName: row.orderFormSchema?.name ?? null,
    formSchemaVersion: row.orderFormSchema?.currentPublishedVersion?.version ?? null,
    active: row.active,
    sortOrder: row.sortOrder,
    completionRequirementCount: row._count.completionRequirements,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function duplicateCodeError(code: string): VfmException {
  return new VfmException('DUPLICATE_ENTRY', `Vrsta zadatka s kodom "${code}" već postoji.`, [
    detail('code', 'Kod mora biti jedinstven, uključujući arhivirane vrste.'),
  ]);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class TaskTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: TaskTypeListQuery): Promise<TaskTypeListResponse> {
    const where: Prisma.TaskTypeWhereInput = { deletedAt: null };
    if (query.activeOnly) where.active = true;
    if (query.requiresVehicle !== undefined) where.requiresVehicle = query.requiresVehicle;
    if (query.q?.trim()) {
      const contains = { contains: query.q.trim(), mode: 'insensitive' as const };
      where.OR = [{ code: contains }, { name: contains }, { description: contains }];
    }

    const allowed = ['sortOrder', 'name', 'code', 'createdAt', 'updatedAt'] as const;
    const sort = allowed.find((key) => key === query.sortBy);
    const orderBy: Prisma.TaskTypeOrderByWithRelationInput[] = sort
      ? [
          { [sort]: query.sortOrder } as Prisma.TaskTypeOrderByWithRelationInput,
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ]
      : [{ sortOrder: 'asc' }, { name: 'asc' }, { code: 'asc' }, { id: 'asc' }];

    const [total, rows] = await Promise.all([
      this.prisma.taskType.count({ where }),
      this.prisma.taskType.findMany({
        where,
        select: taskTypeSelect(),
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(serialize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string): Promise<TaskTypeDetail> {
    const row = await this.loadDetail(this.prisma, id);
    return this.serializeDetail(row);
  }

  async create(input: CreateTaskTypeInput, actorId?: string): Promise<TaskTypeMutation<TaskTypeDetail>> {
    const id = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.taskType.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (existing) throw duplicateCodeError(input.code);

      const orderFormId = input.orderFormSchemaId ?? input.formSchemaId ?? null;
      const realizationFormId = input.realizationFormSchemaId ?? null;
      if (orderFormId) {
        await this.assertAssignableTaskForm(tx, orderFormId, id, 'ORDER');
      }
      if (realizationFormId) {
        await this.assertAssignableTaskForm(tx, realizationFormId, id, 'REALIZATION');
      }

      let row: TaskTypeRow;
      try {
        row = await tx.taskType.create({
          data: {
            id,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            iconName: input.iconName ?? null,
            colorHex: input.colorHex ?? null,
            requiresVehicle: input.requiresVehicle,
            requiresOdometer: input.requiresOdometer,
            requiresPhotos: input.requiresPhotos,
            defaultPriority: input.defaultPriority,
            defaultAssignMode: input.defaultAssignMode,
            allowMultipleClaimants: input.allowMultipleClaimants,
            dueOffsetHours: input.dueOffsetHours ?? null,
            orderFormSchemaId: orderFormId,
            realizationFormSchemaId: realizationFormId,
            active: true,
            sortOrder: input.sortOrder,
            createdById: actorId ?? null,
          },
          select: taskTypeSelect(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateCodeError(input.code);
        throw error;
      }

      const data = { ...serialize(row), completionRequirements: [] };
      return { data, after: { ...data } };
    });
  }

  async update(id: string, input: UpdateTaskTypeInput): Promise<TaskTypeMutation<TaskTypeDetail>> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);

      const orderFormId =
        input.orderFormSchemaId !== undefined
          ? input.orderFormSchemaId
          : input.formSchemaId !== undefined
            ? input.formSchemaId
            : current.orderFormSchemaId;
      const realizationFormId =
        input.realizationFormSchemaId !== undefined
          ? input.realizationFormSchemaId
          : current.realizationFormSchemaId;
      if (orderFormId) {
        await this.assertAssignableTaskForm(tx, orderFormId, id, 'ORDER');
      }
      if (realizationFormId) {
        await this.assertAssignableTaskForm(tx, realizationFormId, id, 'REALIZATION');
      }

      const requiresVehicle = input.requiresVehicle ?? current.requiresVehicle;
      const requiresOdometer = input.requiresOdometer ?? current.requiresOdometer;
      if (requiresOdometer && !requiresVehicle) {
        throw VfmErrors.validationError([
          detail(
            'requiresOdometer',
            'Kilometraža se može zahtijevati samo za vrstu zadatka koja zahtijeva vozilo.',
          ),
        ]);
      }

      // Promjena zadane forme ne smije ostaviti zahtjeve koji pokazuju na
      // polja kojih u novoj objavljenoj definiciji nema. Korisnik prvo ukloni
      // zahtjeve, promijeni formu, pa ih ponovo zada prema novoj definiciji.
      if (
        orderFormId !== current.orderFormSchemaId ||
        realizationFormId !== current.realizationFormSchemaId
      ) {
        await this.assertRequirementsFitForm(
          tx,
          id,
          orderFormId,
          realizationFormId,
          current.completionRequirements.map((row) => ({
            fieldKey: row.fieldKey,
            required: row.required,
            stage: row.stage,
            minPhotos: row.minPhotos,
          })),
        );
      }

      const data: Prisma.TaskTypeUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.iconName !== undefined ? { iconName: input.iconName } : {}),
        ...(input.colorHex !== undefined ? { colorHex: input.colorHex } : {}),
        ...(input.requiresVehicle !== undefined ? { requiresVehicle: input.requiresVehicle } : {}),
        ...(input.requiresOdometer !== undefined ? { requiresOdometer: input.requiresOdometer } : {}),
        ...(input.requiresPhotos !== undefined ? { requiresPhotos: input.requiresPhotos } : {}),
        ...(input.defaultPriority !== undefined ? { defaultPriority: input.defaultPriority } : {}),
        ...(input.defaultAssignMode !== undefined ? { defaultAssignMode: input.defaultAssignMode } : {}),
        ...(input.allowMultipleClaimants !== undefined
          ? { allowMultipleClaimants: input.allowMultipleClaimants }
          : {}),
        ...(input.dueOffsetHours !== undefined ? { dueOffsetHours: input.dueOffsetHours } : {}),
        ...(input.orderFormSchemaId !== undefined || input.formSchemaId !== undefined
          ? { orderFormSchemaId: orderFormId }
          : {}),
        ...(input.realizationFormSchemaId !== undefined
          ? { realizationFormSchemaId: realizationFormId }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      };

      const updated = await tx.taskType.update({
        where: { id },
        data,
        select: taskTypeDetailSelect(),
      });
      const after = this.serializeDetail(updated);
      return { data: after, before: { ...before }, after: { ...after } };
    });
  }

  async archive(
    id: string,
    input: ArchiveTaskTypeInput,
    actorId?: string,
  ): Promise<TaskTypeMutation<{ id: string; code: string; archivedAt: string }>> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);
      const archivedAt = new Date();

      await tx.taskType.update({
        where: { id },
        data: { active: false, deletedAt: archivedAt },
      });

      return {
        data: { id, code: current.code, archivedAt: archivedAt.toISOString() },
        before: { ...before },
        after: {
          id,
          code: current.code,
          active: false,
          deletedAt: archivedAt.toISOString(),
          deletedById: actorId ?? null,
        },
        meta: { ...(input.reason ? { reason: input.reason } : {}) },
      };
    });
  }

  async listCompletionRequirements(id: string): Promise<TaskCompletionRequirementsResponse> {
    await this.assertExists(this.prisma, id);
    const rows = await this.prisma.taskCompletionRequirement.findMany({
      where: { taskTypeId: id },
      select: COMPLETION_REQUIREMENT_SELECT,
      orderBy: [{ stage: 'asc' }, { fieldKey: 'asc' }, { id: 'asc' }],
    });
    return { taskTypeId: id, requirements: rows.map(serializeRequirement) };
  }

  async replaceCompletionRequirements(
    id: string,
    input: ReplaceTaskCompletionRequirementsInput,
  ): Promise<TaskTypeMutation<TaskCompletionRequirementsResponse>> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const current = await this.loadDetail(tx, id);
      const before = current.completionRequirements.map(serializeRequirement);

      await this.assertRequirementsFitForm(
        tx,
        id,
        current.orderFormSchemaId,
        current.realizationFormSchemaId,
        input.requirements,
      );

      await tx.taskCompletionRequirement.deleteMany({ where: { taskTypeId: id } });
      if (input.requirements.length > 0) {
        await tx.taskCompletionRequirement.createMany({
          data: input.requirements.map((requirement) => ({
            id: randomUUID(),
            taskTypeId: id,
            fieldKey: requirement.fieldKey,
            required: requirement.required,
            stage: requirement.stage,
            minPhotos: requirement.minPhotos,
          })),
        });
      }

      const rows = await tx.taskCompletionRequirement.findMany({
        where: { taskTypeId: id },
        select: COMPLETION_REQUIREMENT_SELECT,
        orderBy: [{ stage: 'asc' }, { fieldKey: 'asc' }, { id: 'asc' }],
      });
      const requirements = rows.map(serializeRequirement);
      const data = { taskTypeId: id, requirements };

      return {
        data,
        before: { requirements: before },
        after: { requirements },
        meta: { requirementCount: requirements.length },
      };
    });
  }

  private serializeDetail(row: TaskTypeDetailRow): TaskTypeDetail {
    return {
      ...serialize(row),
      completionRequirements: row.completionRequirements.map(serializeRequirement),
    };
  }

  private async loadDetail(client: Client, id: string): Promise<TaskTypeDetailRow> {
    const row = await client.taskType.findFirst({
      where: { id, deletedAt: null },
      select: taskTypeDetailSelect(),
    });
    if (!row) throw VfmErrors.notFound('Vrsta zadatka nije pronađena.');
    return row;
  }

  private async assertExists(client: Client, id: string): Promise<void> {
    const row = await client.taskType.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw VfmErrors.notFound('Vrsta zadatka nije pronađena.');
  }

  private async lock(tx: Tx, id: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>`
      SELECT "id", "deletedAt"
      FROM "TaskType"
      WHERE "id" = ${id}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row || row.deletedAt !== null) {
      throw VfmErrors.notFound('Vrsta zadatka nije pronađena.');
    }
  }

  /**
   * Zadana forma vrste mora biti objavljena TASK forma. Forma vezana za drugu
   * vrstu (`FormSchema.taskTypeId`) se ne može preoteti; generička TASK forma
   * i forma ove vrste su dozvoljene.
   */
  private async assertAssignableTaskForm(
    client: Client,
    formSchemaId: string,
    taskTypeId: string,
    role: 'ORDER' | 'REALIZATION',
  ): Promise<void> {
    const path = role === 'ORDER' ? 'orderFormSchemaId' : 'realizationFormSchemaId';
    const form = await client.formSchema.findFirst({
      where: { id: formSchemaId, deletedAt: null },
      select: {
        id: true,
        subject: true,
        taskTypeId: true,
        role: true,
        currentPublishedVersionId: true,
      },
    });
    if (!form) {
      throw VfmErrors.validationError([detail(path, 'Odabrana forma ne postoji.')]);
    }
    if (form.subject !== 'TASK') {
      throw VfmErrors.validationError([detail(path, 'Zadana forma vrste zadatka mora imati subject TASK.')]);
    }
    if (form.role !== role) {
      throw VfmErrors.validationError([
        detail(path, `Odabrana forma mora imati ulogu ${role === 'ORDER' ? 'Nalog' : 'Realizacija'}.`),
      ]);
    }
    if (form.taskTypeId !== null && form.taskTypeId !== taskTypeId) {
      throw VfmErrors.validationError([detail(path, 'Odabrana forma je već vezana za drugu vrstu zadatka.')]);
    }
    if (!form.currentPublishedVersionId) {
      throw new VfmException('FORM_VERSION_NOT_PUBLISHED', 'Odabrana TASK forma nema objavljenu verziju.', [
        detail(path, 'Objavite formu prije nego je vežete za vrstu zadatka.'),
      ]);
    }
  }

  /**
   * Efektivna TASK forma za datu ulogu: eksplicitno vezana (`formSchemaId`) ili
   * prva objavljena forma vrste sa tom ulogom (legacy redovi bez `role` tretiraju
   * se kao ORDER — tako ih je postavila migracija `6_task_order_realization`).
   */
  private async effectiveTaskForm(
    client: Client,
    taskTypeId: string,
    formSchemaId: string | null,
    role: 'ORDER' | 'REALIZATION',
  ): Promise<EffectiveTaskForm | null> {
    const select = {
      id: true,
      key: true,
      role: true,
      currentPublishedVersionId: true,
    } as const;

    let schema = formSchemaId
      ? await client.formSchema.findFirst({
          where: { id: formSchemaId, deletedAt: null },
          select,
        })
      : null;

    if (!schema) {
      schema = await client.formSchema.findFirst({
        where: {
          subject: 'TASK',
          taskTypeId,
          role,
          deletedAt: null,
          currentPublishedVersionId: { not: null },
        },
        select,
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!schema) {
      // Legacy: forma vezana za vrstu bez `role` (prije migracije 6) ili forma
      // bez `taskTypeId`. Prihvata se samo za ORDER, jer realizacija tada nije
      // ni postojala.
      if (role !== 'ORDER') return null;
      schema = await client.formSchema.findFirst({
        where: {
          subject: 'TASK',
          taskTypeId,
          role: null,
          deletedAt: null,
          currentPublishedVersionId: { not: null },
        },
        select,
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!schema) return null;

    if (!schema.currentPublishedVersionId) return null;
    const version = await client.formSchemaVersion.findUnique({
      where: { id: schema.currentPublishedVersionId },
      select: { definition: true, version: true },
    });
    if (!version) return null;

    const definition = parseStoredDefinition(version.definition);
    const fields = new Map<string, string>();
    for (const section of definition.sections ?? []) {
      for (const field of section.fields ?? []) fields.set(field.key, field.type);
    }

    return {
      id: schema.id,
      key: schema.key,
      role,
      version: version.version,
      fields,
    };
  }

  /**
   * Forma protiv koje se zahtjev stvarno provjerava u svojoj fazi:
   * `ON_CREATE`/`ON_CLAIM` idu na nalog (forma pri kreiranju/preuzimanju),
   * `ON_COMPLETE`/`GENERAL`/`ON_CANCEL` na realizaciju (forma pri završetku).
   * Ako forma za tu ulogu ne postoji, koristi se druga (jedna te ista forma).
   */
  private formForRequirementStage(
    stage: string,
    order: EffectiveTaskForm | null,
    realization: EffectiveTaskForm | null,
  ): EffectiveTaskForm | null {
    const usesRealization = stage === 'ON_COMPLETE' || stage === 'GENERAL' || stage === 'ON_CANCEL';
    return usesRealization ? (realization ?? order) : (order ?? realization);
  }

  private async assertRequirementsFitForm(
    client: Client,
    taskTypeId: string,
    orderFormSchemaId: string | null,
    realizationFormSchemaId: string | null,
    requirements: readonly TaskCompletionRequirementInput[],
  ): Promise<void> {
    if (requirements.length === 0) return;

    const [order, realization] = await Promise.all([
      this.effectiveTaskForm(client, taskTypeId, orderFormSchemaId, 'ORDER'),
      this.effectiveTaskForm(client, taskTypeId, realizationFormSchemaId, 'REALIZATION'),
    ]);
    if (!order && !realization) return;

    const issues = requirements.flatMap((requirement, index) => {
      const form = this.formForRequirementStage(requirement.stage, order, realization);
      if (!form) return [];

      const type = form.fields.get(requirement.fieldKey);
      if (type) {
        if (requirement.minPhotos > 0 && type !== 'PHOTO') {
          return [
            detail(`requirements[${index}].minPhotos`, `Polje "${requirement.fieldKey}" nije PHOTO polje.`),
          ];
        }
        return [];
      }

      // Polje postoji u drugoj formi → zahtjev je vjerovatno u pogrešnoj fazi.
      const other = form === order ? realization : order;
      const elsewhere = other?.fields.has(requirement.fieldKey) ? other : null;
      const hint = elsewhere
        ? ` Polje postoji u ${roleLabel(elsewhere.role)} formi (${elsewhere.key}) — za nju koristite odgovarajuću fazu zahtjeva.`
        : '';
      return [
        detail(
          `requirements[${index}].fieldKey`,
          `Polje "${requirement.fieldKey}" ne postoji u objavljenoj ${roleLabel(form.role)} formi (${form.key}) za fazu ${requirement.stage}.${hint}`,
        ),
      ];
    });

    if (issues.length > 0) throw VfmErrors.validationError(issues);
  }
}
