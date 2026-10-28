/**
 * Pregled forme u Builder-u (W21; docs/06 §7.7, docs/04 §11).
 *
 * Pregled koristi **isti** `buildRenderModel` iz `@vfm/form-renderer` i **iste**
 * kontrole (`FormFields`) koje koristi stvarni unos — Builder tako pokazuje
 * tačno ono što će korisnik vidjeti, uključujući uslove vidljivosti, izračunata
 * polja i progres. Nikakva poslovna logika ne živi u komponenti.
 */
import { useMemo, useState } from 'react';
import type { FormDefinition } from '@vfm/form-engine/definition';
import type { RenderModel } from '@vfm/form-renderer';
import { buildRenderModel } from '@vfm/form-renderer';
import { EmptyState } from '../../components/ui/index.js';
import { FormFields } from './form-fields.js';
import { sarajevoToday } from './forms-preview-values.js';

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

      <FormFields
        model={model}
        idPrefix="preview"
        onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
      />

      {Object.keys(model.computed).length > 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-3">
          <p className="mb-1 text-xs font-medium">Izračunato</p>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            {Object.entries(model.computed).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">{key}</dt>
                <dd className="font-mono">{String(value ?? '—')}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
