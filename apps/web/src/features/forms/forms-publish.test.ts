import { describe, expect, it } from 'vitest';
import { parseDefinition } from '@vfm/form-engine/definition';
import type { FormDefinition } from '@vfm/form-engine/definition';
import { ApiError } from '../../lib/api.js';
import {
  buildPublishInput,
  isNormalizedRemovalError,
  needsNormalizedRemovalConfirm,
} from './forms-publish.js';

function definition(keys: readonly string[], mappedKey?: string): FormDefinition {
  const parsed = parseDefinition({
    $schema: 'vfm-form/1',
    meta: { title: 'Pranje', subject: 'TASK', language: 'bs' },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovno',
        order: 1,
        visibleWhen: null,
        fields: keys.map((key, index) => ({
          key,
          type: key === 'washCost' ? 'MONEY' : 'PHOTO',
          label: key,
          order: index + 1,
          required: false,
          visibleWhen: null,
          disabled: false,
          visibleOnForm: true,
          storeInFormData: true,
        })),
      },
    ],
    normalizedName: mappedKey
      ? [{ fieldKey: mappedKey, column: 'totalCost', transform: 'MONEY_TO_FENINZI' }]
      : [],
  });
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
  return parsed.definition;
}

describe('forms-publish', () => {
  it('traži potvrdu kad nestane mapiranje washCost → totalCost', () => {
    const previous = definition(['washCost', 'foto'], 'washCost');
    const next = definition(['foto']);
    expect(needsNormalizedRemovalConfirm(previous, next)).toBe(true);
    expect(needsNormalizedRemovalConfirm(previous, previous)).toBe(false);
    expect(needsNormalizedRemovalConfirm(null, next)).toBe(false);
  });

  it('šalje confirmNormalizedRemoval samo kad je potvrđeno', () => {
    expect(buildPublishInput({ changeNote: 'Samo fotografija', confirmNormalizedRemoval: false })).toEqual({
      changeNote: 'Samo fotografija',
    });
    expect(buildPublishInput({ changeNote: 'Samo fotografija', confirmNormalizedRemoval: true })).toEqual({
      changeNote: 'Samo fotografija',
      confirmNormalizedRemoval: true,
    });
  });

  it('prepoznaje NORMALIZED_FIELD_REMOVED iz API greške', () => {
    expect(
      isNormalizedRemovalError(
        new ApiError('FORM_VALIDATION_FAILED', 'Verzija 7 se ne može objaviti', 422, [
          {
            path: ['$.normalizedName[0]'],
            message: 'NORMALIZED_FIELD_REMOVED: Polje "washCost" je bilo mapirano na kolonu "totalCost".',
          },
        ]),
      ),
    ).toBe(true);
    expect(isNormalizedRemovalError(new ApiError('VALIDATION_ERROR', 'Bilješka je obavezna', 400))).toBe(
      false,
    );
  });
});
