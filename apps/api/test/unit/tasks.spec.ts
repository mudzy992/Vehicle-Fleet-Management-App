/** Zadaci: snapshot forme, vidljivost/opseg, CAS izmjene i statusne tranzicije. */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import {
  cancelTaskSchema,
  createTaskSchema,
  reopenTaskSchema,
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
  private readonly grants = new Map<string, Map<string, 'ALL' | 'OWN'>>();

  constructor() {
    this.set(adminId, {
      'task:view': 'ALL',
      'task:view_all': 'ALL',
      'task:create': 'ALL',
      'task:update': 'ALL',
      'task:cancel': 'ALL',
      'task:reopen': 'ALL',
    });
    this.set(invitedId, {
      'task:view': 'OWN',
      'task:claim': 'OWN',
      'task:update': 'OWN',
      'task:cancel': 'OWN',
      'task:reopen': 'OWN',
    });
    this.set(invited2Id, { 'task:view': 'OWN', 'task:claim': 'OWN' });
    this.set(assigneeId, { 'task:view': 'OWN', 'task:claim': 'OWN', 'task:update': 'OWN' });
    this.set(observerId, { 'task:view': 'OWN' });
    this.set(outsiderId, {
      'task:view': 'OWN',
      'task:claim': 'OWN',
      'task:update': 'OWN',
      'task:cancel': 'OWN',
      'task:reopen': 'OWN',
    });
    this.set(noClaimId, { 'task:view': 'OWN' });
    this.set(inactiveId, { 'task:view': 'OWN', 'task:claim': 'OWN' });
  }

  private set(userId: string, grants: Record<string, 'ALL' | 'OWN'>): void {
    this.grants.set(userId, new Map(Object.entries(grants)));
  }

  async effective(userId: string) {
    const permissions = new Map(this.grants.get(userId) ?? []);
    return {
      isSuperAdmin: false,
      permissions,
      list: [...permissions.keys()],
      grants: [],
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
      id: `assignment-${this.assignments.length + 1}`,
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
      if (key === 'assignments' && typeof condition === 'object' && condition !== null) {
        const some = (condition as Row).some as Row;
        const hit = this.assignments.some(
          (assignment) => assignment.taskId === row.id && this.matches(assignment, some),
        );
        if (!hit) return false;
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

describe('TasksController — metadata', () => {
  it('rute imaju odvojene permisije, audit i 201 za kreiranje', () => {
    const permissions = (method: unknown): unknown =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).permissions;
    const mode = (method: unknown): unknown =>
      Reflect.getMetadata('vfm:requiredPermissions', method as object).mode;

    expect(permissions(TasksController.prototype.list)).toEqual(['task:view', 'task:view_all']);
    expect(mode(TasksController.prototype.list)).toBe('ANY');
    expect(permissions(TasksController.prototype.get)).toEqual(['task:view', 'task:view_all']);
    expect(permissions(TasksController.prototype.create)).toEqual(['task:create']);
    expect(permissions(TasksController.prototype.update)).toEqual(['task:update']);
    expect(permissions(TasksController.prototype.cancel)).toEqual(['task:cancel']);
    expect(permissions(TasksController.prototype.reopen)).toEqual(['task:reopen']);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TasksController.prototype.create)).toBe(201);
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
  });
});
