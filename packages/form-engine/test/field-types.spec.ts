import { FIELD_TYPES as SHARED_FIELD_TYPES } from '@vfm/shared';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VALIDATION_KEYS,
  FIELD_TYPES,
  FIELD_TYPES_WITH_OPTIONS,
  FIELD_VALUE_KIND,
  INPUT_FIELD_TYPES,
  allowedValidationKeysFor,
  isKnownFieldType,
  isMobileCompatible,
} from '../dist/index.js';

describe('katalog tipova polja (docs/04 §3)', () => {
  it('koristi isti izvor tipova kao @vfm/shared (nema drift-a)', () => {
    expect([...FIELD_TYPES]).toEqual([...SHARED_FIELD_TYPES]);
  });

  it('svaki tip ima mapiranje vrijednosti i dozvoljene validacije', () => {
    for (const type of FIELD_TYPES) {
      expect(FIELD_VALUE_KIND[type], type).toBeDefined();
      expect(ALLOWED_VALIDATION_KEYS[type], type).toBeDefined();
      expect(Array.isArray(allowedValidationKeysFor(type)), type).toBe(true);
    }
  });

  it('SECTION ne unosi vrijednost, COMPUTED se računa', () => {
    expect(FIELD_VALUE_KIND.SECTION).toBe('none');
    expect(FIELD_VALUE_KIND.COMPUTED).toBe('computed');
    expect(INPUT_FIELD_TYPES).not.toContain('SECTION');
    expect(INPUT_FIELD_TYPES).not.toContain('COMPUTED');
    expect(INPUT_FIELD_TYPES).toHaveLength(FIELD_TYPES.length - 2);
  });

  it('MONEY je iznos u feninzima, PHOTO/FILE nose ID-jeve priloga', () => {
    expect(FIELD_VALUE_KIND.MONEY).toBe('money');
    expect(FIELD_VALUE_KIND.PHOTO).toBe('attachmentIds');
    expect(FIELD_VALUE_KIND.FILE).toBe('attachmentIds');
    expect(FIELD_VALUE_KIND.REFERENCE_VEHICLE).toBe('uuid');
  });

  it('samo izborna polja zahtijevaju optionsSource', () => {
    expect([...FIELD_TYPES_WITH_OPTIONS]).toEqual(['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN']);
    expect(FIELD_TYPES_WITH_OPTIONS).not.toContain('TEXT');
  });

  it('validacijski ključevi prate dokumentaciju po tipu', () => {
    expect(allowedValidationKeysFor('TEXT')).toContain('pattern');
    expect(allowedValidationKeysFor('INTEGER')).toEqual(['min', 'max', 'step']);
    expect(allowedValidationKeysFor('DECIMAL')).toContain('precision');
    expect(allowedValidationKeysFor('PHOTO')).toContain('maxFiles');
    expect(allowedValidationKeysFor('PHOTO')).toContain('mimeTypes');
    expect(allowedValidationKeysFor('FILE')).toContain('allowedExtensions');
    expect(allowedValidationKeysFor('SECTION')).toEqual([]);
    expect(allowedValidationKeysFor('COMPUTED')).toEqual([]);
  });

  it('svaki trenutni tip ima mobilnu kontrolu osim SECTION (grupa)', () => {
    for (const type of FIELD_TYPES) {
      expect(isMobileCompatible(type), type).toBe(type !== 'SECTION');
    }
  });

  it('isKnownFieldType odbija nepoznate vrijednosti iz JSON-a', () => {
    expect(isKnownFieldType('TEXT')).toBe(true);
    expect(isKnownFieldType('SARCASTIC')).toBe(false);
    expect(isKnownFieldType('text')).toBe(false);
    expect(isKnownFieldType(undefined)).toBe(false);
    expect(isKnownFieldType(42)).toBe(false);
  });
});
