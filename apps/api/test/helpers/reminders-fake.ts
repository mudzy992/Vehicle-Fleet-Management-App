/**
 * Fake Prisma za podsjetnike.
 *
 * Bitno ponašanje: `scheduledReminder.createMany({ skipDuplicates: true })`
 * poštuje unique `dedupeKey` i vraća **samo** broj stvarno upisanih redova —
 * upravo to dokazuje idempotentnost skenera (P-07).
 */
export interface FakePolicyRow {
  id: string;
  kind: string;
  enabled: boolean;
  thresholdsDays: number[];
  thresholdsKm: number[];
  channels: string[];
  escalate: boolean;
  notes: string | null;
  updatedAt: Date;
}

export interface FakeReminderRow {
  id: string;
  policyId: string;
  kind: string;
  entityType: string;
  entityId: string;
  dueDate: Date | null;
  dueKm: number | null;
  thresholdDays: number | null;
  thresholdKm: number | null;
  fireAt: Date;
  status: string;
  dedupeKey: string;
  sentAt: Date | null;
  acknowledgedById: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

export class FakeRemindersPrisma {
  readonly policies: FakePolicyRow[] = [];
  readonly reminders: FakeReminderRow[] = [];
  readonly registrations: Array<{ id: string; vehicleId: string; validUntil: Date }> = [];
  readonly insurances: Array<{ id: string; vehicleId: string; validUntil: Date }> = [];
  readonly drivers: Array<{
    id: string;
    licenseExpiresAt: Date | null;
    createdById?: string | null;
    deletedAt?: Date | null;
  }> = [];
  readonly vehicles: Array<{
    id: string;
    nextServiceDueDate: Date | null;
    nextServiceDueKm: number | null;
    createdById?: string | null;
    deletedAt?: Date | null;
  }> = [];

  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  addPolicy(kind: string, overrides: Partial<FakePolicyRow> = {}): FakePolicyRow {
    const row: FakePolicyRow = {
      id: this.nextId('pol'),
      kind,
      enabled: true,
      thresholdsDays: [5],
      thresholdsKm: [],
      channels: ['IN_APP', 'FCM'],
      escalate: false,
      notes: null,
      updatedAt: new Date(),
      ...overrides,
    };
    this.policies.push(row);
    return row;
  }

  addReminder(overrides: Partial<FakeReminderRow> = {}): FakeReminderRow {
    const row: FakeReminderRow = {
      id: this.nextId('rem'),
      policyId: 'pol-0001',
      kind: 'REGISTRATION',
      entityType: 'Vehicle',
      entityId: 'veh-1',
      dueDate: null,
      dueKm: null,
      thresholdDays: 5,
      thresholdKm: null,
      fireAt: new Date(),
      status: 'SCHEDULED',
      dedupeKey: `key-${this.seq}`,
      sentAt: null,
      acknowledgedById: null,
      acknowledgedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
    this.reminders.push(row);
    return row;
  }

  reminderPolicy = {
    findMany: async (args: { where?: Where } = {}) =>
      this.policies.filter(
        (policy) => args.where?.enabled === undefined || policy.enabled === args.where.enabled,
      ),
    findUnique: async (args: { where: { kind?: string; id?: string } }) =>
      this.policies.find(
        (policy) =>
          (args.where.kind === undefined || policy.kind === args.where.kind) &&
          (args.where.id === undefined || policy.id === args.where.id),
      ) ?? null,
    create: async (args: { data: Record<string, unknown> }) => {
      const row: FakePolicyRow = {
        id: String(args.data.id ?? this.nextId('pol')),
        kind: String(args.data.kind),
        enabled: (args.data.enabled as boolean | undefined) ?? true,
        thresholdsDays: (args.data.thresholdsDays as number[] | undefined) ?? [5],
        thresholdsKm: (args.data.thresholdsKm as number[] | undefined) ?? [],
        channels: (args.data.channels as string[] | undefined) ?? ['IN_APP', 'FCM'],
        escalate: (args.data.escalate as boolean | undefined) ?? false,
        notes: (args.data.notes as string | null) ?? null,
        updatedAt: new Date(),
      };
      this.policies.push(row);
      return row;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const index = this.policies.findIndex((policy) => policy.id === args.where.id);
      if (index < 0) throw new Error('nema politike');
      const next = { ...this.policies[index]!, ...args.data, updatedAt: new Date() };
      this.policies[index] = next as FakePolicyRow;
      return next;
    },
  };

  scheduledReminder = {
    count: async (args: { where?: Where } = {}) => this.filter(args.where ?? {}).length,
    findMany: async (args: { where?: Where; skip?: number; take?: number } = {}) => {
      const rows = this.filter(args.where ?? {});
      return rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
    },
    findUnique: async (args: { where: { id: string } }) =>
      this.reminders.find((row) => row.id === args.where.id) ?? null,
    createMany: async (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const data of args.data) {
        const key = String(data.dedupeKey);
        if (args.skipDuplicates && this.reminders.some((row) => row.dedupeKey === key)) continue;
        this.reminders.push({
          id: String(data.id ?? this.nextId('rem')),
          policyId: String(data.policyId),
          kind: String(data.kind),
          entityType: String(data.entityType),
          entityId: String(data.entityId),
          dueDate: (data.dueDate as Date | undefined) ?? null,
          dueKm: (data.dueKm as number | undefined) ?? null,
          thresholdDays: (data.thresholdDays as number | undefined) ?? null,
          thresholdKm: (data.thresholdKm as number | undefined) ?? null,
          fireAt: data.fireAt as Date,
          status: String(data.status ?? 'SCHEDULED'),
          dedupeKey: key,
          sentAt: null,
          acknowledgedById: null,
          acknowledgedAt: null,
          createdAt: new Date(),
        });
        count += 1;
      }
      return { count };
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const index = this.reminders.findIndex((row) => row.id === args.where.id);
      if (index < 0) throw new Error('nema podsjetnika');
      const next = { ...this.reminders[index]!, ...args.data } as FakeReminderRow;
      this.reminders[index] = next;
      return next;
    },
  };

  private filter(where: Where): FakeReminderRow[] {
    const matches = (row: FakeReminderRow, condition: Where): boolean => {
      if (Array.isArray(condition.AND) && !condition.AND.every((item) => matches(row, item as Where)))
        return false;
      if (Array.isArray(condition.OR) && !condition.OR.some((item) => matches(row, item as Where)))
        return false;
      if (typeof condition.kind === 'string' && row.kind !== condition.kind) return false;
      if (typeof condition.status === 'string' && row.status !== condition.status) return false;
      if (typeof condition.entityType === 'string' && row.entityType !== condition.entityType) return false;
      if (typeof condition.entityId === 'string' && row.entityId !== condition.entityId) return false;
      if (condition.entityId && typeof condition.entityId === 'object') {
        const ids = (condition.entityId as { in?: string[] }).in;
        if (ids && !ids.includes(row.entityId)) return false;
      }
      if (condition.id && typeof condition.id === 'object') {
        const ids = (condition.id as { in?: string[] }).in;
        if (ids && !ids.includes(row.id)) return false;
      }
      if (condition.fireAt && typeof condition.fireAt === 'object') {
        const lte = (condition.fireAt as { lte?: Date }).lte;
        if (lte && row.fireAt > lte) return false;
      }
      return true;
    };
    return this.reminders.filter((row) => matches(row, where));
  }

  registrationRecord = { findMany: async () => this.registrations };
  insuranceRecord = { findMany: async () => this.insurances };
  driver = {
    findMany: async (args: { where?: Where } = {}) =>
      this.drivers.filter(
        (row) =>
          (typeof args.where?.createdById !== 'string' || row.createdById === args.where.createdById) &&
          (args.where?.deletedAt !== null || row.deletedAt === null || row.deletedAt === undefined),
      ),
  };
  vehicle = {
    findMany: async (args: { where?: Where } = {}) =>
      this.vehicles.filter(
        (row) =>
          (typeof args.where?.createdById !== 'string' || row.createdById === args.where.createdById) &&
          (args.where?.deletedAt !== null || row.deletedAt === null || row.deletedAt === undefined),
      ),
  };
}

function asPrisma(fake: FakeRemindersPrisma): never {
  return fake as unknown as never;
}

async function catchVfm(promise: Promise<unknown>): Promise<{ code: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string };
  }
  throw new Error('očekivana greška nije bačena');
}

export { asPrisma, catchVfm };
