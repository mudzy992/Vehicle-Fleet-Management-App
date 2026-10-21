/** Model vrsta zadataka: upit, strogi payloadi, zahtjevi i arhiva. */
import { describe, expect, it } from 'vitest';
import type { FormSchemaSummary, TaskTypeDetail } from '@vfm/shared/schemas';
import {
  DEFAULT_TASK_TYPE_FILTERS,
  DEFAULT_TASK_TYPE_FORM_VALUES,
  availableTaskForms,
  buildRequirementsPayload,
  buildTaskTypeCreatePayload,
  buildTaskTypeQuery,
  buildTaskTypeUpdatePayload,
  effectiveTaskForm,
  isTaskTypeFiltered,
  pageAfterArchive,
  requirementDrafts,
  taskTypeArchiveConfirmation,
  taskTypeArchiveSuccess,
  taskTypeFormValues,
} from './task-types-model.js';

const taskTypeId = '11111111-1111-4111-8111-111111111111';
const genericFormId = '22222222-2222-4222-8222-222222222222';
const ownFormId = '33333333-3333-4333-8333-333333333333';
const otherFormId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';

const detail: TaskTypeDetail = {
  id: taskTypeId,
  code: 'WASH',
  name: 'Pranje vozila',
  description: 'Vanjsko pranje',
  iconName: 'car-wash',
  colorHex: '#2563EB',
  requiresVehicle: true,
  requiresOdometer: true,
  requiresPhotos: true,
  defaultPriority: 'NORMAL',
  defaultAssignMode: 'OPEN_CLAIM',
  allowMultipleClaimants: false,
  dueOffsetHours: 24,
  formSchemaId: genericFormId,
  formSchemaKey: 'pranje_vozila',
  formSchemaName: 'Pranje vozila',
  formSchemaVersion: 3,
  active: true,
  sortOrder: 10,
  completionRequirementCount: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  completionRequirements: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      taskTypeId,
      fieldKey: 'photosAfter',
      required: true,
      stage: 'ON_COMPLETE',
      minPhotos: 2,
    },
  ],
};

function formSummary(patch: Partial<FormSchemaSummary> = {}): FormSchemaSummary {
  return {
    id: genericFormId,
    key: 'pranje_vozila',
    name: 'Pranje vozila',
    subject: 'TASK',
    taskTypeId: null,
    description: null,
    ownerModule: null,
    status: 'PUBLISHED',
    currentPublishedVersionId: versionId,
    currentPublishedVersion: 1,
    versionCount: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...patch,
  };
}

describe('Model vrsta zadataka', () => {
  it('gradi serverski upit samo s aktivnim filterima', () => {
    expect(buildTaskTypeQuery(DEFAULT_TASK_TYPE_FILTERS, 2, 10)).toEqual({
      page: 2,
      pageSize: 10,
      sortBy: 'sortOrder',
      sortOrder: 'asc',
    });
    expect(isTaskTypeFiltered(DEFAULT_TASK_TYPE_FILTERS)).toBe(false);

    const filters = {
      ...DEFAULT_TASK_TYPE_FILTERS,
      q: ' pranje ',
      activeOnly: true,
      requiresVehicle: 'true' as const,
    };
    expect(buildTaskTypeQuery(filters, 1, 25)).toMatchObject({
      q: 'pranje',
      activeOnly: 'true',
      requiresVehicle: 'true',
    });
    expect(isTaskTypeFiltered(filters)).toBe(true);
  });

  it('u izboru ostavlja generičke i vlastite objavljene TASK forme', () => {
    const forms = [
      formSummary(),
      formSummary({ id: ownFormId, key: 'vlastita', taskTypeId }),
      formSummary({ id: otherFormId, key: 'tuđa', taskTypeId: '99999999-9999-4999-8999-999999999999' }),
      formSummary({ id: '77777777-7777-4777-8777-777777777777', key: 'vozilo', subject: 'VEHICLE' }),
      formSummary({ id: '88888888-8888-4888-8888-888888888888', key: 'draft', status: 'DRAFT' }),
    ];

    expect(availableTaskForms(forms, taskTypeId).map((form) => form.key)).toEqual([
      'pranje_vozila',
      'vlastita',
    ]);
    expect(availableTaskForms(forms).map((form) => form.key)).toEqual(['pranje_vozila']);
  });

  it('efektivna forma prati API redoslijed: zadana forma prije vezane, bez generičkog fallbacka', () => {
    const forms = [formSummary(), formSummary({ id: ownFormId, key: 'vlastita', taskTypeId })];

    expect(effectiveTaskForm(forms, detail)?.key).toBe('pranje_vozila');
    expect(effectiveTaskForm(forms, { ...detail, formSchemaId: null })?.key).toBe('vlastita');
    expect(effectiveTaskForm([forms[0]!], { ...detail, formSchemaId: null })).toBeNull();
  });

  it('kreiranje normalizuje kod, boju i brojeve prije slanja', () => {
    const payload = buildTaskTypeCreatePayload({
      ...DEFAULT_TASK_TYPE_FORM_VALUES,
      code: ' DELIVERY ',
      name: ' Dostava dokumentacije ',
      description: ' ',
      colorHex: '#abc123',
      dueOffsetHours: '48',
      sortOrder: '80',
    });

    expect(payload).toMatchObject({
      code: 'DELIVERY',
      name: 'Dostava dokumentacije',
      description: null,
      colorHex: '#ABC123',
      dueOffsetHours: 48,
      sortOrder: 80,
      defaultPriority: 'NORMAL',
      defaultAssignMode: 'OPEN_CLAIM',
    });
  });

  it('kreiranje odbija neispravan kod, boju, rok i kilometražu bez vozila', () => {
    const base = { ...DEFAULT_TASK_TYPE_FORM_VALUES, code: 'TEST', name: 'Test vrsta' };
    expect(() => buildTaskTypeCreatePayload({ ...base, code: 'niska' })).toThrow('Kod mora');
    expect(() => buildTaskTypeCreatePayload({ ...base, colorHex: 'plava' })).toThrow('#RRGGBB');
    expect(() => buildTaskTypeCreatePayload({ ...base, dueOffsetHours: '0' })).toThrow('Rok u satima');
    expect(() =>
      buildTaskTypeCreatePayload({ ...base, requiresVehicle: false, requiresOdometer: true }),
    ).toThrow('Kilometraža se može zahtijevati');
  });

  it('PATCH šalje samo stvarne izmjene i null za obrisana opciona polja', () => {
    const values = taskTypeFormValues(detail);
    expect(values).toMatchObject({ code: 'WASH', dueOffsetHours: '24', sortOrder: '10' });
    expect(() => buildTaskTypeUpdatePayload(detail, values)).toThrow('Nema izmjena');

    const payload = buildTaskTypeUpdatePayload(detail, {
      ...values,
      name: 'Detaljno pranje vozila',
      description: '',
      dueOffsetHours: '',
      formSchemaId: '',
    });
    expect(payload).toEqual({
      name: 'Detaljno pranje vozila',
      description: null,
      dueOffsetHours: null,
      formSchemaId: null,
    });
    expect(payload).not.toHaveProperty('code');
  });

  it('PATCH ne pokušava promijeniti kod i poštuje nedostupnu listu formi', () => {
    const values = taskTypeFormValues(detail);
    expect(() => buildTaskTypeUpdatePayload(detail, { ...values, code: 'OTHER' })).toThrow(
      'ne može mijenjati',
    );

    const payload = buildTaskTypeUpdatePayload(
      detail,
      { ...values, name: 'Novo ime', formSchemaId: '' },
      false,
    );
    expect(payload).toEqual({ name: 'Novo ime' });
  });

  it('zahtjevi se mapiraju u draftove i strogi PUT payload', () => {
    const drafts = requirementDrafts(detail.completionRequirements);
    expect(drafts).toEqual([
      { fieldKey: 'photosAfter', required: true, stage: 'ON_COMPLETE', minPhotos: '2' },
    ]);
    expect(buildRequirementsPayload(drafts)).toEqual({
      requirements: [{ fieldKey: 'photosAfter', required: true, stage: 'ON_COMPLETE', minPhotos: 2 }],
    });
    expect(buildRequirementsPayload([])).toEqual({ requirements: [] });
  });

  it('zahtjevi odbijaju dupli ključ, pogrešnu fazu i fotografije u opcionalnom zahtjevu', () => {
    expect(() =>
      buildRequirementsPayload([
        { fieldKey: 'photosAfter', required: true, stage: 'ON_COMPLETE', minPhotos: '1' },
        { fieldKey: 'photosAfter', required: true, stage: 'ON_COMPLETE', minPhotos: '2' },
      ]),
    ).toThrow('ponavlja');
    expect(() =>
      buildRequirementsPayload([
        { fieldKey: 'photosAfter', required: true, stage: 'KASNIJE', minPhotos: '1' },
      ]),
    ).toThrow('fazu priloga');
    expect(() =>
      buildRequirementsPayload([
        { fieldKey: 'photosAfter', required: false, stage: 'ON_COMPLETE', minPhotos: '1' },
      ]),
    ).toThrow('obavezan zahtjev');
  });

  it('arhiva ima jasan tekst i ne ostavlja praznu stranu', () => {
    expect(taskTypeArchiveConfirmation(detail)).toContain('postojeći zadaci i historija ostaju');
    expect(taskTypeArchiveSuccess(detail)).toContain('WASH');
    expect(pageAfterArchive(1, 3)).toBe(2);
    expect(pageAfterArchive(3, 3)).toBe(3);
    expect(pageAfterArchive(0, 1)).toBe(1);
  });
});
