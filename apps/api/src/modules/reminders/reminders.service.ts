/**
 * `RemindersService` — politike i idempotentni podsjetnici (docs/03 §3.8, P-07).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Idempotentnost.** `ScheduledReminder.dedupeKey` je
 *    `{kind}:{entityType}:{entityId}:{dueDate|dueKm}:{threshold}` i unique je u
 *    bazi. Skener upisuje kroz `createMany({ skipDuplicates: true })`, pa dva
 *    pokretanja (ručno + cron) **ne** prave duplikate — drugo vraća `created: 0`.
 * 2. **Default prag 5 dana.** Politika postoji po vrsti; ako je nema, skener je
 *    preskače (`enabled` je odluka administratora, ne pretpostavka).
 * 3. **Vrijeme je lokalno (Europe/Sarajevo), pohrana UTC.** `fireAt` je 06:00
 *    lokalno na dan `dueDate − threshold`; računa se iz offseta zone za taj
 *    datum (CET/CEST), ne „fiksno +1/+2".
 * 4. **Potvrda i odgađanje su stanja, ne brisanje.** `acknowledge` prelazi u
 *    `ACKNOWLEDGED` (idempotentno), `snooze` pomjera `fireAt` u budućnost.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Permission } from '@vfm/shared';
import { toLocalDateString } from '@vfm/shared';
import type {
  ReminderListQuery,
  ReminderListResponse,
  ReminderPolicy,
  ReminderPolicyList,
  ReminderScanResult,
  ScheduledReminder,
  SnoozeReminderInput,
  UpdateReminderPolicyInput,
} from '@vfm/shared/schemas';
import type { Prisma } from '../../generated/prisma/client.js';
import { VfmErrors, VfmException } from '../../common/errors/vfm-error.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface ReminderMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/** Vremenska zona poslovnog dana (N-11). */
export const BUSINESS_TIMEZONE = 'Europe/Sarajevo';

/** Sat u kojem skener šalje podsjetnike (06:00 lokalno). */
export const REMINDER_SCAN_HOUR = 6;

/** Default prag (dani) ako politika nema svoj — zahtjev Faze 3. */
export const DEFAULT_THRESHOLD_DAYS = 5;

const SELECT = {
  id: true,
  kind: true,
  entityType: true,
  entityId: true,
  dueDate: true,
  dueKm: true,
  thresholdDays: true,
  thresholdKm: true,
  fireAt: true,
  status: true,
  sentAt: true,
  acknowledgedAt: true,
  createdAt: true,
} as const;

interface ReminderRow {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  dueDate: Date | null;
  dueKm: number | null;
  thresholdDays: number | null;
  thresholdKm: number | null;
  fireAt: Date;
  status: string;
  sentAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

interface PolicyRow {
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

function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

function dateOnly(value: Date | null): string | null {
  return value ? toLocalDateString(value) : null;
}

/** Offset zone (minute) za dati trenutak — rješava CET/CEST bez fiksnih sati. */
export function zoneOffsetMinutes(at: Date, timeZone = BUSINESS_TIMEZONE): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * `YYYY-MM-DD` + sat (lokalno) → UTC `Date`. Dvostruka korekcija offseta:
 * prva procjena može pasti u drugu stranu DST prelaza, pa se offset računa
 * ponovo na korigovanom trenutku.
 */
export function zonedDateTime(dateIso: string, hour: number, timeZone = BUSINESS_TIMEZONE): Date {
  const [year, month, day] = dateIso.split('-').map(Number);
  const naive = Date.UTC(year!, month! - 1, day!, hour, 0, 0, 0);
  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  const corrected = new Date(naive - zoneOffsetMinutes(firstGuess, timeZone) * 60_000);
  return corrected;
}

/** `YYYY-MM-DD` minus N dana (bez zavisnosti od zone). */
export function shiftDate(dateIso: string, days: number): string {
  const base = Date.parse(`${dateIso}T00:00:00.000Z`);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Ključ idempotentnosti (P-07) — jedan podsjetnik po (zapis, vrsta, prag). */
export function reminderDedupeKey(args: {
  kind: string;
  entityType: string;
  entityId: string;
  dueDate: string | null;
  dueKm: number | null;
  thresholdDays: number | null;
  thresholdKm: number | null;
}): string {
  const due = args.dueDate ?? `km${args.dueKm ?? 0}`;
  const threshold = args.thresholdDays ?? `km${args.thresholdKm ?? 0}`;
  return `${args.kind}:${args.entityType}:${args.entityId}:${due}:${threshold}`;
}

interface Candidate {
  kind: string;
  entityType: string;
  entityId: string;
  dueDate?: string;
  dueKm?: number;
}

@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Čitanje
  // ---------------------------------------------------------------------------

  async list(query: ReminderListQuery, actor?: AuthenticatedUser): Promise<ReminderListResponse> {
    const queryWhere = this.buildWhere(query);
    const permissionWhere = actor ? await this.reminderViewScope(actor) : undefined;
    const where = permissionWhere ? { AND: [queryWhere, permissionWhere] } : queryWhere;
    const [total, rows] = await Promise.all([
      this.prisma.scheduledReminder.count({ where }),
      this.prisma.scheduledReminder.findMany({
        where,
        orderBy: { fireAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: SELECT,
      }),
    ]);

    return {
      items: (rows as ReminderRow[]).map((row) => this.toReminder(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async listPolicies(): Promise<ReminderPolicyList> {
    const rows = await this.prisma.reminderPolicy.findMany({ orderBy: { kind: 'asc' } });
    return { items: (rows as PolicyRow[]).map((row) => this.toPolicy(row)) };
  }

  // ---------------------------------------------------------------------------
  //  Političke izmjene
  // ---------------------------------------------------------------------------

  async updatePolicy(
    kind: string,
    input: UpdateReminderPolicyInput,
  ): Promise<ReminderMutation<ReminderPolicy>> {
    const existing = (await this.prisma.reminderPolicy.findUnique({
      where: { kind: kind as never },
    })) as PolicyRow | null;

    const data: Record<string, unknown> = {};
    for (const key of ['enabled', 'channels', 'escalate', 'notes'] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.thresholdsDays) {
      data.thresholdsDays = uniqueSorted(input.thresholdsDays);
    }
    if (input.thresholdsKm) {
      data.thresholdsKm = uniqueSorted(input.thresholdsKm);
    }

    const saved = existing
      ? await this.prisma.reminderPolicy.update({ where: { id: existing.id }, data })
      : await this.prisma.reminderPolicy.create({
          data: {
            id: randomUUID(),
            kind: kind as never,
            thresholdsDays: input.thresholdsDays ?? [DEFAULT_THRESHOLD_DAYS],
            thresholdsKm: input.thresholdsKm ?? [],
            ...data,
          },
        });

    return {
      data: this.toPolicy(saved as PolicyRow),
      ...(existing ? { before: this.policySnapshot(existing) } : {}),
      after: this.policySnapshot(saved as PolicyRow),
    };
  }

  // ---------------------------------------------------------------------------
  //  Stanja podsjetnika
  // ---------------------------------------------------------------------------

  async acknowledge(
    id: string,
    actorOrId?: AuthenticatedUser | string,
  ): Promise<ReminderMutation<ScheduledReminder>> {
    const actor = typeof actorOrId === 'string' ? undefined : actorOrId;
    const actorId = typeof actorOrId === 'string' ? actorOrId : actorOrId?.id;
    const current = await this.loadOrThrow(id);
    if (actor) await this.assertReminderScope(actor, 'reminder:acknowledge', current);
    if (current.status === 'ACKNOWLEDGED') {
      return { data: this.toReminder(current) };
    }
    if (current.status === 'CANCELLED') {
      throw new VfmException('VALIDATION_ERROR', 'Otkazan podsjetnik se ne potvrđuje.', [
        detail('status', current.status),
      ]);
    }

    const updated = (await this.prisma.scheduledReminder.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: actorId ?? null,
        acknowledgedAt: new Date(),
      },
      select: SELECT,
    })) as ReminderRow;

    return {
      data: this.toReminder(updated),
      before: { status: current.status },
      after: { status: updated.status, acknowledgedById: actorId ?? null },
    };
  }

  async snooze(
    id: string,
    input: SnoozeReminderInput,
    actor?: AuthenticatedUser,
  ): Promise<ReminderMutation<ScheduledReminder>> {
    const current = await this.loadOrThrow(id);
    if (actor) await this.assertReminderScope(actor, 'reminder:snooze', current);
    if (['ACKNOWLEDGED', 'CANCELLED', 'SENT'].includes(current.status)) {
      throw new VfmException('VALIDATION_ERROR', 'Podsjetnik se više ne može odgoditi.', [
        detail('status', current.status),
      ]);
    }

    const fireAt = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
    const updated = (await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: 'SNOOZED', fireAt },
      select: SELECT,
    })) as ReminderRow;

    return {
      data: this.toReminder(updated),
      before: { status: current.status, fireAt: current.fireAt.toISOString() },
      after: { status: updated.status, fireAt: updated.fireAt.toISOString() },
    };
  }

  // ---------------------------------------------------------------------------
  //  Skener (P-07)
  // ---------------------------------------------------------------------------

  /**
   * Pravi `ScheduledReminder` redove za sve aktivne izvore i pragove politika.
   *
   * Idempotentno: `dedupeKey` je unique, a `createMany({ skipDuplicates })`
   * tiho preskače postojeće. Vraća broj kandidata i broj **stvarno** upisanih.
   */
  async scan(now = new Date()): Promise<ReminderScanResult> {
    const policies = (await this.prisma.reminderPolicy.findMany({
      where: { enabled: true },
    })) as PolicyRow[];
    const byKind = new Map(policies.map((policy) => [policy.kind, policy]));

    const candidates = await this.collectCandidates();
    const rows: Prisma.ScheduledReminderCreateManyInput[] = [];

    for (const candidate of candidates) {
      const policy = byKind.get(candidate.kind);
      if (!policy) continue;

      if (candidate.dueDate) {
        const thresholds = policy.thresholdsDays.length ? policy.thresholdsDays : [DEFAULT_THRESHOLD_DAYS];

        for (const threshold of thresholds) {
          const fireDate = shiftDate(candidate.dueDate, -threshold);
          rows.push({
            id: randomUUID(),
            policyId: policy.id,
            kind: candidate.kind as never,
            entityType: candidate.entityType,
            entityId: candidate.entityId,
            dueDate: new Date(`${candidate.dueDate}T00:00:00.000Z`),
            thresholdDays: threshold,
            fireAt: zonedDateTime(fireDate, REMINDER_SCAN_HOUR),
            dedupeKey: reminderDedupeKey({
              kind: candidate.kind,
              entityType: candidate.entityType,
              entityId: candidate.entityId,
              dueDate: candidate.dueDate,
              dueKm: null,
              thresholdDays: threshold,
              thresholdKm: null,
            }),
          });
        }
      }

      if (candidate.dueKm !== undefined) {
        for (const threshold of policy.thresholdsKm) {
          rows.push({
            id: randomUUID(),
            policyId: policy.id,
            kind: candidate.kind as never,
            entityType: candidate.entityType,
            entityId: candidate.entityId,
            dueKm: candidate.dueKm,
            thresholdKm: threshold,
            // Kilometraža nema datum — podsjetnik „pada" odmah kad prag bude
            // pređen; `fireAt` je trenutak skena (dalje ga pomjera snooze).
            fireAt: now,
            dedupeKey: reminderDedupeKey({
              kind: candidate.kind,
              entityType: candidate.entityType,
              entityId: candidate.entityId,
              dueDate: null,
              dueKm: candidate.dueKm,
              thresholdDays: null,
              thresholdKm: threshold,
            }),
          });
        }
      }
    }

    let created = 0;
    if (rows.length > 0) {
      const result = await this.prisma.scheduledReminder.createMany({
        data: rows,
        skipDuplicates: true,
      });
      created = result.count;
    }

    return { candidates: rows.length, created, scannedAt: now.toISOString() };
  }

  private async collectCandidates(): Promise<Candidate[]> {
    const [registrations, insurances, drivers, vehicles] = await Promise.all([
      this.prisma.registrationRecord.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, vehicleId: true, validUntil: true },
      }),
      this.prisma.insuranceRecord.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, vehicleId: true, validUntil: true },
      }),
      this.prisma.driver.findMany({
        where: { deletedAt: null, status: 'ACTIVE', licenseExpiresAt: { not: null } },
        select: { id: true, licenseExpiresAt: true },
      }),
      this.prisma.vehicle.findMany({
        where: { deletedAt: null, status: { not: 'ARCHIVED' } },
        select: { id: true, nextServiceDueDate: true, nextServiceDueKm: true },
      }),
    ]);

    const candidates: Candidate[] = [];

    for (const row of registrations as Array<{ id: string; vehicleId: string; validUntil: Date }>) {
      candidates.push({
        kind: 'REGISTRATION',
        entityType: 'Vehicle',
        entityId: row.vehicleId,
        dueDate: dateOnly(row.validUntil)!,
      });
    }

    for (const row of insurances as Array<{ id: string; vehicleId: string; validUntil: Date }>) {
      candidates.push({
        kind: 'INSURANCE',
        entityType: 'Vehicle',
        entityId: row.vehicleId,
        dueDate: dateOnly(row.validUntil)!,
      });
    }

    for (const row of drivers as Array<{ id: string; licenseExpiresAt: Date | null }>) {
      candidates.push({
        kind: 'DRIVER_LICENSE',
        entityType: 'Driver',
        entityId: row.id,
        dueDate: dateOnly(row.licenseExpiresAt)!,
      });
    }

    for (const row of vehicles as Array<{
      id: string;
      nextServiceDueDate: Date | null;
      nextServiceDueKm: number | null;
    }>) {
      if (row.nextServiceDueDate) {
        candidates.push({
          kind: 'SERVICE_DATE',
          entityType: 'Vehicle',
          entityId: row.id,
          dueDate: dateOnly(row.nextServiceDueDate)!,
        });
      }
      if (row.nextServiceDueKm !== null) {
        candidates.push({
          kind: 'SERVICE_KM',
          entityType: 'Vehicle',
          entityId: row.id,
          dueKm: row.nextServiceDueKm,
        });
      }
    }

    return candidates;
  }

  // ---------------------------------------------------------------------------
  //  Pomoćne
  // ---------------------------------------------------------------------------

  private async reminderViewScope(actor: AuthenticatedUser): Promise<Record<string, unknown> | undefined> {
    const permission: Permission = 'reminder:view';
    const scope = actor.permissions?.permissions.get(permission);
    if (actor.isSuperAdmin || scope === 'ALL') return undefined;
    if (scope !== 'OWN') {
      throw VfmErrors.scopeDenied([
        { path: [permission], message: 'Nemate pristup podsjetnicima u ovom opsegu.', code: 'scope_denied' },
      ]);
    }

    const [vehicles, drivers] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { deletedAt: null, createdById: actor.id },
        select: { id: true },
      }),
      this.prisma.driver.findMany({
        where: { deletedAt: null, createdById: actor.id },
        select: { id: true },
      }),
    ]);
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const driverIds = drivers.map((driver) => driver.id);
    if (vehicleIds.length === 0 && driverIds.length === 0) return { id: { in: [] } };
    return {
      OR: [
        ...(vehicleIds.length ? [{ entityType: 'Vehicle', entityId: { in: vehicleIds } }] : []),
        ...(driverIds.length ? [{ entityType: 'Driver', entityId: { in: driverIds } }] : []),
      ],
    };
  }

  private async assertReminderScope(
    actor: AuthenticatedUser,
    permission: Permission,
    reminder: ReminderRow,
  ): Promise<void> {
    const scope = actor.permissions?.permissions.get(permission);
    if (actor.isSuperAdmin || scope === 'ALL') return;
    if (scope === 'OWN') {
      const entity =
        reminder.entityType === 'Vehicle'
          ? await this.prisma.vehicle.findFirst({
              where: { id: reminder.entityId, createdById: actor.id, deletedAt: null },
              select: { id: true },
            })
          : reminder.entityType === 'Driver'
            ? await this.prisma.driver.findFirst({
                where: { id: reminder.entityId, createdById: actor.id, deletedAt: null },
                select: { id: true },
              })
            : null;
      if (entity) return;
    }
    throw VfmErrors.scopeDenied([
      { path: [permission], message: 'Podsjetnik nije u vašem OWN opsegu.', code: 'scope_denied' },
    ]);
  }

  private buildWhere(query: ReminderListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.dueWithinDays !== undefined) {
      where.fireAt = { lte: new Date(Date.now() + query.dueWithinDays * 24 * 60 * 60 * 1000) };
    }
    return where;
  }

  private async loadOrThrow(id: string): Promise<ReminderRow> {
    const row = await this.prisma.scheduledReminder.findUnique({ where: { id }, select: SELECT });
    if (!row) throw new VfmException('NOT_FOUND', 'Podsjetnik nije pronađen.');
    return row as ReminderRow;
  }

  private toReminder(row: ReminderRow): ScheduledReminder {
    return {
      id: row.id,
      kind: row.kind as ScheduledReminder['kind'],
      entityType: row.entityType,
      entityId: row.entityId,
      dueDate: dateOnly(row.dueDate),
      dueKm: row.dueKm,
      thresholdDays: row.thresholdDays,
      thresholdKm: row.thresholdKm,
      fireAt: row.fireAt.toISOString(),
      status: row.status as ScheduledReminder['status'],
      sentAt: row.sentAt?.toISOString() ?? null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      due: row.status === 'SCHEDULED' && row.fireAt.getTime() <= Date.now(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toPolicy(row: PolicyRow): ReminderPolicy {
    return {
      id: row.id,
      kind: row.kind as ReminderPolicy['kind'],
      enabled: row.enabled,
      thresholdsDays: row.thresholdsDays,
      thresholdsKm: row.thresholdsKm,
      channels: row.channels,
      escalate: row.escalate,
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private policySnapshot(row: PolicyRow): Readonly<Record<string, unknown>> {
    return {
      kind: row.kind,
      enabled: row.enabled,
      thresholdsDays: row.thresholdsDays,
      thresholdsKm: row.thresholdsKm,
      channels: row.channels,
      escalate: row.escalate,
    };
  }
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
