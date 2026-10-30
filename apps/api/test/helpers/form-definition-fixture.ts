/** Minimalna TASK definicija za životni ciklus verzija (2 polja da se jedno smije ukloniti). */
export function inspectionDefinition(): Record<string, unknown> {
  return {
    $schema: 'vfm-form/1',
    meta: { title: 'Pregled', subject: 'TASK', language: 'bs' },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovno',
        description: null,
        order: 1,
        visibleWhen: null,
        fields: [
          {
            key: 'napomena',
            type: 'TEXT',
            label: 'Napomena',
            order: 1,
            required: false,
            visibleWhen: null,
            disabled: false,
            visibleOnForm: true,
            storeInFormData: true,
          },
          {
            key: 'ocjena',
            type: 'INTEGER',
            label: 'Ocjena',
            order: 2,
            required: false,
            visibleWhen: null,
            disabled: false,
            visibleOnForm: true,
            storeInFormData: true,
            validation: { min: 1, max: 5 },
          },
        ],
      },
    ],
  };
}

export function fieldKeysOf(definition: Record<string, unknown>): string[] {
  const sections = definition['sections'];
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => {
    if (!section || typeof section !== 'object' || !('fields' in section)) return [];
    const fields = (section as { fields: unknown }).fields;
    if (!Array.isArray(fields)) return [];
    return fields.flatMap((field) => {
      if (!field || typeof field !== 'object' || !('key' in field)) return [];
      return [String((field as { key: unknown }).key)];
    });
  });
}

export function withFirstSectionFields(
  definition: Record<string, unknown>,
  mutate: (fields: Record<string, unknown>[]) => void,
): Record<string, unknown> {
  const next = structuredClone(definition);
  const sections = next['sections'] as Array<{ fields: Record<string, unknown>[] }>;
  mutate(sections[0]!.fields);
  sections[0]!.fields.forEach((field, index) => {
    field['order'] = index + 1;
  });
  return next;
}
