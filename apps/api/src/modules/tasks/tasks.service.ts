/**
 * Zadaci — jezgra Faze 5 (docs/07 §2.11).
 *
 * Ova cjelina namjerno pokriva kreiranje, čitanje, djelimičnu izmjenu,
 * otkazivanje i ponovno otvaranje. Atomski claim i završetak ostaju zasebne
 * cjeline jer nose konkurencijske i autorizacijske garancije koje se moraju
 * dokazati odvojenim testovima.
 *
 * Pri kreiranju se snapshotuje tačna objavljena TASK forma: prvo eksplicitna
 * zadana forma vrste (`TaskType.formSchemaId`), zatim objavljena forma vezana
 * uz vrstu (`FormSchema.taskTypeId`). Generička TASK forma nije fallback —
 * vrsta bez efektivne forme ne može napraviti zadatak s tuđim poljima.
 * Domenska promjena, `TaskEvent` i DB `OutboxEvent` nastaju u istoj
 * transakciji; Redis/BullMQ publish nije zamjena za transakcijski outbox.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  canTransitionTask,
  toLocalDateString,
  type ClientType,
  type EffectivePermissionsResult,
  type Permission,
  type TaskAssignMode,
  type TaskStatus,
} from '@vfm/shared';
import { flattenFields, validateRecord, type FormDefinition } from '@vfm/form-engine';
import type {
  CancelTaskInput,
  CreateTaskInput,
  ReopenTaskInput,
  TaskAssignmentView,
  TaskDetail,
  TaskEventView,
  TaskListQuery,
  TaskListResponse,
  TaskView,
  UpdateTaskInput,
} from '@vfm/shared/schemas';
import { toDatabaseDate } from '../../common/dates.js';
import { VfmErrors, VfmException } from '../../common/errors/vfm-error.js';
import { detail, parseStoredDefinition } from '../../common/form-record-support.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionsService } from '../auth/permissions/permissions.service.js';

const TASK_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  vehicleId: true,
  taskTypeId: true,
  priority: true,
  status: true,
  assignMode: true,
  createdById: true,
  assigneeUserId: true,
  claimedAt: true,
  completedAt: true,
  completedById: true,
  dueAt: true,
  dueDate: true,
  cancelledAt: true,
  cancelReason: true,
  reopenedAt: true,
  releasedAt: true,
  durationMinutes: true,
  odometerKm: true,
  totalCost: true,
  fuelLiters: true,
  fuelAmount: true,
  fuelConsumptionL100: true,
  formSchemaId: true,
  formSchemaVersionId: true,
  formData: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TaskSelect;

const TASK_ASSIGNMENT_SELECT = {
  id: true,
  taskId: true,
  userId: true,
  role: true,
  assignedById: true,
  assignedAt: true,
  revokedAt: true,
  note: true,
} as const satisfies Prisma.TaskAssignmentSelect;

const TASK_EVENT_SELECT = {
  id: true,
  taskId: true,
  action: true,
  actorId: true,
  actorRole: true,
  at: true,
  clientType: true,
  requestId: true,
  data: true,
  formSchemaVersionId: true,
} as const satisfies Prisma.TaskEventSelect;

const USER_NAME_FIELDS = {
  firstName: true,
  lastName: true,
  displayName: true,
} as const;

type TaskSelectWithRelations = typeof TASK_SELECT & {
  vehicle: {
    select: { internalNo: true; make: true; model: true; plateNumber: true };
  };
  taskType: {
    select: { code: true; name: true; iconName: true; colorHex: true };
  };
  createdBy: { select: typeof USER_NAME_FIELDS };
  assignee: { select: typeof USER_NAME_FIELDS };
  formSchema: { select: { key: true; name: true } };
  formSchemaVersion: { select: { version: true } };
};

type TaskDetailSelect = TaskSelectWithRelations & {
  assignments: {
    select: typeof TASK_ASSIGNMENT_SELECT & {
      user: { select: typeof USER_NAME_FIELDS };
    };
    orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }];
  };
  events: {
    select: typeof TASK_EVENT_SELECT & {
      actor: { select: typeof USER_NAME_FIELDS };
    };
    orderBy: [{ at: 'asc' }, { id: 'asc' }];
  };
  attachments: { where: { deletedAt: null }; select: { id: true } };
  _count: { select: { comments: { where: { deletedAt: null } } } };
};

type TaskRow = Prisma.TaskGetPayload<{ select: TaskSelectWithRelations }>;
type TaskDetailRow = Prisma.TaskGetPayload<{ select: TaskDetailSelect }>;
type Tx = Prisma.TransactionClient;
type Client = PrismaService | Tx;

export interface TaskActorContext {
  readonly id: string;
  readonly roles?: readonly string[];
  readonly clientType?: ClientType;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
}

export interface TaskMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface ActorAccess {
  readonly actor: TaskActorContext;
  readonly permissions: EffectivePermissionsResult;
  readonly viewAll: boolean;
  readonly updateAll: boolean;
  readonly cancelAll: boolean;
  readonly reopenAll: boolean;
}

interface ResolvedTaskForm {
  readonly formSchemaId: string;
  readonly formSchemaVersionId: string;
  readonly version: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  readonly definition: FormDefinition;
}

interface RequirementRow {
  readonly fieldKey: string;
  readonly required: boolean;
  readonly stage: string;
  readonly minPhotos: number;
}

function taskSelect(): TaskSelectWithRelations {
  return {
    ...TASK_SELECT,
    vehicle: {
      select: { internalNo: true, make: true, model: true, plateNumber: true },
    },
    taskType: {
      select: { code: true, name: true, iconName: true, colorHex: true },
    },
    createdBy: { select: USER_NAME_FIELDS },
    assignee: { select: USER_NAME_FIELDS },
    formSchema: { select: { key: true, name: true } },
    formSchemaVersion: { select: { version: true } },
  };
}

function taskDetailSelect(): TaskDetailSelect {
  return {
    ...taskSelect(),
    assignments: {
      select: {
        ...TASK_ASSIGNMENT_SELECT,
        user: { select: USER_NAME_FIELDS },
      },
      orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
    },
    events: {
      select: {
        ...TASK_EVENT_SELECT,
        actor: { select: USER_NAME_FIELDS },
      },
      orderBy: [{ at: 'asc' }, { id: 'asc' }],
    },
    attachments: { where: { deletedAt: null }, select: { id: true } },
    _count: { select: { comments: { where: { deletedAt: null } } } },
  };
}

function userName(
  user: { firstName: string; lastName: string; displayName: string | null } | null | undefined,
): string | null {
  if (!user) return null;
  return user.displayName?.trim() || `${user.firstName} ${user.lastName}`.trim();
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    const number = (value as { toNumber(): number }).toNumber();
    return Number.isFinite(number) ? number : null;
  }
  const number = Number(String(value));
  return Number.isFinite(number) ? number : null;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function plainRecordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : null;
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function serializeAssignment(row: TaskDetailRow['assignments'][number]): TaskAssignmentView {
  return {
    id: row.id,
    userId: row.userId,
    userName: userName(row.user) ?? row.userId,
    role: row.role as TaskAssignmentView['role'],
    assignedById: row.assignedById,
    assignedAt: row.assignedAt.toISOString(),
    revokedAt: toIso(row.revokedAt),
    note: row.note,
  };
}

function serializeEvent(row: TaskDetailRow['events'][number]): TaskEventView {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorName: userName(row.actor),
    actorRole: row.actorRole,
    at: row.at.toISOString(),
    clientType: row.clientType,
    requestId: row.requestId,
    data: plainRecordOrNull(row.data),
    formSchemaVersionId: row.formSchemaVersionId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(
    query: TaskListQuery,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskListResponse> {
    const access = await this.resolveAccess(actorInput);
    const now = new Date();
    const conditions: Prisma.TaskWhereInput[] = [{ deletedAt: null }];

    if (query.status) conditions.push({ status: query.status });
    if (query.vehicleId) conditions.push({ vehicleId: query.vehicleId });
    if (query.taskTypeId) conditions.push({ taskTypeId: query.taskTypeId });
    if (query.assigneeUserId) conditions.push({ assigneeUserId: query.assigneeUserId });
    if (query.createdById) conditions.push({ createdById: query.createdById });
    if (query.priority) conditions.push({ priority: query.priority });

    if (query.dueFrom || query.dueTo) {
      conditions.push({
        dueAt: {
          ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
          ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
        },
      });
    }

    if (query.q?.trim()) {
      const contains = { contains: query.q.trim(), mode: 'insensitive' as const };
      conditions.push({ OR: [{ code: contains }, { title: contains }, { description: contains }] });
    }

    if (!access.viewAll) {
      conditions.push({
        OR: [
          { createdById: access.actor.id },
          { assigneeUserId: access.actor.id },
          { completedById: access.actor.id },
          { assignments: { some: { userId: access.actor.id, revokedAt: null } } },
          { status: 'OPEN', assignMode: 'BROADCAST' },
        ],
      });
    }

    if (query.mine) {
      conditions.push({
        OR: [
          { createdById: access.actor.id },
          { assigneeUserId: access.actor.id },
          { completedById: access.actor.id },
          { assignments: { some: { userId: access.actor.id, revokedAt: null } } },
        ],
      });
    }

    if (query.overdueOnly) {
      conditions.push({ dueAt: { lt: now }, status: { in: ['OPEN', 'IN_PROGRESS'] } });
    }

    const where: Prisma.TaskWhereInput = { AND: conditions };
    const allowedSort = ['dueAt', 'createdAt', 'updatedAt', 'priority', 'title', 'code'] as const;
    const sort = allowedSort.find((key) => key === query.sortBy);
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = sort
      ? [
          { [sort]: query.sortOrder } as Prisma.TaskOrderByWithRelationInput,
          { dueAt: 'asc' },
          { createdAt: 'desc' },
          { id: 'asc' },
        ]
      : [{ dueAt: 'asc' }, { createdAt: 'desc' }, { code: 'asc' }, { id: 'asc' }];

    const [total, rows] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        select: taskSelect(),
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.serialize(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string, actorInput: TaskActorContext | string | undefined): Promise<TaskDetail> {
    const access = await this.resolveAccess(actorInput);
    const row = await this.loadDetail(this.prisma, id);
    if (!this.canView(row, access)) throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    return this.serializeDetail(row);
  }

  async create(
    input: CreateTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);
    const actor = access.actor;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        await this.lockRow(tx, 'TaskType', input.taskTypeId);

        const taskType = await tx.taskType.findFirst({
          where: { id: input.taskTypeId, deletedAt: null },
          select: {
            id: true,
            code: true,
            name: true,
            requiresVehicle: true,
            defaultPriority: true,
            defaultAssignMode: true,
            dueOffsetHours: true,
            formSchemaId: true,
            active: true,
            completionRequirements: {
              select: { fieldKey: true, required: true, stage: true, minPhotos: true },
            },
          },
        });
        if (!taskType) {
          throw VfmErrors.validationError([detail('taskTypeId', 'Vrsta zadatka ne postoji.')]);
        }
        if (!taskType.active) {
          throw VfmErrors.validationError([
            detail('taskTypeId', 'Vrsta zadatka je deaktivirana i ne može se koristiti za novi zadatak.'),
          ]);
        }

        const vehicle = await this.resolveVehicle(tx, taskType.requiresVehicle, input.vehicleId);
        const assignMode = this.effectiveAssignMode(input, taskType.defaultAssignMode);
        this.assertAssignModeShape(input, assignMode);
        await this.assertRecipients(tx, input, assignMode, actor.id);

        const form = await this.resolvePublishedTaskForm(tx, taskType.id, taskType.formSchemaId);
        const formData = this.validateDraftFormData({
          form,
          values: input.formData,
          isNew: true,
          requirements: taskType.completionRequirements,
        });

        const title =
          input.title ?? `${taskType.name}${vehicle ? ` — ${vehicle.internalNo}` : ''}`.slice(0, 160);
        const dueAt =
          input.dueAt === undefined
            ? taskType.dueOffsetHours === null
              ? null
              : new Date(now.getTime() + taskType.dueOffsetHours * 60 * 60 * 1000)
            : input.dueAt === null
              ? null
              : new Date(input.dueAt);
        const code = await this.nextTaskCode(tx, now);
        const taskId = randomUUID();

        await tx.task.create({
          data: {
            id: taskId,
            code,
            title,
            description: input.description ?? null,
            vehicleId: vehicle?.id ?? null,
            taskTypeId: taskType.id,
            priority: input.priority ?? taskType.defaultPriority,
            status: 'OPEN',
            assignMode,
            createdById: actor.id,
            assigneeUserId: assignMode === 'ASSIGN_DIRECT' ? input.assigneeUserId : null,
            dueAt,
            dueDate: dueAt ? toDatabaseDate(toLocalDateString(dueAt)) : null,
            formSchemaId: form.formSchemaId,
            formSchemaVersionId: form.formSchemaVersionId,
            formData: formData as Prisma.InputJsonObject,
            version: 0,
          },
          select: { id: true },
        });

        const assignments = [
          ...(assignMode === 'ASSIGN_DIRECT' && input.assigneeUserId
            ? [{ userId: input.assigneeUserId, role: 'ASSIGNEE' }]
            : []),
          ...input.invitedUserIds.map((userId) => ({ userId, role: 'INVITED' })),
          ...input.observerUserIds.map((userId) => ({ userId, role: 'OBSERVER' })),
        ];
        if (assignments.length > 0) {
          await tx.taskAssignment.createMany({
            data: assignments.map((assignment) => ({
              id: randomUUID(),
              taskId,
              userId: assignment.userId,
              role: assignment.role,
              assignedById: actor.id,
              assignedAt: now,
              note: null,
            })),
          });
        }

        const createdData = {
          code,
          title,
          taskTypeId: taskType.id,
          vehicleId: vehicle?.id ?? null,
          assignMode,
          priority: input.priority ?? taskType.defaultPriority,
          dueAt: dueAt?.toISOString() ?? null,
          invitedUserIds: [...input.invitedUserIds],
          assigneeUserId: assignMode === 'ASSIGN_DIRECT' ? input.assigneeUserId : null,
          observerUserIds: [...input.observerUserIds],
        };
        await tx.taskEvent.createMany({
          data: [
            this.eventData({
              taskId,
              action: 'CREATED',
              actor,
              at: now,
              data: createdData,
              formSchemaVersionId: form.formSchemaVersionId,
            }),
            ...(input.invitedUserIds.length > 0
              ? [
                  this.eventData({
                    taskId,
                    action: 'INVITED',
                    actor,
                    at: new Date(now.getTime() + 1),
                    data: { invitedUserIds: [...input.invitedUserIds] },
                  }),
                ]
              : []),
            ...(assignMode === 'ASSIGN_DIRECT' && input.assigneeUserId
              ? [
                  this.eventData({
                    taskId,
                    action: 'ASSIGNED',
                    actor,
                    at: new Date(now.getTime() + 1),
                    data: { assigneeUserId: input.assigneeUserId },
                  }),
                ]
              : []),
          ],
        });

        await this.createOutbox(tx, {
          taskId,
          code,
          eventType: 'TASK_CREATED',
          status: 'OPEN',
          version: 0,
          actorId: actor.id,
          recipientUserIds:
            assignMode === 'BROADCAST'
              ? []
              : [
                  ...input.invitedUserIds,
                  ...(assignMode === 'ASSIGN_DIRECT' && input.assigneeUserId ? [input.assigneeUserId] : []),
                ],
          extra: {
            assignMode,
            broadcast: assignMode === 'BROADCAST',
            observerUserIds: [...input.observerUserIds],
          },
        });

        const detailRow = await this.loadDetail(tx, taskId);
        const data = this.serializeDetail(detailRow, now);
        return {
          data,
          after: { ...data },
          meta: { code: data.code, status: data.status, taskTypeCode: data.taskTypeCode },
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new VfmException('DUPLICATE_ENTRY', 'Zadatak ili dodjela s istim ključem već postoji.', [
          detail('code', 'Kod ili dodjela zadatka mora biti jedinstvena.'),
        ]);
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);

      const ownOpen =
        current.status === 'OPEN' &&
        (current.createdById === access.actor.id || current.assigneeUserId === access.actor.id);
      if (!access.updateAll && !ownOpen) {
        throw VfmErrors.scopeDenied([
          detail(
            'task:update',
            'Zadatak možete mijenjati samo ako ste ga kreirali ili ste izvršilac, i to dok je slobodan.',
          ),
        ]);
      }
      if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          `Zadatak u statusu ${current.status} se ne može mijenjati kroz PATCH.`,
          undefined,
          { from: current.status, action: 'UPDATE' },
        );
      }
      this.assertVersion(current.version, input.version);

      const data: Prisma.TaskUncheckedUpdateManyInput = { version: { increment: 1 } };
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueAt !== undefined) {
        const dueAt = input.dueAt === null ? null : new Date(input.dueAt);
        data.dueAt = dueAt;
        data.dueDate = dueAt ? toDatabaseDate(toLocalDateString(dueAt)) : null;
      }
      if (input.formData !== undefined) {
        const form = await this.loadSnapshotForm(tx, current.formSchemaVersionId);
        const requirements = await tx.taskCompletionRequirement.findMany({
          where: { taskTypeId: current.taskTypeId, stage: 'ON_CREATE' },
          select: { fieldKey: true, required: true, stage: true, minPhotos: true },
        });
        data.formData = this.validateDraftFormData({
          form,
          values: input.formData,
          isNew: false,
          requirements,
        }) as Prisma.InputJsonObject;
      }

      const changed = await tx.task.updateMany({
        where: { id, version: input.version, status: current.status, deletedAt: null },
        data,
      });
      if (changed.count !== 1) await this.throwCasFailure(tx, id, input.version);

      const changedFields = Object.keys(input).filter((key) => key !== 'version');
      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: 'UPDATED',
          actor: access.actor,
          at: new Date(),
          data: {
            changedFields,
            fromStatus: current.status,
            toStatus: current.status,
            previousVersion: current.version,
            version: current.version + 1,
          },
          formSchemaVersionId: current.formSchemaVersionId,
        }),
      });

      const updated = await this.loadDetail(tx, id);
      const serialized = this.serializeDetail(updated);
      return {
        data: serialized,
        before: { ...before },
        after: { ...serialized },
        meta: { code: serialized.code, status: serialized.status, changedFields },
      };
    });
  }

  async cancel(
    id: string,
    input: CancelTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);

      if (!access.cancelAll && current.createdById !== access.actor.id) {
        throw VfmErrors.scopeDenied([
          detail('task:cancel', 'Zadatak može otkazati njegov kreator ili korisnik s punim opsegom.'),
        ]);
      }
      this.assertVersion(current.version, input.version);
      if (!canTransitionTask(current.status, 'CANCELLED')) {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          `Zadatak u statusu ${current.status} se ne može otkazati.`,
          undefined,
          { from: current.status, to: 'CANCELLED' },
        );
      }

      const now = new Date();
      const changed = await tx.task.updateMany({
        where: { id, version: input.version, status: current.status, deletedAt: null },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) await this.throwCasFailure(tx, id, input.version);

      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: 'CANCELLED',
          actor: access.actor,
          at: now,
          data: {
            fromStatus: current.status,
            toStatus: 'CANCELLED',
            reason: input.reason,
            previousVersion: current.version,
            version: current.version + 1,
          },
          formSchemaVersionId: current.formSchemaVersionId,
        }),
      });
      await this.createOutbox(tx, {
        taskId: id,
        code: current.code,
        eventType: 'TASK_CANCELLED',
        status: 'CANCELLED',
        version: current.version + 1,
        actorId: access.actor.id,
        recipientUserIds: this.involvedUserIds(current, access.actor.id),
        extra: { reason: input.reason, fromStatus: current.status },
      });

      const updated = await this.loadDetail(tx, id);
      const data = this.serializeDetail(updated, now);
      return {
        data,
        before: { ...before },
        after: { ...data },
        meta: { code: data.code, status: data.status, reason: input.reason },
      };
    });
  }

  async reopen(
    id: string,
    input: ReopenTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);

      if (!access.reopenAll && current.createdById !== access.actor.id) {
        throw VfmErrors.scopeDenied([
          detail('task:reopen', 'Zadatak može ponovo otvoriti njegov kreator ili korisnik s punim opsegom.'),
        ]);
      }
      this.assertVersion(current.version, input.version);

      const target: TaskStatus | null =
        current.status === 'CANCELLED' ? 'OPEN' : current.status === 'COMPLETED' ? 'IN_PROGRESS' : null;
      if (!target || !canTransitionTask(current.status, target)) {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          `Zadatak u statusu ${current.status} se ne može ponovo otvoriti.`,
          undefined,
          { from: current.status, to: target },
        );
      }

      const now = new Date();
      const data: Prisma.TaskUncheckedUpdateManyInput = {
        status: target,
        reopenedAt: now,
        cancelledAt: null,
        cancelReason: null,
        version: { increment: 1 },
      };
      if (input.dueAt !== undefined) {
        const dueAt = input.dueAt === null ? null : new Date(input.dueAt);
        data.dueAt = dueAt;
        data.dueDate = dueAt ? toDatabaseDate(toLocalDateString(dueAt)) : null;
      }

      let revokeAssignee = false;
      if (current.status === 'CANCELLED') {
        data.claimedAt = null;
        data.durationMinutes = null;
        if (current.assignMode !== 'ASSIGN_DIRECT') {
          data.assigneeUserId = null;
          revokeAssignee = current.assigneeUserId !== null;
        }
      } else {
        data.completedAt = null;
        data.completedById = null;
        data.durationMinutes = null;
      }

      const changed = await tx.task.updateMany({
        where: { id, version: input.version, status: current.status, deletedAt: null },
        data,
      });
      if (changed.count !== 1) await this.throwCasFailure(tx, id, input.version);

      if (revokeAssignee) {
        await tx.taskAssignment.updateMany({
          where: { taskId: id, role: 'ASSIGNEE', revokedAt: null },
          data: { revokedAt: now },
        });
      }

      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: 'REOPENED',
          actor: access.actor,
          at: now,
          data: {
            fromStatus: current.status,
            toStatus: target,
            reason: input.reason ?? null,
            previousVersion: current.version,
            version: current.version + 1,
          },
          formSchemaVersionId: current.formSchemaVersionId,
        }),
      });
      await this.createOutbox(tx, {
        taskId: id,
        code: current.code,
        eventType: 'TASK_REOPENED',
        status: target,
        version: current.version + 1,
        actorId: access.actor.id,
        recipientUserIds: this.involvedUserIds(current, access.actor.id),
        extra: { reason: input.reason ?? null, fromStatus: current.status },
      });

      const updated = await this.loadDetail(tx, id);
      const dataResult = this.serializeDetail(updated, now);
      return {
        data: dataResult,
        before: { ...before },
        after: { ...dataResult },
        meta: { code: dataResult.code, status: dataResult.status, reason: input.reason ?? null },
      };
    });
  }

  private serialize(row: TaskRow, now = new Date()): TaskView {
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      vehicleId: row.vehicleId,
      vehicleInternalNo: row.vehicle?.internalNo ?? null,
      vehicleMake: row.vehicle?.make ?? null,
      vehicleModel: row.vehicle?.model ?? null,
      vehiclePlateNumber: row.vehicle?.plateNumber ?? null,
      taskTypeId: row.taskTypeId,
      taskTypeCode: row.taskType.code,
      taskTypeName: row.taskType.name,
      taskTypeIconName: row.taskType.iconName,
      taskTypeColorHex: row.taskType.colorHex,
      priority: row.priority,
      status: row.status,
      assignMode: row.assignMode,
      createdById: row.createdById,
      createdByName: userName(row.createdBy) ?? row.createdById,
      assigneeUserId: row.assigneeUserId,
      assigneeName: userName(row.assignee),
      claimedAt: toIso(row.claimedAt),
      completedAt: toIso(row.completedAt),
      completedById: row.completedById,
      dueAt: toIso(row.dueAt),
      dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      isOverdue:
        (row.status === 'OPEN' || row.status === 'IN_PROGRESS') &&
        row.dueAt !== null &&
        row.dueAt.getTime() < now.getTime(),
      cancelledAt: toIso(row.cancelledAt),
      cancelReason: row.cancelReason,
      reopenedAt: toIso(row.reopenedAt),
      releasedAt: toIso(row.releasedAt),
      durationMinutes: row.durationMinutes,
      odometerKm: row.odometerKm,
      totalCost: row.totalCost,
      fuelLiters: decimalNumber(row.fuelLiters),
      fuelAmount: row.fuelAmount,
      fuelConsumptionL100: decimalNumber(row.fuelConsumptionL100),
      formSchemaId: row.formSchemaId,
      formSchemaKey: row.formSchema.key,
      formSchemaName: row.formSchema.name,
      formSchemaVersionId: row.formSchemaVersionId,
      formSchemaVersion: row.formSchemaVersion.version,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeDetail(row: TaskDetailRow, now = new Date()): TaskDetail {
    return {
      ...this.serialize(row, now),
      formData: plainRecord(row.formData),
      assignments: row.assignments.map(serializeAssignment),
      events: row.events.map(serializeEvent),
      attachmentIds: row.attachments.map((attachment) => attachment.id),
      commentCount: row._count.comments,
    };
  }

  private async loadDetail(client: Client, id: string): Promise<TaskDetailRow> {
    const row = await client.task.findFirst({
      where: { id, deletedAt: null },
      select: taskDetailSelect(),
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    return row;
  }

  private canView(row: TaskDetailRow, access: ActorAccess): boolean {
    if (access.viewAll) return true;
    if (
      row.createdById === access.actor.id ||
      row.assigneeUserId === access.actor.id ||
      row.completedById === access.actor.id
    ) {
      return true;
    }
    if (
      row.assignments.some((assignment) => assignment.userId === access.actor.id && !assignment.revokedAt)
    ) {
      return true;
    }
    return row.status === 'OPEN' && row.assignMode === 'BROADCAST';
  }

  private involvedUserIds(row: TaskDetailRow, excludeUserId?: string): string[] {
    const ids = new Set<string>([row.createdById]);
    if (row.assigneeUserId) ids.add(row.assigneeUserId);
    if (row.completedById) ids.add(row.completedById);
    for (const assignment of row.assignments) {
      if (!assignment.revokedAt) ids.add(assignment.userId);
    }
    if (excludeUserId) ids.delete(excludeUserId);
    return [...ids];
  }

  private async resolveAccess(actorInput: TaskActorContext | string | undefined): Promise<ActorAccess> {
    const actor: TaskActorContext | undefined =
      typeof actorInput === 'string' ? { id: actorInput } : actorInput;
    if (!actor?.id) throw VfmErrors.unauthenticated();

    const permissions = await this.permissions.effective(actor.id, actor.clientType ?? 'WEB');
    if (!permissions) throw VfmErrors.unauthenticated();

    const has = (permission: Permission): boolean =>
      permissions.isSuperAdmin || permissions.permissions.has(permission);
    const all = (permission: Permission): boolean =>
      permissions.isSuperAdmin || permissions.permissions.get(permission) === 'ALL';

    return {
      actor,
      permissions,
      viewAll: has('task:view_all') || all('task:view'),
      updateAll: all('task:update'),
      cancelAll: all('task:cancel'),
      reopenAll: all('task:reopen'),
    };
  }

  private async lockRow(tx: Tx, table: 'Task' | 'TaskType' | 'FormSchema', id: string): Promise<void> {
    if (table === 'Task') {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Task" WHERE "id" = ${id}::uuid FOR UPDATE`;
    } else if (table === 'TaskType') {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "TaskType" WHERE "id" = ${id}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "FormSchema" WHERE "id" = ${id}::uuid FOR UPDATE`;
    }
  }

  private async resolveVehicle(
    tx: Tx,
    requiresVehicle: boolean,
    vehicleId: string | null | undefined,
  ): Promise<{ id: string; internalNo: string } | null> {
    if (!vehicleId) {
      if (requiresVehicle) {
        throw VfmErrors.validationError([detail('vehicleId', 'Ova vrsta zadatka zahtijeva vozilo.')]);
      }
      return null;
    }

    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true, internalNo: true, status: true, archivedAt: true },
    });
    if (!vehicle) {
      throw VfmErrors.validationError([detail('vehicleId', 'Odabrano vozilo ne postoji.')]);
    }
    if (vehicle.status === 'ARCHIVED' || vehicle.archivedAt !== null) {
      throw VfmErrors.validationError([
        detail('vehicleId', 'Zadatak se ne može kreirati za arhivirano vozilo.'),
      ]);
    }
    return { id: vehicle.id, internalNo: vehicle.internalNo };
  }

  private effectiveAssignMode(input: CreateTaskInput, fallback: TaskAssignMode): TaskAssignMode {
    return input.assignMode ?? (input.assigneeUserId ? 'ASSIGN_DIRECT' : fallback);
  }

  private assertAssignModeShape(input: CreateTaskInput, assignMode: TaskAssignMode): void {
    const issues = [] as ReturnType<typeof detail>[];
    if (assignMode === 'ASSIGN_DIRECT') {
      if (!input.assigneeUserId)
        issues.push(detail('assigneeUserId', 'Direktna dodjela zahtijeva izvršioca.'));
      if (input.invitedUserIds.length > 0) {
        issues.push(detail('invitedUserIds', 'Direktna dodjela nema listu pozvanih korisnika.'));
      }
    } else if (input.assigneeUserId) {
      issues.push(detail('assigneeUserId', 'Izvršilac se može navesti samo za direktnu dodjelu.'));
    }
    if (assignMode === 'BROADCAST' && input.invitedUserIds.length > 0) {
      issues.push(detail('invitedUserIds', 'Broadcast zadatak nema listu pozvanih korisnika.'));
    }
    if (issues.length > 0) throw VfmErrors.validationError(issues);
  }

  private async assertRecipients(
    tx: Tx,
    input: CreateTaskInput,
    assignMode: TaskAssignMode,
    actorId: string,
  ): Promise<void> {
    const invited = assignMode === 'OPEN_CLAIM' ? input.invitedUserIds : [];
    const assignee = assignMode === 'ASSIGN_DIRECT' ? input.assigneeUserId : null;
    const observers = input.observerUserIds;
    const allIds = [...new Set([actorId, ...invited, ...(assignee ? [assignee] : []), ...observers])];
    const users = await tx.user.findMany({
      where: { id: { in: allIds }, deletedAt: null },
      select: { id: true, status: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    const actor = byId.get(actorId);
    if (!actor || actor.status !== 'ACTIVE') throw VfmErrors.unauthenticated();

    const issues = [] as ReturnType<typeof detail>[];
    const checkUser = (userId: string, path: string): boolean => {
      const user = byId.get(userId);
      if (!user) {
        issues.push(detail(path, 'Odabrani korisnik ne postoji.'));
        return false;
      }
      if (user.status !== 'ACTIVE') {
        issues.push(detail(path, 'Korisnik nije aktivan i ne može primiti zadatak.'));
        return false;
      }
      return true;
    };

    invited.forEach((userId, index) => checkUser(userId, `invitedUserIds[${index}]`));
    if (assignee) checkUser(assignee, 'assigneeUserId');
    observers.forEach((userId, index) => checkUser(userId, `observerUserIds[${index}]`));
    if (issues.length > 0) throw VfmErrors.validationError(issues);

    const claimCandidates = [
      ...invited.map((userId, index) => ({ userId, path: `invitedUserIds[${index}]` })),
      ...(assignee ? [{ userId: assignee, path: 'assigneeUserId' }] : []),
    ];
    const permissionIssues = [] as ReturnType<typeof detail>[];

    await Promise.all(
      claimCandidates.map(async ({ userId, path }) => {
        if (!(await this.permissions.hasPermission(userId, 'task:claim', 'OWN', 'WEB'))) {
          permissionIssues.push(detail(path, 'Korisnik nema pravo preuzimanja zadatka (`task:claim`).'));
        }
      }),
    );
    await Promise.all(
      observers.map(async (userId, index) => {
        const canView =
          (await this.permissions.hasPermission(userId, 'task:view', 'OWN', 'WEB')) ||
          (await this.permissions.hasPermission(userId, 'task:view_all', 'OWN', 'WEB'));
        if (!canView) {
          permissionIssues.push(
            detail(`observerUserIds[${index}]`, 'Posmatrač mora imati pravo pregleda zadataka.'),
          );
        }
      }),
    );

    if (permissionIssues.length > 0) throw VfmErrors.validationError(permissionIssues);
  }

  private async resolvePublishedTaskForm(
    tx: Tx,
    taskTypeId: string,
    formSchemaId: string | null,
  ): Promise<ResolvedTaskForm> {
    let candidateId = formSchemaId;
    if (!candidateId) {
      const bound = await tx.formSchema.findFirst({
        where: {
          subject: 'TASK',
          taskTypeId,
          deletedAt: null,
          currentPublishedVersionId: { not: null },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true },
      });
      candidateId = bound?.id ?? null;
    }

    if (!candidateId) {
      throw new VfmException(
        'FORM_VERSION_NOT_PUBLISHED',
        'Vrsta zadatka nema objavljenu TASK formu; zadatak se ne može kreirati.',
        [detail('taskTypeId', 'Povežite objavljenu TASK formu s vrstom zadatka.')],
      );
    }

    await this.lockRow(tx, 'FormSchema', candidateId);
    const schema = await tx.formSchema.findFirst({
      where: { id: candidateId, deletedAt: null },
      select: {
        id: true,
        subject: true,
        taskTypeId: true,
        currentPublishedVersionId: true,
      },
    });
    if (
      !schema ||
      schema.subject !== 'TASK' ||
      (schema.taskTypeId !== null && schema.taskTypeId !== taskTypeId) ||
      !schema.currentPublishedVersionId
    ) {
      throw new VfmException(
        'FORM_VERSION_NOT_PUBLISHED',
        'Efektivna TASK forma vrste nema objavljenu verziju; zadatak se ne može kreirati.',
        [detail('taskTypeId', 'Objavite i povežite ispravnu TASK formu s vrstom zadatka.')],
      );
    }

    const version = await tx.formSchemaVersion.findFirst({
      where: { id: schema.currentPublishedVersionId },
      select: {
        id: true,
        formSchemaId: true,
        version: true,
        status: true,
        definition: true,
      },
    });
    if (!version || version.formSchemaId !== schema.id || version.status !== 'PUBLISHED') {
      throw new VfmException(
        'FORM_VERSION_NOT_PUBLISHED',
        'Objavljena verzija efektivne TASK forme ne postoji.',
      );
    }

    return {
      formSchemaId: schema.id,
      formSchemaVersionId: version.id,
      version: version.version,
      status: version.status,
      definition: parseStoredDefinition(version.definition),
    };
  }

  private async loadSnapshotForm(tx: Tx, versionId: string): Promise<ResolvedTaskForm> {
    const version = await tx.formSchemaVersion.findFirst({
      where: { id: versionId },
      select: {
        id: true,
        formSchemaId: true,
        version: true,
        status: true,
        definition: true,
        formSchema: { select: { subject: true } },
      },
    });
    if (!version || version.formSchema.subject !== 'TASK') {
      throw new VfmException('FORM_VALIDATION_FAILED', 'Snapshotovana verzija TASK forme ne postoji.');
    }
    return {
      formSchemaId: version.formSchemaId,
      formSchemaVersionId: version.id,
      version: version.version,
      status: version.status,
      definition: parseStoredDefinition(version.definition),
    };
  }

  private validateDraftFormData(args: {
    form: ResolvedTaskForm;
    values: Record<string, unknown>;
    isNew: boolean;
    requirements: readonly RequirementRow[];
  }): Record<string, unknown> {
    const result = validateRecord({
      version: {
        id: args.form.formSchemaVersionId,
        version: args.form.version,
        status: args.form.status,
        definition: args.form.definition,
      },
      values: args.values,
      isNew: args.isNew,
      today: toLocalDateString(new Date()),
    });

    if (result.versionError) {
      throw new VfmException('FORM_VERSION_NOT_PUBLISHED', undefined, undefined, {
        versionError: result.versionError,
      });
    }

    const errors = result.errors.filter((error) => error.code !== 'REQUIRED');
    if (errors.length > 0) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        `Početni podaci forme nisu ispravni (${errors.length} greška/e).`,
        errors.map((error) => detail(`formData.${error.key}`, `${error.code}: ${error.message}`)),
        { errors },
      );
    }

    const values = { ...result.values } as Record<string, unknown>;
    this.assertOnCreateRequirements(args.form.definition, values, args.requirements);
    return values;
  }

  private assertOnCreateRequirements(
    definition: FormDefinition,
    values: Record<string, unknown>,
    requirements: readonly RequirementRow[],
  ): void {
    const fields = new Map(flattenFields(definition).map(({ field }) => [field.key, field]));
    const issues = [] as ReturnType<typeof detail>[];

    for (const requirement of requirements) {
      if (requirement.stage !== 'ON_CREATE' || !requirement.required) continue;
      const field = fields.get(requirement.fieldKey);
      if (!field) {
        issues.push(
          detail(
            `formData.${requirement.fieldKey}`,
            `ON_CREATE zahtjev pokazuje na polje koje ne postoji u snapshotovanoj formi.`,
          ),
        );
        continue;
      }

      const value = values[requirement.fieldKey];
      if (requirement.minPhotos > 0) {
        if (field.type !== 'PHOTO') {
          issues.push(
            detail(
              `formData.${requirement.fieldKey}`,
              'ON_CREATE zahtjev za fotografije mora pokazivati na PHOTO polje.',
            ),
          );
        } else if (!Array.isArray(value) || value.length < requirement.minPhotos) {
          issues.push(
            detail(
              `formData.${requirement.fieldKey}`,
              `Pri kreiranju je potrebno najmanje ${requirement.minPhotos} fotografija.`,
            ),
          );
        }
        continue;
      }

      if (isEmptyValue(value)) {
        issues.push(detail(`formData.${requirement.fieldKey}`, 'Polje je obavezno pri kreiranju zadatka.'));
      }
    }

    if (issues.length > 0) {
      throw new VfmException('FORM_VALIDATION_FAILED', 'ON_CREATE zahtjevi zadatka nisu ispunjeni.', issues);
    }
  }

  private async nextTaskCode(tx: Tx, now: Date): Promise<string> {
    const year = toLocalDateString(now).slice(0, 4);
    const lockKey = `vfm:task-code:${year}`;
    await tx.$queryRaw<Array<{ locked: unknown }>>`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey})) AS "locked"`;

    const prefix = `Z-${year}-`;
    const rows = await tx.task.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });
    let max = 0;
    for (const row of rows) {
      const suffix = row.code.slice(prefix.length);
      if (/^\d+$/u.test(suffix)) max = Math.max(max, Number.parseInt(suffix, 10));
    }
    return `${prefix}${String(max + 1).padStart(6, '0')}`;
  }

  private eventData(args: {
    taskId: string;
    action: Prisma.TaskEventCreateManyInput['action'];
    actor: TaskActorContext;
    at: Date;
    data: Record<string, unknown>;
    formSchemaVersionId?: string | null;
  }): Prisma.TaskEventCreateManyInput {
    return {
      id: randomUUID(),
      taskId: args.taskId,
      action: args.action,
      actorId: args.actor.id,
      actorRole: args.actor.roles?.length ? args.actor.roles.join(',') : null,
      at: args.at,
      ipAddress: args.actor.ipAddress ?? null,
      clientType: args.actor.clientType ?? null,
      requestId: args.actor.requestId ?? null,
      data: args.data as Prisma.InputJsonObject,
      formSchemaVersionId: args.formSchemaVersionId ?? null,
    };
  }

  private async createOutbox(
    tx: Tx,
    args: {
      taskId: string;
      code: string;
      eventType: 'TASK_CREATED' | 'TASK_CANCELLED' | 'TASK_REOPENED';
      status: TaskStatus;
      version: number;
      actorId: string;
      recipientUserIds: readonly string[];
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: randomUUID(),
        aggregateType: 'TASK',
        aggregateId: args.taskId,
        eventType: args.eventType,
        idempotencyKey: `task:${args.taskId}:${args.eventType}:v${args.version}`,
        payload: {
          taskId: args.taskId,
          code: args.code,
          status: args.status,
          version: args.version,
          actorId: args.actorId,
          recipientUserIds: [...new Set(args.recipientUserIds)],
          ...(args.extra ?? {}),
        } as Prisma.InputJsonObject,
      },
    });
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new VfmException(
        'VERSION_CONFLICT',
        'Zadatak je u međuvremenu izmijenjen. Ponovo ga učitajte.',
        undefined,
        {
          currentVersion: current,
        },
      );
    }
  }

  private async throwCasFailure(tx: Tx, id: string, expectedVersion: number): Promise<never> {
    const fresh = await tx.task.findFirst({
      where: { id, deletedAt: null },
      select: { version: true },
    });
    if (!fresh) throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    if (fresh.version !== expectedVersion) {
      throw new VfmException(
        'VERSION_CONFLICT',
        'Zadatak je u međuvremenu izmijenjen. Ponovo ga učitajte.',
        undefined,
        {
          currentVersion: fresh.version,
        },
      );
    }
    throw new VfmException('INVALID_TASK_TRANSITION', 'Status zadatka se u međuvremenu promijenio.');
  }
}
