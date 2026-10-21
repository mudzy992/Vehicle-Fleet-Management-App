/** Zadaci: snapshot forme, vidljivost/opseg, CAS izmjene i statusne tranzicije. */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import {
  cancelTaskSchema,
  claimTaskSchema,
  completeTaskSchema,
  createTaskSchema,
  reopenTaskSchema,
  taskAvailableQuerySchema,
  taskDetailSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  updateTaskSchema,
} from '@vfm/shared/schemas';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import { TasksController } from '../../src/modules/tasks/tasks.controller.js';
import { TasksService, type TaskActorContext } from '../../src/modules/tasks/tasks.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const invitedId = '22222222-2222-4222-8222-222222222222';
const invited2Id = '33333333-3333-4333-8333-333333333333';
const assigneeId = '44444444-4444-4444-8444-444444444444';
const observerId = '55555555-5555-4555-8555-555555555555';
const outsiderId = '66666666-6666-4666-8666-666666666666';
const noClaimId = '77777777-7777-4777-8777-777777777777';
const inactiveId = '88888888-8888-4888-8888-888888888888';
const missingId = '99999999-9999-4999-8999-999999999999';
const broadcastUserId = '10101010-1010-4101-8101-101010101010';
const vehicleClaimId = '12121212-1212-4121-8121-121212121212';
const overrideId = '13131313-1313-4131-8131-131313131313';

const vehicleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const archivedVehicleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const washTypeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const customTypeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const noFormTypeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const directTypeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const inactiveTypeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const genericFormId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const genericVersionId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const boundFormId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const boundVersionId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';
const photoId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const generalAttachmentId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const otherAttachmentId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';

type Row = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

function applyUpdate(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null && 'increment' in value) {
      row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      row[key] = clone(value);
    }
  }
  row.updatedAt = new Date('2026-10-21T12:00:00.000Z');
}

class FakePermissions {
  private readonly grants = new Map<string, Map<string, 'ALL' | 'OWN' | 'VEHICLE_IDS'>>();

  constructor() {
    this.set(adminId, {
      'task:view': 'ALL',
      'task:view_all': 'ALL',
      'task:create': 'ALL',
      'task:update': 'ALL',
      'task:cancel': 'ALL',
      'task:reopen': 'ALL',
      'task:complete': 'ALL',
      'task:complete_override': 'ALL',
    });
    this.set(invitedId, {
      'task:view': 'OWN',
      'task:claim': 'OWN',
      'task:update': 'OWN',
      'task:cancel': 'OWN',
      'task:reopen': 'OWN',
      'task:complete': 'OWN',
    });
    this.set(invited2Id, { 'task:view': 'OWN', 'task:claim': 'OWN', 'task:complete': 'OWN' });
    this.set(assigneeId, {
      'task:view': 'OWN',
      'task:claim': 'OWN',
      'task:update': 'OWN',
      'task:complete': 'OWN',
    });
    this.set(observerId, { 'task:view': 'OWN', 'task:claim': 'OWN', 'task:complete': 'OWN' });
    this.set(outsiderId, {
      'task:view': 'OWN',
      'task:claim': 'OWN',
      'task:update': 'OWN',
      'task:cancel': 'OWN',
      'task:reopen': 'OWN',
      'task:complete': 'OWN',
    });
    this.set(noClaimId, { 'task:view': 'OWN' });
    this.set(inactiveId, { 'task:view': 'OWN', 'task:claim': 'OWN' });
    this.set(broadcastUserId, { 'task:view': 'OWN', 'task:claim': 'ALL' });
    this.set(vehicleClaimId, {
      'task:view': 'OWN',
      'task:claim': 'VEHICLE_IDS',
      'task:complete': 'VEHICLE_IDS',
    });
    this.set(overrideId, { 'task:view': 'OWN', 'task:complete_override': 'ALL' });
  }

  private set(userId: string, grants: Record<string, 'ALL' | 'OWN' | 'VEHICLE_IDS'>): void {
    this.grants.set(userId, new Map(Object.entries(grants)));
  }

  async effective(userId: string) {
    const permissions = new Map(this.grants.get(userId) ?? []);
    return {
      isSuperAdmin: false,
      permissions,
      list: [...permissions.keys()],
      grants:
        userId === vehicleClaimId
          ? [
              { permission: 'task:claim', scope: 'VEHICLE_IDS', scopeVehicleIds: [vehicleId] },
              { permission: 'task:complete', scope: 'VEHICLE_IDS', scopeVehicleIds: [vehicleId] },
            ]
          : [],
    };
  }

  async hasPermission(
    userId: string,
    permission: string,
    requiredScope: 'ALL' | 'OWN' = 'OWN',
  ): Promise<boolean> {
    const scope = this.grants.get(userId)?.get(permission);
    if (!scope) return false;
    return requiredScope === 'OWN' || scope === 'ALL';
  }
}

class FakeTasksPrisma {
  readonly users = new Map<string, Row>();
  readonly vehicles = new Map<string, Row>();
  readonly taskTypes = new Map<string, Row>();
  readonly forms = new Map<string, Row>();
  readonly versions = new Map<string, Row>();
  readonly requirements: Row[] = [];
  readonly tasks = new Map<string, Row>();
  readonly assignments: Row[] = [];
  readonly events: Row[] = [];
  readonly outbox: Row[] = [];
  readonly attachments: Row[] = [];
  readonly comments: Row[] = [];
  readonly rawCalls: string[] = [];

  constructor() {
    const washDefinition = clone(SEED_FORMS.find((form) => form.key === 'pranje_vozila')!.definition);

    for (const [id, firstName, lastName, status] of [
      [adminId, 'Amina', 'Administrator', 'ACTIVE'],
      [invitedId, 'Emina', 'Pozvana', 'ACTIVE'],
      [invited2Id, 'Adnan', 'Pozvani', 'ACTIVE'],
      [assigneeId, 'Ivan', 'Izvršilac', 'ACTIVE'],
      [observerId, 'Olga', 'Posmatrač', 'ACTIVE'],
      [outsiderId, 'Omer', 'Vanjski', 'ACTIVE'],
      [noClaimId, 'Nermin', 'BezPrava', 'ACTIVE'],
      [inactiveId, 'Ivo', 'Neaktivan', 'SUSPENDED'],
      [broadcastUserId, 'Dino', 'Broadcast', 'ACTIVE'],
      [vehicleClaimId, 'Vedad', 'VoziloOpseg', 'ACTIVE'],
      [overrideId, 'Mujo', 'Override', 'ACTIVE'],
    ] as const) {
      this.users.set(id, {
        id,
        firstName,
        lastName,
        displayName: null,
        status,
        deletedAt: null,
      });
    }

    this.vehicles.set(vehicleId, {
      id: vehicleId,
      internalNo: 'V-001',
      make: 'Škoda',
      model: 'Octavia',
      plateNumber: 'A01-A-001',
      status: 'ACTIVE',
      archivedAt: null,
      deletedAt: null,
    });
    this.vehicles.set(archivedVehicleId, {
      id: archivedVehicleId,
      internalNo: 'V-099',
      make: 'VW',
      model: 'Golf',
      plateNumber: null,
      status: 'ARCHIVED',
      archivedAt: new Date('2026-10-01T10:00:00Z'),
      deletedAt: null,
    });

    this.forms.set(genericFormId, {
      id: genericFormId,
      key: 'pranje_vozila',
      name: 'Pranje vozila',
      subject: 'TASK',
      taskTypeId: null,
      currentPublishedVersionId: genericVersionId,
      deletedAt: null,
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    });
    this.versions.set(genericVersionId, {
      id: genericVersionId,
      formSchemaId: genericFormId,
      version: 3,
      status: 'PUBLISHED',
      definition: clone(washDefinition),
    });
    this.forms.set(boundFormId, {
      id: boundFormId,
      key: 'prilagodjeni_zadatak',
      name: 'Prilagođeni zadatak',
      subject: 'TASK',
      taskTypeId: customTypeId,
      currentPublishedVersionId: boundVersionId,
      deletedAt: null,
      updatedAt: new Date('2026-10-02T10:00:00Z'),
    });
    this.versions.set(boundVersionId, {
      id: boundVersionId,
      formSchemaId: boundFormId,
      version: 1,
      status: 'PUBLISHED',
      definition: clone(washDefinition),
    });

    this.addTaskType({
      id: washTypeId,
      code: 'WASH',
      name: 'Pranje vozila',
      formSchemaId: genericFormId,
    });
    this.addTaskType({
      id: customTypeId,
      code: 'CUSTOM',
      name: 'Prilagođeni zadatak',
      requiresVehicle: false,
      dueOffsetHours: null,
    });
    this.addTaskType({
      id: noFormTypeId,
      code: 'NO_FORM',
      name: 'Bez forme',
      requiresVehicle: false,
      dueOffsetHours: null,
    });
    this.addTaskType({
      id: directTypeId,
      code: 'SERVICE_VISIT',
      name: 'Odlazak na servis',
      defaultPriority: 'HIGH',
      defaultAssignMode: 'ASSIGN_DIRECT',
      dueOffsetHours: 48,
      formSchemaId: genericFormId,
    });
    this.addTaskType({
      id: inactiveTypeId,
      code: 'INACTIVE',
      name: 'Neaktivna vrsta',
      active: false,
      formSchemaId: genericFormId,
    });

    this.requirements.push(
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        taskTypeId: washTypeId,
        fieldKey: 'photosAfter',
        required: true,
        stage: 'ON_COMPLETE',
        minPhotos: 1,
      },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
        taskTypeId: customTypeId,
        fieldKey: 'washType',
        required: true,
        stage: 'ON_CREATE',
        minPhotos: 0,
      },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
        taskTypeId: customTypeId,
        fieldKey: 'photosAfter',
        required: true,
        stage: 'ON_CREATE',
        minPhotos: 1,
      },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4',
        taskTypeId: customTypeId,
        fieldKey: 'washDurationMin',
        required: true,
        stage: 'ON_CLAIM',
        minPhotos: 0,
      },
    );
  }

  private addTaskType(patch: Row): void {
    this.taskTypes.set(String(patch.id), {
      description: null,
      iconName: 'clipboard-list',
      colorHex: '#2563EB',
      requiresVehicle: true,
      defaultPriority: 'NORMAL',
      defaultAssignMode: 'OPEN_CLAIM',
      dueOffsetHours: 24,
      formSchemaId: null,
      active: true,
      deletedAt: null,
      ...patch,
    });
  }

  addTask(patch: Row): Row {
    const row: Row = {
      title: 'Seed zadatak',
      description: null,
      vehicleId,
      taskTypeId: washTypeId,
      priority: 'NORMAL',
      status: 'OPEN',
      assignMode: 'OPEN_CLAIM',
      createdById: adminId,
      assigneeUserId: null,
      claimedAt: null,
      completedAt: null,
      completedById: null,
      dueAt: new Date('2026-10-25T10:00:00Z'),
      dueDate: new Date('2026-10-25T00:00:00Z'),
      cancelledAt: null,
      cancelReason: null,
      reopenedAt: null,
      releasedAt: null,
      durationMinutes: null,
      odometerKm: null,
      totalCost: null,
      fuelLiters: null,
      fuelAmount: null,
      fuelConsumptionL100: null,
      formSchemaId: genericFormId,
      formSchemaVersionId: genericVersionId,
      formData: {},
      version: 0,
      createdAt: new Date('2026-10-20T08:00:00Z'),
      updatedAt: new Date('2026-10-20T08:00:00Z'),
      deletedAt: null,
      ...patch,
    };
    this.tasks.set(String(row.id), row);
    return row;
  }

  addAssignment(taskId: string, userId: string, role: string, patch: Row = {}): void {
    this.assignments.push({
      id: `00000000-0000-4000-8000-${String(this.assignments.length + 1).padStart(12, '0')}`,
      taskId,
      userId,
      role,
      assignedById: adminId,
      assignedAt: new Date('2026-10-20T08:00:00Z'),
      revokedAt: null,
      note: null,
      ...patch,
    });
  }

  private matches(row: Row, where: Row = {}): boolean {
    for (const [key, condition] of Object.entries(where)) {
      if (key === 'AND') {
        if (!(condition as Row[]).every((nested) => this.matches(row, nested))) return false;
        continue;
      }
      if (key === 'OR') {
        if (!(condition as Row[]).some((nested) => this.matches(row, nested))) return false;
        continue;
      }
      if (key === 'NOT') {
        const nested = Array.isArray(condition) ? (condition as Row[]) : [condition as Row];
        if (nested.some((item) => this.matches(row, item))) return false;
        continue;
      }
      if (key === 'assignments' && typeof condition === 'object' && condition !== null) {
        const relation = condition as Row;
        const related = this.assignments.filter((assignment) => assignment.taskId === row.id);
        if (relation.some && !related.some((assignment) => this.matches(assignment, relation.some as Row))) {
          return false;
        }
        if (relation.none && related.some((assignment) => this.matches(assignment, relation.none as Row))) {
          return false;
        }
        if (
          relation.every &&
          !related.every((assignment) => this.matches(assignment, relation.every as Row))
        ) {
          return false;
        }
        continue;
      }
      if (
        typeof condition === 'object' &&
        condition !== null &&
        !(condition instanceof Date) &&
        !Array.isArray(condition)
      ) {
        const value = row[key];
        const filter = condition as Row;
        if ('in' in filter && !(filter.in as unknown[]).includes(value)) return false;
        if ('not' in filter && value === filter.not) return false;
        if ('gte' in filter && compare(value, filter.gte) < 0) return false;
        if ('lte' in filter && compare(value, filter.lte) > 0) return false;
        if ('lt' in filter && compare(value, filter.lt) >= 0) return false;
        if ('contains' in filter) {
          if (
            !String(value ?? '')
              .toLowerCase()
              .includes(String(filter.contains).toLowerCase())
          )
            return false;
        }
        if ('startsWith' in filter && !String(value ?? '').startsWith(String(filter.startsWith)))
          return false;
        continue;
      }
      if (compare(row[key], condition) !== 0) return false;
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

  private userFields(id: string | null): Row | null {
    if (!id) return null;
    const user = this.users.get(id);
    return user
      ? { firstName: user.firstName, lastName: user.lastName, displayName: user.displayName }
      : null;
  }

  private enrichTask(row: Row, detail = false): Row {
    const vehicle = row.vehicleId ? this.vehicles.get(String(row.vehicleId)) : null;
    const taskType = this.taskTypes.get(String(row.taskTypeId))!;
    const form = this.forms.get(String(row.formSchemaId))!;
    const version = this.versions.get(String(row.formSchemaVersionId))!;
    const base: Row = {
      ...clone(row),
      vehicle: vehicle
        ? {
            internalNo: vehicle.internalNo,
            make: vehicle.make,
            model: vehicle.model,
            plateNumber: vehicle.plateNumber,
          }
        : null,
      taskType: {
        code: taskType.code,
        name: taskType.name,
        iconName: taskType.iconName,
        colorHex: taskType.colorHex,
      },
      createdBy: this.userFields(String(row.createdById)),
      assignee: this.userFields(row.assigneeUserId as string | null),
      formSchema: { key: form.key, name: form.name },
      formSchemaVersion: { version: version.version },
    };
    if (!detail) return base;

    return {
      ...base,
      assignments: this.assignments
        .filter((assignment) => assignment.taskId === row.id)
        .sort((a, b) => compare(a.assignedAt, b.assignedAt) || compare(a.id, b.id))
        .map((assignment) => ({ ...clone(assignment), user: this.userFields(String(assignment.userId)) })),
      events: this.events
        .filter((event) => event.taskId === row.id)
        .sort((a, b) => compare(a.at, b.at) || compare(a.id, b.id))
        .map((event) => ({ ...clone(event), actor: this.userFields(event.actorId as string | null) })),
      attachments: this.attachments.filter((item) => item.taskId === row.id).map((item) => ({ id: item.id })),
      _count: { comments: this.comments.filter((item) => item.taskId === row.id).length },
    };
  }

  readonly $transaction = async <T>(callback: (tx: FakeTasksPrisma) => Promise<T>): Promise<T> =>
    callback(this);

  readonly $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    this.rawCalls.push(strings.join('?'));
    return [{ id: String(values[0] ?? '') }];
  };

  readonly $executeRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    this.rawCalls.push(`execute:${strings.join('?')}:${String(values[0] ?? '')}`);
    return 1;
  };

  readonly taskType = {
    findFirst: async (args: { where?: Row; select?: Row } = {}) => {
      const row = [...this.taskTypes.values()].find((candidate) => this.matches(candidate, args.where));
      if (!row) return null;
      return {
        ...clone(row),
        ...(args.select && 'completionRequirements' in args.select
          ? {
              completionRequirements: this.requirements
                .filter((requirement) => requirement.taskTypeId === row.id)
                .map(clone),
            }
          : {}),
      };
    },
  };

  readonly vehicle = {
    findFirst: async (args: { where?: Row } = {}) => {
      const row = [...this.vehicles.values()].find((candidate) => this.matches(candidate, args.where));
      return row ? clone(row) : null;
    },
  };

  readonly user = {
    findMany: async (args: { where?: Row } = {}) =>
      [...this.users.values()].filter((row) => this.matches(row, args.where)).map(clone),
    findFirst: async (args: { where?: Row } = {}) => {
      const row = [...this.users.values()].find((candidate) => this.matches(candidate, args.where));
      return row ? clone(row) : null;
    },
  };

  readonly formSchema = {
    findFirst: async (args: { where?: Row; orderBy?: Row[] } = {}) => {
      const rows = this.sort(
        [...this.forms.values()].filter((row) => this.matches(row, args.where)),
        args.orderBy,
      );
      return rows[0] ? clone(rows[0]) : null;
    },
  };

  readonly formSchemaVersion = {
    findFirst: async (args: { where?: Row; select?: Row } = {}) => {
      const row = [...this.versions.values()].find((candidate) => this.matches(candidate, args.where));
      if (!row) return null;
      return {
        ...clone(row),
        ...(args.select && 'formSchema' in args.select
          ? { formSchema: { subject: this.forms.get(String(row.formSchemaId))?.subject } }
          : {}),
      };
    },
  };

  readonly taskCompletionRequirement = {
    findMany: async (args: { where?: Row } = {}) =>
      this.requirements.filter((row) => this.matches(row, args.where)).map(clone),
  };

  readonly task = {
    count: async (args: { where?: Row } = {}) =>
      [...this.tasks.values()].filter((row) => this.matches(row, args.where)).length,
    findMany: async (
      args: { where?: Row; orderBy?: Row[]; skip?: number; take?: number; select?: Row } = {},
    ) => {
      const rows = this.sort(
        [...this.tasks.values()].filter((row) => this.matches(row, args.where)),
        args.orderBy,
      );
      const skip = args.skip ?? 0;
      return rows.slice(skip, skip + (args.take ?? rows.length)).map((row) => this.enrichTask(row));
    },
    findFirst: async (args: { where?: Row; select?: Row; orderBy?: Row[] } = {}) => {
      const rows = this.sort(
        [...this.tasks.values()].filter((row) => this.matches(row, args.where)),
        args.orderBy,
      );
      const row = rows[0];
      if (!row) return null;
      if (args.select && Object.keys(args.select).length === 1 && 'version' in args.select) {
        return { version: row.version };
      }
      return this.enrichTask(row, Boolean(args.select && 'assignments' in args.select));
    },
    create: async (args: { data: Row }) => {
      if ([...this.tasks.values()].some((row) => row.code === args.data.code)) {
        throw Object.assign(new Error('Unique violation'), { code: 'P2002' });
      }
      const now = new Date();
      const row: Row = {
        description: null,
        claimedAt: null,
        completedAt: null,
        completedById: null,
        cancelledAt: null,
        cancelReason: null,
        reopenedAt: null,
        releasedAt: null,
        durationMinutes: null,
        odometerKm: null,
        totalCost: null,
        fuelLiters: null,
        fuelAmount: null,
        fuelConsumptionL100: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...clone(args.data),
      };
      this.tasks.set(String(row.id), row);
      return clone(row);
    },
    updateMany: async (args: { where?: Row; data: Row }) => {
      const rows = [...this.tasks.values()].filter((row) => this.matches(row, args.where));
      for (const row of rows) applyUpdate(row, args.data);
      return { count: rows.length };
    },
  };

  readonly taskAssignment = {
    findFirst: async (args: { where?: Row } = {}) => {
      const row = this.assignments.find((candidate) => this.matches(candidate, args.where));
      return row ? clone(row) : null;
    },
    createMany: async (args: { data: Row[] }) => {
      this.assignments.push(...args.data.map((row) => ({ revokedAt: null, ...clone(row) })));
      return { count: args.data.length };
    },
    updateMany: async (args: { where?: Row; data: Row }) => {
      const rows = this.assignments.filter((row) => this.matches(row, args.where));
      for (const row of rows) applyUpdate(row, args.data);
      return { count: rows.length };
    },
  };

  readonly taskEvent = {
    create: async (args: { data: Row }) => {
      this.events.push(clone(args.data));
      return clone(args.data);
    },
    createMany: async (args: { data: Row[] }) => {
      this.events.push(...args.data.map(clone));
      return { count: args.data.length };
    },
  };

  readonly outboxEvent = {
    create: async (args: { data: Row }) => {
      this.outbox.push(clone(args.data));
      return clone(args.data);
    },
  };

  readonly attachment = {
    findMany: async (args: { where?: Row } = {}) =>
      this.attachments.filter((row) => this.matches(row, args.where)).map(clone),
    updateMany: async (args: { where?: Row; data: Row }) => {
      const rows = this.attachments.filter((row) => this.matches(row, args.where));
      for (const row of rows) applyUpdate(row, args.data);
      return { count: rows.length };
    },
  };

  readonly taskComment = {
    create: async (args: { data: Row }) => {
      const row = { deletedAt: null, ...clone(args.data) };
      this.comments.push(row);
      return clone(row);
    },
  };
}

function actor(id: string): TaskActorContext {
  return {
    id,
    roles: [id === adminId ? 'ADMINISTRATOR' : 'OBICNI_KORISNIK'],
    clientType: 'WEB',
    requestId: 'req-1',
  };
}

function setup() {
  const fake = new FakeTasksPrisma();
  const permissions = new FakePermissions();
  const service = new TasksService(fake as unknown as PrismaService, permissions as never);
  return { fake, permissions, service };
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

function parseCreate(input: Row) {
  return createTaskSchema.parse(input);
}

describe('TasksService — kreiranje i snapshot forme', () => {
  it('kreira OPEN zadatak s kodom, pozvanima, događajima i transakcijskim outboxom', async () => {
    const { fake, service } = setup();
    const before = Date.now();
    const result = await service.create(
      parseCreate({
        taskTypeId: washTypeId,
        vehicleId,
        invitedUserIds: [invitedId, invited2Id],
        observerUserIds: [observerId],
        dueAt: '2026-10-21T22:30:00.000Z',
        formData: { washType: 'FULL' },
      }),
      actor(adminId),
    );

    expect(result.data.code).toMatch(/^Z-\d{4}-000001$/u);
    expect(result.data).toMatchObject({
      title: 'Pranje vozila — V-001',
      status: 'OPEN',
      assignMode: 'OPEN_CLAIM',
      priority: 'NORMAL',
      formSchemaId: genericFormId,
      formSchemaVersionId: genericVersionId,
      formSchemaVersion: 3,
      dueDate: '2026-10-22',
      formData: { washType: 'FULL' },
    });
    expect(taskDetailSchema.parse(result.data)).toEqual(result.data);
    expect(result.data.assignments.map((item) => [item.userId, item.role])).toEqual(
      expect.arrayContaining([
        [invitedId, 'INVITED'],
        [invited2Id, 'INVITED'],
        [observerId, 'OBSERVER'],
      ]),
    );
    expect(result.data.events.map((event) => event.action)).toEqual(['CREATED', 'INVITED']);
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]).toMatchObject({
      aggregateType: 'TASK',
      aggregateId: result.data.id,
      eventType: 'TASK_CREATED',
      idempotencyKey: `task:${result.data.id}:TASK_CREATED:v0`,
    });
    expect((fake.outbox[0]!.payload as Row).recipientUserIds).toEqual([invitedId, invited2Id]);
    expect(Date.parse(result.data.createdAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('koristi formu vezanu za vrstu i provjerava ON_CREATE zahtjeve', async () => {
    const { fake, service } = setup();
    const missing = await errorOf(() =>
      service.create(
        parseCreate({ taskTypeId: customTypeId, formData: { washType: 'FULL' } }),
        actor(adminId),
      ),
    );
    expect(missing.code).toBe('FORM_VALIDATION_FAILED');
    expect(missing.httpStatus).toBe(422);
    expect(fake.tasks.size).toBe(0);

    const created = await service.create(
      parseCreate({
        taskTypeId: customTypeId,
        formData: { washType: 'FULL', photosAfter: [photoId] },
      }),
      actor(adminId),
    );
    expect(created.data.formSchemaId).toBe(boundFormId);
    expect(created.data.formSchemaVersionId).toBe(boundVersionId);
    expect(created.data.formSchemaVersion).toBe(1);
  });

  it('bez efektivne forme ne koristi generički fallback, a neaktivna vrsta i vozilo se odbijaju', async () => {
    const { service } = setup();

    const noForm = await errorOf(() =>
      service.create(parseCreate({ taskTypeId: noFormTypeId }), actor(adminId)),
    );
    expect(noForm.code).toBe('FORM_VERSION_NOT_PUBLISHED');
    expect(noForm.httpStatus).toBe(409);

    const inactive = await errorOf(() =>
      service.create(parseCreate({ taskTypeId: inactiveTypeId, vehicleId }), actor(adminId)),
    );
    expect(inactive.code).toBe('VALIDATION_ERROR');

    const missingVehicle = await errorOf(() =>
      service.create(parseCreate({ taskTypeId: washTypeId }), actor(adminId)),
    );
    expect(missingVehicle.details?.[0]?.path).toEqual(['vehicleId']);

    const archivedVehicle = await errorOf(() =>
      service.create(parseCreate({ taskTypeId: washTypeId, vehicleId: archivedVehicleId }), actor(adminId)),
    );
    expect(archivedVehicle.code).toBe('VALIDATION_ERROR');
  });

  it('djelimična forma prihvata nedostajuća obavezna polja, ali ne nepoznata ni pogrešne tipove', async () => {
    const { fake, service } = setup();
    const unknown = await errorOf(() =>
      service.create(
        parseCreate({ taskTypeId: washTypeId, vehicleId, formData: { nepoznato: 1 } }),
        actor(adminId),
      ),
    );
    expect(unknown.code).toBe('FORM_VALIDATION_FAILED');

    const wrongType = await errorOf(() =>
      service.create(
        parseCreate({ taskTypeId: washTypeId, vehicleId, formData: { washDurationMin: 'pola sata' } }),
        actor(adminId),
      ),
    );
    expect(wrongType.code).toBe('FORM_VALIDATION_FAILED');
    expect(fake.tasks.size).toBe(0);
    expect(fake.outbox).toEqual([]);
  });

  it('primaoci moraju biti aktivni i imati odgovarajuće pravo', async () => {
    const { service } = setup();
    for (const patch of [
      { invitedUserIds: [missingId] },
      { invitedUserIds: [inactiveId] },
      { invitedUserIds: [noClaimId] },
      { observerUserIds: [missingId] },
    ]) {
      const error = await errorOf(() =>
        service.create(parseCreate({ taskTypeId: washTypeId, vehicleId, ...patch }), actor(adminId)),
      );
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('direktna dodjela ostaje OPEN s jednim ASSIGNEE redom i ASSIGNED događajem', async () => {
    const { fake, service } = setup();
    const missingAssignee = await errorOf(() =>
      service.create(parseCreate({ taskTypeId: directTypeId, vehicleId }), actor(adminId)),
    );
    expect(missingAssignee.details?.[0]?.path).toEqual(['assigneeUserId']);

    const created = await service.create(
      parseCreate({ taskTypeId: directTypeId, vehicleId, assigneeUserId: assigneeId }),
      actor(adminId),
    );
    expect(created.data).toMatchObject({
      status: 'OPEN',
      assignMode: 'ASSIGN_DIRECT',
      priority: 'HIGH',
      assigneeUserId: assigneeId,
      claimedAt: null,
    });
    expect(created.data.assignments).toEqual([
      expect.objectContaining({ userId: assigneeId, role: 'ASSIGNEE' }),
    ]);
    expect(created.data.events.map((event) => event.action)).toEqual(['CREATED', 'ASSIGNED']);
    expect((fake.outbox[0]!.payload as Row).recipientUserIds).toEqual([assigneeId]);
  });

  it('BROADCAST u outboxu označava dinamičke primaoce i vidljiv je korisniku s task:view', async () => {
    const { fake, service } = setup();
    const created = await service.create(
      parseCreate({
        taskTypeId: customTypeId,
        assignMode: 'BROADCAST',
        formData: { washType: 'FULL', photosAfter: [photoId] },
      }),
      actor(adminId),
    );

    expect(created.data.assignMode).toBe('BROADCAST');
    expect(fake.outbox[0]!.payload).toMatchObject({ broadcast: true, recipientUserIds: [] });
    const detail = await service.get(created.data.id, actor(outsiderId));
    expect(detail.id).toBe(created.data.id);
  });
});

describe('TasksService — lista, detalj i opseg', () => {
  function seedList() {
    const setupResult = setup();
    const { fake } = setupResult;
    const openId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const progressId = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    const broadcastId = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
    const hiddenId = 'ffffffff-ffff-4fff-8fff-fffffffffff4';
    const mineId = 'ffffffff-ffff-4fff-8fff-fffffffffff5';

    fake.addTask({
      id: openId,
      code: 'Z-2026-000001',
      title: 'Pranje vozila',
      dueAt: new Date('2020-01-01T10:00:00Z'),
      dueDate: new Date('2020-01-01T00:00:00Z'),
    });
    fake.addAssignment(openId, invitedId, 'INVITED');
    fake.addTask({
      id: progressId,
      code: 'Z-2026-000002',
      title: 'Gorivo',
      status: 'IN_PROGRESS',
      createdById: observerId,
      assigneeUserId: invitedId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      dueAt: new Date('2030-01-01T10:00:00Z'),
      dueDate: new Date('2030-01-01T00:00:00Z'),
    });
    fake.addTask({
      id: broadcastId,
      code: 'Z-2026-000003',
      title: 'Broadcast zadatak',
      createdById: observerId,
      assignMode: 'BROADCAST',
      taskTypeId: customTypeId,
      vehicleId: null,
      formSchemaId: boundFormId,
      formSchemaVersionId: boundVersionId,
    });
    fake.addTask({
      id: hiddenId,
      code: 'Z-2026-000004',
      title: 'Skriveni završeni',
      status: 'COMPLETED',
      createdById: observerId,
      assigneeUserId: assigneeId,
      completedAt: new Date('2026-10-20T10:00:00Z'),
      completedById: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
    });
    fake.addTask({
      id: mineId,
      code: 'Z-2026-000005',
      title: 'Moj otkazani',
      status: 'CANCELLED',
      createdById: invitedId,
      cancelledAt: new Date('2026-10-20T11:00:00Z'),
      cancelReason: 'Nije potrebno',
    });

    return { ...setupResult, openId, progressId, broadcastId, hiddenId, mineId };
  }

  it('administrator vidi sve, a običan korisnik samo povezane i broadcast zadatke', async () => {
    const { service, openId, progressId, broadcastId, hiddenId, mineId } = seedList();

    const adminList = await service.list(taskListQuerySchema.parse({}), actor(adminId));
    expect(adminList.total).toBe(5);
    expect(taskListResponseSchema.parse(adminList)).toEqual(adminList);

    const ownList = await service.list(taskListQuerySchema.parse({}), actor(invitedId));
    expect(ownList.items.map((item) => item.id).sort()).toEqual(
      [openId, progressId, broadcastId, mineId].sort(),
    );
    expect(ownList.items.map((item) => item.id)).not.toContain(hiddenId);

    const mine = await service.list(taskListQuerySchema.parse({ mine: 'true' }), actor(invitedId));
    expect(mine.items.map((item) => item.id).sort()).toEqual([openId, progressId, mineId].sort());

    const overdue = await service.list(taskListQuerySchema.parse({ overdueOnly: 'true' }), actor(adminId));
    expect(overdue.items.map((item) => item.id)).toEqual([openId]);
    expect(overdue.items[0]?.isOverdue).toBe(true);
  });

  it('filteri i pretraga rade na serveru', async () => {
    const { service, progressId } = seedList();
    const result = await service.list(
      taskListQuerySchema.parse({
        q: 'gorivo',
        status: 'IN_PROGRESS',
        vehicleId,
        taskTypeId: washTypeId,
        assigneeUserId: invitedId,
        priority: 'NORMAL',
      }),
      actor(adminId),
    );
    expect(result.items.map((item) => item.id)).toEqual([progressId]);
  });

  it('detalj skrivenog zadatka je 404, a povezani korisnik dobija dodjele i događaje', async () => {
    const { fake, service, openId, hiddenId } = seedList();
    fake.events.push({
      id: 'event-1',
      taskId: openId,
      action: 'CREATED',
      actorId: adminId,
      actorRole: 'ADMINISTRATOR',
      at: new Date('2026-10-20T08:00:00Z'),
      ipAddress: null,
      clientType: 'WEB',
      requestId: 'req-1',
      data: { code: 'Z-2026-000001' },
      formSchemaVersionId: genericVersionId,
    });

    const detail = await service.get(openId, actor(invitedId));
    expect(detail.assignments).toEqual([expect.objectContaining({ userId: invitedId, role: 'INVITED' })]);
    expect(detail.events[0]?.action).toBe('CREATED');

    const hidden = await errorOf(() => service.get(hiddenId, actor(invitedId)));
    expect(hidden.code).toBe('NOT_FOUND');
    expect(hidden.httpStatus).toBe(404);
  });
});

describe('TasksService — PATCH i CAS', () => {
  it('kreator mijenja otvoren zadatak, formu i rok uz rast verzije i UPDATED događaj', async () => {
    const { fake, service } = setup();
    const taskId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    fake.addTask({ id: taskId, code: 'Z-2026-000010', createdById: invitedId, version: 2 });

    const result = await service.update(
      taskId,
      updateTaskSchema.parse({
        version: 2,
        title: 'Izmijenjen naslov',
        dueAt: '2026-10-21T22:30:00.000Z',
        formData: { washType: 'EXTERNAL' },
      }),
      actor(invitedId),
    );

    expect(result.data).toMatchObject({
      title: 'Izmijenjen naslov',
      dueDate: '2026-10-22',
      version: 3,
      formData: { washType: 'EXTERNAL' },
    });
    expect(fake.events.at(-1)).toMatchObject({
      action: 'UPDATED',
      data: expect.objectContaining({ changedFields: ['title', 'dueAt', 'formData'] }),
    });

    const stale = await errorOf(() =>
      service.update(taskId, updateTaskSchema.parse({ version: 2, priority: 'HIGH' }), actor(invitedId)),
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(stale.extra).toEqual({ currentVersion: 3 });
  });

  it('opseg i status sprečavaju neovlaštenu ili završenu izmjenu', async () => {
    const { fake, service } = setup();
    const openId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const progressId = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    const completedId = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
    fake.addTask({ id: openId, code: 'Z-2026-000011', createdById: adminId });
    fake.addTask({
      id: progressId,
      code: 'Z-2026-000012',
      status: 'IN_PROGRESS',
      createdById: adminId,
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      version: 1,
    });
    fake.addTask({
      id: completedId,
      code: 'Z-2026-000013',
      status: 'COMPLETED',
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      completedAt: new Date('2026-10-20T10:00:00Z'),
      completedById: assigneeId,
    });

    const outsider = await errorOf(() =>
      service.update(
        openId,
        updateTaskSchema.parse({ version: 0, title: 'Tuđa izmjena' }),
        actor(outsiderId),
      ),
    );
    expect(outsider.code).toBe('SCOPE_DENIED');

    const assigneeProgress = await errorOf(() =>
      service.update(progressId, updateTaskSchema.parse({ version: 1, title: 'U toku' }), actor(assigneeId)),
    );
    expect(assigneeProgress.code).toBe('SCOPE_DENIED');

    const adminProgress = await service.update(
      progressId,
      updateTaskSchema.parse({ version: 1, priority: 'URGENT' }),
      actor(adminId),
    );
    expect(adminProgress.data.priority).toBe('URGENT');

    const completed = await errorOf(() =>
      service.update(completedId, updateTaskSchema.parse({ version: 0, title: 'Prekasno' }), actor(adminId)),
    );
    expect(completed.code).toBe('INVALID_TASK_TRANSITION');
  });

  it('neispravan nacrt forme pri PATCH-u ne mijenja zadatak', async () => {
    const { fake, service } = setup();
    const taskId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    fake.addTask({ id: taskId, code: 'Z-2026-000014', version: 4 });

    const error = await errorOf(() =>
      service.update(
        taskId,
        updateTaskSchema.parse({ version: 4, formData: { washType: 'NEPOZNATO' } }),
        actor(adminId),
      ),
    );
    expect(error.code).toBe('FORM_VALIDATION_FAILED');
    expect(fake.tasks.get(taskId)?.version).toBe(4);
  });
});

describe('TasksService — otkazivanje i ponovno otvaranje', () => {
  it('administrator otkazuje zadatak u toku uz razlog, događaj i outbox', async () => {
    const { fake, service } = setup();
    const taskId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    fake.addTask({
      id: taskId,
      code: 'Z-2026-000020',
      status: 'IN_PROGRESS',
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      version: 2,
    });
    fake.addAssignment(taskId, assigneeId, 'ASSIGNEE');

    const result = await service.cancel(
      taskId,
      cancelTaskSchema.parse({ version: 2, reason: 'Vozilo ostaje na servisu' }),
      actor(adminId),
    );
    expect(result.data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Vozilo ostaje na servisu',
      version: 3,
      assigneeUserId: assigneeId,
    });
    expect(result.data.cancelledAt).not.toBeNull();
    expect(fake.events.at(-1)).toMatchObject({ action: 'CANCELLED' });
    expect(fake.outbox.at(-1)).toMatchObject({
      eventType: 'TASK_CANCELLED',
      idempotencyKey: `task:${taskId}:TASK_CANCELLED:v3`,
    });
  });

  it('kreator s OWN opsegom može otkazati, vanjski korisnik i završen zadatak ne mogu', async () => {
    const { fake, service } = setup();
    const ownId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const completedId = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    fake.addTask({ id: ownId, code: 'Z-2026-000021', createdById: invitedId });
    fake.addTask({
      id: completedId,
      code: 'Z-2026-000022',
      status: 'COMPLETED',
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      completedAt: new Date('2026-10-20T10:00:00Z'),
      completedById: assigneeId,
    });

    const outsider = await errorOf(() =>
      service.cancel(ownId, cancelTaskSchema.parse({ version: 0, reason: 'Pokušaj' }), actor(outsiderId)),
    );
    expect(outsider.code).toBe('SCOPE_DENIED');

    const own = await service.cancel(
      ownId,
      cancelTaskSchema.parse({ version: 0, reason: 'Više nije potrebno' }),
      actor(invitedId),
    );
    expect(own.data.status).toBe('CANCELLED');

    const completed = await errorOf(() =>
      service.cancel(completedId, cancelTaskSchema.parse({ version: 0, reason: 'Prekasno' }), actor(adminId)),
    );
    expect(completed.code).toBe('INVALID_TASK_TRANSITION');
  });

  it('reopen otkazanog OPEN_CLAIM zadatka oslobađa izvršioca i opoziva ASSIGNEE red', async () => {
    const { fake, service } = setup();
    const taskId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    fake.addTask({
      id: taskId,
      code: 'Z-2026-000023',
      status: 'CANCELLED',
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      cancelledAt: new Date('2026-10-20T10:00:00Z'),
      cancelReason: 'Odgođeno',
      version: 3,
    });
    fake.addAssignment(taskId, invitedId, 'INVITED');
    fake.addAssignment(taskId, assigneeId, 'ASSIGNEE');

    const result = await service.reopen(
      taskId,
      reopenTaskSchema.parse({ version: 3, reason: 'Ponovo aktuelno', dueAt: '2030-01-01T10:00:00.000Z' }),
      actor(adminId),
    );
    expect(result.data).toMatchObject({
      status: 'OPEN',
      assigneeUserId: null,
      claimedAt: null,
      cancelledAt: null,
      cancelReason: null,
      version: 4,
    });
    expect(result.data.reopenedAt).not.toBeNull();
    expect(result.data.assignments.find((item) => item.role === 'ASSIGNEE')?.revokedAt).not.toBeNull();
    expect(fake.outbox.at(-1)).toMatchObject({ eventType: 'TASK_REOPENED' });
  });

  it('reopen direktnog otkazanog zadatka čuva izvršioca, a završenog vraća u IN_PROGRESS', async () => {
    const { fake, service } = setup();
    const directId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const completedId = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    fake.addTask({
      id: directId,
      code: 'Z-2026-000024',
      status: 'CANCELLED',
      assignMode: 'ASSIGN_DIRECT',
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
      cancelledAt: new Date('2026-10-20T10:00:00Z'),
      cancelReason: 'Odgođeno',
      version: 1,
    });
    fake.addAssignment(directId, assigneeId, 'ASSIGNEE');
    fake.addTask({
      id: completedId,
      code: 'Z-2026-000025',
      status: 'COMPLETED',
      assigneeUserId: assigneeId,
      claimedAt: new Date('2026-10-20T08:00:00Z'),
      completedAt: new Date('2026-10-20T10:00:00Z'),
      completedById: assigneeId,
      durationMinutes: 120,
      version: 5,
    });

    const direct = await service.reopen(directId, reopenTaskSchema.parse({ version: 1 }), actor(adminId));
    expect(direct.data).toMatchObject({ status: 'OPEN', assigneeUserId: assigneeId, claimedAt: null });
    expect(direct.data.assignments[0]?.revokedAt).toBeNull();

    const completed = await service.reopen(
      completedId,
      reopenTaskSchema.parse({ version: 5, reason: 'Potrebna ispravka' }),
      actor(adminId),
    );
    expect(completed.data).toMatchObject({
      status: 'IN_PROGRESS',
      assigneeUserId: assigneeId,
      completedAt: null,
      completedById: null,
      durationMinutes: null,
      version: 6,
    });
    expect(completed.data.claimedAt).toBe('2026-10-20T08:00:00.000Z');
  });

  it('reopen otvorenog zadatka i zastarjela verzija se odbijaju', async () => {
    const { fake, service } = setup();
    const taskId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    fake.addTask({ id: taskId, code: 'Z-2026-000026', status: 'CANCELLED', version: 2 });

    const stale = await errorOf(() =>
      service.reopen(taskId, reopenTaskSchema.parse({ version: 1 }), actor(adminId)),
    );
    expect(stale.code).toBe('VERSION_CONFLICT');

    await service.reopen(taskId, reopenTaskSchema.parse({ version: 2 }), actor(adminId));
    const open = await errorOf(() =>
      service.reopen(taskId, reopenTaskSchema.parse({ version: 3 }), actor(adminId)),
    );
    expect(open.code).toBe('INVALID_TASK_TRANSITION');
  });
});

describe('TasksService — slobodni zadaci i atomski claim', () => {
  const claimInput = (formData: Record<string, unknown> = {}) => claimTaskSchema.parse({ formData });
  const availableQuery = (patch: Record<string, unknown> = {}) => taskAvailableQuerySchema.parse(patch);

  function seedOpenClaim(fake: ReturnType<typeof setup>['fake'], patch: Row = {}): string {
    const id = String(patch.id ?? 'ffffffff-ffff-4fff-8fff-fffffffff101');
    fake.addTask({
      id,
      code: 'Z-2026-000101',
      title: 'Slobodan zadatak',
      formData: { washType: 'FULL' },
      version: 2,
      ...patch,
    });
    return id;
  }

  it('available vraća samo zadatke koje akter smije preuzeti po načinu dodjele i opsegu', async () => {
    const { fake, service } = setup();
    const openId = seedOpenClaim(fake);
    fake.addAssignment(openId, invitedId, 'INVITED');
    fake.addAssignment(openId, invited2Id, 'INVITED');
    fake.addAssignment(openId, observerId, 'OBSERVER');

    const directId = 'ffffffff-ffff-4fff-8fff-fffffffff102';
    fake.addTask({
      id: directId,
      code: 'Z-2026-000102',
      title: 'Direktni zadatak',
      taskTypeId: directTypeId,
      assignMode: 'ASSIGN_DIRECT',
      assigneeUserId: assigneeId,
    });
    fake.addAssignment(directId, assigneeId, 'ASSIGNEE');

    const broadcastId = 'ffffffff-ffff-4fff-8fff-fffffffff103';
    fake.addTask({
      id: broadcastId,
      code: 'Z-2026-000103',
      title: 'Broadcast zadatak',
      assignMode: 'BROADCAST',
    });
    const ownBroadcastId = 'ffffffff-ffff-4fff-8fff-fffffffff104';
    fake.addTask({
      id: ownBroadcastId,
      code: 'Z-2026-000104',
      title: 'Vlastiti broadcast',
      assignMode: 'BROADCAST',
      createdById: invitedId,
      priority: 'HIGH',
    });
    const progressId = 'ffffffff-ffff-4fff-8fff-fffffffff105';
    fake.addTask({
      id: progressId,
      code: 'Z-2026-000105',
      status: 'IN_PROGRESS',
      assigneeUserId: invited2Id,
      claimedAt: new Date('2026-10-20T09:00:00Z'),
    });
    fake.addAssignment(progressId, invitedId, 'INVITED');

    const invitedList = await service.available(availableQuery(), actor(invitedId));
    expect(taskListResponseSchema.parse(invitedList)).toEqual(invitedList);
    expect(invitedList.total).toBe(2);
    expect(invitedList.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([openId, ownBroadcastId]),
    );
    expect(
      (await service.available(availableQuery({ priority: 'HIGH' }), actor(invitedId))).items.map(
        (item) => item.id,
      ),
    ).toEqual([ownBroadcastId]);

    expect((await service.available(availableQuery(), actor(invited2Id))).items.map((i) => i.id)).toEqual([
      openId,
    ]);
    expect((await service.available(availableQuery(), actor(assigneeId))).items.map((i) => i.id)).toEqual([
      directId,
    ]);
    expect(
      (await service.available(availableQuery(), actor(broadcastUserId))).items.map((i) => i.id),
    ).toEqual(expect.arrayContaining([broadcastId, ownBroadcastId]));
    expect((await service.available(availableQuery(), actor(broadcastUserId))).total).toBe(2);
    expect((await service.available(availableQuery(), actor(observerId))).total).toBe(0);
    expect((await service.available(availableQuery(), actor(outsiderId))).total).toBe(0);

    const denied = await errorOf(() => service.available(availableQuery(), actor(noClaimId)));
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(denied.httpStatus).toBe(403);
  });

  it('uspješan claim u jednoj transakciji postavlja izvršioca, ASSIGNEE red, CLAIMED događaj i outbox', async () => {
    const { fake, service } = setup();
    const taskId = seedOpenClaim(fake);
    fake.addAssignment(taskId, invitedId, 'INVITED');
    fake.addAssignment(taskId, invited2Id, 'INVITED');
    fake.addAssignment(taskId, observerId, 'OBSERVER');

    const result = await service.claim(taskId, claimInput(), actor(invitedId));

    expect(taskDetailSchema.parse(result.data)).toEqual(result.data);
    expect(result.data).toMatchObject({
      status: 'IN_PROGRESS',
      assigneeUserId: invitedId,
      assigneeName: 'Emina Pozvana',
      version: 3,
      formData: { washType: 'FULL' },
    });
    expect(result.data.claimedAt).not.toBeNull();
    expect(result.before).toMatchObject({ status: 'OPEN', version: 2 });
    expect(result.after).toMatchObject({ status: 'IN_PROGRESS', version: 3 });

    const activeAssignees = fake.assignments.filter(
      (row) => row.taskId === taskId && row.role === 'ASSIGNEE' && row.revokedAt === null,
    );
    expect(activeAssignees).toHaveLength(1);
    expect(activeAssignees[0]).toMatchObject({ userId: invitedId, assignedById: invitedId });
    expect(
      fake.assignments.filter((row) => row.taskId === taskId && row.role === 'INVITED' && !row.revokedAt),
    ).toHaveLength(2);

    const claimedEvents = fake.events.filter((row) => row.taskId === taskId && row.action === 'CLAIMED');
    expect(claimedEvents).toHaveLength(1);
    expect(claimedEvents[0]?.data).toMatchObject({
      previousVersion: 2,
      version: 3,
      assigneeUserId: invitedId,
    });
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]).toMatchObject({
      eventType: 'TASK_CLAIMED',
      idempotencyKey: `task:${taskId}:TASK_CLAIMED:v3`,
      payload: {
        status: 'IN_PROGRESS',
        assigneeUserId: invitedId,
        broadcast: false,
      },
    });
    expect((fake.outbox[0]?.payload as Row).recipientUserIds).toEqual(
      expect.arrayContaining([adminId, invited2Id, observerId]),
    );
    expect((fake.outbox[0]?.payload as Row).recipientUserIds).not.toContain(invitedId);
  });

  it('paralelni pokušaji nad lažnim klijentom daju tačno jednog pobjednika i ostale 409', async () => {
    const { fake, service } = setup();
    const taskId = seedOpenClaim(fake);
    fake.addAssignment(taskId, invitedId, 'INVITED');
    fake.addAssignment(taskId, invited2Id, 'INVITED');

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        service.claim(taskId, claimInput(), actor(index % 2 === 0 ? invitedId : invited2Id)),
      ),
    );
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(VfmException);
      expect((result.reason as VfmException).code).toBe('TASK_ALREADY_CLAIMED');
      expect((result.reason as VfmException).httpStatus).toBe(409);
    }
    expect(fake.tasks.get(taskId)).toMatchObject({ status: 'IN_PROGRESS', version: 3 });
    expect(
      fake.assignments.filter((row) => row.taskId === taskId && row.role === 'ASSIGNEE' && !row.revokedAt),
    ).toHaveLength(1);
    expect(fake.events.filter((row) => row.taskId === taskId && row.action === 'CLAIMED')).toHaveLength(1);
    expect(fake.outbox.filter((row) => row.eventType === 'TASK_CLAIMED')).toHaveLength(1);
  });

  it('direktni zadatak preuzima samo odabrani izvršilac i ne nastaje drugi ASSIGNEE red', async () => {
    const { fake, service } = setup();
    const taskId = 'ffffffff-ffff-4fff-8fff-fffffffff106';
    fake.addTask({
      id: taskId,
      code: 'Z-2026-000106',
      taskTypeId: directTypeId,
      assignMode: 'ASSIGN_DIRECT',
      createdById: invitedId,
      assigneeUserId: assigneeId,
      formData: { washType: 'FULL' },
      version: 1,
    });
    fake.addAssignment(taskId, assigneeId, 'ASSIGNEE');

    const creatorError = await errorOf(() => service.claim(taskId, claimInput(), actor(invitedId)));
    expect(creatorError.code).toBe('SCOPE_DENIED');
    const outsiderError = await errorOf(() => service.claim(taskId, claimInput(), actor(outsiderId)));
    expect(outsiderError.code).toBe('NOT_FOUND');

    const result = await service.claim(taskId, claimInput(), actor(assigneeId));
    expect(result.data).toMatchObject({ status: 'IN_PROGRESS', assigneeUserId: assigneeId, version: 2 });
    const assigneeRows = fake.assignments.filter((row) => row.taskId === taskId && row.role === 'ASSIGNEE');
    expect(assigneeRows).toHaveLength(1);
    expect(assigneeRows[0]).toMatchObject({ userId: assigneeId, assignedById: adminId, revokedAt: null });

    const repeated = await errorOf(() => service.claim(taskId, claimInput(), actor(assigneeId)));
    expect(repeated.code).toBe('TASK_ALREADY_CLAIMED');
    expect(repeated.extra).toMatchObject({ claimedByUserId: assigneeId, claimedByName: 'Ivan Izvršilac' });
  });

  it('claim skriva nevidljiv zadatak, posmatraču daje scope grešku, a neaktivnog kandidata odbija', async () => {
    const { fake, service } = setup();
    const taskId = seedOpenClaim(fake);
    fake.addAssignment(taskId, invitedId, 'INVITED');
    fake.addAssignment(taskId, observerId, 'OBSERVER');
    fake.addAssignment(taskId, inactiveId, 'INVITED');

    expect((await errorOf(() => service.claim(taskId, claimInput(), actor(outsiderId)))).code).toBe(
      'NOT_FOUND',
    );
    expect((await errorOf(() => service.claim(taskId, claimInput(), actor(observerId)))).code).toBe(
      'SCOPE_DENIED',
    );
    expect((await errorOf(() => service.claim(taskId, claimInput(), actor(noClaimId)))).code).toBe(
      'PERMISSION_DENIED',
    );
    expect((await errorOf(() => service.claim(taskId, claimInput(), actor(inactiveId)))).code).toBe(
      'ACCOUNT_INACTIVE',
    );
    expect((await errorOf(() => service.claim(missingId, claimInput(), actor(invitedId)))).code).toBe(
      'NOT_FOUND',
    );
    expect(fake.tasks.get(taskId)).toMatchObject({ status: 'OPEN', version: 2 });
    expect(fake.events.filter((row) => row.action === 'CLAIMED')).toHaveLength(0);
  });

  it('kreator može preuzeti OPEN_CLAIM bez pozvanih, a opozvani ASSIGNEE red se reaktivira', async () => {
    const { fake, service } = setup();
    const ownId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff107',
      code: 'Z-2026-000107',
      createdById: invitedId,
    });
    const own = await service.claim(ownId, claimInput(), actor(invitedId));
    expect(own.data.assigneeUserId).toBe(invitedId);

    const reopenedId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff108',
      code: 'Z-2026-000108',
    });
    fake.addAssignment(reopenedId, invitedId, 'INVITED');
    fake.addAssignment(reopenedId, invitedId, 'ASSIGNEE', {
      revokedAt: new Date('2026-10-20T12:00:00Z'),
    });
    await service.claim(reopenedId, claimInput(), actor(invitedId));
    const assigneeRows = fake.assignments.filter(
      (row) => row.taskId === reopenedId && row.role === 'ASSIGNEE',
    );
    expect(assigneeRows).toHaveLength(1);
    expect(assigneeRows[0]).toMatchObject({ userId: invitedId, assignedById: invitedId, revokedAt: null });
  });

  it('broadcast poštuje OWN i VEHICLE_IDS opseg claim permisije', async () => {
    const { fake, service } = setup();
    const otherId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff109',
      code: 'Z-2026-000109',
      assignMode: 'BROADCAST',
    });
    const ownId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff110',
      code: 'Z-2026-000110',
      assignMode: 'BROADCAST',
      createdById: outsiderId,
    });
    const otherVehicleId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff111',
      code: 'Z-2026-000111',
      assignMode: 'BROADCAST',
      vehicleId: archivedVehicleId,
    });

    expect((await errorOf(() => service.claim(otherId, claimInput(), actor(outsiderId)))).code).toBe(
      'SCOPE_DENIED',
    );
    await service.claim(ownId, claimInput(), actor(outsiderId));
    await service.claim(otherId, claimInput(), actor(broadcastUserId));

    expect((await service.available(availableQuery(), actor(vehicleClaimId))).total).toBe(0);
    expect(
      (await errorOf(() => service.claim(otherVehicleId, claimInput(), actor(vehicleClaimId)))).code,
    ).toBe('SCOPE_DENIED');
    const allowedId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff112',
      code: 'Z-2026-000112',
      assignMode: 'BROADCAST',
      vehicleId,
    });
    expect((await service.available(availableQuery(), actor(vehicleClaimId))).items.map((i) => i.id)).toEqual(
      [allowedId],
    );
    await service.claim(allowedId, claimInput(), actor(vehicleClaimId));
  });

  it('claim spaja poslani nacrt s postojećim i provjerava ON_CLAIM zahtjev prije prelaza', async () => {
    const { fake, service } = setup();
    const taskId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff113',
      code: 'Z-2026-000113',
      taskTypeId: customTypeId,
      vehicleId: null,
      formSchemaId: boundFormId,
      formSchemaVersionId: boundVersionId,
      formData: {
        washType: 'FULL',
        washCost: { amount: 9000, currency: 'BAM' },
        photosAfter: [photoId],
      },
    });
    fake.addAssignment(taskId, invitedId, 'INVITED');

    const missing = await errorOf(() => service.claim(taskId, claimInput(), actor(invitedId)));
    expect(missing.code).toBe('FORM_VALIDATION_FAILED');
    expect(missing.details?.some((item) => item.path.join('.') === 'formData.washDurationMin')).toBe(true);
    expect(fake.tasks.get(taskId)).toMatchObject({ status: 'OPEN', version: 2 });
    expect(fake.events.filter((row) => row.action === 'CLAIMED')).toHaveLength(0);

    const result = await service.claim(taskId, claimInput({ washDurationMin: 45 }), actor(invitedId));
    expect(result.data.formData).toMatchObject({
      washType: 'FULL',
      photosAfter: [photoId],
      washDurationMin: 45,
    });
    expect(result.data.status).toBe('IN_PROGRESS');
  });

  it('već preuzet zadatak daje podatke o izvršiocu kandidatu, a terminalna stanja invalidnu tranziciju', async () => {
    const { fake, service } = setup();
    const progressId = seedOpenClaim(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff114',
      code: 'Z-2026-000114',
      status: 'IN_PROGRESS',
      assigneeUserId: invited2Id,
      claimedAt: new Date('2026-10-20T09:29:10Z'),
      version: 3,
    });
    fake.addAssignment(progressId, invitedId, 'INVITED');
    fake.addAssignment(progressId, invited2Id, 'ASSIGNEE');

    const claimed = await errorOf(() => service.claim(progressId, claimInput(), actor(invitedId)));
    expect(claimed.code).toBe('TASK_ALREADY_CLAIMED');
    expect(claimed.extra).toMatchObject({
      taskId: progressId,
      claimedByUserId: invited2Id,
      claimedByName: 'Adnan Pozvani',
      claimedAt: '2026-10-20T09:29:10.000Z',
    });
    expect((await errorOf(() => service.claim(progressId, claimInput(), actor(outsiderId)))).code).toBe(
      'NOT_FOUND',
    );

    for (const [status, suffix] of [
      ['COMPLETED', '115'],
      ['CANCELLED', '116'],
    ] as const) {
      const terminalId = seedOpenClaim(fake, {
        id: `ffffffff-ffff-4fff-8fff-fffffffff${suffix}`,
        code: `Z-2026-000${suffix}`,
        status,
        assigneeUserId: invited2Id,
        claimedAt: new Date('2026-10-20T09:00:00Z'),
        ...(status === 'COMPLETED'
          ? { completedAt: new Date('2026-10-20T10:00:00Z'), completedById: invited2Id }
          : { cancelledAt: new Date('2026-10-20T10:00:00Z'), cancelReason: 'Odgođeno' }),
      });
      fake.addAssignment(terminalId, invitedId, 'INVITED');
      const error = await errorOf(() => service.claim(terminalId, claimInput(), actor(invitedId)));
      expect(error.code).toBe('INVALID_TASK_TRANSITION');
      expect(error.httpStatus).toBe(422);
    }
  });
});

describe('TasksService — završetak i override', () => {
  const validCompletionForm = (): Record<string, unknown> => ({
    washType: 'FULL',
    washDurationMin: 45,
    washCost: { amount: 9000, currency: 'BAM' },
    photosAfter: [photoId],
  });
  const completeInput = (patch: Row = {}) =>
    completeTaskSchema.parse({ version: 2, formData: validCompletionForm(), ...patch });

  const seedInProgress = (fake: FakeTasksPrisma, patch: Row = {}): string => {
    const { skipAssignment, ...taskPatch } = patch;
    const id = String(taskPatch.id ?? `ffffffff-ffff-4fff-8fff-fffffffff${200 + fake.tasks.size}`);
    fake.addTask({
      id,
      code: `Z-2026-000${200 + fake.tasks.size}`,
      status: 'IN_PROGRESS',
      assigneeUserId: assigneeId,
      claimedAt: new Date(Date.now() - 65 * 60_000),
      version: 2,
      ...taskPatch,
    });
    if (skipAssignment !== true) {
      fake.addAssignment(id, String(taskPatch.assigneeUserId ?? assigneeId), 'ASSIGNEE');
    }
    return id;
  };

  const addAttachment = (fake: FakeTasksPrisma, patch: Row = {}): Row => {
    const row: Row = {
      id: photoId,
      ownerType: 'OTHER',
      ownerId: assigneeId,
      stage: 'GENERAL',
      mimeType: 'image/jpeg',
      sizeBytes: 2048n,
      uploadedById: assigneeId,
      taskId: null,
      formFieldKey: null,
      deletedAt: null,
      ...patch,
    };
    fake.attachments.push(row);
    return row;
  };

  it('izvršilac završava zadatak uz punu formu, normalizaciju, priloge, komentar, događaj i outbox', async () => {
    const { fake, service } = setup();
    const taskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff201',
      code: 'Z-2026-000201',
      formData: { washType: 'FULL' },
    });
    fake.addAssignment(taskId, observerId, 'OBSERVER');
    addAttachment(fake);
    addAttachment(fake, { id: generalAttachmentId });

    const result = await service.complete(
      taskId,
      completeInput({
        formData: {
          washDurationMin: 45,
          washCost: { amount: 9000, currency: 'BAM' },
          photosAfter: [photoId],
        },
        attachmentIds: [generalAttachmentId],
        comment: 'Felge su dodatno oprane.',
        odometerKm: 148230,
      }),
      actor(assigneeId),
    );

    expect(result.data).toMatchObject({
      status: 'COMPLETED',
      assigneeUserId: assigneeId,
      completedById: assigneeId,
      version: 3,
      odometerKm: 148230,
      totalCost: 9000,
      commentCount: 1,
    });
    expect(result.data.completedAt).not.toBeNull();
    expect(result.data.durationMinutes).toBeGreaterThanOrEqual(65);
    expect(result.data.durationMinutes).toBeLessThanOrEqual(66);
    expect(result.data.formData).toMatchObject({
      washType: 'FULL',
      washDurationMin: 45,
      photosAfter: [photoId],
    });
    expect(result.data.attachmentIds).toEqual(expect.arrayContaining([photoId, generalAttachmentId]));
    expect(taskDetailSchema.parse(result.data)).toEqual(result.data);
    expect(result.meta).toMatchObject({ override: false, completedById: assigneeId });
    expect(result.meta?.boundAttachmentIds).toEqual(expect.arrayContaining([photoId, generalAttachmentId]));

    expect(fake.attachments.find((row) => row.id === photoId)).toMatchObject({
      ownerType: 'TASK',
      ownerId: taskId,
      taskId,
      formFieldKey: 'photosAfter',
      stage: 'ON_COMPLETE',
    });
    expect(fake.attachments.find((row) => row.id === generalAttachmentId)).toMatchObject({
      ownerType: 'TASK',
      ownerId: taskId,
      taskId,
      formFieldKey: null,
      stage: 'ON_COMPLETE',
    });
    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0]).toMatchObject({
      taskId,
      authorId: assigneeId,
      body: 'Felge su dodatno oprane.',
      mentionsUserIds: [],
    });

    const events = fake.events.filter((row) => row.taskId === taskId && row.action === 'COMPLETED');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      assigneeUserId: assigneeId,
      completedById: assigneeId,
      override: false,
      odometerKm: 148230,
      normalized: { totalCost: 9000 },
      submittedAttachmentIds: [generalAttachmentId],
      comment: 'Felge su dodatno oprane.',
    });
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]).toMatchObject({
      eventType: 'TASK_COMPLETED',
      idempotencyKey: `task:${taskId}:TASK_COMPLETED:v3`,
    });
    expect((fake.outbox[0]!.payload as Row).recipientUserIds).toEqual([adminId, observerId]);
    expect(fake.outbox[0]!.payload as Row).toMatchObject({ override: false, odometerKm: 148230 });
  });

  it('puna validacija primjenjuje ON_COMPLETE fotografije, stvarne priloge i ranije fazne zahtjeve', async () => {
    const { fake, service } = setup();
    const taskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff202',
      code: 'Z-2026-000202',
    });

    const missingPhotos = await errorOf(() =>
      service.complete(
        taskId,
        completeInput({
          formData: { ...validCompletionForm(), washType: 'INTERNAL', photosAfter: [] },
        }),
        actor(assigneeId),
      ),
    );
    expect(missingPhotos.code).toBe('FORM_VALIDATION_FAILED');
    expect(missingPhotos.httpStatus).toBe(422);
    expect(missingPhotos.details?.some((item) => item.path.join('.') === 'formData.photosAfter')).toBe(true);
    expect(fake.tasks.get(taskId)).toMatchObject({ status: 'IN_PROGRESS', version: 2 });

    const unknownPhoto = await errorOf(() =>
      service.complete(
        taskId,
        completeInput({ formData: { ...validCompletionForm(), photosAfter: [otherAttachmentId] } }),
        actor(assigneeId),
      ),
    );
    expect(unknownPhoto.code).toBe('FORM_VALIDATION_FAILED');
    expect(
      ((unknownPhoto.extra as Row).errors as Row[]).some((item) => item.code === 'ATTACHMENT_UNKNOWN'),
    ).toBe(true);

    addAttachment(fake, {
      ownerType: 'TASK',
      ownerId: taskId,
      taskId,
      formFieldKey: 'photosAfter',
      stage: 'ON_CLAIM',
    });
    addAttachment(fake, {
      id: otherAttachmentId,
      ownerType: 'TASK',
      ownerId: missingId,
      taskId: missingId,
      stage: 'ON_COMPLETE',
    });
    const foreignGeneral = await errorOf(() =>
      service.complete(taskId, completeInput({ attachmentIds: [otherAttachmentId] }), actor(assigneeId)),
    );
    expect(foreignGeneral.code).toBe('VALIDATION_ERROR');
    expect(foreignGeneral.httpStatus).toBe(400);
    expect(fake.tasks.get(taskId)).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
    expect(fake.outbox).toHaveLength(0);

    const custom = setup();
    const customTaskId = seedInProgress(custom.fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff203',
      code: 'Z-2026-000203',
      taskTypeId: customTypeId,
      vehicleId: null,
      formSchemaId: boundFormId,
      formSchemaVersionId: boundVersionId,
    });
    addAttachment(custom.fake);
    const missingClaimField = await errorOf(() =>
      custom.service.complete(
        customTaskId,
        completeInput({
          formData: {
            washType: 'FULL',
            washCost: { amount: 9000, currency: 'BAM' },
            photosAfter: [photoId],
          },
        }),
        actor(assigneeId),
      ),
    );
    expect(missingClaimField.code).toBe('FORM_VALIDATION_FAILED');
    expect(
      missingClaimField.details?.some((item) => item.path.join('.') === 'formData.washDurationMin'),
    ).toBe(true);
  });

  it('P7: vidljivi neizvršilac dobija NOT_ASSIGNEE, nevidljivi NOT_FOUND, a opseg se poštuje', async () => {
    const { fake, service } = setup();
    const taskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff204',
      code: 'Z-2026-000204',
    });
    fake.addAssignment(taskId, observerId, 'OBSERVER');

    const notAssignee = await errorOf(() => service.complete(taskId, completeInput(), actor(observerId)));
    expect(notAssignee.code).toBe('NOT_ASSIGNEE');
    expect(notAssignee.httpStatus).toBe(403);
    expect(notAssignee.extra).toMatchObject({ taskId, assigneeUserId: assigneeId });
    expect((await errorOf(() => service.complete(taskId, completeInput(), actor(outsiderId)))).code).toBe(
      'NOT_FOUND',
    );

    const noPermissionTaskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff205',
      code: 'Z-2026-000205',
      assigneeUserId: noClaimId,
    });
    expect(
      (await errorOf(() => service.complete(noPermissionTaskId, completeInput(), actor(noClaimId)))).code,
    ).toBe('PERMISSION_DENIED');

    const otherVehicleTaskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff206',
      code: 'Z-2026-000206',
      vehicleId: archivedVehicleId,
      assigneeUserId: vehicleClaimId,
    });
    expect(
      (await errorOf(() => service.complete(otherVehicleTaskId, completeInput(), actor(vehicleClaimId))))
        .code,
    ).toBe('SCOPE_DENIED');
  });

  it('override završava tuđi zadatak, bilježi stvarnog aktera i OVERRIDE_COMPLETED događaj', async () => {
    const { fake, service } = setup();
    const taskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff207',
      code: 'Z-2026-000207',
    });
    addAttachment(fake, {
      ownerType: 'TASK',
      ownerId: taskId,
      taskId,
      formFieldKey: 'photosAfter',
      stage: 'ON_CLAIM',
    });

    const result = await service.complete(
      taskId,
      completeInput({ reason: 'Izvršilac je odsutan, posao je provjeren na terenu.' }),
      actor(overrideId),
    );

    expect(result.data).toMatchObject({
      status: 'COMPLETED',
      assigneeUserId: assigneeId,
      completedById: overrideId,
      version: 3,
    });
    expect(result.meta).toMatchObject({
      override: true,
      completedById: overrideId,
      reason: 'Izvršilac je odsutan, posao je provjeren na terenu.',
    });
    expect(fake.attachments.find((row) => row.id === photoId)).toMatchObject({ stage: 'ON_CLAIM' });

    const events = fake.events.filter((row) => row.taskId === taskId && row.action === 'OVERRIDE_COMPLETED');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      assigneeUserId: assigneeId,
      completedById: overrideId,
      override: true,
      reason: 'Izvršilac je odsutan, posao je provjeren na terenu.',
    });
    expect((fake.outbox[0]!.payload as Row).recipientUserIds).toEqual([adminId, assigneeId]);
    expect(fake.outbox[0]!.payload as Row).toMatchObject({
      override: true,
      completedById: overrideId,
    });

    const ownTaskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff208',
      code: 'Z-2026-000208',
      assigneeUserId: overrideId,
    });
    addAttachment(fake, {
      id: generalAttachmentId,
      ownerId: overrideId,
      uploadedById: overrideId,
    });
    const ownResult = await service.complete(
      ownTaskId,
      completeInput({
        formData: { ...validCompletionForm(), photosAfter: [generalAttachmentId] },
      }),
      actor(overrideId),
    );
    expect(ownResult.meta).toMatchObject({ override: false, completedById: overrideId });
    expect(fake.events.filter((row) => row.taskId === ownTaskId && row.action === 'COMPLETED')).toHaveLength(
      1,
    );
  });

  it('CAS verzija i statusna mašina odbijaju zastarjeli ili nedozvoljeni završetak', async () => {
    const { fake, service } = setup();
    const taskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff209',
      code: 'Z-2026-000209',
    });
    const conflict = await errorOf(() =>
      service.complete(taskId, completeInput({ version: 3 }), actor(assigneeId)),
    );
    expect(conflict.code).toBe('VERSION_CONFLICT');
    expect(conflict.httpStatus).toBe(409);
    expect(conflict.extra).toMatchObject({ currentVersion: 2 });

    const openTaskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff210',
      code: 'Z-2026-000210',
      status: 'OPEN',
      claimedAt: null,
    });
    expect((await errorOf(() => service.complete(openTaskId, completeInput(), actor(assigneeId)))).code).toBe(
      'INVALID_TASK_TRANSITION',
    );

    const completedTaskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff211',
      code: 'Z-2026-000211',
      status: 'COMPLETED',
      completedAt: new Date('2026-10-20T10:00:00Z'),
      completedById: assigneeId,
    });
    expect(
      (await errorOf(() => service.complete(completedTaskId, completeInput(), actor(assigneeId)))).code,
    ).toBe('INVALID_TASK_TRANSITION');
    expect(fake.events.filter((row) => row.action === 'COMPLETED')).toHaveLength(0);
  });

  it('direktna kilometraža mora odgovarati normalizovanoj i zahtijeva vozilo', async () => {
    const { fake, service } = setup();
    const version = fake.versions.get(genericVersionId)!;
    const definition = version.definition as Row;
    const firstSection = (definition.sections as Row[])[0]!;
    (firstSection.fields as Row[]).push({
      key: 'odometerKm',
      type: 'INTEGER',
      label: 'Kilometraža',
      order: 99,
      validation: { min: 0, max: 2147483647 },
    });
    definition.normalizedName = [
      ...((definition.normalizedName as Row[]) ?? []),
      { fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' },
    ];

    const taskId = seedInProgress(fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff212',
      code: 'Z-2026-000212',
    });
    addAttachment(fake);
    const mismatch = await errorOf(() =>
      service.complete(
        taskId,
        completeInput({
          formData: { ...validCompletionForm(), odometerKm: 148000 },
          odometerKm: 148001,
        }),
        actor(assigneeId),
      ),
    );
    expect(mismatch.code).toBe('VALIDATION_ERROR');
    expect(mismatch.details?.some((item) => item.path.join('.') === 'odometerKm')).toBe(true);
    expect(fake.tasks.get(taskId)).toMatchObject({ status: 'IN_PROGRESS', version: 2 });

    const result = await service.complete(
      taskId,
      completeInput({
        formData: { ...validCompletionForm(), odometerKm: 148000 },
        odometerKm: 148000,
      }),
      actor(assigneeId),
    );
    expect(result.data.odometerKm).toBe(148000);

    const noVehicle = setup();
    const noVehicleTaskId = seedInProgress(noVehicle.fake, {
      id: 'ffffffff-ffff-4fff-8fff-fffffffff213',
      code: 'Z-2026-000213',
      taskTypeId: customTypeId,
      vehicleId: null,
      formSchemaId: boundFormId,
      formSchemaVersionId: boundVersionId,
    });
    const noVehicleError = await errorOf(() =>
      noVehicle.service.complete(noVehicleTaskId, completeInput({ odometerKm: 1000 }), actor(assigneeId)),
    );
    expect(noVehicleError.code).toBe('VALIDATION_ERROR');
    expect(noVehicleError.details?.some((item) => item.path.join('.') === 'odometerKm')).toBe(true);
  });
});

describe('TasksController — metadata', () => {
  it('rute imaju odvojene permisije, audit i 201 za kreiranje', () => {
    const permissions = (method: unknown): unknown =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).permissions;
    const mode = (method: unknown): unknown =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).mode;

    expect(permissions(TasksController.prototype.list)).toEqual(['task:view', 'task:view_all']);
    expect(mode(TasksController.prototype.list)).toBe('ANY');
    expect(permissions(TasksController.prototype.available)).toEqual(['task:claim']);
    expect(permissions(TasksController.prototype.get)).toEqual(['task:view', 'task:view_all']);
    expect(permissions(TasksController.prototype.create)).toEqual(['task:create']);
    expect(permissions(TasksController.prototype.update)).toEqual(['task:update']);
    expect(permissions(TasksController.prototype.claim)).toEqual(['task:claim']);
    expect(permissions(TasksController.prototype.complete)).toEqual([
      'task:complete',
      'task:complete_override',
    ]);
    expect(mode(TasksController.prototype.complete)).toBe('ANY');
    expect(permissions(TasksController.prototype.cancel)).toEqual(['task:cancel']);
    expect(permissions(TasksController.prototype.reopen)).toEqual(['task:reopen']);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TasksController.prototype.create)).toBe(201);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TasksController.prototype.claim)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TasksController.prototype.complete)).toBe(200);
    expect(Reflect.getMetadata('vfm:audit', TasksController.prototype.claim)).toMatchObject({
      action: 'CLAIM',
      severity: 'INFO',
      resource: 'Task',
    });
    expect(Reflect.getMetadata('vfm:audit', TasksController.prototype.complete)).toMatchObject({
      action: 'COMPLETE',
      severity: 'INFO',
      resource: 'Task',
    });
    expect(Reflect.getMetadata('vfm:audit', TasksController.prototype.cancel)).toMatchObject({
      action: 'CANCEL',
      severity: 'WARN',
      resource: 'Task',
    });
    expect(Reflect.getMetadata('vfm:audit', TasksController.prototype.reopen)).toMatchObject({
      action: 'REOPEN',
      severity: 'WARN',
      resource: 'Task',
    });
  });

  it('DTO-i odbijaju serverska polja i prazan PATCH', () => {
    expect(createTaskSchema.safeParse({ taskTypeId: washTypeId, status: 'COMPLETED' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(cancelTaskSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(claimTaskSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ version: 0, status: 'COMPLETED' }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ version: 0, formValues: {} }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ version: 0, attachmentIds: [photoId, photoId] }).success).toBe(
      false,
    );
    expect(completeTaskSchema.parse({ version: 0 })).toMatchObject({
      formData: {},
      attachmentIds: [],
    });
    expect(taskAvailableQuerySchema.safeParse({ status: 'OPEN' }).success).toBe(false);
  });
});
