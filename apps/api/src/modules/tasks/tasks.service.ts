/**
 * Zadaci — jezgra, atomsko preuzimanje i završetak u Fazi 5 (docs/07 §2.11).
 *
 * Servis pokriva kreiranje, čitanje, djelimičnu izmjenu, otkazivanje,
 * ponovno otvaranje, listu slobodnih zadataka, claim i završetak. Tek pri
 * završetku forma prolazi punu validaciju i normalizaciju u kolone zadatka.
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
  type PermissionScope,
  type TaskAssignMode,
  type TaskStatus,
} from '@vfm/shared';
import {
  flattenFields,
  NORMALIZATION_COLUMNS,
  validateRecord,
  type AttachmentFacts,
  type FormDefinition,
} from '@vfm/form-engine';
import type {
  AssignTaskInput,
  CreateTaskCommentInput,
  CancelTaskInput,
  ClaimTaskInput,
  CompleteTaskInput,
  CreateTaskInput,
  ReopenTaskInput,
  ReleaseTaskInput,
  TaskAssignmentView,
  TaskAvailableQuery,
  TaskCommentListQuery,
  TaskCommentListResponse,
  TaskCommentView,
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

const TASK_ATTACHMENT_SELECT = {
  id: true,
  ownerType: true,
  ownerId: true,
  stage: true,
  mimeType: true,
  sizeBytes: true,
  uploadedById: true,
  taskId: true,
  formFieldKey: true,
  deletedAt: true,
} as const satisfies Prisma.AttachmentSelect;

/**
 * Rezultat završetka smije iz forme napuniti samo mjerljive kolone. Naslov,
 * opis, prioritet i rok ostaju sistemska polja zadatka pod kontrolom DTO-a i
 * PATCH toka, iako ih form-engine poznaje kao moguće TASK kolone.
 */
const TASK_COMPLETION_NORMALIZED_COLUMNS = ['odometerKm', 'totalCost', 'fuelLiters', 'fuelAmount'] as const;
type TaskCompletionNormalizedColumn = (typeof TASK_COMPLETION_NORMALIZED_COLUMNS)[number];

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
  readonly claimScope: PermissionScope | null;
  /** `null` = bez ograničenja po vozilu; prazan skup = nijedno vozilo. */
  readonly claimVehicleIds: readonly string[] | null;
  readonly completeScope: PermissionScope | null;
  readonly completeVehicleIds: readonly string[] | null;
  readonly completeOverrideScope: PermissionScope | null;
  readonly completeOverrideVehicleIds: readonly string[] | null;
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

type TaskAttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof TASK_ATTACHMENT_SELECT }>;

interface CompletionAttachmentPlan {
  /** Činjenice za form-engine: samo prilozi koji smiju pripasti ovom zadatku. */
  readonly facts: ReadonlyMap<string, AttachmentFacts>;
  /** Kanonsko vezivanje po prilogu; `null` je opći prilog bez polja forme. */
  readonly bindings: ReadonlyMap<string, string | null>;
  readonly rows: ReadonlyMap<string, TaskAttachmentRow>;
  readonly referencedIds: readonly string[];
}

interface ValidatedCompletionForm {
  readonly values: Record<string, unknown>;
  readonly normalized: Partial<Record<TaskCompletionNormalizedColumn, number>>;
  readonly mappedColumns: ReadonlySet<TaskCompletionNormalizedColumn>;
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

    return this.queryTaskPage({ AND: conditions }, query, now);
  }

  /**
   * Zadataci koje akter u ovom trenutku smije preuzeti.
   *
   * Kandidatura je ista kao u atomskom claim-u: direktni izvršilac, pozvani
   * ili kreator kod `OPEN_CLAIM` te svi nosioci primjenjivog `task:claim`
   * opsega kod `BROADCAST` zadatka. `task:view_all` sam po sebi ne daje
   * kandidaturu za tuđi direktni ili pozvani zadatak.
   */
  async available(
    query: TaskAvailableQuery,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskListResponse> {
    const access = await this.resolveAccess(actorInput);
    this.assertClaimPermission(access);

    const now = new Date();
    const conditions: Prisma.TaskWhereInput[] = [
      { deletedAt: null },
      { status: 'OPEN' },
      this.claimEligibilityWhere(access),
      {
        assignments: {
          none: {
            role: 'ASSIGNEE',
            revokedAt: null,
            NOT: { userId: access.actor.id },
          },
        },
      },
    ];

    if (query.vehicleId) conditions.push({ vehicleId: query.vehicleId });
    if (query.taskTypeId) conditions.push({ taskTypeId: query.taskTypeId });
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
    if (query.overdueOnly) conditions.push({ dueAt: { lt: now } });

    return this.queryTaskPage({ AND: conditions }, query, now);
  }

  private async queryTaskPage(
    where: Prisma.TaskWhereInput,
    query: {
      readonly page: number;
      readonly pageSize: number;
      readonly sortBy?: string;
      readonly sortOrder: 'asc' | 'desc';
    },
    now = new Date(),
  ): Promise<TaskListResponse> {
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

  async listEvents(id: string, actorInput: TaskActorContext | string | undefined): Promise<TaskEventView[]> {
    const access = await this.resolveAccess(actorInput);
    const task = await this.loadDetail(this.prisma, id);
    if (!this.canView(task, access)) throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    return task.events.map(serializeEvent);
  }

  async listComments(
    id: string,
    query: TaskCommentListQuery,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskCommentListResponse> {
    const access = await this.resolveAccess(actorInput);
    const canRead =
      access.permissions.isSuperAdmin ||
      access.permissions.permissions.has('task:view') ||
      access.permissions.permissions.has('task:view_all');
    if (!canRead) {
      throw VfmErrors.permissionDenied([detail('task:view', 'Za pregled komentara potreban je task:view.')]);
    }
    const task = await this.loadDetail(this.prisma, id);
    if (!this.canView(task, access)) throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    const where = { taskId: id, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prisma.taskComment.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          taskId: true,
          authorId: true,
          body: true,
          mentionsUserIds: true,
          createdAt: true,
          updatedAt: true,
          author: { select: USER_NAME_FIELDS },
        },
      }),
      this.prisma.taskComment.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        authorId: row.authorId,
        authorName: userName(row.author) ?? row.authorId,
        body: row.body,
        mentionsUserIds: row.mentionsUserIds,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async addComment(
    id: string,
    input: CreateTaskCommentInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskCommentView> {
    const access = await this.resolveAccess(actorInput);
    const commentScope = access.permissions.isSuperAdmin
      ? 'ALL'
      : (access.permissions.permissions.get('task:comment') ?? null);
    if (commentScope === null) {
      throw VfmErrors.permissionDenied([detail('task:comment', 'Za komentar je potreban task:comment.')]);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const task = await this.loadDetail(tx, id);
      const visible = this.canView(task, access);
      if (!visible) throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
      const related =
        task.createdById === access.actor.id ||
        task.assigneeUserId === access.actor.id ||
        task.completedById === access.actor.id ||
        task.assignments.some((assignment) => assignment.userId === access.actor.id && !assignment.revokedAt);
      const commentVehicleIds = access.permissions.grants
        .filter((grant) => grant.permission === 'task:comment' && grant.scope === 'VEHICLE_IDS')
        .flatMap((grant) => grant.scopeVehicleIds ?? []);
      const commentAllowed =
        commentScope === 'ALL' ||
        (commentScope === 'OWN' && related) ||
        (commentScope === 'VEHICLE_IDS' &&
          task.vehicleId !== null &&
          commentVehicleIds.includes(task.vehicleId));
      if (!commentAllowed) {
        throw VfmErrors.scopeDenied([
          detail('task:comment', 'Permisija za komentar ne obuhvata ovaj zadatak.'),
        ]);
      }
      const now = new Date();
      const commentId = randomUUID();
      await tx.taskComment.create({
        data: {
          id: commentId,
          taskId: id,
          authorId: access.actor.id,
          body: input.body,
          mentionsUserIds: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: 'COMMENTED',
          actor: access.actor,
          at: now,
          data: { commentId },
          formSchemaVersionId: task.formSchemaVersionId,
        }),
      });
      await tx.outboxEvent.create({
        data: {
          id: randomUUID(),
          aggregateType: 'TASK',
          aggregateId: id,
          eventType: 'TASK_COMMENTED',
          idempotencyKey: `task:${id}:TASK_COMMENTED:${commentId}`,
          payload: {
            taskId: id,
            code: task.code,
            status: task.status,
            version: task.version,
            actorId: access.actor.id,
            commentId,
            recipientUserIds: this.involvedUserIds(task, access.actor.id),
          } as Prisma.InputJsonObject,
        },
      });
      const author = await tx.user.findFirst({
        where: { id: access.actor.id },
        select: USER_NAME_FIELDS,
      });
      return {
        id: commentId,
        taskId: id,
        authorId: access.actor.id,
        authorName: userName(author) ?? access.actor.id,
        body: input.body,
        mentionsUserIds: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    });
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
        const taskId = randomUUID();
        const attachmentPlan = await this.prepareCompletionAttachments(tx, {
          taskId,
          actorId: actor.id,
          definition: form.definition,
          values: input.formData,
          attachmentIds: [],
        });
        const formData = this.validateDraftFormData({
          form,
          values: input.formData,
          isNew: true,
          requirements: taskType.completionRequirements,
          attachments: attachmentPlan.facts,
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
        await this.bindCompletionAttachments(tx, taskId, actor.id, attachmentPlan, 'ON_CREATE');

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

  /**
   * Vraća zadatak u toku među slobodne. Otvorena/broadcast dodjela uklanja
   * trenutnog izvršioca i opoziva ASSIGNEE red; kod direktne dodjele ostaje
   * unaprijed izabrani izvršilac kao jedini kandidat za novo preuzimanje.
   */
  async release(
    id: string,
    input: ReleaseTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);
    const releaseScope = access.permissions.isSuperAdmin
      ? 'ALL'
      : (access.permissions.permissions.get('task:release') ?? null);
    if (releaseScope !== 'ALL') {
      throw VfmErrors.permissionDenied([
        detail('task:release', 'Za vraćanje zadatka među slobodne potrebno je task:release s punim opsegom.'),
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);
      this.assertVersion(current.version, input.version);
      if (!canTransitionTask(current.status, 'OPEN')) {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          `Zadatak u statusu ${current.status} se ne može vratiti među slobodne.`,
          undefined,
          { from: current.status, to: 'OPEN' },
        );
      }

      const now = new Date();
      const releaseDirectAssignment = current.assignMode === 'ASSIGN_DIRECT';
      const changed = await tx.task.updateMany({
        where: { id, version: input.version, status: 'IN_PROGRESS', deletedAt: null },
        data: {
          status: 'OPEN',
          assigneeUserId: releaseDirectAssignment ? current.assigneeUserId : null,
          claimedAt: null,
          durationMinutes: null,
          releasedAt: now,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) await this.throwCasFailure(tx, id, input.version);

      if (!releaseDirectAssignment) {
        await tx.taskAssignment.updateMany({
          where: { taskId: id, role: 'ASSIGNEE', revokedAt: null },
          data: { revokedAt: now },
        });
      }

      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: 'RELEASED',
          actor: access.actor,
          at: now,
          data: {
            fromStatus: 'IN_PROGRESS',
            toStatus: 'OPEN',
            previousAssigneeUserId: current.assigneeUserId,
            assigneeUserId: releaseDirectAssignment ? current.assigneeUserId : null,
            assignMode: current.assignMode,
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
        eventType: 'TASK_RELEASED',
        status: 'OPEN',
        version: current.version + 1,
        actorId: access.actor.id,
        recipientUserIds: this.involvedUserIds(current, access.actor.id),
        extra: {
          fromStatus: 'IN_PROGRESS',
          previousAssigneeUserId: current.assigneeUserId,
          assigneeUserId: releaseDirectAssignment ? current.assigneeUserId : null,
          assignMode: current.assignMode,
          reason: input.reason ?? null,
        },
      });

      const updated = await this.loadDetail(tx, id);
      const serialized = this.serializeDetail(updated, now);
      return {
        data: serialized,
        before: { ...before },
        after: { ...serialized },
        meta: {
          code: serialized.code,
          status: serialized.status,
          previousAssigneeUserId: current.assigneeUserId,
          assigneeUserId: serialized.assigneeUserId,
          assignMode: serialized.assignMode,
          reason: input.reason ?? null,
        },
      };
    });
  }

  /** Naknadno mijenja način dodjele i aktivne kandidate zadatka. */
  async assign(
    id: string,
    input: AssignTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);
    const assignScope = access.permissions.isSuperAdmin
      ? 'ALL'
      : (access.permissions.permissions.get('task:assign') ?? null);
    if (assignScope !== 'ALL') {
      throw VfmErrors.permissionDenied([
        detail('task:assign', 'Za izmjenu dodjele potreban je task:assign s punim opsegom.'),
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);
      this.assertVersion(current.version, input.version);
      if (current.status !== 'OPEN' && current.status !== 'IN_PROGRESS') {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          'Dodjela se može izmijeniti samo na otvorenom zadatku ili zadatku u toku.',
          undefined,
          { status: current.status },
        );
      }
      if (current.status === 'IN_PROGRESS' && input.mode !== 'ASSIGN_DIRECT') {
        throw VfmErrors.validationError([
          detail('mode', 'Zadatak u toku mora ostati direktno dodijeljen jednom izvršiocu.'),
        ]);
      }

      const users = await tx.user.findMany({
        where: { id: { in: input.userIds }, deletedAt: null },
        select: { id: true, status: true },
      });
      const activeIds = new Set(users.filter((user) => user.status === 'ACTIVE').map((user) => user.id));
      const invalidUsers = input.userIds.filter((userId) => !activeIds.has(userId));
      if (invalidUsers.length) {
        throw VfmErrors.validationError(
          invalidUsers.map((userId) => detail('userIds', `Korisnik ${userId} ne postoji ili nije aktivan.`)),
        );
      }
      const candidateIds = input.mode === 'BROADCAST' ? [] : input.userIds;
      const unauthorized: string[] = [];
      for (const userId of candidateIds) {
        if (!(await this.permissions.hasPermission(userId, 'task:claim', 'OWN', 'WEB'))) {
          unauthorized.push(userId);
        }
      }
      if (unauthorized.length) {
        throw VfmErrors.validationError(
          unauthorized.map((userId) => detail('userIds', `Korisnik ${userId} nema task:claim.`)),
        );
      }

      const now = new Date();
      const assigneeUserId = input.mode === 'ASSIGN_DIRECT' ? input.userIds[0]! : null;
      const changed = await tx.task.updateMany({
        where: { id, deletedAt: null, version: input.version, status: current.status },
        data: {
          assignMode: input.mode,
          assigneeUserId,
          claimedAt: current.status === 'IN_PROGRESS' ? now : null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) await this.throwCasFailure(tx, id, input.version);

      await tx.taskAssignment.updateMany({
        where: { taskId: id, role: { in: ['ASSIGNEE', 'INVITED'] }, revokedAt: null },
        data: { revokedAt: now },
      });
      const newAssignments = [
        ...(assigneeUserId ? [{ userId: assigneeUserId, role: 'ASSIGNEE' }] : []),
        ...(input.mode === 'OPEN_CLAIM' ? input.userIds.map((userId) => ({ userId, role: 'INVITED' })) : []),
      ];
      for (const assignment of newAssignments) {
        const existing = await tx.taskAssignment.findFirst({
          where: { taskId: id, userId: assignment.userId, role: assignment.role },
          select: { id: true },
        });
        if (existing) {
          await tx.taskAssignment.updateMany({
            where: { id: existing.id },
            data: { revokedAt: null, assignedById: access.actor.id, assignedAt: now, note: null },
          });
        } else {
          await tx.taskAssignment.create({
            data: {
              id: randomUUID(),
              taskId: id,
              userId: assignment.userId,
              role: assignment.role,
              assignedById: access.actor.id,
              assignedAt: now,
              revokedAt: null,
              note: null,
            },
          });
        }
      }

      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: 'ASSIGNED',
          actor: access.actor,
          at: now,
          data: {
            fromAssignMode: current.assignMode,
            assignMode: input.mode,
            previousAssigneeUserId: current.assigneeUserId,
            assigneeUserId,
            userIds: input.userIds,
            previousVersion: current.version,
            version: current.version + 1,
          },
          formSchemaVersionId: current.formSchemaVersionId,
        }),
      });
      await this.createOutbox(tx, {
        taskId: id,
        code: current.code,
        eventType: 'TASK_ASSIGNED',
        status: current.status,
        version: current.version + 1,
        actorId: access.actor.id,
        recipientUserIds: [...new Set([...this.involvedUserIds(current), ...input.userIds])].filter(
          (userId) => userId !== access.actor.id,
        ),
        extra: {
          assignMode: input.mode,
          broadcast: input.mode === 'BROADCAST',
          previousAssigneeUserId: current.assigneeUserId,
          assigneeUserId,
          userIds: input.userIds,
        },
      });

      const updated = await this.loadDetail(tx, id);
      const serialized = this.serializeDetail(updated, now);
      return {
        data: serialized,
        before: { ...before },
        after: { ...serialized },
        meta: { code: serialized.code, status: serialized.status, assigneeUserId },
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

  /**
   * Atomsko preuzimanje slobodnog zadatka.
   *
   * Kandidatura i forma se provjere nad trenutnim zapisom, ali pobjednika
   * odlučuje jedan uslovni `UPDATE` (`OPEN` + učitana verzija + kandidatura
   * u `WHERE` dijelu). Paralelni gubitnik zato ne može upisati drugog
   * izvršioca: njegov `count` je 0 i svježe stanje se mapira na
   * `409 TASK_ALREADY_CLAIMED`. Ako je u međuvremenu samo PATCH povećao
   * verziju, pokušaj se ograničeno ponavlja nad svježim nacrtom forme.
   */
  async claim(
    id: string,
    input: ClaimTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);
    this.assertClaimPermission(access);

    return this.prisma.$transaction(async (tx) => {
      await this.assertActiveClaimant(tx, access.actor.id);
      let latestVersion = 0;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.loadDetail(tx, id);
        latestVersion = current.version;
        const before = this.serializeDetail(current);
        this.assertClaimable(current, access);

        const form = await this.loadSnapshotForm(tx, current.formSchemaVersionId);
        const requirements = await tx.taskCompletionRequirement.findMany({
          where: {
            taskTypeId: current.taskTypeId,
            stage: { in: ['ON_CREATE', 'ON_CLAIM'] },
          },
          select: { fieldKey: true, required: true, stage: true, minPhotos: true },
        });
        const formData = this.validateDraftFormData({
          form,
          values: { ...plainRecord(current.formData), ...input.formData },
          isNew: false,
          requirements,
          stages: ['ON_CREATE', 'ON_CLAIM'],
        });

        const now = new Date();
        const data: Prisma.TaskUncheckedUpdateManyInput = {
          status: 'IN_PROGRESS',
          assigneeUserId: access.actor.id,
          claimedAt: now,
          formData: formData as Prisma.InputJsonObject,
          version: { increment: 1 },
        };
        const changed = await tx.task.updateMany({
          where: {
            id,
            deletedAt: null,
            status: 'OPEN',
            version: current.version,
            AND: [
              this.claimEligibilityWhere(access),
              {
                assignments: {
                  none: {
                    role: 'ASSIGNEE',
                    revokedAt: null,
                    NOT: { userId: access.actor.id },
                  },
                },
              },
            ],
          },
          data,
        });

        if (changed.count !== 1) {
          const fresh = await this.loadDetail(tx, id);
          latestVersion = fresh.version;
          this.assertClaimable(fresh, access);
          if (fresh.version !== current.version && attempt < 2) continue;
          throw new VfmException(
            'VERSION_CONFLICT',
            'Zadatak je u međuvremenu izmijenjen. Ponovo ga učitajte i pokušajte preuzeti.',
            undefined,
            { currentVersion: fresh.version },
          );
        }

        await this.ensureClaimAssignment(tx, id, access.actor.id, now);
        await tx.taskEvent.create({
          data: this.eventData({
            taskId: id,
            action: 'CLAIMED',
            actor: access.actor,
            at: now,
            data: {
              fromStatus: 'OPEN',
              toStatus: 'IN_PROGRESS',
              assigneeUserId: access.actor.id,
              previousAssigneeUserId: current.assigneeUserId,
              assignMode: current.assignMode,
              previousVersion: current.version,
              version: current.version + 1,
            },
            formSchemaVersionId: current.formSchemaVersionId,
          }),
        });
        await this.createOutbox(tx, {
          taskId: id,
          code: current.code,
          eventType: 'TASK_CLAIMED',
          status: 'IN_PROGRESS',
          version: current.version + 1,
          actorId: access.actor.id,
          recipientUserIds: this.involvedUserIds(current, access.actor.id),
          extra: {
            fromStatus: 'OPEN',
            assigneeUserId: access.actor.id,
            assignMode: current.assignMode,
            broadcast: current.assignMode === 'BROADCAST',
          },
        });

        const updated = await this.loadDetail(tx, id);
        const serialized = this.serializeDetail(updated, now);
        return {
          data: serialized,
          before: { ...before },
          after: { ...serialized },
          meta: {
            code: serialized.code,
            status: serialized.status,
            assigneeUserId: serialized.assigneeUserId,
            claimedAt: serialized.claimedAt,
          },
        };
      }

      throw new VfmException(
        'VERSION_CONFLICT',
        'Zadatak je u međuvremenu izmijenjen. Ponovo ga učitajte i pokušajte preuzeti.',
        undefined,
        { currentVersion: latestVersion },
      );
    });
  }

  /**
   * Završetak zadatka u izvršavanju.
   *
   * Red se zaključava i CAS-om prelazi `IN_PROGRESS → COMPLETED`. Poslani
   * `formData` spaja se s nacrtom, zatim prolazi punu validaciju prema
   * snapshotovanoj formi, svim dosadašnjim zahtjevima vrste i stvarnim
   * prilozima. U istoj transakciji nastaju vezani prilozi, opcioni komentar,
   * `COMPLETED`/`OVERRIDE_COMPLETED` događaj i `TASK_COMPLETED` outbox.
   */
  async complete(
    id: string,
    input: CompleteTaskInput,
    actorInput: TaskActorContext | string | undefined,
  ): Promise<TaskMutation<TaskDetail>> {
    const access = await this.resolveAccess(actorInput);

    return this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'Task', id);
      const current = await this.loadDetail(tx, id);
      const before = this.serializeDetail(current);
      const { override } = this.authorizeCompletion(current, access);
      this.assertVersion(current.version, input.version);

      if (!canTransitionTask(current.status, 'COMPLETED')) {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          `Zadatak u statusu ${current.status} se ne može završiti.`,
          undefined,
          { from: current.status, to: 'COMPLETED' },
        );
      }
      const hasActiveAssignee =
        current.assigneeUserId !== null &&
        current.assignments.some(
          (assignment) =>
            assignment.role === 'ASSIGNEE' &&
            assignment.userId === current.assigneeUserId &&
            !assignment.revokedAt,
        );
      if (!hasActiveAssignee) {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          'Zadatak u izvršavanju nema aktivnog izvršioca i ne može se završiti.',
          undefined,
          { from: current.status, to: 'COMPLETED' },
        );
      }
      if (input.odometerKm !== undefined && current.vehicleId === null) {
        throw VfmErrors.validationError([
          detail('odometerKm', 'Kilometraža se može evidentirati samo za zadatak s vozilom.'),
        ]);
      }

      const form = await this.loadSnapshotForm(tx, current.formSchemaVersionId);
      const requirements = await tx.taskCompletionRequirement.findMany({
        where: { taskTypeId: current.taskTypeId },
        select: { fieldKey: true, required: true, stage: true, minPhotos: true },
      });
      const mergedFormData = this.dedupeAttachmentFieldValues(form.definition, {
        ...plainRecord(current.formData),
        ...input.formData,
      });
      const attachmentPlan = await this.prepareCompletionAttachments(tx, {
        taskId: id,
        actorId: access.actor.id,
        definition: form.definition,
        values: mergedFormData,
        attachmentIds: input.attachmentIds,
      });
      const validated = this.validateCompletionFormData({
        form,
        values: mergedFormData,
        requirements,
        attachments: attachmentPlan.facts,
      });

      if (
        input.odometerKm !== undefined &&
        validated.normalized.odometerKm !== undefined &&
        input.odometerKm !== validated.normalized.odometerKm
      ) {
        throw VfmErrors.validationError([
          detail('odometerKm', 'Kilometraža iz zahtjeva mora biti jednaka kilometraži iz završne forme.'),
        ]);
      }
      const effectiveOdometerKm =
        input.odometerKm ??
        (validated.mappedColumns.has('odometerKm')
          ? (validated.normalized.odometerKm ?? null)
          : current.odometerKm);

      const now = new Date();
      const durationMinutes = current.claimedAt
        ? Math.max(0, Math.floor((now.getTime() - current.claimedAt.getTime()) / 60_000))
        : null;
      const data: Prisma.TaskUncheckedUpdateManyInput = {
        status: 'COMPLETED',
        completedAt: now,
        completedById: access.actor.id,
        durationMinutes,
        formData: validated.values as Prisma.InputJsonObject,
        version: { increment: 1 },
      };
      if (validated.mappedColumns.has('odometerKm') || input.odometerKm !== undefined) {
        data.odometerKm = effectiveOdometerKm;
      }
      if (validated.mappedColumns.has('totalCost')) {
        data.totalCost = validated.normalized.totalCost ?? null;
      }
      if (validated.mappedColumns.has('fuelLiters')) {
        data.fuelLiters = validated.normalized.fuelLiters ?? null;
      }
      if (validated.mappedColumns.has('fuelAmount')) {
        data.fuelAmount = validated.normalized.fuelAmount ?? null;
      }

      const changed = await tx.task.updateMany({
        where: {
          id,
          version: input.version,
          status: 'IN_PROGRESS',
          assigneeUserId: current.assigneeUserId,
          deletedAt: null,
        },
        data,
      });
      if (changed.count !== 1) await this.throwCasFailure(tx, id, input.version);

      const boundAttachmentIds = await this.bindCompletionAttachments(
        tx,
        id,
        access.actor.id,
        attachmentPlan,
      );

      const comment = input.comment?.trim() ? input.comment.trim() : null;
      let commentId: string | null = null;
      if (comment) {
        commentId = randomUUID();
        await tx.taskComment.create({
          data: {
            id: commentId,
            taskId: id,
            authorId: access.actor.id,
            body: comment,
            mentionsUserIds: [],
            createdAt: now,
            updatedAt: now,
          } as Prisma.TaskCommentUncheckedCreateInput,
        });
      }

      const eventAction = override ? ('OVERRIDE_COMPLETED' as const) : ('COMPLETED' as const);
      await tx.taskEvent.create({
        data: this.eventData({
          taskId: id,
          action: eventAction,
          actor: access.actor,
          at: now,
          data: {
            fromStatus: 'IN_PROGRESS',
            toStatus: 'COMPLETED',
            assigneeUserId: current.assigneeUserId,
            completedById: access.actor.id,
            override,
            reason: input.reason ?? null,
            durationMinutes,
            odometerKm: effectiveOdometerKm,
            normalized: validated.normalized,
            attachmentIds: attachmentPlan.referencedIds,
            submittedAttachmentIds: [...input.attachmentIds],
            boundAttachmentIds,
            commentId,
            comment,
            previousVersion: current.version,
            version: current.version + 1,
          },
          formSchemaVersionId: current.formSchemaVersionId,
        }),
      });
      await this.createOutbox(tx, {
        taskId: id,
        code: current.code,
        eventType: 'TASK_COMPLETED',
        status: 'COMPLETED',
        version: current.version + 1,
        actorId: access.actor.id,
        recipientUserIds: this.involvedUserIds(current, access.actor.id),
        extra: {
          fromStatus: 'IN_PROGRESS',
          assigneeUserId: current.assigneeUserId,
          completedById: access.actor.id,
          override,
          reason: input.reason ?? null,
          durationMinutes,
          odometerKm: effectiveOdometerKm,
          submittedAttachmentIds: [...input.attachmentIds],
          commentId,
        },
      });

      const updated = await this.loadDetail(tx, id);
      const serialized = this.serializeDetail(updated, now);
      return {
        data: serialized,
        before: { ...before },
        after: { ...serialized },
        meta: {
          code: serialized.code,
          status: serialized.status,
          assigneeUserId: serialized.assigneeUserId,
          completedById: serialized.completedById,
          completedAt: serialized.completedAt,
          durationMinutes: serialized.durationMinutes,
          override,
          reason: input.reason ?? null,
          commentId,
          boundAttachmentIds,
        },
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

  private assertClaimPermission(access: ActorAccess): void {
    if (access.claimScope !== null) return;
    throw VfmErrors.permissionDenied([
      detail('task:claim', 'Za pregled slobodnih zadataka i preuzimanje potrebna je permisija task:claim.'),
    ]);
  }

  private completionScopeAllows(
    row: TaskDetailRow,
    access: ActorAccess,
    scope: PermissionScope | null,
    vehicleIds: readonly string[] | null,
    override: boolean,
  ): boolean {
    if (scope === null || scope === 'DRIVER_IDS') return false;
    if (scope === 'ALL') return true;
    if (scope === 'VEHICLE_IDS') {
      return row.vehicleId !== null && vehicleIds !== null && vehicleIds.includes(row.vehicleId);
    }
    return row.assigneeUserId === access.actor.id || (override && row.createdById === access.actor.id);
  }

  /**
   * Običan završetak pripada trenutnom izvršiocu. Drugi akter prolazi samo
   * kroz primjenjivi `task:complete_override` opseg; vidljivom neizvršiocu
   * bez tog prava vraća se P7 greška `NOT_ASSIGNEE`, a nevidljiv zadatak se
   * ne otkriva.
   */
  private authorizeCompletion(row: TaskDetailRow, access: ActorAccess): { override: boolean } {
    const isAssignee = row.assigneeUserId === access.actor.id;
    const canSelfComplete =
      isAssignee &&
      (this.completionScopeAllows(row, access, access.completeScope, access.completeVehicleIds, false) ||
        this.completionScopeAllows(
          row,
          access,
          access.completeOverrideScope,
          access.completeOverrideVehicleIds,
          false,
        ));
    if (canSelfComplete) return { override: false };

    const canOverride =
      !isAssignee &&
      this.completionScopeAllows(
        row,
        access,
        access.completeOverrideScope,
        access.completeOverrideVehicleIds,
        true,
      );
    if (canOverride) return { override: true };

    if (access.completeScope === null && access.completeOverrideScope === null) {
      throw VfmErrors.permissionDenied([
        detail(
          'task:complete',
          'Za završetak zadatka potrebna je permisija task:complete ili task:complete_override.',
        ),
      ]);
    }
    if (isAssignee) {
      throw VfmErrors.scopeDenied([
        detail('task:complete', 'Permisija za završetak ne obuhvata ovaj zadatak.'),
      ]);
    }
    if (!this.canView(row, access)) {
      throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    }
    if (access.completeOverrideScope !== null) {
      throw VfmErrors.scopeDenied([
        detail('task:complete_override', 'Override permisija ne obuhvata ovaj zadatak.'),
      ]);
    }
    throw new VfmException(
      'NOT_ASSIGNEE',
      'Zadatak može završiti samo dodijeljeni izvršilac ili korisnik s task:complete_override permisijom.',
      undefined,
      { taskId: row.id, assigneeUserId: row.assigneeUserId },
    );
  }

  private async assertActiveClaimant(tx: Tx, actorId: string): Promise<void> {
    const user = await tx.user.findFirst({
      where: { id: actorId, deletedAt: null },
      select: { status: true },
    });
    if (!user || user.status !== 'ACTIVE') throw VfmErrors.accountInactive();
  }

  private claimVehicleAllowed(row: TaskDetailRow, access: ActorAccess): boolean {
    if (access.claimVehicleIds === null) return true;
    return row.vehicleId !== null && access.claimVehicleIds.includes(row.vehicleId);
  }

  /** Da li akter pripada krugu kandidata, neovisno o trenutnom statusu. */
  private isClaimCandidate(row: TaskDetailRow, access: ActorAccess): boolean {
    if (access.claimScope === null || access.claimScope === 'DRIVER_IDS') return false;
    if (!this.claimVehicleAllowed(row, access)) return false;

    const actorId = access.actor.id;
    const activeRoles = new Set(
      row.assignments
        .filter((assignment) => assignment.userId === actorId && !assignment.revokedAt)
        .map((assignment) => assignment.role),
    );
    if (row.assigneeUserId === actorId || activeRoles.has('ASSIGNEE')) return true;

    if (row.assignMode === 'ASSIGN_DIRECT') return false;
    if (row.assignMode === 'OPEN_CLAIM') {
      return row.createdById === actorId || activeRoles.has('INVITED');
    }
    return access.claimScope !== 'OWN' || row.createdById === actorId;
  }

  private canClaimNow(row: TaskDetailRow, access: ActorAccess): boolean {
    if (row.status !== 'OPEN' || !this.isClaimCandidate(row, access)) return false;
    const actorId = access.actor.id;
    if (row.assigneeUserId !== null && row.assigneeUserId !== actorId) return false;

    const activeAssignees = row.assignments.filter(
      (assignment) => assignment.role === 'ASSIGNEE' && !assignment.revokedAt,
    );
    if (activeAssignees.some((assignment) => assignment.userId !== actorId)) return false;
    if (row.assignMode === 'ASSIGN_DIRECT') {
      return (
        row.assigneeUserId === actorId && activeAssignees.some((assignment) => assignment.userId === actorId)
      );
    }
    return true;
  }

  private assertClaimable(row: TaskDetailRow, access: ActorAccess): void {
    const candidate = this.isClaimCandidate(row, access);
    const visible = this.canView(row, access);

    if (row.status === 'IN_PROGRESS') {
      if (candidate || visible) throw this.alreadyClaimedError(row, access.actor.id);
      throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    }
    if (row.status !== 'OPEN') {
      if (candidate || visible) {
        throw new VfmException(
          'INVALID_TASK_TRANSITION',
          `Zadatak u statusu ${row.status} se ne može preuzeti.`,
          undefined,
          { from: row.status, to: 'IN_PROGRESS' },
        );
      }
      throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
    }
    if (this.canClaimNow(row, access)) return;

    const occupiedByOther =
      (row.assigneeUserId !== null && row.assigneeUserId !== access.actor.id) ||
      row.assignments.some(
        (assignment) =>
          assignment.role === 'ASSIGNEE' && !assignment.revokedAt && assignment.userId !== access.actor.id,
      );
    if (candidate && occupiedByOther) throw this.alreadyClaimedError(row, access.actor.id);
    if (visible) {
      throw VfmErrors.scopeDenied([
        detail(
          'task:claim',
          'Zadatak mogu preuzeti samo direktni izvršilac, pozvani korisnik, kreator slobodnog zadatka ili kandidat za broadcast zadatak u dozvoljenom opsegu.',
        ),
      ]);
    }
    throw new VfmException('NOT_FOUND', 'Zadatak nije pronađen.');
  }

  private alreadyClaimedError(row: TaskDetailRow, actorId: string): VfmException {
    const claimedByName = userName(row.assignee);
    const isSelf = row.assigneeUserId === actorId;
    return new VfmException(
      'TASK_ALREADY_CLAIMED',
      isSelf
        ? 'Zadatak ste već preuzeli.'
        : claimedByName
          ? `Zadatak je preuzeo ${claimedByName}.`
          : undefined,
      undefined,
      {
        taskId: row.id,
        assigneeUserId: row.assigneeUserId,
        claimedByUserId: row.assigneeUserId,
        assigneeName: claimedByName,
        claimedByName,
        claimedAt: toIso(row.claimedAt),
      },
    );
  }

  /** Prisma pandan `isClaimCandidate`/`canClaimNow` za jedan atomski UPDATE. */
  private claimEligibilityWhere(access: ActorAccess): Prisma.TaskWhereInput {
    if (access.claimScope === null || access.claimScope === 'DRIVER_IDS') {
      return { id: { in: [] } };
    }

    const actorId = access.actor.id;
    const canonicalAssignee: Prisma.TaskWhereInput = {
      OR: [{ assigneeUserId: null }, { assigneeUserId: actorId }],
    };
    const candidates: Prisma.TaskWhereInput[] = [
      {
        AND: [
          canonicalAssignee,
          {
            assignments: {
              some: { userId: actorId, role: 'ASSIGNEE', revokedAt: null },
            },
          },
        ],
      },
      {
        assignMode: 'OPEN_CLAIM',
        AND: [
          canonicalAssignee,
          {
            OR: [
              { createdById: actorId },
              {
                assignments: {
                  some: { userId: actorId, role: 'INVITED', revokedAt: null },
                },
              },
            ],
          },
        ],
      },
    ];

    if (access.claimScope === 'OWN') {
      candidates.push({
        assignMode: 'BROADCAST',
        createdById: actorId,
        AND: [canonicalAssignee],
      });
    } else {
      candidates.push({ assignMode: 'BROADCAST', AND: [canonicalAssignee] });
    }

    const where: Prisma.TaskWhereInput = { OR: candidates };
    return access.claimVehicleIds === null
      ? where
      : { AND: [where, { vehicleId: { in: [...access.claimVehicleIds] } }] };
  }

  private async ensureClaimAssignment(tx: Tx, taskId: string, actorId: string, now: Date): Promise<void> {
    const existing = await tx.taskAssignment.findFirst({
      where: { taskId, userId: actorId, role: 'ASSIGNEE' },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      await tx.taskAssignment.createMany({
        data: [
          {
            id: randomUUID(),
            taskId,
            userId: actorId,
            role: 'ASSIGNEE',
            assignedById: actorId,
            assignedAt: now,
            note: null,
          },
        ],
      });
      return;
    }
    if (existing.revokedAt !== null) {
      await tx.taskAssignment.updateMany({
        where: { id: existing.id, revokedAt: { not: null } },
        data: { revokedAt: null, assignedById: actorId, assignedAt: now },
      });
    }
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

    const scopedPermission = (
      permission: Permission,
    ): { scope: PermissionScope | null; vehicleIds: readonly string[] | null } => {
      const scope: PermissionScope | null = permissions.isSuperAdmin
        ? 'ALL'
        : (permissions.permissions.get(permission) ?? null);
      return {
        scope,
        vehicleIds:
          scope === 'VEHICLE_IDS'
            ? [
                ...new Set(
                  permissions.grants
                    .filter((grant) => grant.permission === permission && grant.scope === 'VEHICLE_IDS')
                    .flatMap((grant) => grant.scopeVehicleIds ?? []),
                ),
              ]
            : null,
      };
    };
    const claim = scopedPermission('task:claim');
    const complete = scopedPermission('task:complete');
    const completeOverride = scopedPermission('task:complete_override');

    return {
      actor,
      permissions,
      viewAll: has('task:view_all') || all('task:view'),
      updateAll: all('task:update'),
      cancelAll: all('task:cancel'),
      reopenAll: all('task:reopen'),
      claimScope: claim.scope,
      claimVehicleIds: claim.vehicleIds,
      completeScope: complete.scope,
      completeVehicleIds: complete.vehicleIds,
      completeOverrideScope: completeOverride.scope,
      completeOverrideVehicleIds: completeOverride.vehicleIds,
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

  private dedupeAttachmentFieldValues(
    definition: FormDefinition,
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...values };
    for (const { field } of flattenFields(definition)) {
      if (field.type !== 'PHOTO' && field.type !== 'FILE') continue;
      const value = result[field.key];
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        result[field.key] = [...new Set(value)];
      }
    }
    return result;
  }

  private isCompletionAttachmentEligible(row: TaskAttachmentRow, taskId: string, actorId: string): boolean {
    const pointsToTask = row.taskId === taskId || (row.ownerType === 'TASK' && row.ownerId === taskId);
    if (pointsToTask) {
      if (row.taskId !== null && row.taskId !== taskId) return false;
      if (row.ownerType === 'TASK' && row.ownerId !== taskId) return false;
      return row.ownerType === 'TASK' || row.ownerType === 'OTHER';
    }
    return (
      row.taskId === null &&
      row.ownerType === 'OTHER' &&
      row.ownerId === actorId &&
      row.uploadedById === actorId
    );
  }

  /**
   * Priprema dokaze za PHOTO/FILE polja i dodatne opće priloge.
   *
   * Prihvata se prilog koji je već vezan uz ovaj zadatak ili je još uvijek
   * nevezani upload samog aktera. Tuđi nevezani upload i prilog drugog
   * zapisa ne ulaze u mapu form-enginea, pa završetak pada prije prelaza.
   */
  private async prepareCompletionAttachments(
    tx: Tx,
    args: {
      taskId: string;
      actorId: string;
      definition: FormDefinition;
      values: Record<string, unknown>;
      attachmentIds: readonly string[];
    },
  ): Promise<CompletionAttachmentPlan> {
    const fieldValues = new Map<string, readonly string[]>();
    const fieldsByAttachment = new Map<string, string[]>();

    for (const { field } of flattenFields(args.definition)) {
      if (field.type !== 'PHOTO' && field.type !== 'FILE') continue;
      const value = args.values[field.key];
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) continue;
      const ids = value as string[];
      fieldValues.set(field.key, ids);
      for (const id of ids) {
        const fields = fieldsByAttachment.get(id) ?? [];
        fields.push(field.key);
        fieldsByAttachment.set(id, fields);
      }
    }

    const generalIds = [...new Set(args.attachmentIds)];
    const referencedIds = [...new Set([...fieldsByAttachment.keys(), ...generalIds])];
    const rows =
      referencedIds.length === 0
        ? []
        : await tx.attachment.findMany({
            where: { id: { in: referencedIds }, deletedAt: null },
            select: TASK_ATTACHMENT_SELECT,
          });
    const rowById = new Map(rows.map((row) => [row.id, row]));

    const generalIssues = generalIds.flatMap((id, index) => {
      const row = rowById.get(id);
      return !row || !this.isCompletionAttachmentEligible(row, args.taskId, args.actorId)
        ? [
            detail(
              `attachmentIds.${index}`,
              'Prilog ne postoji, obrisan je ili se ne smije vezati uz ovaj zadatak.',
            ),
          ]
        : [];
    });
    if (generalIssues.length > 0) throw VfmErrors.validationError(generalIssues);

    const fieldIssues = [] as ReturnType<typeof detail>[];
    for (const [fieldKey, ids] of fieldValues) {
      for (const id of ids) {
        if ((fieldsByAttachment.get(id)?.length ?? 0) > 1) {
          fieldIssues.push(detail(`formData.${fieldKey}`, 'Isti prilog ne može popuniti više polja forme.'));
          continue;
        }
        const row = rowById.get(id);
        if (row && this.isCompletionAttachmentEligible(row, args.taskId, args.actorId)) {
          if (row.formFieldKey !== null && row.formFieldKey !== fieldKey) {
            fieldIssues.push(detail(`formData.${fieldKey}`, 'Prilog pripada drugom polju forme.'));
          }
        }
      }
    }
    if (fieldIssues.length > 0) {
      throw new VfmException('FORM_VALIDATION_FAILED', 'Prilozi forme nisu ispravno vezani.', fieldIssues);
    }

    const facts = new Map<string, AttachmentFacts>();
    const bindings = new Map<string, string | null>();
    const eligibleRows = new Map<string, TaskAttachmentRow>();
    for (const [fieldKey, ids] of fieldValues) {
      for (const id of ids) {
        const row = rowById.get(id);
        if (!row || !this.isCompletionAttachmentEligible(row, args.taskId, args.actorId)) continue;
        facts.set(id, {
          mimeType: row.mimeType,
          sizeBytes: typeof row.sizeBytes === 'bigint' ? Number(row.sizeBytes) : row.sizeBytes,
        });
        bindings.set(id, fieldKey);
        eligibleRows.set(id, row);
      }
    }
    for (const id of generalIds) {
      const row = rowById.get(id);
      if (!row) continue;
      eligibleRows.set(id, row);
      if (!bindings.has(id)) bindings.set(id, null);
    }

    return { facts, bindings, rows: eligibleRows, referencedIds };
  }

  private async bindCompletionAttachments(
    tx: Tx,
    taskId: string,
    actorId: string,
    plan: CompletionAttachmentPlan,
    stage: 'ON_CREATE' | 'ON_COMPLETE' = 'ON_COMPLETE',
  ): Promise<readonly string[]> {
    const boundIds: string[] = [];

    for (const [attachmentId, formFieldKey] of plan.bindings) {
      const row = plan.rows.get(attachmentId);
      if (!row) continue;
      const alreadyBound = row.taskId === taskId && row.ownerType === 'TASK' && row.ownerId === taskId;
      const pointsToTask = row.taskId === taskId || (row.ownerType === 'TASK' && row.ownerId === taskId);
      const nextFormFieldKey = row.formFieldKey ?? formFieldKey;
      const needsBinding = !alreadyBound || (formFieldKey !== null && row.formFieldKey !== formFieldKey);

      const eligibility: Prisma.AttachmentWhereInput = alreadyBound
        ? { taskId, ownerType: 'TASK', ownerId: taskId }
        : row.taskId === taskId || (row.ownerType === 'TASK' && row.ownerId === taskId)
          ? {
              OR: [{ taskId }, { ownerType: 'TASK', ownerId: taskId }],
            }
          : {
              taskId: null,
              ownerType: 'OTHER',
              ownerId: actorId,
              uploadedById: actorId,
            };
      const changed = await tx.attachment.updateMany({
        where: { id: attachmentId, deletedAt: null, AND: [eligibility] },
        data: {
          ownerType: 'TASK',
          ownerId: taskId,
          taskId,
          formFieldKey: nextFormFieldKey,
          ...(pointsToTask ? {} : { stage }),
        } as Prisma.AttachmentUncheckedUpdateManyInput,
      });
      if (changed.count !== 1) {
        throw VfmErrors.validationError([
          detail('attachmentIds', 'Prilog je u međuvremenu obrisan ili vezan uz drugi zapis.'),
        ]);
      }
      if (needsBinding) boundIds.push(attachmentId);
    }

    return boundIds;
  }

  private validateDraftFormData(args: {
    form: ResolvedTaskForm;
    values: Record<string, unknown>;
    isNew: boolean;
    requirements: readonly RequirementRow[];
    stages?: readonly string[];
    attachments?: ReadonlyMap<string, AttachmentFacts>;
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
      attachments: args.attachments,
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
    this.assertStageRequirements(
      args.form.definition,
      values,
      args.requirements,
      args.stages ?? ['ON_CREATE'],
    );
    return values;
  }

  /**
   * Puna validacija završne forme: sva obavezna polja snapshotovane verzije,
   * stvarni prilozi te svi dosadašnji zahtjevi vrste (`GENERAL`, `ON_CREATE`,
   * `ON_CLAIM`, `ON_COMPLETE`). Normalizacija se primjenjuje samo na
   * mjerljive kolone rezultata.
   */
  private validateCompletionFormData(args: {
    form: ResolvedTaskForm;
    values: Record<string, unknown>;
    requirements: readonly RequirementRow[];
    attachments: ReadonlyMap<string, AttachmentFacts>;
  }): ValidatedCompletionForm {
    let result: ReturnType<typeof validateRecord>;
    try {
      result = validateRecord({
        version: {
          id: args.form.formSchemaVersionId,
          version: args.form.version,
          status: args.form.status,
          definition: args.form.definition,
        },
        values: args.values,
        isNew: false,
        today: toLocalDateString(new Date()),
        attachments: args.attachments,
      });
    } catch (error) {
      if (error instanceof VfmException) throw error;
      throw new VfmException(
        'NORMALIZATION_MISMATCH',
        error instanceof Error ? error.message : 'Normalizacija završene forme nije moguća.',
      );
    }

    if (result.versionError) {
      throw new VfmException('FORM_VERSION_NOT_PUBLISHED', undefined, undefined, {
        versionError: result.versionError,
      });
    }
    if (!result.ok) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        `Podaci za završetak zadatka nisu ispravni (${result.errors.length} greška/e).`,
        result.errors.map((error) => detail(`formData.${error.key}`, `${error.code}: ${error.message}`)),
        { errors: result.errors },
      );
    }

    const values = { ...result.values } as Record<string, unknown>;
    this.assertStageRequirements(args.form.definition, values, args.requirements, [
      'GENERAL',
      'ON_CREATE',
      'ON_CLAIM',
      'ON_COMPLETE',
    ]);

    const allowedColumns = NORMALIZATION_COLUMNS['TASK'] ?? [];
    for (const column of Object.keys(result.normalized)) {
      if (!allowedColumns.includes(column)) {
        throw new VfmException(
          'NORMALIZATION_MISMATCH',
          `Mapiranje na kolonu "${column}" ne postoji na entitetu TASK.`,
          [detail(`normalizedName.${column}`, column)],
        );
      }
    }

    const supported = new Set<string>(TASK_COMPLETION_NORMALIZED_COLUMNS);
    const mappedColumns = new Set<TaskCompletionNormalizedColumn>();
    for (const mapping of args.form.definition.normalizedName ?? []) {
      if (mapping.column !== null && supported.has(mapping.column)) {
        mappedColumns.add(mapping.column as TaskCompletionNormalizedColumn);
      }
    }

    const normalized: Partial<Record<TaskCompletionNormalizedColumn, number>> = {};
    for (const column of TASK_COMPLETION_NORMALIZED_COLUMNS) {
      const value = result.normalized[column];
      if (value === undefined) continue;
      const integerColumn = column !== 'fuelLiters';
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        (integerColumn && (!Number.isInteger(value) || value > 2_147_483_647)) ||
        (!integerColumn && value > 99_999_999.99)
      ) {
        throw new VfmException(
          'NORMALIZATION_MISMATCH',
          `Normalizovana vrijednost za "${column}" nije u dozvoljenom opsegu zadatka.`,
          [detail(`normalizedName.${column}`, String(value))],
        );
      }
      normalized[column] = value;
    }

    return { values, normalized, mappedColumns };
  }

  private assertStageRequirements(
    definition: FormDefinition,
    values: Record<string, unknown>,
    requirements: readonly RequirementRow[],
    stages: readonly string[],
  ): void {
    const fields = new Map(flattenFields(definition).map(({ field }) => [field.key, field]));
    const issues = [] as ReturnType<typeof detail>[];
    const stageSet = new Set(stages);

    for (const requirement of requirements) {
      if (!stageSet.has(requirement.stage) || !requirement.required) continue;
      const field = fields.get(requirement.fieldKey);
      if (!field) {
        issues.push(
          detail(
            `formData.${requirement.fieldKey}`,
            `${requirement.stage} zahtjev pokazuje na polje koje ne postoji u snapshotovanoj formi.`,
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
              `${requirement.stage} zahtjev za fotografije mora pokazivati na PHOTO polje.`,
            ),
          );
        } else if (!Array.isArray(value) || value.length < requirement.minPhotos) {
          const when =
            requirement.stage === 'ON_CREATE'
              ? 'Pri kreiranju'
              : requirement.stage === 'ON_CLAIM'
                ? 'Pri preuzimanju'
                : requirement.stage === 'ON_COMPLETE'
                  ? 'Pri završetku'
                  : requirement.stage === 'GENERAL'
                    ? 'Za završetak'
                    : `U fazi ${requirement.stage}`;
          issues.push(
            detail(
              `formData.${requirement.fieldKey}`,
              `${when} je potrebno najmanje ${requirement.minPhotos} fotografija.`,
            ),
          );
        }
        continue;
      }

      if (isEmptyValue(value)) {
        const message =
          requirement.stage === 'ON_CREATE'
            ? 'Polje je obavezno pri kreiranju zadatka.'
            : requirement.stage === 'ON_CLAIM'
              ? 'Polje je obavezno pri preuzimanju zadatka.'
              : requirement.stage === 'ON_COMPLETE'
                ? 'Polje je obavezno pri završetku zadatka.'
                : requirement.stage === 'GENERAL'
                  ? 'Polje je obavezno za završetak zadatka.'
                  : `Polje je obavezno u fazi ${requirement.stage}.`;
        issues.push(detail(`formData.${requirement.fieldKey}`, message));
      }
    }

    if (issues.length > 0) {
      throw new VfmException(
        'FORM_VALIDATION_FAILED',
        `${stages.join('/')} zahtjevi zadatka nisu ispunjeni.`,
        issues,
      );
    }
  }

  private async nextTaskCode(tx: Tx, now: Date): Promise<string> {
    const year = toLocalDateString(now).slice(0, 4);
    const lockKey = `vfm:task-code:${year}`;
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "locked"`;

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
      eventType:
        | 'TASK_CREATED'
        | 'TASK_CLAIMED'
        | 'TASK_COMPLETED'
        | 'TASK_RELEASED'
        | 'TASK_ASSIGNED'
        | 'TASK_CANCELLED'
        | 'TASK_REOPENED';
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
