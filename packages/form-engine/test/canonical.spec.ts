import { describe, expect, it } from 'vitest';
import {
  CanonicalizationError,
  canonicalJson,
  contentHash,
  definitionETag,
  sameCanonicalJson,
} from '../src/index.js';

describe('kanonski JSON i contentHash (docs/04 §8.10, §11)', () => {
  it('sortira ključeve objekata pa hash ne zavisi od redoslijeda', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it('poštuje redoslijed nizova (niz je uređen)', () => {
    expect(canonicalJson([1, 2])).toBe('[1,2]');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('izbacuje ključeve s `undefined` vrijednošću', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('odbija `undefined` u nizu (pozicija mora ostati stabilna)', () => {
    expect(() => canonicalJson([1, undefined, 3])).toThrow(CanonicalizationError);
    expect(() => canonicalJson([1, undefined])).toThrow(/\$\[1\]/u);

    try {
      canonicalJson([1, undefined]);
      expect.unreachable('trebalo je baciti');
    } catch (error) {
      expect((error as CanonicalizationError).path).toBe('$[1]');
    }
  });

  it('normalizuje `-0` na `0` (dva jednaka zapisa → isti hash)', () => {
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
    expect(contentHash({ a: -0 })).toBe(contentHash({ a: 0 }));
  });

  it('serializuje Date kao ISO 8601 UTC', () => {
    const date = new Date('2026-10-20T08:15:00.000Z');

    expect(canonicalJson({ at: date })).toBe('{"at":"2026-10-20T08:15:00.000Z"}');
    expect(() => canonicalJson(new Date('nije-datum'))).toThrow(CanonicalizationError);
  });

  it('odbija ne-JSON vrijednosti (funkcija, bigint, simbol, klasa)', () => {
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ n: 1n })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ s: Symbol('x') })).toThrow(CanonicalizationError);
    expect(() => canonicalJson(new Map())).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ nested: new Set([1]) })).toThrow(CanonicalizationError);
    class Custom {
      value = 1;
    }
    expect(() => canonicalJson({ custom: new Custom() })).toThrow(CanonicalizationError);
    expect(() => canonicalJson(Object.assign(Object.create(null), { a: 1 }))).not.toThrow();
  });

  it('odbija beskonačne brojeve i NaN', () => {
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/konačan/u);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/konačan/u);
  });

  it('odbija cikličnu referencu', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(/Ciklična/u);
  });

  it('odbija ključ `__proto__` (prototype pollution preko JSON-a)', () => {
    const value = JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>;

    expect(() => canonicalJson(value)).toThrow(/__proto__/u);
    try {
      canonicalJson(value);
      expect.unreachable('trebalo je baciti');
    } catch (error) {
      expect((error as CanonicalizationError).path).toBe('$.__proto__');
    }
  });

  it('contentHash je stabilan SHA-256 hex (64 znaka) i mijenja se s sadržajem', () => {
    const a = contentHash({ meta: { title: 'A' } });
    const b = contentHash({ meta: { title: 'A' } });
    const c = contentHash({ meta: { title: 'B' } });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('contentHash ne zavisi od redoslijeda ključeva', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(contentHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('definicija s istim poljem u drugom redoslijedu ključeva daje isti hash', () => {
    const first = { $schema: 'vfm-form/1', meta: { title: 'X', subject: 'TASK' } };
    const second = { meta: { subject: 'TASK', title: 'X' }, $schema: 'vfm-form/1' };

    expect(contentHash(first)).toBe(contentHash(second));
  });

  it('definitionETag je jak ETag u navodnicima', () => {
    const etag = definitionETag({ a: 1 });

    expect(etag).toBe(`"${contentHash({ a: 1 })}"`);
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
  });

  it('sameCanonicalJson ignoriše redoslijed ključeva, ali ne i razlike u vrijednostima', () => {
    expect(sameCanonicalJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameCanonicalJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameCanonicalJson([1, 2], [2, 1])).toBe(false);
  });

  it('greška nosi putanju do problematičnog čvora', () => {
    try {
      canonicalJson({ sections: [{ fields: [{ key: () => 'x' }] }] });
      expect.unreachable('trebalo je baciti');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).path).toBe('$.sections[0].fields[0].key');
    }
  });
});
