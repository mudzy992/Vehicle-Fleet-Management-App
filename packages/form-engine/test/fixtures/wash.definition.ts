/**
 * Fixture: **tačan primjer iz dokumentacije** (docs/04-FORM_ENGINE.md §2 —
 * "Pranje vozila"). Služi kao dokaz da je dokumentovani ugovor implementabilan:
 * primjer mora proći meta-shemu bez izmjena.
 */
export function washDefinition(): Record<string, unknown> {
  const definition = {
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
        description: null,
        order: 1,
        visibleWhen: null,
        fields: [
          {
            key: 'washType',
            type: 'SINGLE_CHOICE',
            label: 'Vrsta pranja',
            helpText: 'Odaberi šta je urađeno',
            placeholder: null,
            required: true,
            order: 1,
            visibleWhen: null,
            disabled: false,
            optionsSource: {
              kind: 'STATIC',
              items: [
                { value: 'EXTERNAL', label: 'Vanjsko' },
                { value: 'INTERNAL', label: 'Unutrašnje' },
                { value: 'FULL', label: 'Kompletno' },
              ],
            },
            validation: { minSelect: 1 },
          },
          {
            key: 'washDurationMin',
            type: 'INTEGER',
            label: 'Trajanje (min)',
            required: false,
            order: 2,
            validation: { min: 1, max: 480 },
          },
          {
            key: 'washCost',
            type: 'MONEY',
            label: 'Trošak pranja',
            required: false,
            order: 3,
            validation: { min: 0, max: 100000, currency: 'BAM' },
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
        key: 'racun',
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
            visibleOnForm: true,
            storeInFormData: true,
          },
        ],
      },
    ],
  };
  return definition as unknown as Record<string, unknown>;
}

/** Svježa (duboka) kopija — testovi smiju mijenjati bez uticaja na druge. */
export function freshWashDefinition(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(washDefinition())) as Record<string, unknown>;
}

/** Minimalna validna definicija (jedno TEXT polje) za izolovane provjere. */
export function minimalDefinition(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: { title: 'Test forma', subject: 'OTHER' },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovno',
        order: 1,
        fields: [{ key: 'napomena', type: 'TEXT', label: 'Napomena', order: 1 }],
      },
    ],
    ...patch,
  };
}
