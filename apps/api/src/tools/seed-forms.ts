/**
 * Početne forme koje seed uvijek osigurava (docs/04 §2, §8; P-01).
 *
 * Zašto u kodu, a ne u SQL migraciji:
 * - definicija mora proći **istu** meta-shemu i provjere pri objavi kao forma iz
 *   Builder-a; da je u migraciji, mogla bi zaobići engine;
 * - `contentHash` se računa kanonizacijom, pa se mora izračunati u JS-u;
 * - seed je idempotentan: postojeća objavljena verzija se **ne dira**, pa se
 *   ručne izmjene kroz Builder ne prepisuju pri deployu.
 *
 * Sadržaj je namjerno mali i fiktivan (bez stvarnih registracija i lica):
 * `vehicle` (FK za vozila iz seed-a), `pranje_vozila` (generička forma zadatka —
 * jedna po `(subject, taskTypeId)`), `registracija_vozila`.
 */
import type { FormSubject } from '@vfm/shared';

export interface SeedForm {
  readonly key: string;
  readonly name: string;
  readonly subject: FormSubject;
  readonly description: string;
  readonly ownerModule: string;
  readonly definition: Record<string, unknown>;
}

const OPCIJE_GORIVA = [
  { value: 'DIESEL', label: 'Dizel' },
  { value: 'PETROL', label: 'Benzin' },
  { value: 'HYBRID', label: 'Hibrid' },
  { value: 'ELECTRIC', label: 'Električno' },
];

function vehicleForm(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: {
      title: 'Vozilo',
      description: 'Osnovni podaci o vozilu',
      subject: 'VEHICLE',
      language: 'bs',
      estimatedMinutes: 3,
    },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovni podaci',
        order: 1,
        fields: [
          {
            key: 'internalNo',
            type: 'TEXT',
            label: 'Interni broj',
            required: true,
            order: 1,
            validation: { maxLength: 20 },
          },
          {
            key: 'make',
            type: 'TEXT',
            label: 'Marka',
            required: true,
            order: 2,
            validation: { maxLength: 60 },
          },
          {
            key: 'model',
            type: 'TEXT',
            label: 'Model',
            required: true,
            order: 3,
            validation: { maxLength: 60 },
          },
          {
            key: 'year',
            type: 'INTEGER',
            label: 'Godina proizvodnje',
            order: 4,
            validation: { min: 1980, max: 2100 },
          },
          {
            key: 'fuelType',
            type: 'SINGLE_CHOICE',
            label: 'Gorivo',
            required: true,
            order: 5,
            optionsSource: { kind: 'STATIC', items: OPCIJE_GORIVA },
          },
          {
            key: 'plateNumber',
            type: 'TEXT',
            label: 'Registarska oznaka',
            order: 6,
            validation: { maxLength: 20 },
          },
          {
            key: 'odometerKm',
            type: 'INTEGER',
            label: 'Kilometraža',
            order: 7,
            validation: { min: 0, max: 2_000_000 },
          },
        ],
      },
    ],
    //  Samo kolone iz `NORMALIZATION_COLUMNS.VEHICLE` (identitet vozila —
    //  `internalNo`, `make`, `model`, `fuelType` — je strukturirani dio API-ja,
    //  docs/04 §7).
    normalizedName: [
      { fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' },
      { fieldKey: 'plateNumber', column: 'plateNumber', transform: 'TO_TEXT' },
    ],
  };
}

function washForm(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: {
      title: 'Pranje vozila',
      description: 'Vanjsko i unutrašnje pranje',
      subject: 'TASK',
      language: 'bs',
      estimatedMinutes: 3,
    },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovni podaci',
        order: 1,
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
          {
            key: 'washDurationMin',
            type: 'INTEGER',
            label: 'Trajanje (min)',
            order: 2,
            validation: { min: 1, max: 480 },
          },
          {
            key: 'washCost',
            type: 'MONEY',
            label: 'Trošak pranja',
            order: 3,
            validation: { min: 0, max: 1000, currency: 'BAM' },
          },
          {
            key: 'photosAfter',
            type: 'PHOTO',
            label: 'Fotografije nakon pranja',
            required: true,
            order: 4,
            visibleWhen: { field: 'washType', op: 'IN', value: ['EXTERNAL', 'FULL'] },
            validation: {
              minFiles: 1,
              maxFiles: 4,
              maxSizeMb: 10,
              mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            },
          },
        ],
      },
      {
        key: 'obracun',
        title: 'Obračun',
        order: 2,
        fields: [
          {
            key: 'costPerMinute',
            type: 'COMPUTED',
            label: 'Cijena po minuti',
            order: 1,
            computed: {
              expression: 'if(washDurationMin > 0, round(washCost / washDurationMin, 2), 0)',
              resultType: 'DECIMAL',
              precision: 2,
              unit: 'KM/min',
            },
          },
        ],
      },
    ],
    normalizedName: [{ fieldKey: 'washCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' }],
  };
}

function registrationForm(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: {
      title: 'Registracija vozila',
      description: 'Podaci o registraciji i osiguranju',
      subject: 'REGISTRATION',
      language: 'bs',
      estimatedMinutes: 4,
    },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'registracija',
        title: 'Registracija',
        order: 1,
        fields: [
          {
            key: 'registrationNumber',
            type: 'TEXT',
            label: 'Broj registracije',
            required: true,
            order: 1,
            validation: { maxLength: 40 },
          },
          { key: 'validFrom', type: 'DATE', label: 'Važi od', required: true, order: 2 },
          { key: 'validUntil', type: 'DATE', label: 'Važi do', required: true, order: 3 },
          {
            key: 'costAmount',
            type: 'MONEY',
            label: 'Trošak registracije',
            order: 4,
            validation: { min: 0, max: 5000, currency: 'BAM' },
          },
          {
            key: 'insuranceCompany',
            type: 'TEXT',
            label: 'Osiguravajuće društvo',
            order: 5,
            validation: { maxLength: 80 },
          },
        ],
      },
    ],
    normalizedName: [
      { fieldKey: 'registrationNumber', column: 'registrationNumber', transform: 'TO_TEXT' },
      { fieldKey: 'validFrom', column: 'validFrom', transform: 'TO_DATE' },
      { fieldKey: 'validUntil', column: 'validUntil', transform: 'TO_DATE' },
      { fieldKey: 'costAmount', column: 'costAmount', transform: 'MONEY_TO_FENINZI' },
    ],
  };
}

/** Redoslijed je bitan samo za log; sve forme su nezavisne. */
export const SEED_FORMS: readonly SeedForm[] = [
  {
    key: 'vehicle',
    name: 'Vozilo',
    subject: 'VEHICLE',
    description: 'Osnovni podaci o vozilu.',
    ownerModule: 'vehicles',
    definition: vehicleForm(),
  },
  {
    key: 'pranje_vozila',
    name: 'Pranje vozila',
    subject: 'TASK',
    description: 'Generička forma zadatka pranja (default za TASK).',
    ownerModule: 'tasks',
    definition: washForm(),
  },
  {
    key: 'registracija_vozila',
    name: 'Registracija vozila',
    subject: 'REGISTRATION',
    description: 'Registracija i troškovi registracije.',
    ownerModule: 'registrations',
    definition: registrationForm(),
  },
];
