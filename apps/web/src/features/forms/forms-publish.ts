import { checkPublishable } from '@vfm/form-engine';
import { parseDefinition } from '@vfm/form-engine/definition';
import type { FormDefinition } from '@vfm/form-engine/definition';
import type { PublishFormVersionInput } from '@vfm/shared/schemas';
import { ApiError } from '../../lib/api.js';

const DUMMY_NOTE = 'potvrda-uklanjanja';

export function needsNormalizedRemovalConfirm(
  previous: unknown,
  definition: FormDefinition | null | undefined,
): boolean {
  if (!previous || !definition) return false;
  const parsedPrevious = parseDefinition(previous);
  if (!parsedPrevious.ok) return false;
  return checkPublishable({
    definition,
    changeNote: DUMMY_NOTE,
    previousPublished: parsedPrevious.definition,
  }).issues.some((issue) => issue.code === 'NORMALIZED_FIELD_REMOVED');
}

export function isNormalizedRemovalError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';
  if (message.includes('NORMALIZED_FIELD_REMOVED')) return true;
  if (!(error instanceof ApiError)) return false;
  return (
    error.details?.some(
      (detail) =>
        detail.code === 'NORMALIZED_FIELD_REMOVED' || detail.message.includes('NORMALIZED_FIELD_REMOVED'),
    ) === true
  );
}

export function buildPublishInput(input: {
  readonly changeNote: string;
  readonly confirmNormalizedRemoval: boolean;
}): PublishFormVersionInput {
  if (!input.confirmNormalizedRemoval) return { changeNote: input.changeNote };
  return { changeNote: input.changeNote, confirmNormalizedRemoval: true };
}
