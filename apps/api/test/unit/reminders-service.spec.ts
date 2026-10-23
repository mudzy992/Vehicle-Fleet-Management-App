/**
 * `RemindersService` — idempotentni podsjetnici (docs/09, P-07).
 *
 * Dokazi koje testovi traže:
 * - dva pokretanja skenera → drugo **ne** upisuje nove redove;
 * - `fireAt` je 06:00 Europe/Sarajevo (CET/CEST), pohranjen u UTC;
 * - `dedupeKey` je jedan po (zapis, vrsta, prag);
 * - potvrda/odgađanje mijenjaju stanje, ne brišu zapis.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import {
  DEFAULT_THRESHOLD_DAYS,
  RemindersService,
  reminderDedupeKey,
  shiftDate,
  zonedDateTime,
  zoneOffsetMinutes,
} from '../../src/modules/reminders/reminders.service.js';
import type { ReminderListQuery } from '@vfm/shared/schemas';
import { asPrisma, catchVfm, FakeRemindersPrisma } from '../helpers/reminders-fake.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const NOW = new Date('2026-10-20T10:00:00.000Z');

function service(fake = new FakeRemindersPrisma()): {
  fake: FakeRemindersPrisma;
  svc: RemindersService;
} {
  return { fake, svc: new RemindersService(asPrisma(fake)) };
}

function query(overrides: Partial<ReminderListQuery> = {}): ReminderListQuery {
  return { page: 1, pageSize: 25, sortOrder: 'asc', ...overrides } as ReminderListQuery;
}

function scopeActor(permission: string, scope: 'ALL' | 'OWN'): AuthenticatedUser {
  return {
    id: 'user-own',
    isSuperAdmin: false,
    permissions: {
      isSuperAdmin: false,
      list: [permission],
      permissions: new Map([[permission, scope]]),
      grants: [{ permission, scope, scopeVehicleIds: [] }],
    },
  } as unknown as AuthenticatedUser;
}

describe('vremenska zona', () => {
  it('06:00 Europe/Sarajevo je 04:00 UTC ljeti i 05:00 UTC zimi', () => {
    expect(zonedDateTime('2026-07-01', 6).toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(zonedDateTime('2026-01-15', 6).toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('offset zone se mijenja na DST granici', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00.000Z'))).toBe(60);
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00.000Z'))).toBe(120);
  });

  it('`shiftDate` pomjera datum bez uticaja zone', () => {
    expect(shiftDate('2026-03-01', -5)).toBe('2026-02-24');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('RemindersService — skener', () => {
  it('pravi po jedan podsjetnik za svaki prag politike', async () => {
    const { fake, svc } = service();
    fake.addPolicy('REGISTRATION', { thresholdsDays: [5, 1] });
    fake.registrations.push({
      id: 'reg-1',
      vehicleId: 'veh-1',
      validUntil: new Date('2026-12-31T00:00:00.000Z'),
    });

    const result = await svc.scan(NOW);

    expect(result.candidates).toBe(2);
    expect(result.created).toBe(2);
    expect(fake.reminders.map((row) => row.thresholdDays).sort()).toEqual([1, 5]);
    // Prag 5 → 26.12. u 06:00 lokalno (zimi UTC+1 → 05:00 UTC).
    expect(fake.reminders[0]!.fireAt.toISOString()).toBe('2026-12-26T05:00:00.000Z');
  });

  it('drugi sken ne upisuje ništa (P-07 idempotentnost)', async () => {
    const { fake, svc } = service();
    fake.addPolicy('INSURANCE');
    fake.insurances.push({
      id: 'ins-1',
      vehicleId: 'veh-1',
      validUntil: new Date('2027-02-01T00:00:00.000Z'),
    });

    const first = await svc.scan(NOW);
    const second = await svc.scan(NOW);

    expect(first.created).toBe(1);
    expect(second.candidates).toBe(1);
    expect(second.created).toBe(0);
    expect(fake.reminders).toHaveLength(1);
  });

  it('`dedupeKey` je jedan po (zapis, vrsta, prag)', () => {
    const base = {
      kind: 'REGISTRATION',
      entityType: 'Vehicle',
      entityId: 'veh-1',
      dueDate: '2026-12-31',
      dueKm: null,
      thresholdDays: 5,
      thresholdKm: null,
    };
    expect(reminderDedupeKey(base)).toBe('REGISTRATION:Vehicle:veh-1:2026-12-31:5');
    expect(reminderDedupeKey({ ...base, thresholdDays: 1 })).not.toBe(reminderDedupeKey(base));
  });

  it('isključena politika ne pravi podsjetnike', async () => {
    const { fake, svc } = service();
    fake.addPolicy('REGISTRATION', { enabled: false });
    fake.registrations.push({
      id: 'reg-1',
      vehicleId: 'veh-1',
      validUntil: new Date('2026-12-31T00:00:00.000Z'),
    });

    const result = await svc.scan(NOW);

    expect(result.candidates).toBe(0);
    expect(fake.reminders).toHaveLength(0);
  });

  it('prazni pragovi koriste default 5 dana', async () => {
    const { fake, svc } = service();
    fake.addPolicy('REGISTRATION', { thresholdsDays: [] });
    fake.registrations.push({
      id: 'reg-1',
      vehicleId: 'veh-1',
      validUntil: new Date('2026-12-31T00:00:00.000Z'),
    });

    await svc.scan(NOW);

    expect(fake.reminders[0]!.thresholdDays).toBe(DEFAULT_THRESHOLD_DAYS);
  });

  it('kilometraža koristi pragove u km i `dueKm`', async () => {
    const { fake, svc } = service();
    fake.addPolicy('SERVICE_KM', { thresholdsDays: [5], thresholdsKm: [1000, 500] });
    fake.vehicles.push({ id: 'veh-1', nextServiceDueDate: null, nextServiceDueKm: 150_000 });

    await svc.scan(NOW);

    expect(fake.reminders).toHaveLength(2);
    expect(fake.reminders.map((row) => row.thresholdKm).sort((a, b) => a! - b!)).toEqual([500, 1000]);
    expect(fake.reminders[0]!.dueKm).toBe(150_000);
    expect(fake.reminders[0]!.fireAt.toISOString()).toBe(NOW.toISOString());
  });

  it('vozačka dozvola ide na `Driver` entitet', async () => {
    const { fake, svc } = service();
    fake.addPolicy('DRIVER_LICENSE', { thresholdsDays: [30] });
    fake.drivers.push({ id: 'drv-1', licenseExpiresAt: new Date('2026-11-30T00:00:00.000Z') });

    await svc.scan(NOW);

    expect(fake.reminders[0]!.entityType).toBe('Driver');
    expect(fake.reminders[0]!.entityId).toBe('drv-1');
    expect(fake.reminders[0]!.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('servisni datum i kilometraža dijele isto vozilo bez duplikata', async () => {
    const { fake, svc } = service();
    fake.addPolicy('SERVICE_DATE');
    fake.addPolicy('SERVICE_KM', { thresholdsKm: [1000] });
    fake.vehicles.push({
      id: 'veh-1',
      nextServiceDueDate: new Date('2026-11-01T00:00:00.000Z'),
      nextServiceDueKm: 150_000,
    });

    const result = await svc.scan(NOW);

    expect(result.created).toBe(2);
    expect(new Set(fake.reminders.map((row) => row.kind)).size).toBe(2);
  });
});

describe('RemindersService — stanja', () => {
  it('potvrda je idempotentna i bilježi aktera', async () => {
    const { fake, svc } = service();
    const row = fake.addReminder();

    const first = await svc.acknowledge(row.id, 'user-1');
    const second = await svc.acknowledge(row.id, 'user-1');

    expect(first.data.status).toBe('ACKNOWLEDGED');
    expect(first.data.acknowledgedAt).not.toBeNull();
    expect(second.data.status).toBe('ACKNOWLEDGED');
    expect(fake.reminders[0]!.acknowledgedById).toBe('user-1');
  });

  it('otkazan podsjetnik se ne potvrđuje', async () => {
    const { fake, svc } = service();
    const row = fake.addReminder({ status: 'CANCELLED' });

    const error = await catchVfm(svc.acknowledge(row.id));

    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('odgađanje pomjera `fireAt` u budućnost i mijenja status', async () => {
    const { fake, svc } = service();
    const row = fake.addReminder({ fireAt: new Date('2026-10-01T05:00:00.000Z') });

    const outcome = await svc.snooze(row.id, { days: 3 });

    expect(outcome.data.status).toBe('SNOOZED');
    expect(new Date(outcome.data.fireAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('potvrđen podsjetnik se ne odgađa', async () => {
    const { fake, svc } = service();
    const row = fake.addReminder({ status: 'ACKNOWLEDGED' });

    const error = await catchVfm(svc.snooze(row.id, { days: 2 }));

    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('nepostojeći podsjetnik je `NOT_FOUND`', async () => {
    const { svc } = service();
    const error = await catchVfm(svc.acknowledge('nema'));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('RemindersService — politike i lista', () => {
  it('izmjena politike normalizuje pragove (unique + sort)', async () => {
    const { fake, svc } = service();
    fake.addPolicy('REGISTRATION', { thresholdsDays: [5] });

    const outcome = await svc.updatePolicy('REGISTRATION', {
      thresholdsDays: [10, 5, 10, 1],
    });

    expect(outcome.data.thresholdsDays).toEqual([1, 5, 10]);
    expect(outcome.before).toBeDefined();
  });

  it('politika koja ne postoji se kreira s default pragom', async () => {
    const { fake, svc } = service();

    const outcome = await svc.updatePolicy('INSURANCE', { enabled: true });

    expect(outcome.data.thresholdsDays).toEqual([DEFAULT_THRESHOLD_DAYS]);
    expect(fake.policies).toHaveLength(1);
  });

  it('lista filtrira po vrsti, statusu i roku', async () => {
    const { fake, svc } = service();
    fake.addReminder({ kind: 'REGISTRATION', status: 'SCHEDULED' });
    fake.addReminder({ kind: 'INSURANCE', status: 'SENT' });

    expect((await svc.list(query())).total).toBe(2);
    expect((await svc.list(query({ kind: 'INSURANCE' }))).total).toBe(1);
    expect((await svc.list(query({ status: 'SENT' }))).total).toBe(1);
    expect((await svc.list(query({ dueWithinDays: 30 }))).total).toBe(
      fake.reminders.filter((row) => row.fireAt.getTime() <= Date.now() + 30 * 86_400_000).length,
    );
  });

  it('OWN lista ograničava podsjetnike na vozila i vozače koje je korisnik kreirao', async () => {
    const { fake, svc } = service();
    fake.vehicles.push(
      { id: 'veh-own', nextServiceDueDate: null, nextServiceDueKm: null, createdById: 'user-own' },
      { id: 'veh-other', nextServiceDueDate: null, nextServiceDueKm: null, createdById: 'user-other' },
    );
    fake.drivers.push(
      { id: 'driver-own', licenseExpiresAt: null, createdById: 'user-own' },
      { id: 'driver-other', licenseExpiresAt: null, createdById: 'user-other' },
    );
    fake.addReminder({ entityType: 'Vehicle', entityId: 'veh-own' });
    fake.addReminder({ entityType: 'Vehicle', entityId: 'veh-other' });
    fake.addReminder({ entityType: 'Driver', entityId: 'driver-own' });
    fake.addReminder({ entityType: 'Driver', entityId: 'driver-other' });

    const scoped = await svc.list(query(), scopeActor('reminder:view', 'OWN'));
    const filtered = await svc.list(query({ entityId: 'veh-other' }), scopeActor('reminder:view', 'OWN'));

    expect(scoped.items.map((item) => item.entityId).sort()).toEqual(['driver-own', 'veh-own']);
    expect(filtered.total).toBe(0);
  });

  it('acknowledge i snooze odbijaju scope koji nije ALL', async () => {
    const { svc } = service();
    const acknowledgeError = await catchVfm(
      svc.acknowledge('reminder-id', scopeActor('reminder:acknowledge', 'OWN')),
    );
    const snoozeError = await catchVfm(
      svc.snooze('reminder-id', { days: 2 }, scopeActor('reminder:snooze', 'OWN')),
    );

    expect(acknowledgeError.code).toBe('SCOPE_DENIED');
    expect(snoozeError.code).toBe('SCOPE_DENIED');
  });

  it('lista politika vraća sve vrste', async () => {
    const { fake, svc } = service();
    fake.addPolicy('REGISTRATION');
    fake.addPolicy('DRIVER_LICENSE');

    const list = await svc.listPolicies();

    expect(list.items).toHaveLength(2);
  });
});
