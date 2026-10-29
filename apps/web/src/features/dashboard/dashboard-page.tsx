/**
 * Nadzorna tabla (W03/W02 u inventaru: „Nadzorna ploča", docs/06 §9.1).
 *
 * Brojevi se **ne** računaju u browseru iz cijele liste: svaki upit traži
 * `pageSize=1` i koristi `total` koji vraća server (isti filteri kao ekrani),
 * pa tabla ne zavisi od toga koliko je zapisa učitano. Jedini izuzetak su
 * „rokovi" widgeti — oni traže samo zapise unutar 30 dana (`expiringInDays`),
 * pa je i njihov skup mali.
 *
 * Sve stavke su uslovljene permisijom: bez `vehicle:view` nema ni kartice ni
 * upita (server bi vratio 403, a prazna kartica bi izgledala kao kvar).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toLocalDateString } from '@vfm/shared';
import type {
  DriverListResponse,
  InsuranceListResponse,
  RegistrationListResponse,
  ReminderListResponse,
  VehicleListResponse,
} from '@vfm/shared/schemas';
import { Badge, Card, CardContent, CardHeader, EmptyState, Stat } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { deadlineLabel, deadlineLevel, deadlineTone } from '../../lib/deadlines.js';
import { useSession } from '../auth/session.js';
import { collectLicenseDeadlines } from '../drivers/drivers-model.js';
import { collectDeadlines, toQueryString } from '../vehicles/vehicles-model.js';

const WINDOW_DAYS = 30;

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' });
}

export function DashboardPage() {
  const { hasPermission } = useSession();
  const today = toLocalDateString(new Date());

  const canVehicles = hasPermission('vehicle:view');
  const canDrivers = hasPermission('driver:view');
  const canRegistrations = hasPermission('registration:view');
  const canInsurances = hasPermission('insurance:view');
  const canReminders = hasPermission('reminder:view');

  const vehicles = useQuery({
    queryKey: ['dashboard', 'vehicles'],
    queryFn: () => api.get<VehicleListResponse>(`/vehicles?${toQueryString({ page: 1, pageSize: 1 })}`),
    enabled: canVehicles,
  });

  const expiringRegistrations = useQuery({
    queryKey: ['dashboard', 'registrations-expiring'],
    queryFn: () =>
      api.get<RegistrationListResponse>(
        `/registrations?${toQueryString({ page: 1, pageSize: 1, expiringInDays: WINDOW_DAYS })}`,
      ),
    enabled: canRegistrations,
  });

  const expiringInsurances = useQuery({
    queryKey: ['dashboard', 'insurances-expiring'],
    queryFn: () =>
      api.get<InsuranceListResponse>(
        `/insurances?${toQueryString({ page: 1, pageSize: 1, expiringInDays: WINDOW_DAYS })}`,
      ),
    enabled: canInsurances,
  });

  const drivers = useQuery({
    queryKey: ['dashboard', 'drivers'],
    queryFn: () => api.get<DriverListResponse>(`/drivers?${toQueryString({ page: 1, pageSize: 1 })}`),
    enabled: canDrivers,
  });

  const expiringLicenses = useQuery({
    queryKey: ['dashboard', 'licenses-expiring'],
    queryFn: () =>
      api.get<DriverListResponse>(
        `/drivers?${toQueryString({ page: 1, pageSize: 1, expiringInDays: WINDOW_DAYS })}`,
      ),
    enabled: canDrivers,
  });

  const reminders = useQuery({
    queryKey: ['dashboard', 'reminders'],
    queryFn: () =>
      api.get<ReminderListResponse>(
        `/reminders?${toQueryString({ page: 1, pageSize: 5, status: 'SCHEDULED', dueWithinDays: WINDOW_DAYS })}`,
      ),
    enabled: canReminders,
  });

  // Widgeti traže zapise unutar prozora, pa je skup mali i tačan.
  const vehicleDeadlines = useQuery({
    queryKey: ['dashboard', 'vehicle-deadlines'],
    queryFn: () =>
      api.get<VehicleListResponse>(
        `/vehicles?${toQueryString({ page: 1, pageSize: 50, expiringInDays: WINDOW_DAYS })}`,
      ),
    enabled: canVehicles,
  });

  const licenseDeadlines = useQuery({
    queryKey: ['dashboard', 'license-deadlines'],
    queryFn: () =>
      api.get<DriverListResponse>(
        `/drivers?${toQueryString({ page: 1, pageSize: 50, expiringInDays: WINDOW_DAYS })}`,
      ),
    enabled: canDrivers,
  });

  const deadlines = useMemo(
    () => collectDeadlines(vehicleDeadlines.data?.items ?? [], { todayIso: today, limit: 8 }),
    [vehicleDeadlines.data, today],
  );

  const licenseEntries = useMemo(
    () => collectLicenseDeadlines(licenseDeadlines.data?.items ?? [], { todayIso: today, limit: 8 }),
    [licenseDeadlines.data, today],
  );

  const error = ([
    vehicles,
    drivers,
    expiringRegistrations,
    expiringInsurances,
    expiringLicenses,
    reminders,
    vehicleDeadlines,
    licenseDeadlines,
  ].find((query) => query.error)?.error ?? null) as ApiError | null;

  return (
    <div className="vfm-dashboard space-y-6">
      <div className="vfm-page-intro">
        <p className="vfm-eyebrow">PREGLED VOZNOG PARKA</p>
        <h1 className="text-2xl font-semibold tracking-tight">Nadzorna tabla</h1>
        <p className="text-sm text-[var(--fg-muted)]">
          Ključni brojevi i rokovi u narednih {WINDOW_DAYS} dana ({formatDate(today)}).
        </p>
      </div>

      {error && (
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--danger)]">
              {error instanceof ApiError ? error.message : 'Greška pri učitavanju nadzorne table.'}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canVehicles && (
          <Stat
            label="Vozila u pogonu"
            value={vehicles.data?.total ?? '—'}
            hint="Aktivna i u servisu (bez arhive i otpisanih)"
          />
        )}
        {canDrivers && <Stat label="Vozači" value={drivers.data?.total ?? '—'} hint="Aktivni i neaktivni" />}
        {canRegistrations && (
          <Stat
            label="Registracije ističu"
            value={expiringRegistrations.data?.total ?? '—'}
            hint={`u narednih ${WINDOW_DAYS} dana`}
            level={(expiringRegistrations.data?.total ?? 0) > 0 ? 'warning' : 'success'}
          />
        )}
        {canInsurances && (
          <Stat
            label="Osiguranja ističu"
            value={expiringInsurances.data?.total ?? '—'}
            hint={`u narednih ${WINDOW_DAYS} dana`}
            level={(expiringInsurances.data?.total ?? 0) > 0 ? 'warning' : 'success'}
          />
        )}
        {canDrivers && (
          <Stat
            label="Dozvole ističu"
            value={expiringLicenses.data?.total ?? '—'}
            hint={`u narednih ${WINDOW_DAYS} dana`}
            level={(expiringLicenses.data?.total ?? 0) > 0 ? 'warning' : 'success'}
          />
        )}
        {canReminders && (
          <Stat
            label="Podsjetnici čekaju"
            value={reminders.data?.total ?? '—'}
            hint="Status SCHEDULED"
            level={(reminders.data?.total ?? 0) > 0 ? 'danger' : 'success'}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canVehicles && (
          <Card>
            <CardHeader
              title="Rokovi vozila"
              description={`Registracija i osiguranje u narednih ${WINDOW_DAYS} dana.`}
            />
            <CardContent>
              {vehicleDeadlines.isPending ? (
                <p className="text-sm text-[var(--fg-muted)]" role="status">
                  Učitavanje rokova…
                </p>
              ) : vehicleDeadlines.error ? (
                <p className="text-sm text-[var(--danger)]" role="alert">
                  Rokovi vozila nisu dostupni.
                </p>
              ) : deadlines.length === 0 ? (
                <EmptyState title="Nema rokova" description="Ništa ne ističe u narednih 30 dana." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {deadlines.map((entry) => (
                    <li
                      key={`${entry.vehicleId}-${entry.label}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <Link className="hover:underline" to={`/vozila/${entry.vehicleId}`}>
                        {entry.internalNo} · {entry.label}
                      </Link>
                      <Badge level={deadlineLevel(entry.tone)} title={entry.date}>
                        {deadlineLabel(entry.date, today)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {canDrivers && (
          <Card>
            <CardHeader
              title="Dozvole vozača"
              description={`Vozačke dozvole koje ističu u narednih ${WINDOW_DAYS} dana.`}
            />
            <CardContent>
              {licenseDeadlines.isPending ? (
                <p className="text-sm text-[var(--fg-muted)]" role="status">
                  Učitavanje rokova…
                </p>
              ) : licenseDeadlines.error ? (
                <p className="text-sm text-[var(--danger)]" role="alert">
                  Rokovi dozvola nisu dostupni.
                </p>
              ) : licenseEntries.length === 0 ? (
                <EmptyState title="Nema rokova" description="Nijedna dozvola ne ističe u 30 dana." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {licenseEntries.map((entry) => (
                    <li key={entry.driverId} className="flex items-center justify-between gap-2">
                      <Link className="hover:underline" to={`/vozaci/${entry.driverId}`}>
                        {entry.name}
                      </Link>
                      <Badge level={deadlineLevel(entry.tone)} title={entry.date}>
                        {deadlineLabel(entry.date, today)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {canReminders && (
        <Card>
          <CardHeader
            title="Podsjetnici"
            description="Najbliži zakazani podsjetnici (dedupeKey čuva idempotentnost)."
          />
          <CardContent>
            {reminders.isPending ? (
              <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
            ) : !reminders.data?.items.length ? (
              <EmptyState
                title="Nema zakazanih podsjetnika"
                description="Skener radi u 06:00 (Europe/Sarajevo); ručno pokretanje je `POST /reminders/scan`."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {reminders.data.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span>
                      {item.kind}
                      <span className="ml-2 text-xs text-[var(--fg-muted)]">{item.entityType}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-[var(--fg-muted)]">
                        {formatDate(item.dueDate ?? item.fireAt.slice(0, 10))}
                      </span>
                      <Badge level={deadlineLevel(deadlineTone(item.dueDate, today))}>
                        {deadlineLabel(item.dueDate, today)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
