import { describe, expect, it } from 'vitest';
import { parseCommaSeparated, parseMimeTypes } from './comma-separated.js';

describe('parseCommaSeparated', () => {
  it('čuva prazan unos iza zareza van niza, ali ne gubi prethodne stavke', () => {
    expect(parseCommaSeparated('JPG,')).toEqual(['JPG']);
    expect(parseCommaSeparated('JPG, PNG, JPEG, GIF')).toEqual(['JPG', 'PNG', 'JPEG', 'GIF']);
  });
});

describe('parseMimeTypes', () => {
  it('pretvara JPG/PNG/JPEG/GIF u MIME tipove bez duplikata', () => {
    expect(parseMimeTypes('JPG, PNG, JPEG, GIF')).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
    ]);
  });
});
