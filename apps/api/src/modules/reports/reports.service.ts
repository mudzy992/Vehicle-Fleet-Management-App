import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Permission } from '@vfm/shared';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type ReportQuery = { from?: string; to?: string; vehicleId?: string };
type ReportDefinition = {
  code: string;
  title: string;
  description: string;
  category: string;
  costRestricted?: boolean;
};
const DEFINITIONS: ReportDefinition[] = [
  {
    code: 'fleet-overview',
    title: 'Pregled voznog parka',
    description: 'Status, kilometraža i ključni rokovi vozila.',
    category: 'Vozila',
  },
  {
    code: 'deadlines',
    title: 'Rokovi i registracije',
    description: 'Registracija, osiguranje i naredni servisni rokovi.',
    category: 'Vozila',
  },
  {
    code: 'task-summary',
    title: 'Učinak zadataka',
    description: 'Broj zadataka i prosječno trajanje po statusu.',
    category: 'Zadaci',
  },
  {
    code: 'fuel-consumption',
    title: 'Potrošnja goriva',
    description: 'Evidentirane količine i prosječna potrošnja.',
    category: 'Troškovi',
  },
  {
    code: 'tire-usage',
    title: 'Korištenje guma',
    description: 'Montaže, kilometraža i trajanje korištenja setova.',
    category: 'Vozila',
  },
  {
    code: 'vehicle-costs',
    title: 'Troškovi vozila',
    description: 'Trošak po vozilu iz završenih zadataka.',
    category: 'Troškovi',
    costRestricted: true,
  },
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  catalog(actor?: AuthenticatedUser) {
    const canViewCosts = this.canViewCosts(actor);
    return {
      items: DEFINITIONS.filter((item) => !item.costRestricted || canViewCosts).map(
        ({ costRestricted: _restricted, ...item }) => item,
      ),
    };
  }

  async vehicles(actor?: AuthenticatedUser) {
    const allowedIds = this.reportVehicleIds(actor);
    const items = await this.prisma.vehicle.findMany({
      where: { deletedAt: null, ...(allowedIds ? { id: { in: allowedIds } } : {}) },
      orderBy: { internalNo: 'asc' },
      select: { id: true, internalNo: true, make: true, model: true },
    });
    return {
      items: items.map((item) => ({ id: item.id, label: `${item.internalNo} · ${item.make} ${item.model}` })),
    };
  }

  async run(code: string, query: ReportQuery, actor?: AuthenticatedUser) {
    const definition = DEFINITIONS.find((item) => item.code === code);
    if (!definition) throw new NotFoundException('Izvještaj nije pronađen.');
    if (definition.costRestricted && !this.canViewCosts(actor))
      throw new ForbiddenException('Nemate pravo pregleda troškova.');
    const allowedVehicleIds = this.reportVehicleIds(actor);
    const selectedVehicleIds = query.vehicleId
      ? allowedVehicleIds === null || allowedVehicleIds.includes(query.vehicleId)
        ? [query.vehicleId]
        : []
      : allowedVehicleIds;
    const whereVehicle = selectedVehicleIds === null ? {} : { vehicleId: { in: selectedVehicleIds } };
    const vehicleWhere = selectedVehicleIds === null ? {} : { id: { in: selectedVehicleIds } };
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
    const dateRange = from || to ? { gte: from, lte: to } : undefined;

    if (code === 'fleet-overview') {
      const items = await this.prisma.vehicle.findMany({
        where: { deletedAt: null, ...vehicleWhere },
        orderBy: { internalNo: 'asc' },
        select: {
          internalNo: true,
          make: true,
          model: true,
          status: true,
          odometerKm: true,
          registrationExpiresAt: true,
          insuranceExpiresAt: true,
          nextServiceDueDate: true,
          nextServiceDueKm: true,
        },
      });
      return {
        code,
        title: definition.title,
        columns: [
          'Broj vozila',
          'Vozilo',
          'Status',
          'Kilometraža (km)',
          'Registracija do',
          'Osiguranje do',
          'Servis do',
        ],
        rows: items.map((v) => [
          v.internalNo,
          `${v.make} ${v.model}`,
          v.status,
          v.odometerKm,
          v.registrationExpiresAt,
          v.insuranceExpiresAt,
          v.nextServiceDueDate ?? (v.nextServiceDueKm ? `${v.nextServiceDueKm} km` : null),
        ]),
      };
    }
    if (code === 'deadlines') {
      const items = await this.prisma.vehicle.findMany({
        where: { deletedAt: null, ...vehicleWhere },
        orderBy: { internalNo: 'asc' },
        select: {
          internalNo: true,
          make: true,
          model: true,
          registrationExpiresAt: true,
          insuranceExpiresAt: true,
          nextServiceDueDate: true,
          nextServiceDueKm: true,
          odometerKm: true,
        },
      });
      const rows = items.flatMap((v) =>
        [
          ['Registracija', v.registrationExpiresAt, v.internalNo, `${v.make} ${v.model}`, null],
          ['Osiguranje', v.insuranceExpiresAt, v.internalNo, `${v.make} ${v.model}`, null],
          [
            'Servis',
            v.nextServiceDueDate,
            v.internalNo,
            `${v.make} ${v.model}`,
            v.nextServiceDueKm ? `${v.nextServiceDueKm} km` : null,
          ],
        ].filter((row) => {
          const dueDate = row[1] as Date | null;
          return dueDate !== null && (!from || dueDate >= from) && (!to || dueDate <= to);
        }),
      );
      return {
        code,
        title: definition.title,
        columns: ['Vrsta roka', 'Datum', 'Broj vozila', 'Vozilo', 'Kilometarski rok'],
        rows,
      };
    }
    if (code === 'task-summary') {
      const groups = await this.prisma.task.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...whereVehicle, ...(dateRange ? { createdAt: dateRange } : {}) },
        _count: { _all: true },
        _avg: { durationMinutes: true },
        orderBy: { status: 'asc' },
      });
      return {
        code,
        title: definition.title,
        columns: ['Status', 'Broj zadataka', 'Prosječno trajanje (min)'],
        rows: groups.map((g) => [
          g.status,
          g._count._all,
          g._avg.durationMinutes == null ? null : Math.round(g._avg.durationMinutes),
        ]),
      };
    }
    if (code === 'fuel-consumption') {
      const items = await this.prisma.task.findMany({
        where: {
          deletedAt: null,
          fuelLiters: { not: null },
          ...whereVehicle,
          ...(dateRange ? { completedAt: dateRange } : {}),
        },
        orderBy: { completedAt: 'desc' },
        take: 1000,
        select: {
          code: true,
          title: true,
          completedAt: true,
          fuelLiters: true,
          fuelConsumptionL100: true,
          vehicle: { select: { internalNo: true } },
        },
      });
      return {
        code,
        title: definition.title,
        columns: ['Zadatak', 'Datum', 'Broj vozila', 'Litara', 'L/100 km'],
        rows: items.map((t) => [
          t.code,
          t.completedAt,
          t.vehicle?.internalNo ?? null,
          t.fuelLiters?.toString() ?? null,
          t.fuelConsumptionL100?.toString() ?? null,
        ]),
      };
    }
    if (code === 'tire-usage') {
      const items = await this.prisma.tireInstallation.findMany({
        where: { deletedAt: null, ...whereVehicle, ...(dateRange ? { mountedAt: dateRange } : {}) },
        orderBy: { mountedAt: 'desc' },
        take: 1000,
        select: {
          mountedAt: true,
          dismountedAt: true,
          mountedOdometerKm: true,
          dismountedOdometerKm: true,
          daysInUse: true,
          kmDriven: true,
          vehicle: { select: { internalNo: true } },
          set: { select: { code: true, brand: true, model: true, season: true, size: true } },
        },
      });
      return {
        code,
        title: definition.title,
        columns: [
          'Set guma',
          'Vozilo',
          'Sezona',
          'Dimenzija',
          'Montirano',
          'Demontirano',
          'Dana u upotrebi',
          'Pređeno km',
        ],
        rows: items.map((t) => [
          `${t.set.code} ${t.set.brand ?? ''} ${t.set.model ?? ''}`.trim(),
          t.vehicle.internalNo,
          t.set.season,
          t.set.size,
          t.mountedAt,
          t.dismountedAt,
          t.daysInUse,
          t.kmDriven ??
            (t.dismountedOdometerKm == null ? null : t.dismountedOdometerKm - t.mountedOdometerKm),
        ]),
      };
    }
    if (code === 'vehicle-costs') {
      const items = await this.prisma.task.findMany({
        where: {
          deletedAt: null,
          status: 'COMPLETED',
          totalCost: { not: null },
          ...whereVehicle,
          ...(dateRange ? { completedAt: dateRange } : {}),
        },
        orderBy: { completedAt: 'desc' },
        take: 1000,
        select: {
          code: true,
          title: true,
          completedAt: true,
          totalCost: true,
          vehicle: { select: { internalNo: true } },
        },
      });
      return {
        code,
        title: definition.title,
        columns: ['Zadatak', 'Datum', 'Broj vozila', 'Trošak (KM)'],
        rows: items.map((t) => [t.code, t.completedAt, t.vehicle?.internalNo ?? null, t.totalCost]),
      };
    }
    throw new NotFoundException('Izvještaj nije pronađen.');
  }

  private reportVehicleIds(actor?: AuthenticatedUser): string[] | null {
    const scope = actor?.permissions?.permissions.get('report:view');
    if (actor?.isSuperAdmin || scope === 'ALL') return null;
    if (scope === 'VEHICLE_IDS') {
      return (
        actor?.permissions?.grants
          .filter((grant) => grant.permission === 'report:view' && grant.scope === 'VEHICLE_IDS')
          .flatMap((grant) => grant.scopeVehicleIds ?? []) ?? []
      );
    }
    // OWN/DRIVER_IDS report scopes do not imply access to arbitrary fleet rows.
    return [];
  }

  private canViewCosts(actor?: AuthenticatedUser): boolean {
    return Boolean(
      actor?.isSuperAdmin || actor?.permissions?.permissions.has('report:view_costs' as Permission),
    );
  }
}
