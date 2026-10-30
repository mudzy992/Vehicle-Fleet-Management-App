/**
 * Form Builder (W17, docs/06 §5.5) — čista logika ekrana, bez React-a.
 *
 * Zašto odvojeno: pravila „šta se smije" (koja akcija nad kojim stanjem verzije)
 * i prikaz statusa moraju biti testirani bez rendera, a server ih ionako provjera
 * ponovo — UI samo ne nudi nemoguće akcije.
 */
import type { FormSchemaStatus, FormSubject } from '@vfm/shared';
import type { FormSchemaDetail, FormVersionDetail, FormVersionDiff, FormVersionSummary } from '@vfm/shared/schemas';

export const FORM_STATUS_LABELS: Readonly<Record<FormSchemaStatus, string>> = {
  DRAFT: 'Nacrt',
  PUBLISHED: 'Objavljena',
  RETIRED: 'Povučena',
};

export const SUBJECT_LABELS: Readonly<Record<FormSubject, string>> = {
  VEHICLE: 'Vozilo',
  DRIVER: 'Vozač',
  REGISTRATION: 'Registracija',
  INSURANCE: 'Osiguranje',
  SERVICE: 'Servis',
  TIRE_SET: 'Komplet guma',
  TIRE_INSTALLATION: 'Montaža guma',
  TASK: 'Zadatak',
  VEHICLE_HANDOVER: 'Predaja vozila',
  OTHER: 'Ostalo',
};

/** Skraćeni `contentHash` za tabelu (pun hash je 64 znaka). */
export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 8) : '—';
}

export type FormAction = 'edit' | 'publish' | 'retire' | 'delete' | 'newVersion';

export interface FormPermissions {
  readonly canUpdate: boolean;
  readonly canManageSchema: boolean;
  readonly canPublish: boolean;
  readonly canRetire: boolean;
}

export interface ActionContext {
  readonly version: Pick<FormVersionSummary, 'id' | 'status'> | null;
  readonly currentPublishedVersionId: string | null;
  readonly permissions: FormPermissions;
}

/**
 * Koje akcije UI smije ponuditi za odabranu verziju.
 *
 * Pravila (docs/04 §8):
 * - `DRAFT` se uređuje, objavljuje i briše; `newVersion` je uvijek dostupan;
 * - `PUBLISHED` se ne mijenja; povlači se samo ako **nije** aktivna (aktivna se
 *   povlači tek kad druga verzija postane aktivna — inače server vraća 422);
 * - `RETIRED` je historija: samo pregled i kopiranje u novu verziju.
 */
export function availableActions(context: ActionContext): FormAction[] {
  const { version, currentPublishedVersionId, permissions } = context;
  if (!version) return [];

  const actions: FormAction[] = [];

  if (version.status === 'DRAFT') {
    if (permissions.canManageSchema) actions.push('edit');
    if (permissions.canPublish) actions.push('publish');
    if (permissions.canManageSchema) actions.push('delete');
    if (permissions.canUpdate) actions.push('newVersion');
    return actions;
  }

  if (version.status === 'PUBLISHED') {
    if (permissions.canRetire && version.id !== currentPublishedVersionId) actions.push('retire');
    if (permissions.canUpdate) actions.push('newVersion');
    return actions;
  }

  if (permissions.canUpdate) actions.push('newVersion');
  return actions;
}

/** Verzija koja se nudi za uređivanje: aktivni nacrt, inače najnovija. */
export function suggestedVersionId(
  versions: readonly FormVersionSummary[],
  currentPublishedVersionId: string | null,
): string | null {
  const draft = versions
    .filter((version) => version.status === 'DRAFT')
    .sort((a, b) => b.version - a.version)[0];
  if (draft) return draft.id;
  if (currentPublishedVersionId) return currentPublishedVersionId;
  return versions[0]?.id ?? null;
}

export function versionSummaryFromDetail(detail: FormVersionDetail): FormVersionSummary {
  return {
    id: detail.id,
    version: detail.version,
    status: detail.status,
    changeNote: detail.changeNote,
    contentHash: detail.contentHash,
    mobileCompatible: detail.mobileCompatible,
    publishedAt: detail.publishedAt,
    publishedById: detail.publishedById,
    retiredAt: detail.retiredAt,
    createdAt: detail.createdAt,
    recordCount: detail.recordCount,
  };
}

export function appendVersionToDetail(
  current: FormSchemaDetail,
  created: FormVersionDetail,
): FormSchemaDetail {
  if (current.versions.some((version) => version.id === created.id)) return current;
  return {
    ...current,
    versionCount: current.versionCount + 1,
    versions: [versionSummaryFromDetail(created), ...current.versions],
  };
}

export interface DefinitionIssueView {
  readonly path: string;
  readonly message: string;
}

export type DefinitionParseResult =
  | { readonly ok: true; readonly definition: Record<string, unknown>; readonly issues: readonly [] }
  | { readonly ok: false; readonly definition: null; readonly issues: readonly DefinitionIssueView[] };

/**
 * Parsira JSON iz editora kroz istu meta-shemu koju koristi server.
 *
 * `parseDefinition` je uvezen u ekran (ne u ovaj modul) da bi model ostao bez
 * zavisnosti; ovdje je samo normalizacija rezultata.
 */
export function toParseResult(
  result:
    | { readonly ok: true; readonly definition: unknown }
    | { readonly ok: false; readonly issues: readonly { path: string; message: string }[] },
): DefinitionParseResult {
  if (result.ok) {
    return { ok: true, definition: result.definition as Record<string, unknown>, issues: [] };
  }
  return { ok: false, definition: null, issues: result.issues.map((issue) => ({ ...issue })) };
}

/** Čitljive linije diffa za panel „Uporedi s prethodnom". */
export function buildDiffLines(diff: FormVersionDiff): string[] {
  const lines: string[] = [];
  for (const key of diff.addedFields) lines.push(`+ polje ${key}`);
  for (const key of diff.removedFields) lines.push(`− polje ${key}`);
  for (const field of diff.changedFields) {
    for (const change of field.changes) {
      lines.push(`~ ${field.key}.${change.path}: ${render(change.before)} → ${render(change.after)}`);
    }
  }
  for (const change of diff.meta) {
    lines.push(`~ ${change.path}: ${render(change.before)} → ${render(change.after)}`);
  }
  if (diff.normalizationChanged) lines.push('~ mapiranje na normalizovane kolone');
  for (const key of diff.addedSections) lines.push(`+ sekcija ${key}`);
  for (const key of diff.removedSections) lines.push(`− sekcija ${key}`);
  return lines;
}

function render(value: unknown): string {
  if (value === undefined) return '∅';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Datum i vrijeme u `Europe/Sarajevo`, `dd.MM.yyyy HH:mm` (docs/01 §5).
 *
 * Slaže se iz dijelova jer `bs-BA` umeće razmake („01. 07. 2026. u 14:00"), a
 * format u aplikaciji je fiksan i bez „u".
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sarajevo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('day')}.${value('month')}.${value('year')}. ${value('hour')}:${value('minute')}`;
}
