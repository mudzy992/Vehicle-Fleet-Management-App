/**
 * Početne forme (`SEED_FORMS`) — validacija prije nego uđu u bazu.
 *
 * Zašto: seed se pokreće na svakom deployu i piše **objavljene** verzije. Ako
 * definicija ne prolazi meta-shemu ili provjere iz `docs/04` §8, deploy bi u
 * bazu stavio formu koja ne može primiti nijedan zapis (P11 bi je odbio).
 * Ovaj test je zato „gate" za sadržaj seed-a, nezavisan od baze.
 */
import { describe, expect, it } from 'vitest';
import { FORM_SUBJECTS } from '@vfm/shared';
import { checkPublishable, parseDefinition } from '@vfm/form-engine';
import { SEED_FORMS } from '../../src/tools/seed-forms.js';

describe('SEED_FORMS', () => {
  it('svaka definicija prolazi meta-shemu i provjere pri objavi', () => {
    for (const form of SEED_FORMS) {
      const parsed = parseDefinition(form.definition);
      expect(parsed.ok, `${form.key}: ${parsed.ok ? '' : JSON.stringify(parsed.issues)}`).toBe(true);
      if (!parsed.ok) continue;

      const checks = checkPublishable({
        definition: parsed.definition,
        changeNote: 'Seed: početna verzija forme.',
      });
      expect(checks.ok, `${form.key}: ${checks.issues.map((issue) => issue.code).join(', ')}`).toBe(true);
      expect(checks.contentHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(checks.mobileCompatible).toBe(true);
    }
  });

  it('ključevi i subjekti su jedinstveni i podržani', () => {
    const keys = SEED_FORMS.map((form) => form.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const form of SEED_FORMS) {
      expect(FORM_SUBJECTS).toContain(form.subject);
      expect(form.definition['meta']).toMatchObject({ subject: form.subject, title: form.name });
    }
  });

  it('postoji tačno jedna generička forma za TASK (partial unique u bazi)', () => {
    const genericTaskForms = SEED_FORMS.filter(
      (form) => form.subject === 'TASK' && form.definition['meta'] !== undefined,
    );
    expect(genericTaskForms).toHaveLength(1);
    expect(genericTaskForms[0]?.key).toBe('pranje_vozila');
  });

  it('forma kompleta guma nosi samo dodatne podatke nabavke', () => {
    const tireSet = SEED_FORMS.find((form) => form.key === 'komplet_guma');
    expect(tireSet).toBeDefined();
    expect(tireSet?.subject).toBe('TIRE_SET');

    const parsed = parseDefinition(tireSet!.definition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const keys = parsed.definition.sections.flatMap((section) => section.fields.map((field) => field.key));
    expect(keys).toEqual(['supplier', 'invoiceNumber', 'napomena']);
    expect(parsed.definition.normalizedName).toEqual([]);
  });

  it('forma vozila pokriva obavezne kolone iz seed-a', () => {
    const vehicle = SEED_FORMS.find((form) => form.key === 'vehicle');
    expect(vehicle).toBeDefined();

    const parsed = parseDefinition(vehicle!.definition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const keys = parsed.definition.sections.flatMap((section) => section.fields.map((field) => field.key));
    for (const required of ['internalNo', 'make', 'model', 'fuelType', 'odometerKm', 'plateNumber']) {
      expect(keys).toContain(required);
    }

    // Normalizacija mora mapirati kilometražu na kolonu vozila (§7).
    expect(parsed.definition.normalizedName).toEqual(
      expect.arrayContaining([{ fieldKey: 'odometerKm', column: 'odometerKm', transform: 'TO_INT' }]),
    );
  });
});
