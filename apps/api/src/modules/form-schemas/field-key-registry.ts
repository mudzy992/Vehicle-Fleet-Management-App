/**
 * Registar ključeva polja (`FieldKeyRegistry`, U-16: isti ključ = isti tip i
 * značenje u svim formama).
 *
 * Zašto zaseban modul: koristi ga i `FormSchemasService` (pri objavi) i seed
 * (pri kreiranju početnih formi). Duplirana logika bi značila da seed i API mogu
 * upisati različite tipove za isti ključ — tačno ono što U-16 zabranjuje.
 */
import { randomUUID } from 'node:crypto';
import type { FormDefinition } from '@vfm/form-engine';

/** Podskup Prisma klijenta koji registar koristi (radi i u transakciji). */
export interface FieldKeyRegistryClient {
  readonly fieldKeyRegistry: {
    findUnique: (args: { where: { key: string } }) => Promise<{
      key: string;
      dataType: string;
      unit: string | null;
      normalizedColumn: string | null;
      usedByFormSchemaIds: string[];
    } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    update: (args: { where: { key: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export interface FieldKeySyncOptions {
  /** Poziva se kad isti ključ u drugoj formi ima drugi tip (U-16 konflikt). */
  readonly onTypeConflict?: (conflict: { key: string; expected: string; actual: string }) => void;
}

/**
 * Usklađuje registar s definicijom: dodaje nove ključeve, dopunjuje
 * `usedByFormSchemaIds` i bilježi normalizovanu kolonu. **Ne mijenja `dataType`**
 * — tip je prvi koji je ključ dobio; razlika se prijavljuje, ne prepisuje.
 */
export async function syncFieldKeys(
  client: FieldKeyRegistryClient,
  definition: FormDefinition,
  formSchemaId: string,
  options: FieldKeySyncOptions = {},
): Promise<void> {
  const mappings = new Map(
    (definition.normalizedName ?? []).map((mapping) => [mapping.fieldKey, mapping] as const),
  );

  for (const section of definition.sections) {
    for (const field of section.fields) {
      const existing = await client.fieldKeyRegistry.findUnique({ where: { key: field.key } });
      const mapping = mappings.get(field.key);
      const usedBy = new Set(existing?.usedByFormSchemaIds ?? []);
      usedBy.add(formSchemaId);

      if (!existing) {
        await client.fieldKeyRegistry.create({
          data: {
            id: randomUUID(),
            key: field.key,
            dataType: field.type,
            unit: field.computed?.unit ?? null,
            normalizedColumn: mapping?.column ?? null,
            usedByFormSchemaIds: [...usedBy],
          },
        });
        continue;
      }

      if (existing.dataType !== field.type) {
        options.onTypeConflict?.({ key: field.key, expected: field.type, actual: existing.dataType });
      }

      await client.fieldKeyRegistry.update({
        where: { key: field.key },
        data: {
          normalizedColumn: mapping?.column ?? existing.normalizedColumn,
          unit: field.computed?.unit ?? existing.unit,
          usedByFormSchemaIds: [...usedBy],
        },
      });
    }
  }
}
