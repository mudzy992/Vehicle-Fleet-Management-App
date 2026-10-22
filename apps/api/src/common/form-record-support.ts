/**
 * Zajednička podrška za zapise dinamičkih formi (P10–P12).
 *
 * Izdvojeno da registracije i osiguranje ne dupliraju pravila koja inače drže
 * `vehicles.service.ts` i `drivers.service.ts`:
 *
 * - verzija forme se bira eksplicitno (`formSchemaVersionId`) ili kao trenutno
 *   objavljena za subject; **novi** zapis mora koristiti `PUBLISHED` verziju,
 *   postojeći smije ostati na `RETIRED` (P10);
 * - `validateRecord` vraća normalizovane kolone; servis propušta samo one s
 *   whitelist-a entiteta, ostalo je `NORMALIZATION_MISMATCH` (definicija i
 *   tabela su se razišle).
 */
import { toLocalDateString } from '@vfm/shared';
import {
  NORMALIZATION_COLUMNS,
  parseDefinition,
  validateRecord,
  type DefinitionIssue,
  type FormDefinition,
} from '@vfm/form-engine';
import type { ApiErrorDetail } from '@vfm/shared';
import { VfmException } from './errors/vfm-error.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { resolveFormOptionValues } from './form-option-values.js';

export function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message };
}

export interface ResolvedFormVersion {
  readonly id: string;
  readonly formSchemaId: string;
  readonly version: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  readonly definition: FormDefinition;
}

/** Minimalni oblik Prisma delegata koji podrška koristi. */
interface FormPrismaLike {
  formSchemaVersion: {
    findUnique: (args: { where: { id: string }; include?: { formSchema?: boolean } }) => Promise<unknown>;
  };
  formSchema: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy?: unknown;
    }) => Promise<{ currentPublishedVersionId: string | null } | null>;
  };
}

export async function resolveFormVersion(
  prisma: FormPrismaLike,
  args: { subject: string; versionId?: string; entityLabel: string },
): Promise<ResolvedFormVersion> {
  const version = (
    args.versionId
      ? await prisma.formSchemaVersion.findUnique({
          where: { id: args.versionId },
          include: { formSchema: true },
        })
      : await activeVersion(prisma, args.subject)
  ) as {
    id: string;
    formSchemaId: string;
    version: number;
    status: string;
    definition: unknown;
    formSchema?: { subject: string };
  } | null;

  if (!version) {
    throw new VfmException(
      'FORM_VERSION_NOT_PUBLISHED',
      `Nema objavljene \`${args.subject}\` forme — ${args.entityLabel} se ne može kreirati.`,
    );
  }

  if (version.formSchema && version.formSchema.subject !== args.subject) {
    throw new VfmException(
      'FORM_VALIDATION_FAILED',
      `Odabrana verzija forme nije za subject \`${args.subject}\`.`,
      [detail('formSchemaVersionId', version.formSchema.subject)],
    );
  }

  return {
    id: version.id,
    formSchemaId: version.formSchemaId,
    version: version.version,
    status: version.status as 'DRAFT' | 'PUBLISHED' | 'RETIRED',
    definition: parseStoredDefinition(version.definition),
  };
}

async function activeVersion(prisma: FormPrismaLike, subject: string): Promise<unknown> {
  const schema = await prisma.formSchema.findFirst({
    where: { subject, deletedAt: null, currentPublishedVersionId: { not: null } },
    orderBy: { updatedAt: 'desc' },
  });
  if (!schema?.currentPublishedVersionId) return null;
  return prisma.formSchemaVersion.findUnique({
    where: { id: schema.currentPublishedVersionId },
    include: { formSchema: true },
  });
}

export function parseStoredDefinition(definition: unknown): FormDefinition {
  const parsed = parseDefinition(definition);
  if (!parsed.ok) {
    throw new VfmException(
      'FORM_VALIDATION_FAILED',
      'Definicija forme zapisa nije ispravna.',
      (parsed.issues as readonly DefinitionIssue[]).map((issue) => detail(issue.path, issue.message)),
    );
  }
  return parsed.definition;
}

/**
 * P11 validacija + filtriranje kolona na whitelist entiteta.
 *
 * @returns `values` (ono što ide u `formData`) i `normalized` (kolone tabele).
 */
export async function validateRecordValues(args: {
  prisma: PrismaService;
  subject: string;
  definition: FormDefinition;
  versionId: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  values: Record<string, unknown>;
  isNew: boolean;
}): Promise<{ values: Record<string, unknown>; normalized: Record<string, unknown> }> {
  const result = validateRecord({
    version: {
      id: args.versionId,
      version: args.versionNumber,
      status: args.status,
      definition: args.definition,
    },
    values: args.values,
    isNew: args.isNew,
    today: toLocalDateString(new Date()),
    optionValues: await resolveFormOptionValues(args.prisma, args.definition),
  });

  if (result.versionError) {
    throw new VfmException('FORM_VERSION_NOT_PUBLISHED', undefined, undefined, {
      versionError: result.versionError,
    });
  }

  if (!result.ok) {
    throw new VfmException(
      'FORM_VALIDATION_FAILED',
      `Podaci nisu ispravni (${result.errors.length} greška/e).`,
      result.errors.map((error) => detail(`formData.${error.key}`, `${error.code}: ${error.message}`)),
      { errors: result.errors },
    );
  }

  const allowed = NORMALIZATION_COLUMNS[args.subject] ?? [];
  const normalized: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(result.normalized)) {
    if (!allowed.includes(column)) {
      throw new VfmException(
        'NORMALIZATION_MISMATCH',
        `Mapiranje na kolonu "${column}" ne postoji na entitetu ${args.subject}.`,
        [detail(`normalizedName.${column}`, column)],
      );
    }
    normalized[column] = value;
  }

  return { values: result.values as Record<string, unknown>, normalized };
}

/**
 * Dodaje strukturirane (API) vrijednosti u formu — samo ako polje postoji u
 * definiciji. Tako `formData` čuva pun snapshot, a forma i dalje provjerava
 * obavezna polja i dužine.
 */
export function mergeCoreValues(
  definition: FormDefinition,
  values: Record<string, unknown>,
  core: Record<string, unknown>,
): Record<string, unknown> {
  const keys = new Set<string>();
  for (const section of definition.sections ?? []) {
    for (const field of section.fields ?? []) keys.add(field.key);
  }

  const merged: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(core)) {
    if (keys.has(key)) merged[key] = value;
  }
  return merged;
}
