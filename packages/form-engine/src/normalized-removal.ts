import type { FormDefinition } from './definition.schema.js';

export function hasRemovedNormalizedFields(
  previous: FormDefinition | null | undefined,
  definition: FormDefinition,
): boolean {
  if (!previous) return false;
  const current = new Map(
    (definition.normalizedName ?? []).map((mapping) => [mapping.fieldKey, mapping] as const),
  );
  const keys = new Set(
    definition.sections.flatMap((section) => section.fields.map((field) => field.key)),
  );
  return (previous.normalizedName ?? []).some((mapping) => {
    if (mapping.column === null) return false;
    const next = current.get(mapping.fieldKey);
    return (
      !keys.has(mapping.fieldKey) ||
      !next ||
      next.column !== mapping.column ||
      next.transform !== mapping.transform
    );
  });
}
