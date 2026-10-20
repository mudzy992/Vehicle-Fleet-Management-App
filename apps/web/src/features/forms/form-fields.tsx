/**
 * Dinamička polja forme — render model → DOM kontrole (W07/W11, docs/04 §11).
 *
 * Izdvojeno iz pregleda u Builder-u da **isti** kod koriste i stvarni unosi
 * (vozilo, vozač, registracija, osiguranje) i pregled. Nijedno poslovno pravilo
 * ne živi ovdje: vidljivost, obaveznost, opcije i izračunata polja dolaze iz
 * `buildRenderModel` (`@vfm/form-renderer`), a server ponovo validira (P11).
 *
 * `CoreFields` je izuzetak koji to potvrđuje: identitet zapisa (`internalNo`,
 * `make`, `model`, `fuelType`…) **nije** dio dinamičke forme (docs/04 §7), pa se
 * unosi kroz statične kontrole i šalje kao strukturirani dio API-ja.
 */
import type { FormDefinition } from '@vfm/form-engine';
import type { RenderField, RenderModel } from '@vfm/form-renderer';
import { formatFieldValue } from '@vfm/form-renderer';
import { Badge, Field, inputClassName } from '../../components/ui/index.js';
import { inputValue, moneyInputValue, parseInputValue, toggleMulti } from './forms-preview-values.js';

/** Opis strukturiranog polja koje ne dolazi iz forme. */
export interface CoreFieldSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: 'TEXT' | 'INTEGER' | 'SELECT' | 'DATE' | 'MULTILINE';
  readonly required?: boolean;
  readonly hint?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

export interface CoreFieldsProps {
  readonly fields: readonly CoreFieldSpec[];
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (key: string, value: string) => void;
  readonly disabled?: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly idPrefix?: string;
}

/** Strukturirani dio zapisa (obavezne kolone tabele). */
export function CoreFields({
  fields,
  values,
  onChange,
  disabled = false,
  errors = {},
  idPrefix = 'core',
}: CoreFieldsProps) {
  if (fields.length === 0) return null;

  return (
    <section className="space-y-3 rounded-md border border-[var(--border)] p-3">
      <header>
        <h3 className="text-sm font-medium">Osnovni podaci</h3>
        <p className="text-xs text-[var(--fg-muted)]">
          Ovi podaci su strukturirane kolone (ne dio dinamičke forme).
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `${idPrefix}-${field.key}`;
          const common = {
            id,
            disabled,
            className: inputClassName,
            value: values[field.key] ?? '',
            'aria-invalid': errors[field.key] ? true : undefined,
          } as const;

          return (
            <Field
              key={field.key}
              label={`${field.label}${field.required ? ' *' : ''}`}
              htmlFor={id}
              hint={field.hint}
              error={errors[field.key] ?? null}
            >
              {field.kind === 'SELECT' ? (
                <select {...common} onChange={(event) => onChange(field.key, event.target.value)}>
                  <option value="">—</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.kind === 'MULTILINE' ? (
                <textarea
                  {...common}
                  className={`${inputClassName} h-24`}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              ) : (
                <input
                  {...common}
                  inputMode={field.kind === 'INTEGER' ? 'numeric' : undefined}
                  type={field.kind === 'DATE' ? 'date' : 'text'}
                  onChange={(event) =>
                    onChange(
                      field.key,
                      field.kind === 'INTEGER'
                        ? event.target.value.replace(/[^0-9]/gu, '')
                        : event.target.value,
                    )
                  }
                />
              )}
            </Field>
          );
        })}
      </div>
    </section>
  );
}

export interface FormFieldsProps {
  readonly model: RenderModel;
  readonly onChange: (key: string, value: unknown) => void;
  readonly idPrefix?: string;
  /** Serverske greške po `fieldKey` (npr. iz `FORM_VALIDATION_FAILED`). */
  readonly errors?: Readonly<Record<string, string>>;
  /**
   * Ključevi koje ekran unosi statično (`CoreFields`) — ne prikazuju se ponovo,
   * da korisnik ne vidi dva polja za istu vrijednost.
   */
  readonly hiddenKeys?: readonly string[];
}

/** Vidljive sekcije render modela. */
export function FormFields({
  model,
  onChange,
  idPrefix = 'form',
  errors = {},
  hiddenKeys = [],
}: FormFieldsProps) {
  const hidden = new Set(hiddenKeys);
  const sections = model.sections
    .filter((section) => section.visible)
    .map((section) => ({ ...section, fields: section.fields.filter((field) => !hidden.has(field.key)) }))
    .filter((section) => section.fields.length > 0);

  return (
    <>
      {sections.map((section) => (
        <section key={section.key} className="space-y-3 rounded-md border border-[var(--border)] p-3">
          <header className="space-y-0.5">
            <h3 className="text-sm font-medium">{section.title}</h3>
            {section.description ? (
              <p className="text-xs text-[var(--fg-muted)]">{section.description}</p>
            ) : null}
          </header>

          {section.fields.map((field) => (
            <Field
              key={field.key}
              label={`${field.label}${field.required ? ' *' : ''}`}
              htmlFor={`${idPrefix}-${field.key}`}
              hint={field.helpText ?? undefined}
              error={field.errors[0]?.message ?? errors[field.key] ?? null}
            >
              {renderControl(field, `${idPrefix}-${field.key}`, (value) => onChange(field.key, value))}
            </Field>
          ))}
        </section>
      ))}
    </>
  );
}

/** Definicija → opis polja za `CoreFields` nije potrebna; ovo je samo tip-guard. */
export function hasVisibleFields(definition: FormDefinition): boolean {
  return (definition.sections ?? []).some((section) => (section.fields ?? []).length > 0);
}

function renderControl(field: RenderField, id: string, onChange: (value: unknown) => void) {
  const disabled = field.disabled || field.readOnly;

  switch (field.widget) {
    case 'BOOLEAN':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={field.value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>Da</span>
        </label>
      );

    case 'SELECT':
      if (!field.options) {
        return <p className="text-xs text-[var(--fg-muted)]">Opcije se učitavaju na serveru (LIST/QUERY).</p>;
      }
      return (
        <select
          id={id}
          className={inputClassName}
          value={inputValue(field.value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'MULTI_SELECT':
      if (!field.options) {
        return <p className="text-xs text-[var(--fg-muted)]">Opcije se učitavaju na serveru (LIST/QUERY).</p>;
      }
      return (
        <div className="space-y-1">
          {field.options.map((option) => {
            const checked = Array.isArray(field.value) && field.value.includes(option.value);
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(toggleMulti(field.value, option.value))}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      );

    case 'OUTPUT':
      return (
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-sm">
          {formatFieldValue(field)}
        </p>
      );

    case 'PHOTO':
    case 'FILE':
      return (
        <p className="rounded-md border border-dashed border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)]">
          {field.widget === 'PHOTO' ? 'Fotografije' : 'Prilozi'} se dodaju uz zapis (kamera/upload).
        </p>
      );

    case 'REFERENCE':
      return (
        <p className="rounded-md border border-dashed border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)]">
          Odabir zapisa ({field.type}) — puni se iz šifarnika.
        </p>
      );

    case 'MONEY':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            step="0.01"
            className={inputClassName}
            value={moneyInputValue(field.value)}
            disabled={disabled}
            placeholder={field.placeholder ?? undefined}
            onChange={(event) => onChange(parseInputValue('MONEY', event.target.value))}
          />
          <span className="text-xs text-[var(--fg-muted)]">KM</span>
        </div>
      );

    case 'NUMBER':
      return (
        <input
          id={id}
          type="number"
          className={inputClassName}
          value={inputValue(field.value)}
          disabled={disabled}
          placeholder={field.placeholder ?? undefined}
          step={typeof field.validation.step === 'number' ? field.validation.step : 'any'}
          min={typeof field.validation.min === 'number' ? field.validation.min : undefined}
          max={typeof field.validation.max === 'number' ? field.validation.max : undefined}
          onChange={(event) => onChange(parseInputValue('NUMBER', event.target.value))}
        />
      );

    case 'DATE':
    case 'DATETIME':
      return (
        <input
          id={id}
          type={field.widget === 'DATE' ? 'date' : 'datetime-local'}
          className={inputClassName}
          value={inputValue(field.value)}
          disabled={disabled}
          onChange={(event) => onChange(parseInputValue(field.widget, event.target.value))}
        />
      );

    case 'TEXTAREA':
      return (
        <textarea
          id={id}
          className={`${inputClassName} h-24`}
          value={inputValue(field.value)}
          disabled={disabled}
          placeholder={field.placeholder ?? undefined}
          onChange={(event) => onChange(parseInputValue('TEXTAREA', event.target.value))}
        />
      );

    case 'CURRENCY':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            className={inputClassName}
            value={inputValue(field.value)}
            disabled={disabled}
            maxLength={3}
            placeholder={field.placeholder ?? 'BAM'}
            onChange={(event) => onChange(event.target.value.trim().toUpperCase())}
          />
          {field.value ? <Badge level="neutral">{String(field.value)}</Badge> : null}
        </div>
      );

    case 'GROUP':
      return null;

    case 'TEXT':
    default:
      return (
        <input
          id={id}
          className={inputClassName}
          value={inputValue(field.value)}
          disabled={disabled}
          placeholder={field.placeholder ?? undefined}
          onChange={(event) => onChange(parseInputValue('TEXT', event.target.value))}
        />
      );
  }
}
