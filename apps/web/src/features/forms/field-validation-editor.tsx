import { ALLOWED_VALIDATION_KEYS, REFERENCE_ENTITY_TYPES } from '@vfm/form-engine/field-types';
import type { FieldDefinition } from '@vfm/form-engine/definition';
import { Field, inputClassName } from '../../components/ui/index.js';
import { CommaSeparatedInput } from './comma-separated-input.js';
import { parseMimeTypes } from './comma-separated.js';

const BOOLEAN_RULES = new Set([
  'trim',
  'notInFuture',
  'notInPast',
  'requiredTrue',
  'unique',
  'filterStatus',
  'filterActive',
]);
const ARRAY_RULES = new Set(['allowedCurrencies', 'mimeTypes', 'allowedExtensions']);
const LABELS: Readonly<Record<string, string>> = {
  min: 'Minimalna vrijednost',
  max: 'Maksimalna vrijednost',
  step: 'Korak',
  precision: 'Broj decimala',
  minLength: 'Minimalan broj znakova',
  maxLength: 'Maksimalan broj znakova',
  pattern: 'Obrazac (regex)',
  trim: 'Ukloniti razmake s rubova',
  rows: 'Broj redova',
  minDate: 'Najraniji datum',
  maxDate: 'Najkasniji datum',
  notInFuture: 'Ne dozvoli budući datum',
  notInPast: 'Ne dozvoli prošli datum',
  granularity: 'Preciznost vremena',
  requiredTrue: 'Mora biti potvrđeno',
  minSelect: 'Minimalan broj izbora',
  maxSelect: 'Maksimalan broj izbora',
  unique: 'Izbori moraju biti jedinstveni',
  currency: 'Valuta',
  allowedCurrencies: 'Dozvoljene valute (zarezom)',
  minFiles: 'Minimalan broj fajlova',
  maxFiles: 'Maksimalan broj fajlova',
  maxSizeMb: 'Maksimalna veličina (MB)',
  mimeTypes: 'Dozvoljeni MIME tipovi (zarezom)',
  requireStage: 'Faza obaveznog priloga',
  allowedExtensions: 'Dozvoljene ekstenzije (zarezom)',
  filterStatus: 'Filtrirati aktivne zapise',
  filterActive: 'Samo aktivni vozači',
  piiScope: 'PII scope',
  entityType: 'Vrsta povezanog zapisa',
};

export function FieldValidationEditor({
  field,
  onChange,
}: {
  field: FieldDefinition;
  onChange: (field: FieldDefinition) => void;
}) {
  const keys = ALLOWED_VALIDATION_KEYS[field.type];
  if (keys.length === 0) return null;
  const update = (key: string, value: unknown) => {
    const validation = { ...field.validation } as Record<string, unknown>;
    if (value === undefined || value === '') delete validation[key];
    else validation[key] = value;
    onChange({ ...field, validation: validation as FieldDefinition['validation'] });
  };

  return (
    <section className="mt-5 space-y-3 rounded-lg border border-border p-4">
      <h3 className="font-semibold">Validacija i ograničenja</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {keys.map((key) => {
          const value = field.validation?.[key];
          const label = LABELS[key] ?? key;
          const id = `validation-${field.key}-${key}`;
          if (key === 'entityType') {
            return (
              <Field key={key} label={label} htmlFor={id}>
                <select
                  id={id}
                  className={inputClassName}
                  value={String(value ?? 'VEHICLE')}
                  onChange={(event) => update(key, event.target.value)}
                >
                  {REFERENCE_ENTITY_TYPES.map((entity) => (
                    <option key={entity} value={entity}>
                      {entity}
                    </option>
                  ))}
                </select>
              </Field>
            );
          }
          if (BOOLEAN_RULES.has(key)) {
            return (
              <label key={key} htmlFor={id} className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  className="vfm-checkbox"
                  checked={value === true}
                  onChange={(event) => update(key, event.target.checked)}
                />
                {label}
              </label>
            );
          }
          if (ARRAY_RULES.has(key)) {
            return (
              <Field
                key={key}
                label={label}
                htmlFor={id}
                hint={
                  key === 'mimeTypes'
                    ? 'Npr. image/jpeg, image/png ili JPG, PNG, GIF.'
                    : 'Vrijednosti odvojiti zarezom.'
                }
              >
                <CommaSeparatedInput
                  id={id}
                  value={value}
                  parse={key === 'mimeTypes' ? parseMimeTypes : undefined}
                  onChange={(items) => update(key, items.length > 0 ? items : undefined)}
                />
              </Field>
            );
          }
          const numeric = [
            'min',
            'max',
            'step',
            'precision',
            'rows',
            'minSelect',
            'maxSelect',
            'minFiles',
            'maxFiles',
            'maxSizeMb',
          ].includes(key);
          return (
            <Field
              key={key}
              label={label}
              htmlFor={id}
              hint={key === 'pattern' ? 'Regex se provjerava sigurnom whitelist validacijom.' : undefined}
            >
              <input
                id={id}
                className={inputClassName}
                type={numeric ? 'number' : key.endsWith('Date') ? 'date' : 'text'}
                value={value === undefined ? '' : String(value)}
                onChange={(event) =>
                  update(
                    key,
                    numeric
                      ? event.target.value === ''
                        ? undefined
                        : Number(event.target.value)
                      : event.target.value,
                  )
                }
              />
            </Field>
          );
        })}
      </div>
    </section>
  );
}
