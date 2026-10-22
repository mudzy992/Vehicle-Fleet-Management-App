/**
 * Resolve current dynamic option/reference values before server-side form validation.
 * All query ids are closed and map to fixed Prisma reads; definitions never supply SQL.
 */
import { inputFields, type FormDefinition } from '@vfm/form-engine';
import type { PrismaService } from '../prisma/prisma.service.js';

interface OptionRow {
  readonly id: string;
}
interface ListOptionRow {
  readonly code: string | null;
  readonly label: string;
}
interface OptionPrisma {
  readonly vehicle: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly driver: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly taskType: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly task: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly registrationRecord: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly insuranceRecord: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly serviceRecord: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly tireSet: {
    findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<OptionRow[]>;
  };
  readonly tireInstallation: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true } | { setId: true };
    }): Promise<Array<OptionRow | { setId: string }>>;
  };
  readonly list: {
    findUnique(args: {
      where: { code: string };
      select: { items: { where: Record<string, unknown>; select: { code: true; label: true } } };
    }): Promise<{ items: ListOptionRow[] } | null>;
  };
}

const RECORD_MODEL_BY_SUBJECT: Readonly<
  Record<
    string,
    | keyof Pick<
        OptionPrisma,
        | 'vehicle'
        | 'driver'
        | 'task'
        | 'registrationRecord'
        | 'insuranceRecord'
        | 'serviceRecord'
        | 'tireSet'
        | 'tireInstallation'
      >
    | null
  >
> = {
  VEHICLE: 'vehicle',
  DRIVER: 'driver',
  REGISTRATION: 'registrationRecord',
  INSURANCE: 'insuranceRecord',
  SERVICE: 'serviceRecord',
  TIRE_SET: 'tireSet',
  TIRE_INSTALLATION: 'tireInstallation',
  TASK: 'task',
  VEHICLE_HANDOVER: null,
  OTHER: null,
};

async function listValues(prisma: OptionPrisma, listCode: string): Promise<Set<string>> {
  const list = await prisma.list.findUnique({
    where: { code: listCode },
    select: { items: { where: { active: true, deletedAt: null }, select: { code: true, label: true } } },
  });
  return new Set((list?.items ?? []).map((item) => item.code ?? item.label));
}

/**
 * Returns the current selectable IDs/values keyed by form field. The result is
 * passed to `validateRecord`; missing/unimplemented sources resolve to an empty
 * set, so writes fail closed rather than trusting client-side options.
 */
export async function resolveFormOptionValues(
  prismaService: PrismaService,
  definition: FormDefinition,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const prisma = prismaService as unknown as OptionPrisma;
  const result = new Map<string, ReadonlySet<string>>();

  for (const { field } of inputFields(definition)) {
    const validation = field.validation ?? {};

    if (field.type === 'REFERENCE_VEHICLE') {
      const status = typeof validation['filterStatus'] === 'string' ? validation['filterStatus'] : 'ACTIVE';
      const rows = await prisma.vehicle.findMany({
        where: { deletedAt: null, status },
        select: { id: true },
      });
      result.set(field.key, new Set(rows.map((row) => row.id)));
      continue;
    }

    if (field.type === 'REFERENCE_DRIVER') {
      const where: Record<string, unknown> = { deletedAt: null };
      if (validation['filterActive'] !== false) where['status'] = 'ACTIVE';
      const rows = await prisma.driver.findMany({ where, select: { id: true } });
      result.set(field.key, new Set(rows.map((row) => row.id)));
      continue;
    }

    if (field.type === 'REFERENCE_RECORD') {
      const subject = typeof validation['entityType'] === 'string' ? validation['entityType'] : '';
      const model = RECORD_MODEL_BY_SUBJECT[subject];
      const rows = model
        ? await prisma[model].findMany({ where: { deletedAt: null }, select: { id: true } })
        : [];
      result.set(field.key, new Set(rows.flatMap((row) => ('id' in row ? [row.id] : []))));
      continue;
    }

    const source = field.optionsSource;
    if (!source || source.kind === 'STATIC') continue;

    if (source.kind === 'LIST') {
      result.set(field.key, await listValues(prisma, source.listCode));
      continue;
    }

    switch (source.queryId) {
      case 'ACTIVE_VEHICLES': {
        const rows = await prisma.vehicle.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        result.set(field.key, new Set(rows.map((row) => row.id)));
        break;
      }
      case 'ACTIVE_DRIVERS': {
        const rows = await prisma.driver.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        result.set(field.key, new Set(rows.map((row) => row.id)));
        break;
      }
      case 'OPEN_TASK_TYPES': {
        const rows = await prisma.taskType.findMany({
          where: { active: true, deletedAt: null },
          select: { id: true },
        });
        result.set(field.key, new Set(rows.map((row) => row.id)));
        break;
      }
      case 'WORKSHOPS':
        result.set(field.key, await listValues(prisma, 'WORKSHOP'));
        break;
      case 'TIRE_SETS_BY_VEHICLE': {
        const vehicleId = source.params?.['vehicleId'];
        if (typeof vehicleId !== 'string') {
          result.set(field.key, new Set());
          break;
        }
        const installations = await prisma.tireInstallation.findMany({
          where: { vehicleId, dismountedAt: null, deletedAt: null },
          select: { setId: true },
        });
        const setIds = installations.flatMap((row) => ('setId' in row ? [row.setId] : []));
        const sets = setIds.length
          ? await prisma.tireSet.findMany({
              where: { id: { in: setIds }, deletedAt: null },
              select: { id: true },
            })
          : [];
        result.set(field.key, new Set(sets.map((row) => row.id)));
        break;
      }
      default:
        result.set(field.key, new Set());
    }
  }

  return result;
}
