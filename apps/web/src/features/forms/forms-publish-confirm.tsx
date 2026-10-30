import { Field, inputClassName } from '../../components/ui/index.js';

interface FormsPublishFieldsProps {
  readonly changeNote: string;
  readonly onChangeNote: (value: string) => void;
  readonly showNormalizedRemovalConfirm: boolean;
  readonly confirmNormalizedRemoval: boolean;
  readonly onConfirmNormalizedRemoval: (value: boolean) => void;
}

export function FormsPublishFields({
  changeNote,
  onChangeNote,
  showNormalizedRemovalConfirm,
  confirmNormalizedRemoval,
  onConfirmNormalizedRemoval,
}: FormsPublishFieldsProps) {
  return (
    <div className="space-y-3">
      <Field
        label="Bilješka o promjeni (obavezna, najmanje 5 znakova)"
        htmlFor="change-note"
        hint="Upisuje se uz objavu/povlačenje i vidljiva je u historiji verzija."
      >
        <input
          id="change-note"
          className={inputClassName}
          value={changeNote}
          maxLength={500}
          onChange={(event) => onChangeNote(event.target.value)}
        />
      </Field>
      {showNormalizedRemovalConfirm ? (
        <label className="flex items-start gap-2 text-sm" htmlFor="confirm-normalized-removal">
          <input
            id="confirm-normalized-removal"
            type="checkbox"
            className="vfm-checkbox mt-0.5"
            checked={confirmNormalizedRemoval}
            onChange={(event) => onConfirmNormalizedRemoval(event.target.checked)}
          />
          <span>
            Potvrđujem uklanjanje mapiranih polja.
            <span className="mt-0.5 block text-xs text-fg-muted">
              Novi zapisi više neće puniti te kolone (npr. cijena u totalCost). Stari zapisi ostaju na staroj
              verziji forme.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
