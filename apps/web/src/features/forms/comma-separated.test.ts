import { describe, expect, it } from 'vitest';
import { parseCommaSeparated } from './comma-separated.js';

describe('parseCommaSeparated', () => {
  it('čuva prazan unos iza zareza van niza, ali ne gubi prethodne stavke', () => {
    expect(parseCommaSeparated('BAM,')).toEqual(['BAM']);
    expect(parseCommaSeparated('BAM, EUR')).toEqual(['BAM', 'EUR']);
  });
});
