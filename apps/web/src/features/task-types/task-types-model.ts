/** Čista logika ekrana vrsta zadataka; API i dalje ponavlja sve provjere. */
import {
  ATTACHMENT_STAGES,
  TASK_ASSIGN_MODES,
  TASK_PRIORITIES,
  type AttachmentStage,
  type TaskAssignMode,
  type TaskPriority,
} from '@vfm/shared';
import type {
  FormSchemaSummary,
  TaskCompletionRequirementView,
  TaskTypeDetail,
  TaskTypeView,
} from '@vfm/shared/schemas';

export interface TaskTypeFilters {
  readonly q: string;
  readonly activeOnly: boolean;
  readonly requiresVehicle: '' | 'true' | 'false';
  readonly sortBy: string;
  readonly sortOrder: 'asc' | 'desc';
}

export const DEFAULT_TASK_TYPE_FILTERS: TaskTypeFilters = {
  q: '',
  activeOnly: false,
  requiresVehicle: '',
  sortBy: 'sortOrder',
  sortOrder: 'asc',
};

export function buildTaskTypeQuery(
  filters: TaskTypeFilters,
  page: number,
  pageSize: number,
): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page,
    pageSize,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  };
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.activeOnly) query.activeOnly = 'true';
  if (filters.requiresVehicle) query.requiresVehicle = filters.requiresVehicle;
  return query;
}

export function isTaskTypeFiltered(filters: TaskTypeFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.activeOnly ||
    filters.requiresVehicle !== '' ||
    filters.sortBy !== DEFAULT_TASK_TYPE_FILTERS.sortBy ||
    filters.sortOrder !== DEFAULT_TASK_TYPE_FILTERS.sortOrder
  );
}

export interface TaskTypeFormValues {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly iconName: string;
  readonly colorHex: string;
  readonly requiresVehicle: boolean;
  readonly requiresOdometer: boolean;
  readonly requiresPhotos: boolean;
  readonly defaultPriority: string;
  readonly defaultAssignMode: string;
  readonly allowMultipleClaimants: boolean;
  readonly dueOffsetHours: string;
  readonly formSchemaId: string;
  readonly sortOrder: string;
}

export const DEFAULT_TASK_TYPE_FORM_VALUES: TaskTypeFormValues = {
  code: '',
  name: '',
  description: '',
  iconName: '',
  colorHex: '',
  requiresVehicle: true,
  requiresOdometer: false,
  requiresPhotos: false,
  defaultPriority: 'NORMAL',
  defaultAssignMode: 'OPEN_CLAIM',
  allowMultipleClaimants: false,
  dueOffsetHours: '',
  formSchemaId: '',
  sortOrder: '100',
};

export function taskTypeFormValues(detail: TaskTypeView | TaskTypeDetail): TaskTypeFormValues {
  return {
    code: detail.code,
    name: detail.name,
    description: detail.description ?? '',
    iconName: detail.iconName ?? '',
    colorHex: detail.colorHex ?? '',
    requiresVehicle: detail.requiresVehicle,
    requiresOdometer: detail.requiresOdometer,
    requiresPhotos: detail.requiresPhotos,
    defaultPriority: detail.defaultPriority,
    defaultAssignMode: detail.defaultAssignMode,
    allowMultipleClaimants: detail.allowMultipleClaimants,
    dueOffsetHours: detail.dueOffsetHours === null ? '' : String(detail.dueOffsetHours),
    formSchemaId: detail.formSchemaId ?? '',
    sortOrder: String(detail.sortOrder),
  };
}

/**
 * U izboru su samo objavljene TASK forme koje nisu vezane za drugu vrstu.
 * API istu provjeru radi u transakciji, pa zastarjela lista ne može zaobići
 * pravilo.
 */
export function availableTaskForms(
  forms: readonly FormSchemaSummary[],
  taskTypeId?: string,
): readonly FormSchemaSummary[] {
  return forms.filter(
    (form) =>
      form.subject === 'TASK' &&
      form.status === 'PUBLISHED' &&
      form.currentPublishedVersionId !== null &&
      (form.taskTypeId === null || form.taskTypeId === taskTypeId),
  );
}

/**
 * Ista efektivna forma koju API koristi za validaciju zahtjeva: prvo forma
 * eksplicitno zadana na vrsti, zatim objavljena forma vezana za tu vrstu.
 * Generička TASK forma se ne podrazumijeva ako nijedna veza ne postoji.
 */
export function effectiveTaskForm(
  forms: readonly FormSchemaSummary[],
  taskType: Pick<TaskTypeView, 'id' | 'formSchemaId'>,
): FormSchemaSummary | null {
  const published = forms.filter(
    (form) =>
      form.subject === 'TASK' && form.status === 'PUBLISHED' && form.currentPublishedVersionId !== null,
  );
  return (
    published.find((form) => form.id === taskType.formSchemaId) ??
    published.find((form) => form.taskTypeId === taskType.id) ??
    null
  );
}

interface ParsedTaskTypeValues {
  readonly name: string;
  readonly description: string | null;
  readonly iconName: string | null;
  readonly colorHex: string | null;
  readonly requiresVehicle: boolean;
  readonly requiresOdometer: boolean;
  readonly requiresPhotos: boolean;
  readonly defaultPriority: TaskPriority;
  readonly defaultAssignMode: TaskAssignMode;
  readonly allowMultipleClaimants: boolean;
  readonly dueOffsetHours: number | null;
  readonly formSchemaId: string | null;
  readonly sortOrder: number;
}

function optionalText(value: string): string | null {
  return value.trim() || null;
}

function parseDueOffsetHours(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+$/u.test(text)) {
    throw new Error('Rok u satima mora biti cijeli broj od 1 do 8760.');
  }
  const parsed = Number(text);
  if (parsed < 1 || parsed > 8760) {
    throw new Error('Rok u satima mora biti cijeli broj od 1 do 8760.');
  }
  return parsed;
}

function parseSortOrder(value: string): number {
  const text = value.trim();
  if (!/^-?\d+$/u.test(text)) {
    throw new Error('Redoslijed prikaza mora biti cijeli broj od -10000 do 10000.');
  }
  const parsed = Number(text);
  if (parsed < -10000 || parsed > 10000) {
    throw new Error('Redoslijed prikaza mora biti cijeli broj od -10000 do 10000.');
  }
  return parsed;
}

function parseTaskTypeValues(
  values: TaskTypeFormValues,
  formSelectionAvailable: boolean,
  currentFormSchemaId: string | null,
): ParsedTaskTypeValues {
  const name = values.name.trim();
  if (name.length < 2) throw new Error('Naziv vrste zadatka mora imati najmanje 2 znaka.');

  const colorText = values.colorHex.trim();
  if (colorText && !/^#[0-9A-Fa-f]{6}$/u.test(colorText)) {
    throw new Error('Boja mora biti u formatu #RRGGBB.');
  }
  if (!TASK_PRIORITIES.includes(values.defaultPriority as TaskPriority)) {
    throw new Error('Odaberite ispravan zadani prioritet.');
  }
  if (!TASK_ASSIGN_MODES.includes(values.defaultAssignMode as TaskAssignMode)) {
    throw new Error('Odaberite ispravan zadani način dodjele.');
  }
  if (values.requiresOdometer && !values.requiresVehicle) {
    throw new Error('Kilometraža se može zahtijevati samo ako vrsta zahtijeva vozilo.');
  }

  return {
    name,
    description: optionalText(values.description),
    iconName: optionalText(values.iconName),
    colorHex: colorText ? colorText.toUpperCase() : null,
    requiresVehicle: values.requiresVehicle,
    requiresOdometer: values.requiresOdometer,
    requiresPhotos: values.requiresPhotos,
    defaultPriority: values.defaultPriority as TaskPriority,
    defaultAssignMode: values.defaultAssignMode as TaskAssignMode,
    allowMultipleClaimants: values.allowMultipleClaimants,
    dueOffsetHours: parseDueOffsetHours(values.dueOffsetHours),
    formSchemaId: formSelectionAvailable ? optionalText(values.formSchemaId) : currentFormSchemaId,
    sortOrder: parseSortOrder(values.sortOrder),
  };
}

export function buildTaskTypeCreatePayload(
  values: TaskTypeFormValues,
  formSelectionAvailable = true,
): Record<string, unknown> {
  const code = values.code.trim();
  if (!/^[A-Z][A-Z0-9_]*$/u.test(code) || code.length < 2 || code.length > 50) {
    throw new Error('Kod mora imati 2–50 znakova u obliku VELIKA_SLOVA (npr. FUEL_REFILL).');
  }
  return { code, ...parseTaskTypeValues(values, formSelectionAvailable, null) };
}

/** PATCH sadrži samo stvarne izmjene; kod se ne šalje jer je nepromjenjiv. */
export function buildTaskTypeUpdatePayload(
  detail: TaskTypeDetail,
  values: TaskTypeFormValues,
  formSelectionAvailable = true,
): Record<string, unknown> {
  if (values.code.trim() !== detail.code) {
    throw new Error('Kod vrste zadatka se nakon kreiranje ne može mijenjati.');
  }

  const parsed = parseTaskTypeValues(values, formSelectionAvailable, detail.formSchemaId);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (detail[key as keyof ParsedTaskTypeValues] !== value) payload[key] = value;
  }
  if (Object.keys(payload).length === 0) throw new Error('Nema izmjena za snimanje.');
  return payload;
}

export interface TaskCompletionRequirementDraft {
  readonly fieldKey: string;
  readonly required: boolean;
  readonly stage: string;
  readonly minPhotos: string;
}

export function emptyRequirementDraft(): TaskCompletionRequirementDraft {
  return { fieldKey: '', required: true, stage: 'ON_COMPLETE', minPhotos: '0' };
}

export function requirementDrafts(
  requirements: readonly TaskCompletionRequirementView[],
): TaskCompletionRequirementDraft[] {
  return requirements.map((requirement) => ({
    fieldKey: requirement.fieldKey,
    required: requirement.required,
    stage: requirement.stage,
    minPhotos: String(requirement.minPhotos),
  }));
}

export function buildRequirementsPayload(drafts: readonly TaskCompletionRequirementDraft[]): {
  requirements: Array<Record<string, unknown>>;
} {
  const seen = new Set<string>();
  const requirements = drafts.map((draft, index) => {
    const fieldKey = draft.fieldKey.trim();
    if (!/^[a-z][a-zA-Z0-9_]{1,48}$/u.test(fieldKey)) {
      throw new Error(`Zahtjev ${index + 1}: unesite ispravan ključ polja (npr. photosAfter).`);
    }
    if (seen.has(fieldKey)) {
      throw new Error(`Zahtjev za polje "${fieldKey}" se ponavlja.`);
    }
    seen.add(fieldKey);

    if (!ATTACHMENT_STAGES.includes(draft.stage as AttachmentStage)) {
      throw new Error(`Zahtjev ${index + 1}: odaberite ispravnu fazu priloga.`);
    }
    const minPhotosText = draft.minPhotos.trim();
    if (!/^\d+$/u.test(minPhotosText)) {
      throw new Error(`Zahtjev ${index + 1}: minimalan broj fotografija mora biti od 0 do 20.`);
    }
    const minPhotos = Number(minPhotosText);
    if (minPhotos < 0 || minPhotos > 20) {
      throw new Error(`Zahtjev ${index + 1}: minimalan broj fotografija mora biti od 0 do 20.`);
    }
    if (minPhotos > 0 && !draft.required) {
      throw new Error(`Zahtjev ${index + 1}: minimalan broj fotografija traži obavezan zahtjev.`);
    }

    return {
      fieldKey,
      required: draft.required,
      stage: draft.stage,
      minPhotos,
    };
  });

  return { requirements };
}

export function taskTypeArchiveConfirmation(row: Pick<TaskTypeView, 'code' | 'name'>): string {
  return (
    `Arhivirati vrstu zadatka ${row.code} (${row.name})? ` +
    'Vrsta više neće biti dostupna za nove zadatke, a postojeći zadaci i historija ostaju sačuvani.'
  );
}

export function taskTypeArchiveSuccess(row: Pick<TaskTypeView, 'code' | 'name'>): string {
  return `Vrsta zadatka ${row.code} (${row.name}) je arhivirana.`;
}

/** Nakon arhiviranja jedinog reda ne ostaje se na praznoj strani. */
export function pageAfterArchive(itemsOnPage: number, page: number): number {
  return itemsOnPage <= 1 && page > 1 ? page - 1 : page;
}
