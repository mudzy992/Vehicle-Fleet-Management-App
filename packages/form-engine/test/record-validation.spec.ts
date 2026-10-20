/**
 * Validacija zapisa prema verziji forme (docs/04 §9, P11).
 *
 * Težište testova:
 * - primjer iz dokumentacije prolazi i **server** računa `costPerMinute`;
 * - nepoznato/skriveno polje se odbija (`UNKNOWN_FIELD`/`FIELD_NOT_VISIBLE`) —
 *   nema tihe reinterpretacije;
 * - `DRAFT` verzija ne prima zapise; `RETIRED` samo kad se uređuje postojeći;
 * - normalizovane kolone se pune samo za uspješan zapis.
 */
import { describe, expect, it } from 'vitest';
import {
  isEmptyRecordValue,
  normalizeRecordValues,
  parseMoneyValue,
  parseDefinition,
  validateRecord,
  webOnlyFieldTypes,
  type FormDefinition,
  type RecordVersionRef,
} from '../src/index.js';
import { freshWashDefinition, minimalDefinition } from './fixtures/wash.definition.js';

function definitionOf(input: unknown): FormDefinition {
  const parsed = parseDefinition(input);
  if (!parsed.ok) {
    throw new Error(`Fixture nije validna: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.definition;
}

const WASH = definitionOf(freshWashDefinition());
const TODAY = '2026-10-20';

function version(overrides: Partial<RecordVersionRef> = {}): RecordVersionRef {
  return {
    id: '018f0000-0000-7000-8000-0000000000c1',
    version: 1,
    status: 'PUBLISHED',
    definition: WASH,
    ...overrides,
  };
}

const VALID_WASH = {
  washType: 'FULL',
  washDurationMin: 30,
  washCost: { amount: 9000, currency: 'BAM' },
  photosAfter: ['018f0000-0000-7000-8000-0000000000f1'],
};

function codes(
  values: unknown,
  overrides: Parameters<typeof validateRecord>[0] extends never
    ? never
    : Partial<Parameters<typeof validateRecord>[0]> = {},
): string[] {
  return validateRecord({ version: version(), values, today: TODAY, ...overrides }).errors.map(
    (error) => error.code,
  );
}

describe('validateRecord — sretan put', () => {
  it('prihvata primjer iz dokumentacije i računa izračunata polja', () => {
    const result = validateRecord({ version: version(), values: VALID_WASH, today: TODAY });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.versionError).toBeNull();
    expect(result.computed['costPerMinute']).toBe(300);
    expect(result.values['costPerMinute']).toBe(300);
    // Tekst se trimuje, novac ostaje { amount, currency }.
    expect(result.values['washType']).toBe('FULL');
    expect(result.values['washCost']).toEqual({ amount: 9000, currency: 'BAM' });
    expect(result.warnings).toEqual([]);
  });

  it('trimuje tekst i prijavljuje razliku izračunatog polja kao upozorenje', () => {
    const result = validateRecord({
      version: version(),
      values: { ...VALID_WASH, washType: '  FULL  ', costPerMinute: 999 },
      today: TODAY,
    });

    expect(result.ok).toBe(true);
    expect(result.values['washType']).toBe('FULL');
    expect(result.values['costPerMinute']).toBe(300);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['COMPUTED_MISMATCH']);
  });

  it('opciona prazna polja se ne prijavljuju kao greška', () => {
    const result = validateRecord({
      version: version(),
      values: { washType: 'INTERNAL', photosAfter: [] },
      today: TODAY,
    });

    expect(result.ok).toBe(true);
    // Bez trajanja/cene izračunato polje je 0 (zaštita u izrazu).
    expect(result.computed['costPerMinute']).toBe(0);
  });
});

describe('validateRecord — odbijanja (§9 tačka 3)', () => {
  it('nepoznato polje', () => {
    expect(codes({ ...VALID_WASH, nepostojece: 1 })).toEqual(['UNKNOWN_FIELD']);
  });

  it('skriveno polje s vrijednošću', () => {
    // `photosAfter` je vidljivo samo za EXTERNAL/FULL.
    const result = validateRecord({
      version: version(),
      values: { washType: 'INTERNAL', photosAfter: ['018f0000-0000-7000-8000-0000000000f1'] },
      today: TODAY,
    });

    expect(result.errors.map((error) => error.code)).toEqual(['FIELD_NOT_VISIBLE']);
    expect(result.ok).toBe(false);
  });

  it('obavezno polje', () => {
    const result = validateRecord({ version: version(), values: { washType: 'FULL' }, today: TODAY });

    expect(result.errors).toEqual([{ key: 'photosAfter', code: 'REQUIRED', message: 'Polje je obavezno.' }]);
  });

  it('tip, min/max i opcije', () => {
    expect(codes({ ...VALID_WASH, washDurationMin: '30' })).toEqual(['TYPE']);
    expect(codes({ ...VALID_WASH, washDurationMin: 0 })).toEqual(['MIN']);
    expect(codes({ ...VALID_WASH, washDurationMin: 481 })).toEqual(['MAX']);
    // Nepoznata opcija čini i `photosAfter` skrivenim (uslov više nije ispunjen),
    // pa se uz `OPTION` prijavljuje i `FIELD_NOT_VISIBLE`.
    expect(codes({ ...VALID_WASH, washType: 'NEPOZNATO' })).toEqual(['FIELD_NOT_VISIBLE', 'OPTION']);
    expect(codes({ ...VALID_WASH, washCost: { amount: 9000 } })).toEqual(['TYPE']);
    expect(codes({ ...VALID_WASH, washCost: { amount: 1000, currency: 'EUR' } })).toEqual(['CURRENCY']);
    expect(codes({ ...VALID_WASH, washCost: { amount: 10_000_001, currency: 'BAM' } })).toEqual(['MAX']);
    expect(codes({ ...VALID_WASH, photosAfter: 'nije-uuid' })).toEqual(['TYPE']);
    expect(codes({ ...VALID_WASH, photosAfter: [] })).toEqual(['REQUIRED']);
  });

  it('prilozi: nepoznat, pogrešan MIME i preveliki fajl', () => {
    const attachments = new Map([
      ['018f0000-0000-7000-8000-0000000000f1', { mimeType: 'application/pdf', sizeBytes: 1024 }],
      ['018f0000-0000-7000-8000-0000000000f2', { mimeType: 'image/jpeg', sizeBytes: 20 * 1024 * 1024 }],
    ]);

    const wrongMime = validateRecord({
      version: version(),
      values: { ...VALID_WASH, photosAfter: ['018f0000-0000-7000-8000-0000000000f1'] },
      today: TODAY,
      attachments,
    });
    expect(wrongMime.errors.map((error) => error.code)).toEqual(['ATTACHMENT_MIME']);

    const tooBig = validateRecord({
      version: version(),
      values: { ...VALID_WASH, photosAfter: ['018f0000-0000-7000-8000-0000000000f2'] },
      today: TODAY,
      attachments,
    });
    expect(tooBig.errors.map((error) => error.code)).toEqual(['ATTACHMENT_SIZE']);

    const unknown = validateRecord({
      version: version(),
      values: { ...VALID_WASH, photosAfter: ['018f0000-0000-7000-8000-0000000000f9'] },
      today: TODAY,
      attachments,
    });
    expect(unknown.errors.map((error) => error.code)).toEqual(['ATTACHMENT_UNKNOWN']);
  });

  it('sekcija u formValues je greška', () => {
    expect(codes({ ...VALID_WASH, osnovno: {} })).toEqual(['UNKNOWN_FIELD']);
  });
});

describe('validateRecord — verzija i oblik unosa', () => {
  it('DRAFT verzija ne prima zapise', () => {
    const result = validateRecord({
      version: version({ status: 'DRAFT' }),
      values: VALID_WASH,
      today: TODAY,
    });

    expect(result.ok).toBe(false);
    expect(result.versionError).toBe('FORM_VERSION_NOT_PUBLISHED');
    expect(result.errors).toEqual([]);
  });

  it('RETIRED prolazi samo pri uređivanju postojećeg zapisa', () => {
    const retired = version({ status: 'RETIRED' });

    expect(validateRecord({ version: retired, values: VALID_WASH, today: TODAY }).versionError).toBe(
      'FORM_VERSION_NOT_PUBLISHED',
    );
    expect(validateRecord({ version: retired, values: VALID_WASH, today: TODAY, isNew: false }).ok).toBe(
      true,
    );
  });

  it('formValues mora biti objekat', () => {
    const result = validateRecord({ version: version(), values: [1, 2, 3], today: TODAY });

    expect(result.ok).toBe(false);
    expect(result.versionError).toBe('FORM_VERSION_INVALID');
  });

  it('izraz koji se ne može izračunati je greška polja', () => {
    const broken = minimalDefinition({
      sections: [
        {
          key: 'sekcija',
          title: 'Sekcija',
          order: 1,
          fields: [
            { key: 'napomena', type: 'TEXT', label: 'Napomena', order: 1 },
            {
              key: 'zbir',
              type: 'COMPUTED',
              label: 'Zbir',
              order: 2,
              computed: { expression: 'round(napomena)', resultType: 'DECIMAL' },
            },
          ],
        },
      ],
    });

    const result = validateRecord({
      version: version({ definition: definitionOf(broken) }),
      values: { napomena: 'tekst' },
      today: TODAY,
    });

    expect(result.errors.map((error) => error.code)).toEqual(['COMPUTED_NOT_EVALUABLE']);
    expect(result.computed['zbir']).toBeNull();
  });
});

describe('normalizacija (§7)', () => {
  const mapped = definitionOf({
    ...freshWashDefinition(),
    normalizedName: [
      { fieldKey: 'washCost', column: 'totalCost', transform: 'MONEY_TO_FENINZI' },
      { fieldKey: 'washDurationMin', column: 'odometerKm', transform: 'TO_INT' },
      { fieldKey: 'washType', column: null, transform: null },
    ],
  });

  it('puni kolone iz mapiranja, a `null` kolone preskače', () => {
    const result = validateRecord({
      version: version({ definition: mapped }),
      values: VALID_WASH,
      today: TODAY,
    });

    expect(result.ok).toBe(true);
    expect(result.normalized).toEqual({ totalCost: 9000, odometerKm: 30 });
    expect(result.normalized).not.toHaveProperty('washType');
  });

  it('bez uspješne validacije nema normalizacije', () => {
    const result = validateRecord({
      version: version({ definition: mapped }),
      values: { washType: 'FULL' },
      today: TODAY,
    });

    expect(result.ok).toBe(false);
    expect(result.normalized).toEqual({});
  });

  it('transformacije pokrivaju datume, tekst i boolean', () => {
    expect(
      normalizeRecordValues(
        {
          ...WASH,
          normalizedName: [{ fieldKey: 'x', column: 'dueDate', transform: 'TO_DATE' }],
        } as FormDefinition,
        { x: '2026-10-20' },
      ),
    ).toEqual({ dueDate: '2026-10-20' });

    expect(
      normalizeRecordValues(
        {
          ...WASH,
          normalizedName: [{ fieldKey: 'x', column: 'dueAt', transform: 'TO_DATETIME' }],
        } as FormDefinition,
        { x: '2026-10-20T10:00:00+02:00' },
      ),
    ).toEqual({ dueAt: '2026-10-20T08:00:00.000Z' });

    expect(
      normalizeRecordValues(
        {
          ...WASH,
          normalizedName: [{ fieldKey: 'x', column: 'title', transform: 'TO_TEXT' }],
        } as FormDefinition,
        { x: 42 },
      ),
    ).toEqual({ title: '42' });

    expect(
      normalizeRecordValues(
        {
          ...WASH,
          normalizedName: [{ fieldKey: 'x', column: 'status', transform: 'TO_BOOL' }],
        } as FormDefinition,
        { x: 'da' },
      ),
    ).toEqual({ status: true });
  });

  it('nemoguća transformacija baca (API → NORMALIZATION_MISMATCH)', () => {
    const definition = {
      ...WASH,
      normalizedName: [{ fieldKey: 'x', column: 'odometerKm', transform: 'TO_INT' }],
    } as FormDefinition;

    expect(() => normalizeRecordValues(definition, { x: 'nije-broj' })).toThrow(/cijeli broj/u);
  });
});

describe('pomoćne funkcije', () => {
  it('isEmptyRecordValue', () => {
    expect(isEmptyRecordValue(undefined)).toBe(true);
    expect(isEmptyRecordValue(null)).toBe(true);
    expect(isEmptyRecordValue('   ')).toBe(true);
    expect(isEmptyRecordValue([])).toBe(true);
    expect(isEmptyRecordValue(0)).toBe(false);
    expect(isEmptyRecordValue(false)).toBe(false);
    expect(isEmptyRecordValue({ amount: 0, currency: 'BAM' })).toBe(false);
  });

  it('parseMoneyValue', () => {
    expect(parseMoneyValue({ amount: 9000, currency: 'BAM' })).toEqual({ amount: 9000, currency: 'BAM' });
    expect(parseMoneyValue({ amount: 90.5, currency: 'BAM' })).toBeNull();
    expect(parseMoneyValue({ amount: 9000, currency: 'bam' })).toBeNull();
    expect(parseMoneyValue('9000')).toBeNull();
  });

  it('webOnlyFieldTypes je prazan za trenutni katalog tipova', () => {
    expect(webOnlyFieldTypes(WASH)).toEqual([]);
  });
});
