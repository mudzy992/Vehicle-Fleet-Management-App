/**
 * Render model (docs/04 §11/§12) — odluke koje web i mobilna **dijele**.
 *
 * Ključni test je paritet: model se gradi istom funkcijom za oba klijenta, pa
 * test traži da je izlaz deterministički i da ne nosi platformski specifična
 * polja; razlika između weba i mobilne smije biti samo u crtanju `widget`-a.
 */
import { describe, expect, it } from 'vitest';
import type { FormDefinition } from '@vfm/form-engine';
import { parseDefinition } from '@vfm/form-engine';
import {
  buildRenderModel,
  collectSubmitValues,
  formatFieldValue,
  type RenderField,
  type RenderModel,
} from '../src/index.js';
import { rendererDefinition } from './fixtures.js';

function definitionOf(input: unknown): FormDefinition {
  const parsed = parseDefinition(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.definition;
}

const DEFINITION = definitionOf(rendererDefinition());
const TODAY = '2026-10-20';

function model(
  values: Record<string, unknown> = {},
  extra: Partial<Parameters<typeof buildRenderModel>[0]> = {},
): RenderModel {
  return buildRenderModel({
    definition: DEFINITION,
    values,
    formSchemaVersionId: '018f0000-0000-7000-8000-0000000000c1',
    version: 3,
    today: TODAY,
    ...extra,
  });
}

function field(result: RenderModel, key: string): RenderField {
  const found = result.sections.flatMap((section) => section.fields).find((item) => item.key === key);
  if (!found) throw new Error(`Polje ${key} nije u modelu.`);
  return found;
}

const BASE_VALUES = {
  servisTip: 'VELIKI',
  vozilo: '018f0000-0000-7000-8000-0000000000e1',
  kilometraza: 120000,
  cijena: { amount: 20000, currency: 'BAM' },
  datumServisa: '2026-10-19',
  pristanak: true,
};

describe('buildRenderModel — struktura i meta', () => {
  it('prenosi meta, layout i verziju koju zapis nosi', () => {
    const result = model(BASE_VALUES);

    expect(result.title).toBe('Servis vozila');
    expect(result.description).toBe('Evidencija servisa');
    expect(result.language).toBe('bs');
    expect(result.columns).toBe(2);
    expect(result.stickySubmit).toBe(true);
    expect(result.formSchemaVersionId).toBe('018f0000-0000-7000-8000-0000000000c1');
    expect(result.version).toBe(3);
    expect(result.sections.map((section) => section.key)).toEqual(['osnovno', 'dodatno']);
  });

  it('mapira svaki tip polja na widget koji klijent crta', () => {
    const result = model(BASE_VALUES);

    expect(field(result, 'servisTip').widget).toBe('SELECT');
    expect(field(result, 'radionica').widget).toBe('SELECT');
    expect(field(result, 'vozilo').widget).toBe('REFERENCE');
    expect(field(result, 'kilometraza').widget).toBe('NUMBER');
    expect(field(result, 'cijena').widget).toBe('MONEY');
    expect(field(result, 'datumServisa').widget).toBe('DATE');
    expect(field(result, 'pristanak').widget).toBe('BOOLEAN');
    expect(field(result, 'opis').widget).toBe('TEXTAREA');
    expect(field(result, 'cijenaPoSatu').widget).toBe('OUTPUT');
    expect(field(result, 'cijenaPoSatu').readOnly).toBe(true);
  });

  it('trimuje vrijednosti i označava obavezna polja', () => {
    const result = model({ ...BASE_VALUES, opis: '  zamjena ulja  ' });

    expect(field(result, 'opis').value).toBe('zamjena ulja');
    expect(field(result, 'servisTip').required).toBe(true);
    expect(field(result, 'kilometraza').required).toBe(false);
  });
});

describe('buildRenderModel — uslovna vidljivost', () => {
  it('skriva polja i sekcije čiji uslov nije ispunjen', () => {
    const result = model({ ...BASE_VALUES, servisTip: 'MALI' });

    expect(result.sections.map((section) => section.key)).toEqual(['osnovno']);
    expect(result.sections[0]?.fields.map((item) => item.key)).not.toContain('cijena');
    expect(() => field(result, 'opis')).toThrow();
  });

  it('uslov radi nad trimovanim unosom („ VELIKI ")', () => {
    const result = model({ ...BASE_VALUES, servisTip: ' VELIKI ' });

    expect(result.sections.map((section) => section.key)).toEqual(['osnovno', 'dodatno']);
    expect(field(result, 'cijena').value).toEqual({ amount: 20000, currency: 'BAM' });
  });

  it('polje s greškom ostaje vidljivo i kad uslov više nije ispunjen', () => {
    const result = model(
      { ...BASE_VALUES, servisTip: 'MALI' },
      {
        errors: [
          { key: 'cijena', code: 'MAX', message: 'Najveći dozvoljeni iznos je 5.000,00 KM.' },
          { key: 'opis', code: 'REQUIRED', message: 'Polje je obavezno.' },
        ],
      },
    );

    const cijena = field(result, 'cijena');
    expect(cijena.visibleWhen).toEqual({ field: 'servisTip', op: 'IN', value: ['VELIKI'] });
    expect(cijena.hasError).toBe(true);
    expect(cijena.errors[0]?.code).toBe('MAX');
    expect(result.errors['cijena']?.code).toBe('MAX');
    expect(result.firstErrorKey).toBe('cijena');
  });
});

describe('buildRenderModel — opcije i izračunata polja', () => {
  it('rješava STATIC opcije, a LIST/QUERY prepušta serveru', () => {
    const result = model(BASE_VALUES);

    expect(field(result, 'servisTip').options).toEqual([
      { value: 'MALI', label: 'Mali servis' },
      { value: 'VELIKI', label: 'Veliki servis' },
    ]);
    expect(field(result, 'servisTip').optionsSourceKind).toBe('STATIC');

    expect(field(result, 'radionica').options).toBeNull();
    expect(field(result, 'radionica').optionsSourceKind).toBe('LIST');
  });

  it('računa COMPUTED istim engine-om kao server', () => {
    const result = model(BASE_VALUES);

    expect(result.computed['cijenaPoSatu']).toBe(100);
    expect(field(result, 'cijenaPoSatu').value).toBe(100);

    // Bez kilometraže zaštita u izrazu daje 0, bez greške na formi.
    const empty = model({ ...BASE_VALUES, kilometraza: undefined });
    expect(empty.computed['cijenaPoSatu']).toBe(0);
  });
});

describe('buildRenderModel — progres i slanje', () => {
  it('računa napredak po obaveznim vidljivim poljima', () => {
    const full = model(BASE_VALUES);
    expect(full.progress.requiredFields).toBe(3);
    expect(full.progress.filledRequired).toBe(3);
    expect(full.progress.percent).toBe(100);

    const partial = model({ servisTip: 'VELIKI' });
    expect(partial.progress.requiredFields).toBe(3);
    expect(partial.progress.filledRequired).toBe(1);
    expect(partial.progress.percent).toBe(33);
  });

  it('collectSubmitValues šalje samo vidljiva, izmjenjiva polja', () => {
    const result = model({ ...BASE_VALUES, zakljucano: 'x', opis: 'radovi' });
    const values = collectSubmitValues(result);

    expect(values['servisTip']).toBe('VELIKI');
    expect(values['opis']).toBe('radovi');
    expect(values).not.toHaveProperty('cijenaPoSatu'); // COMPUTED računa server
    expect(values).not.toHaveProperty('zakljucano'); // disabled
  });

  it('skrivena polja se ne šalju', () => {
    const result = model({ ...BASE_VALUES, servisTip: 'MALI', cijena: { amount: 1, currency: 'BAM' } });

    expect(collectSubmitValues(result)).not.toHaveProperty('cijena');
  });
});

describe('paritet web ↔ mobilna', () => {
  it('model je deterministički i nosi isti JSON za oba klijenta', () => {
    const web = model(BASE_VALUES);
    const mobile = model(BASE_VALUES);

    expect(JSON.stringify(mobile)).toBe(JSON.stringify(web));
    // Nijedno polje modela ne opisuje platformu — samo podatke za crtanje.
    expect(Object.keys(web).sort()).toEqual([
      'columns',
      'computed',
      'description',
      'errors',
      'firstErrorKey',
      'formSchemaVersionId',
      'language',
      'progress',
      'sections',
      'stickySubmit',
      'title',
      'version',
    ]);
  });

  it('formatFieldValue daje isti tekst bez obzira na platformu', () => {
    const result = model(BASE_VALUES);

    expect(formatFieldValue(field(result, 'cijena'))).toContain('200,00');
    expect(formatFieldValue(field(result, 'datumServisa'))).toBe('19.10.2026.');
    expect(formatFieldValue(field(result, 'pristanak'))).toBe('Da');
    expect(formatFieldValue(field(result, 'kilometraza'))).toBe('120000');
  });
});
