import type { FormSubject, TaskFormRole, TaskTypeCode } from '@vfm/shared';
import type { SeedForm } from './seed-forms.js';

function photo(key: string, label: string, required = false, order = 1): Record<string, unknown> {
  return {
    key,
    type: 'PHOTO',
    label,
    required,
    order,
    validation: { minFiles: required ? 1 : 0, maxFiles: 4, maxSizeMb: 10, mimeTypes: ['image/jpeg', 'image/png'] },
  };
}

function note(order: number): Record<string, unknown> {
  return { key: 'napomena', type: 'TEXTAREA', label: 'Napomena', order, validation: { maxLength: 500 } };
}

function taskForm(args: {
  title: string;
  subject?: FormSubject;
  fields: Record<string, unknown>[];
  normalizedName?: Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: { title: args.title, subject: args.subject ?? 'TASK', language: 'bs', estimatedMinutes: 2 },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [{ key: 'osnovno', title: args.title, order: 1, fields: args.fields }],
    normalizedName: args.normalizedName ?? [],
  };
}

export interface SeedTaskForm extends SeedForm {
  readonly role: TaskFormRole;
  readonly taskTypeCode: TaskTypeCode;
}

export const SEED_TASK_FORMS: readonly SeedTaskForm[] = [
  {
    key: 'pranje_vozila_nalog',
    name: 'Pranje — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'WASH',
    ownerModule: 'tasks',
    description: 'Nalog za pranje: vrsta, datum i foto prije.',
    definition: taskForm({
      title: 'Nalog za pranje',
      fields: [
        {
          key: 'washType',
          type: 'SINGLE_CHOICE',
          label: 'Vrsta pranja',
          required: true,
          order: 1,
          optionsSource: {
            kind: 'STATIC',
            items: [
              { value: 'EXTERNAL', label: 'Vanjsko' },
              { value: 'INTERNAL', label: 'Unutrašnje' },
              { value: 'FULL', label: 'Kompletno' },
            ],
          },
        },
        { key: 'dueHint', type: 'DATE', label: 'Željeni datum', order: 2 },
        photo('photosBefore', 'Fotografije prije', true, 3),
        note(4),
      ],
    }),
  },
  {
    key: 'ciscenje_nalog',
    name: 'Čišćenje — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'INTERIOR_CLEANING',
    ownerModule: 'tasks',
    description: 'Nalog za čišćenje unutrašnjosti.',
    definition: taskForm({
      title: 'Nalog za čišćenje',
      fields: [photo('photosBefore', 'Fotografije prije', true, 1), note(2)],
    }),
  },
  {
    key: 'ciscenje_realizacija',
    name: 'Čišćenje — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'INTERIOR_CLEANING',
    ownerModule: 'tasks',
    description: 'Realizacija čišćenja.',
    definition: taskForm({
      title: 'Realizacija čišćenja',
      fields: [photo('photosAfter', 'Fotografije poslije', true, 1), note(2)],
    }),
  },
  {
    key: 'gorivo_nalog',
    name: 'Gorivo — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'FUEL_REFILL',
    ownerModule: 'tasks',
    description: 'Nalog za dopunu goriva.',
    definition: taskForm({ title: 'Nalog za gorivo', fields: [note(1)] }),
  },
  {
    key: 'gorivo_realizacija',
    name: 'Gorivo — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'FUEL_REFILL',
    ownerModule: 'tasks',
    description: 'Točenje: litre, iznos, km.',
    definition: taskForm({
      title: 'Realizacija točenja',
      fields: [
        { key: 'fuelLiters', type: 'DECIMAL', label: 'Litre', required: true, order: 1, validation: { min: 0.1, max: 500 } },
        { key: 'fuelAmount', type: 'MONEY', label: 'Iznos', required: true, order: 2, validation: { min: 0, max: 500_000, currency: 'BAM' } },
        { key: 'odometerKm', type: 'INTEGER', label: 'Kilometraža', required: true, order: 3, validation: { min: 0, max: 2_000_000 } },
        photo('receiptPhoto', 'Slika računa', false, 4),
      ],
      normalizedName: [
        { fieldKey: 'fuelLiters', column: 'fuelLiters', transform: 'TO_DECIMAL' },
        { fieldKey: 'fuelAmount', column: 'fuelAmount', transform: 'MONEY_TO_FENINZI' },
        { fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' },
      ],
    }),
  },
  {
    key: 'servis_nalog',
    name: 'Servis — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'SERVICE_VISIT',
    ownerModule: 'tasks',
    description: 'Nalog za odlazak na servis.',
    definition: taskForm({
      title: 'Nalog za servis',
      fields: [
        { key: 'dueHint', type: 'DATE', label: 'Rok', order: 1 },
        { key: 'workshopName', type: 'TEXT', label: 'Željena radionica', order: 2, validation: { maxLength: 120 } },
        note(3),
      ],
    }),
  },
  {
    key: 'servis_realizacija',
    name: 'Servis — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'SERVICE_VISIT',
    ownerModule: 'tasks',
    description: 'Završetak servisa.',
    definition: taskForm({
      title: 'Realizacija servisa',
      fields: [
        { key: 'serviceDate', type: 'DATE', label: 'Datum servisa', required: true, order: 1 },
        { key: 'odometerKm', type: 'INTEGER', label: 'Kilometraža', required: true, order: 2, validation: { min: 0, max: 2_000_000 } },
        { key: 'totalCost', type: 'MONEY', label: 'Trošak', required: true, order: 3, validation: { min: 0, max: 2147483647, currency: 'BAM' } },
        { key: 'workshopName', type: 'TEXT', label: 'Radionica', order: 4, validation: { maxLength: 120 } },
        photo('receiptPhoto', 'Račun', false, 5),
      ],
      normalizedName: [
        { fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' },
        { fieldKey: 'totalCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' },
      ],
    }),
  },
  {
    key: 'tehnicki_nalog',
    name: 'Tehnički — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'TECHNICAL_INSPECTION',
    ownerModule: 'tasks',
    description: 'Nalog za tehnički pregled.',
    definition: taskForm({
      title: 'Nalog za tehnički pregled',
      fields: [{ key: 'dueHint', type: 'DATE', label: 'Rok', order: 1 }, note(2)],
    }),
  },
  {
    key: 'tehnicki_realizacija',
    name: 'Tehnički — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'TECHNICAL_INSPECTION',
    ownerModule: 'tasks',
    description: 'Završetak tehničkog pregleda.',
    definition: taskForm({
      title: 'Realizacija tehničkog pregleda',
      fields: [
        { key: 'serviceDate', type: 'DATE', label: 'Datum', required: true, order: 1 },
        { key: 'odometerKm', type: 'INTEGER', label: 'Kilometraža', required: true, order: 2, validation: { min: 0, max: 2_000_000 } },
        { key: 'totalCost', type: 'MONEY', label: 'Trošak', required: true, order: 3, validation: { min: 0, max: 2147483647, currency: 'BAM' } },
        photo('receiptPhoto', 'Račun', false, 4),
      ],
      normalizedName: [
        { fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' },
        { fieldKey: 'totalCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' },
      ],
    }),
  },
  {
    key: 'gume_nalog',
    name: 'Gume — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'TIRE_CHANGE',
    ownerModule: 'tasks',
    description: 'Nalog za zamjenu guma.',
    definition: taskForm({
      title: 'Nalog za zamjenu guma',
      fields: [
        {
          key: 'season',
          type: 'SINGLE_CHOICE',
          label: 'Sezona',
          required: true,
          order: 1,
          optionsSource: {
            kind: 'STATIC',
            items: [
              { value: 'SUMMER', label: 'Ljetne' },
              { value: 'WINTER', label: 'Zimske' },
              { value: 'ALL_SEASON', label: 'Cjelogodišnje' },
            ],
          },
        },
        note(2),
      ],
    }),
  },
  {
    key: 'gume_realizacija',
    name: 'Gume — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'TIRE_CHANGE',
    ownerModule: 'tasks',
    description: 'Montaža kompleta.',
    definition: taskForm({
      title: 'Realizacija zamjene guma',
      fields: [
        { key: 'tireSetId', type: 'TEXT', label: 'Komplet (ID)', required: true, order: 1, validation: { maxLength: 40 } },
        { key: 'odometerKm', type: 'INTEGER', label: 'Kilometraža', required: true, order: 2, validation: { min: 0, max: 2_000_000 } },
        photo('photosAfter', 'Foto montaže', true, 3),
      ],
      normalizedName: [{ fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' }],
    }),
  },
  {
    key: 'registracija_nalog',
    name: 'Registracija — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'REGISTRATION',
    ownerModule: 'tasks',
    description: 'Nalog za registraciju.',
    definition: taskForm({ title: 'Nalog za registraciju', fields: [note(1)] }),
  },
  {
    key: 'registracija_zadatak_realizacija',
    name: 'Registracija — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'REGISTRATION',
    ownerModule: 'tasks',
    description: 'Podaci nove registracije.',
    definition: taskForm({
      title: 'Realizacija registracije',
      fields: [
        { key: 'registrationNumber', type: 'TEXT', label: 'Broj registracije', required: true, order: 1, validation: { maxLength: 40 } },
        { key: 'validFrom', type: 'DATE', label: 'Važi od', required: true, order: 2 },
        { key: 'validUntil', type: 'DATE', label: 'Važi do', required: true, order: 3 },
        { key: 'costAmount', type: 'MONEY', label: 'Trošak', order: 4, validation: { min: 0, max: 500_000, currency: 'BAM' } },
      ],
    }),
  },
  {
    key: 'prilagodeni_nalog',
    name: 'Prilagođeni — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'CUSTOM',
    ownerModule: 'tasks',
    description: 'Nalog za prilagođeni zadatak.',
    definition: taskForm({
      title: 'Nalog',
      fields: [{ key: 'opis', type: 'TEXT', label: 'Opis', required: true, order: 1, validation: { maxLength: 1000 } }],
    }),
  },
  {
    key: 'prilagodeni_realizacija',
    name: 'Prilagođeni — realizacija',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'CUSTOM',
    ownerModule: 'tasks',
    description: 'Dokaz izvršenja.',
    definition: taskForm({
      title: 'Realizacija',
      fields: [photo('photosAfter', 'Dokaz', true, 1), note(2)],
    }),
  },
  {
    key: 'predaja_nalog',
    name: 'Predaja vozila — nalog',
    subject: 'TASK',
    role: 'ORDER',
    taskTypeCode: 'HANDOVER',
    ownerModule: 'tasks',
    description: 'Stanje pri predaji.',
    definition: taskForm({
      title: 'Predaja vozila',
      fields: [
        { key: 'odometerKm', type: 'INTEGER', label: 'Kilometraža', required: true, order: 1, validation: { min: 0, max: 2_000_000 } },
        photo('photosBefore', 'Foto stanja', true, 2),
        note(3),
      ],
      normalizedName: [{ fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' }],
    }),
  },
  {
    key: 'predaja_realizacija',
    name: 'Predaja vozila — povrat',
    subject: 'TASK',
    role: 'REALIZATION',
    taskTypeCode: 'HANDOVER',
    ownerModule: 'tasks',
    description: 'Povrat vozila.',
    definition: taskForm({
      title: 'Povrat vozila',
      fields: [
        { key: 'odometerKm', type: 'INTEGER', label: 'Kilometraža', required: true, order: 1, validation: { min: 0, max: 2_000_000 } },
        photo('photosAfter', 'Foto povrata', true, 2),
        note(3),
      ],
      normalizedName: [{ fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' }],
    }),
  },
];
