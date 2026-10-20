/**
 * Pregled forme u Builder-u (W21; docs/06 §7.7, docs/04 §11).
 *
 * Pregled koristi **isti** `buildRenderModel` iz `@vfm/form-renderer` koji će
 * koristiti i zapis (Faza 3) i mobilna aplikacija — Builder tako pokazuje tačno
 * ono što će korisnik vidjeti, uključujući uslove vidljivosti, izračunata polja
 * i progres. Ovdje se samo `widget` mapira na DOM kontrolu; nikakva poslovna
 * logika ne živi u komponenti.
 */
import { useMemo, useState } from 'react';
import type { FormDefinition } from '@vfm/form-engine';
import type { RenderField, RenderModel } from '@vfm/form-renderer';
import { buildRenderModel, formatFieldValue } from '@vfm/form-renderer';
import { Badge, EmptyState, Field, inputClassName } from '../../components/ui/index.js';
import {
  inputValue,
  moneyInputValue,
  parseInputValue,
  sarajevoToday,
  toggleMulti,
} from './forms-preview-values.js';

export interface FormsPreviewProps {
  readonly definition: FormDefinition;
  readonly version?: number | null;
  readonly formSchemaVersionId?: string | null;
}

export function FormsPreview({ definition, version, formSchemaVersionId }: FormsPreviewProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const today = useMemo(() => sarajevoToday(), []);

  const model = useMemo<RenderModel>(
    () => buildRenderModel({ definition, values, today, version, formSchemaVersionId }),
    [definition, values, today, version, formSchemaVersionId],
  );

  const setValue = (key: string, value: unknown): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const visibleSections = model.sections.filter((section) => section.visible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-muted)]">
        <span>
          Pregled: <strong className="text-[var(--fg)]">{model.title}</strong>
          {model.version ? ` · v${model.version}` : ''}
        </span>
        <span>
          Popunjeno {model.progress.filledRequired}/{model.progress.requiredFields} obaveznih ·{' '}
          {model.progress.percent}%
        </span>
      </div>

      {visibleSections.length === 0 ? (
        <EmptyState title="Nema vidljivih sekcija" description="Provjeri `layout.sections` u definiciji." />
      ) : null}

      {visibleSections.map((section) => (
        <section key={section.key} className="space-y-3 rounded-md border border-[var(--border)] p-3">
          <header className="space-y-0.5">
            <h3 className="text-sm font-medium">{section.title}</h3>
            {section.description ? (
              <p className="text-xs text-[var(--fg-muted)]">{section.description}</p>
            ) : null}
          </header>

          {section.fields.map((field) => (
            <PreviewField key={field.key} field={field} onChange={(value) => setValue(field.key, value)} />
          ))}
        </section>
      ))}

      {Object.keys(model.computed).length > 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-3">
          <p className="mb-1 text-xs font-medium">Izračunato</p>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            {Object.entries(model.computed).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">{key}</dt>
                <dd className="font-mono">
                  {typeof value === 'number' ? String(value) : String(value ?? '—')}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function PreviewField({
  field,
  onChange,
}: {
  readonly field: RenderField;
  readonly onChange: (value: unknown) => void;
}) {
  const id = `preview-${field.key}`;
  const label = `${field.label}${field.required ? ' *' : ''}`;

  return (
    <Field label={label} htmlFor={id} hint={field.helpText ?? undefined} error={field.errors[0]?.message}>
      {renderControl(field, id, onChange)}
    </Field>
  );
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
