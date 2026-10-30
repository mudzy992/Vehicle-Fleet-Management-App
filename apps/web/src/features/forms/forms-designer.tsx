import { useMemo, useState } from 'react';
import { ALLOWED_OPTION_QUERY_IDS, FIELD_TYPES } from '@vfm/form-engine/field-types';
import type { AllowedOptionQueryId } from '@vfm/form-engine/field-types';
import type { FieldDefinition, FormDefinition, SectionDefinition } from '@vfm/form-engine/definition';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Field,
  Modal,
  inputClassName,
} from '../../components/ui/index.js';
import { FieldValidationEditor } from './field-validation-editor.js';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  TEXT: 'Kratki tekst',
  TEXTAREA: 'Dugi tekst',
  INTEGER: 'Cijeli broj',
  DECIMAL: 'Decimalni broj',
  DATE: 'Datum',
  DATETIME: 'Datum i vrijeme',
  BOOLEAN: 'Da/ne',
  SINGLE_CHOICE: 'Jedan izbor',
  MULTI_CHOICE: 'Više izbora',
  DROPDOWN: 'Padajuća lista',
  MONEY: 'Novac',
  CURRENCY: 'Valuta',
  PHOTO: 'Fotografija',
  FILE: 'Datoteka',
  REFERENCE_VEHICLE: 'Vozilo',
  REFERENCE_DRIVER: 'Vozač',
  REFERENCE_RECORD: 'Povezani zapis',
  COMPUTED: 'Izračunato polje',
};
const FIELDS = FIELD_TYPES.filter((type) => type !== 'SECTION');
const OPERATORS = [
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
  'BETWEEN',
] as const;
const NORMALIZATION_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  TASK: [
    'odometerKm',
    'totalCost',
    'fuelLiters',
    'fuelAmount',
    'dueDate',
    'dueAt',
    'priority',
    'title',
    'description',
  ],
  VEHICLE: [
    'odometerKm',
    'status',
    'plateNumber',
    'registrationExpiresAt',
    'insuranceExpiresAt',
    'nextServiceDueDate',
    'nextServiceDueKm',
  ],
  SERVICE: [
    'serviceDate',
    'odometerKm',
    'totalCost',
    'nextServiceDueDate',
    'nextServiceDueKm',
    'workshopName',
  ],
  REGISTRATION: ['validFrom', 'validUntil', 'costAmount', 'registrationNumber'],
  INSURANCE: ['validFrom', 'validUntil', 'costAmount', 'policyNumber', 'insuranceCompany'],
  TIRE_INSTALLATION: [
    'mountedAt',
    'mountedOdometerKm',
    'dismountedAt',
    'dismountedOdometerKm',
    'kmDriven',
    'daysInUse',
  ],
};
const TRANSFORMS = [
  'TO_INT',
  'TO_DECIMAL',
  'TO_DATE',
  'TO_DATETIME',
  'TO_BOOL',
  'TO_TEXT',
  'MONEY_TO_FENINZI',
  'FENINZI_TO_MONEY',
] as const;

type Props = {
  definition: FormDefinition;
  readOnly: boolean;
  onChange: (definition: FormDefinition) => void;
};

function keyFromLabel(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase();
  return /^[a-z]/u.test(normalized) ? normalized.slice(0, 49) : `polje_${normalized}`.slice(0, 49);
}

function makeField(type: string, order: number, label = 'Novo polje'): FieldDefinition {
  const key = keyFromLabel(label) || `polje_${order}`;
  const field: FieldDefinition = {
    key,
    type: type as FieldDefinition['type'],
    label,
    order,
    required: false,
    visibleWhen: null,
    disabled: false,
    visibleOnForm: true,
    storeInFormData: type !== 'COMPUTED',
  };
  if (['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(type)) {
    field.optionsSource = { kind: 'STATIC', items: [{ value: 'opcija_1', label: 'Opcija 1', sortOrder: 0 }] };
  }
  if (type === 'COMPUTED') field.computed = { expression: '1', resultType: 'INTEGER' };
  if (type === 'REFERENCE_RECORD') field.validation = { entityType: 'VEHICLE' };
  return field;
}

export function FormsDesigner({ definition, readOnly, onChange }: Props) {
  const [editing, setEditing] = useState<{ sectionIndex: number; fieldIndex: number | null } | null>(null);
  const allFields = useMemo(
    () => definition.sections.flatMap((section) => section.fields),
    [definition.sections],
  );

  const update = (recipe: (current: FormDefinition) => FormDefinition) => onChange(recipe(definition));
  const updateSection = (index: number, patch: Partial<SectionDefinition>) =>
    update((current) => ({
      ...current,
      sections: current.sections.map((section, itemIndex) =>
        itemIndex === index ? { ...section, ...patch } : section,
      ),
    }));
  const addSection = () => {
    const index = definition.sections.length + 1;
    const section: SectionDefinition = {
      key: `sekcija_${index}`,
      title: `Nova sekcija ${index}`,
      description: null,
      order: index,
      visibleWhen: null,
      fields: [makeField('TEXT', 1, `Novo polje ${allFields.length + 1}`)],
    };
    update((current) => ({ ...current, sections: [...current.sections, section] }));
  };
  const deleteSection = (index: number) =>
    update((current) => {
      const removedKeys = new Set(current.sections[index]?.fields.map((field) => field.key) ?? []);
      return {
        ...current,
        sections: current.sections
          .filter((_section, itemIndex) => itemIndex !== index)
          .map((section, order) => ({ ...section, order: order + 1 })),
        normalizedName: current.normalizedName?.filter((mapping) => !removedKeys.has(mapping.fieldKey)),
      };
    });
  const moveSection = (index: number, direction: -1 | 1) =>
    update((current) => {
      const sections = [...current.sections];
      const next = index + direction;
      if (next < 0 || next >= sections.length) return current;
      [sections[index], sections[next]] = [sections[next]!, sections[index]!];
      return { ...current, sections: sections.map((section, order) => ({ ...section, order: order + 1 })) };
    });
  const saveField = (sectionIndex: number, fieldIndex: number | null, field: FieldDefinition) => {
    update((current) => ({
      ...current,
      sections: current.sections.map((section, index) => {
        if (index !== sectionIndex) return section;
        const fields =
          fieldIndex === null
            ? [...section.fields, { ...field, order: section.fields.length + 1 }]
            : section.fields.map((item, i) => (i === fieldIndex ? { ...field, order: i + 1 } : item));
        return { ...section, fields };
      }),
    }));
    setEditing(null);
  };
  const moveField = (sectionIndex: number, fieldIndex: number, direction: -1 | 1) =>
    update((current) => ({
      ...current,
      sections: current.sections.map((section, index) => {
        if (index !== sectionIndex) return section;
        const fields = [...section.fields];
        const next = fieldIndex + direction;
        if (next < 0 || next >= fields.length) return section;
        [fields[fieldIndex], fields[next]] = [fields[next]!, fields[fieldIndex]!];
        return { ...section, fields: fields.map((field, order) => ({ ...field, order: order + 1 })) };
      }),
    }));
  const deleteField = (sectionIndex: number, fieldIndex: number) =>
    update((current) => ({
      ...current,
      sections: current.sections.map((section, index) =>
        index !== sectionIndex
          ? section
          : {
              ...section,
              fields: section.fields
                .filter((_field, i) => i !== fieldIndex)
                .map((field, order) => ({ ...field, order: order + 1 })),
            },
      ),
      normalizedName: current.normalizedName?.filter(
        (mapping) => mapping.fieldKey !== current.sections[sectionIndex]?.fields[fieldIndex]?.key,
      ),
    }));

  return (
    <div className="space-y-4" data-testid="forms-designer">
      <Card>
        <CardHeader
          title="Postavke forme"
          description="Uredite naslov i raspored; ključ forme i predmet ostaju vezani za katalog."
        />
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Naslov" htmlFor="designer-title">
            <input
              id="designer-title"
              className={inputClassName}
              value={definition.meta.title}
              disabled={readOnly}
              onChange={(event) =>
                update((current) => ({ ...current, meta: { ...current.meta, title: event.target.value } }))
              }
            />
          </Field>
          <Field label="Opis" htmlFor="designer-description">
            <input
              id="designer-description"
              className={inputClassName}
              value={definition.meta.description ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  meta: { ...current.meta, description: event.target.value || null },
                }))
              }
            />
          </Field>
          <Field label="Trajanje u minutama" htmlFor="designer-duration">
            <input
              id="designer-duration"
              type="number"
              min={1}
              max={600}
              className={inputClassName}
              value={definition.meta.estimatedMinutes ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  meta: {
                    ...current.meta,
                    estimatedMinutes: event.target.value ? Number(event.target.value) : undefined,
                  },
                }))
              }
            />
          </Field>
          <Field label="Broj kolona na webu" htmlFor="designer-columns">
            <select
              id="designer-columns"
              className={inputClassName}
              value={definition.layout?.columns ?? 1}
              disabled={readOnly}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  layout: {
                    columns: Number(event.target.value) as 1 | 2,
                    sectionsCollapsible: current.layout?.sectionsCollapsible ?? true,
                    stickySubmit: current.layout?.stickySubmit ?? true,
                  },
                }))
              }
            >
              <option value={1}>Jedna kolona</option>
              <option value={2}>Dvije kolone</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="vfm-checkbox"
              checked={definition.layout?.sectionsCollapsible ?? true}
              disabled={readOnly}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  layout: {
                    columns: current.layout?.columns ?? 1,
                    sectionsCollapsible: event.target.checked,
                    stickySubmit: current.layout?.stickySubmit ?? true,
                  },
                }))
              }
            />{' '}
            Sekcije mogu biti sklopive
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="vfm-checkbox"
              checked={definition.layout?.stickySubmit ?? true}
              disabled={readOnly}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  layout: {
                    columns: current.layout?.columns ?? 1,
                    sectionsCollapsible: current.layout?.sectionsCollapsible ?? true,
                    stickySubmit: event.target.checked,
                  },
                }))
              }
            />{' '}
            Dugme za slanje ostaje vidljivo
          </label>
        </CardContent>
      </Card>

      {definition.sections.map((section, sectionIndex) => (
        <Card key={`${section.key}-${sectionIndex}`} className="space-y-4">
          <CardHeader
            title={`Sekcija ${sectionIndex + 1}`}
            description={`${section.fields.length} polja`}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={readOnly || sectionIndex === 0}
                  aria-label={`Pomjeri sekciju ${sectionIndex + 1} gore`}
                  onClick={() => moveSection(sectionIndex, -1)}
                >
                  Gore
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={readOnly || sectionIndex === definition.sections.length - 1}
                  aria-label={`Pomjeri sekciju ${sectionIndex + 1} dolje`}
                  onClick={() => moveSection(sectionIndex, 1)}
                >
                  Dolje
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={readOnly || definition.sections.length <= 1}
                  onClick={() => deleteSection(sectionIndex)}
                >
                  Ukloni
                </Button>
              </div>
            }
          />
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Naziv sekcije" htmlFor={`section-title-${sectionIndex}`}>
                <input
                  id={`section-title-${sectionIndex}`}
                  className={inputClassName}
                  value={section.title}
                  disabled={readOnly}
                  onChange={(event) => updateSection(sectionIndex, { title: event.target.value })}
                />
              </Field>
              <Field label="Opis sekcije" htmlFor={`section-description-${sectionIndex}`}>
                <input
                  id={`section-description-${sectionIndex}`}
                  className={inputClassName}
                  value={section.description ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateSection(sectionIndex, { description: event.target.value || null })
                  }
                />
              </Field>
            </div>
            <div className="space-y-2">
              {section.fields.map((field, fieldIndex) => (
                <div
                  key={field.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {field.label}
                      {field.required ? ' · obavezno' : ''}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {FIELD_LABELS[field.type] ?? field.type} · {field.key}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={readOnly || fieldIndex === 0}
                      aria-label={`Pomjeri ${field.label} gore`}
                      onClick={() => moveField(sectionIndex, fieldIndex, -1)}
                    >
                      Gore
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={readOnly || fieldIndex === section.fields.length - 1}
                      aria-label={`Pomjeri ${field.label} dolje`}
                      onClick={() => moveField(sectionIndex, fieldIndex, 1)}
                    >
                      Dolje
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={readOnly}
                      onClick={() => setEditing({ sectionIndex, fieldIndex })}
                    >
                      Uredi
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={readOnly || section.fields.length <= 1}
                      onClick={() => deleteField(sectionIndex, fieldIndex)}
                    >
                      Ukloni
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={readOnly || allFields.length >= 100}
              onClick={() => setEditing({ sectionIndex, fieldIndex: null })}
            >
              Dodaj polje
            </Button>
          </CardContent>
        </Card>
      ))}
      <Button
        variant="secondary"
        disabled={readOnly || definition.sections.length >= 20}
        onClick={addSection}
      >
        Dodaj sekciju
      </Button>

      <NormalizationEditor definition={definition} readOnly={readOnly} onChange={onChange} />
      {editing ? (
        <FieldEditorModal
          open
          initial={
            editing.fieldIndex === null
              ? makeField(
                  'TEXT',
                  definition.sections[editing.sectionIndex]!.fields.length + 1,
                  `Novo polje ${allFields.length + 1}`,
                )
              : definition.sections[editing.sectionIndex]!.fields[editing.fieldIndex]!
          }
          knownFields={allFields.filter(
            (field) =>
              field.key !==
              (editing.fieldIndex === null
                ? ''
                : definition.sections[editing.sectionIndex]!.fields[editing.fieldIndex]!.key),
          )}
          onClose={() => setEditing(null)}
          onSave={(field) => saveField(editing.sectionIndex, editing.fieldIndex, field)}
        />
      ) : null}
    </div>
  );
}

function FieldEditorModal({
  open,
  initial,
  knownFields,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: FieldDefinition;
  knownFields: readonly FieldDefinition[];
  onClose: () => void;
  onSave: (field: FieldDefinition) => void;
}) {
  const [field, setField] = useState<FieldDefinition>(initial);
  const [optionsText, setOptionsText] = useState(() => {
    const source = initial.optionsSource;
    return source?.kind === 'STATIC'
      ? source.items.map((item) => `${item.value}|${item.label}`).join('\n')
      : '';
  });
  const [sourceKind, setSourceKind] = useState<'STATIC' | 'LIST' | 'QUERY'>(
    initial.optionsSource?.kind ?? 'STATIC',
  );
  const [conditionEnabled, setConditionEnabled] = useState(Boolean(initial.visibleWhen));
  const [conditionField, setConditionField] = useState(
    initial.visibleWhen && 'field' in initial.visibleWhen ? initial.visibleWhen.field : '',
  );
  const [conditionOperator, setConditionOperator] = useState<(typeof OPERATORS)[number]>(
    initial.visibleWhen && 'field' in initial.visibleWhen
      ? (initial.visibleWhen.op as (typeof OPERATORS)[number])
      : '==',
  );
  const [conditionValue, setConditionValue] = useState(() => {
    const current = initial.visibleWhen && 'field' in initial.visibleWhen ? initial.visibleWhen.value : '';
    return typeof current === 'string' ? current : current === undefined ? '' : String(current);
  });
  const optionText = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(field.type);
  const niladic = ['IS_EMPTY', 'IS_NOT_EMPTY'].includes(conditionOperator);
  const listCondition = ['IN', 'NOT_IN', 'BETWEEN'].includes(conditionOperator);

  const changeType = (type: string) => {
    const base = makeField(type, initial.order, field.label);
    setField({
      ...base,
      ...field,
      type: type as FieldDefinition['type'],
      optionsSource: base.optionsSource,
      computed: base.computed,
      validation: base.validation,
      required: type === 'COMPUTED' ? false : field.required,
      storeInFormData: type !== 'COMPUTED',
    });
    setSourceKind(base.optionsSource?.kind ?? 'STATIC');
    setOptionsText(
      base.optionsSource?.kind === 'STATIC'
        ? base.optionsSource.items.map((item) => `${item.value}|${item.label}`).join('\n')
        : '',
    );
  };
  const save = () => {
    const key = field.key.trim();
    const next: FieldDefinition = { ...field, key, label: field.label.trim(), order: initial.order };
    if (optionText) {
      if (sourceKind === 'STATIC') {
        const items = optionsText
          .split(/\r?\n/u)
          .map((line, index) => {
            const [value, ...labelParts] = line.split('|');
            return { value: value?.trim() ?? '', label: labelParts.join('|').trim(), sortOrder: index };
          })
          .filter((item) => item.value && item.label);
        next.optionsSource = { kind: 'STATIC', items };
      } else if (sourceKind === 'LIST') {
        next.optionsSource = {
          kind: 'LIST',
          listCode: field.optionsSource?.kind === 'LIST' ? field.optionsSource.listCode : 'WORKSHOP',
        };
      } else {
        next.optionsSource = {
          kind: 'QUERY',
          queryId: field.optionsSource?.kind === 'QUERY' ? field.optionsSource.queryId : 'ACTIVE_VEHICLES',
        };
      }
    } else delete next.optionsSource;
    if (conditionEnabled && conditionField) {
      const sourceField = knownFields.find((candidate) => candidate.key === conditionField);
      const convert = (raw: string): string | number | boolean => {
        if (
          sourceField?.type === 'INTEGER' ||
          sourceField?.type === 'DECIMAL' ||
          sourceField?.type === 'MONEY'
        )
          return Number(raw);
        if (sourceField?.type === 'BOOLEAN') return raw.toLowerCase() === 'true';
        return raw;
      };
      const value = listCondition
        ? conditionValue
            .split(',')
            .map((item) => convert(item.trim()))
            .filter((item) => item !== '')
        : convert(conditionValue);
      const leaf = niladic
        ? { field: conditionField, op: conditionOperator }
        : { field: conditionField, op: conditionOperator, value };
      next.visibleWhen = leaf as FieldDefinition['visibleWhen'];
    } else if (!conditionEnabled) next.visibleWhen = null;
    if (next.type === 'COMPUTED' && !next.computed)
      next.computed = { expression: '1', resultType: 'INTEGER' };
    if (next.type !== 'COMPUTED') delete next.computed;
    onSave(next);
  };

  return (
    <Modal
      open={open}
      title={initial.key.startsWith('novo_polje_') ? 'Dodaj polje' : `Uredi polje: ${initial.label}`}
      description="Polje se uređuje kroz kontrole; definicija se validira istom šemom kao na serveru."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Odustani
          </Button>
          <Button onClick={save} disabled={!field.key.trim() || !field.label.trim()}>
            Sačuvaj polje
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Naziv polja" htmlFor="field-label">
          <input
            id="field-label"
            className={inputClassName}
            value={field.label}
            onChange={(event) =>
              setField((current) => ({
                ...current,
                label: event.target.value,
                key:
                  current.key === keyFromLabel(current.label)
                    ? keyFromLabel(event.target.value)
                    : current.key,
              }))
            }
          />
        </Field>
        <Field
          label="Ključ (interni)"
          htmlFor="field-key"
          hint="Mala slova/engleski identifikator; generiše se iz naziva."
        >
          <input
            id="field-key"
            className={inputClassName}
            value={field.key}
            onChange={(event) => setField((current) => ({ ...current, key: event.target.value }))}
          />
        </Field>
        <Field label="Vrsta polja" htmlFor="field-type">
          <select
            id="field-type"
            className={inputClassName}
            value={field.type}
            onChange={(event) => changeType(event.target.value)}
          >
            {FIELDS.map((type) => (
              <option key={type} value={type}>
                {FIELD_LABELS[type] ?? type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tekst pomoći" htmlFor="field-help">
          <input
            id="field-help"
            className={inputClassName}
            value={field.helpText ?? ''}
            maxLength={300}
            onChange={(event) =>
              setField((current) => ({ ...current, helpText: event.target.value || null }))
            }
          />
        </Field>
        <Field label="Primjer unosa" htmlFor="field-placeholder">
          <input
            id="field-placeholder"
            className={inputClassName}
            value={field.placeholder ?? ''}
            maxLength={120}
            onChange={(event) =>
              setField((current) => ({ ...current, placeholder: event.target.value || null }))
            }
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="vfm-checkbox"
            checked={field.required}
            onChange={(event) => setField((current) => ({ ...current, required: event.target.checked }))}
          />{' '}
          Obavezno
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="vfm-checkbox"
            checked={field.visibleOnForm}
            onChange={(event) => setField((current) => ({ ...current, visibleOnForm: event.target.checked }))}
          />{' '}
          Prikaži na formi
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="vfm-checkbox"
            checked={field.storeInFormData}
            onChange={(event) =>
              setField((current) => ({ ...current, storeInFormData: event.target.checked }))
            }
          />{' '}
          Sačuvaj vrijednost
        </label>
      </div>

      {optionText ? (
        <section className="mt-5 space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-semibold">Izvor izbora</h3>
          <Field label="Izvor" htmlFor="field-source-kind">
            <select
              id="field-source-kind"
              className={inputClassName}
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value as typeof sourceKind)}
            >
              <option value="STATIC">Lista opcija</option>
              <option value="LIST">Šifarnik</option>
              <option value="QUERY">Pretraga sistema</option>
            </select>
          </Field>
          {sourceKind === 'STATIC' ? (
            <Field label="Opcije (jedna po redu: ključ | naziv)" htmlFor="field-options">
              <textarea
                id="field-options"
                className={`${inputClassName} min-h-32`}
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
                placeholder={'da | Da\nne | Ne'}
              />
            </Field>
          ) : null}
          {sourceKind === 'LIST' ? (
            <Field label="Kod šifarnika" htmlFor="field-list-code">
              <input
                id="field-list-code"
                className={inputClassName}
                value={field.optionsSource?.kind === 'LIST' ? field.optionsSource.listCode : 'WORKSHOP'}
                onChange={(event) =>
                  setField((current) => ({
                    ...current,
                    optionsSource: { kind: 'LIST', listCode: event.target.value.toUpperCase() },
                  }))
                }
              />
            </Field>
          ) : null}
          {sourceKind === 'QUERY' ? (
            <Field label="Izvor pretrage" htmlFor="field-query-id">
              <select
                id="field-query-id"
                className={inputClassName}
                value={
                  field.optionsSource?.kind === 'QUERY' ? field.optionsSource.queryId : 'ACTIVE_VEHICLES'
                }
                onChange={(event) =>
                  setField((current) => ({
                    ...current,
                    optionsSource: { kind: 'QUERY', queryId: event.target.value as AllowedOptionQueryId },
                  }))
                }
              >
                {ALLOWED_OPTION_QUERY_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </section>
      ) : null}

      <FieldValidationEditor field={field} onChange={setField} />
      {field.type === 'COMPUTED' ? (
        <section className="mt-4 grid gap-3 md:grid-cols-2">
          <Field
            label="Izraz"
            htmlFor="computed-expression"
            hint="Koristite podržani izraz; engine provjerava tipove i cikluse."
          >
            <input
              id="computed-expression"
              className={inputClassName}
              value={field.computed?.expression ?? ''}
              onChange={(event) =>
                setField((current) => ({
                  ...current,
                  computed: {
                    expression: event.target.value,
                    resultType: current.computed?.resultType ?? 'INTEGER',
                    precision: current.computed?.precision,
                    unit: current.computed?.unit,
                  },
                }))
              }
            />
          </Field>
          <Field label="Rezultat" htmlFor="computed-type">
            <select
              id="computed-type"
              className={inputClassName}
              value={field.computed?.resultType ?? 'INTEGER'}
              onChange={(event) =>
                setField((current) => ({
                  ...current,
                  computed: {
                    expression: current.computed?.expression ?? '1',
                    resultType: event.target.value as NonNullable<FieldDefinition['computed']>['resultType'],
                  },
                }))
              }
            >
              {['INTEGER', 'DECIMAL', 'STRING', 'BOOLEAN', 'DATE', 'DATETIME', 'MONEY'].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
        </section>
      ) : null}

      <section className="mt-5 space-y-3 rounded-lg border border-border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="vfm-checkbox"
            checked={conditionEnabled}
            onChange={(event) => setConditionEnabled(event.target.checked)}
          />{' '}
          Prikaži samo kada je uslov ispunjen
        </label>
        {conditionEnabled ? (
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Zavisno od polja" htmlFor="condition-field">
              <select
                id="condition-field"
                className={inputClassName}
                value={conditionField}
                onChange={(event) => setConditionField(event.target.value)}
              >
                <option value="">Odaberi polje</option>
                {knownFields.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Uslov" htmlFor="condition-operator">
              <select
                id="condition-operator"
                className={inputClassName}
                value={conditionOperator}
                onChange={(event) => setConditionOperator(event.target.value as typeof conditionOperator)}
              >
                {OPERATORS.map((operator) => (
                  <option key={operator}>{operator}</option>
                ))}
              </select>
            </Field>
            {!niladic ? (
              <Field label="Vrijednost" htmlFor="condition-value">
                <input
                  id="condition-value"
                  className={inputClassName}
                  value={conditionValue}
                  onChange={(event) => setConditionValue(event.target.value)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        {initial.visibleWhen && !('field' in initial.visibleWhen) ? (
          <p className="text-xs text-warning">
            Postojeći složeni uslov je sačuvan. Jednostavni editor ga ne mijenja; isključite opciju samo ako
            ga želite ukloniti.
          </p>
        ) : null}
      </section>
    </Modal>
  );
}

function NormalizationEditor({ definition, readOnly, onChange }: Props) {
  const fields = definition.sections.flatMap((section) => section.fields);
  const columns = NORMALIZATION_COLUMNS[definition.meta.subject] ?? [];
  const mappings = definition.normalizedName ?? [];
  const add = () => {
    const field = fields.find((candidate) => !mappings.some((mapping) => mapping.fieldKey === candidate.key));
    if (!field || columns.length === 0) return;
    onChange({
      ...definition,
      normalizedName: [...mappings, { fieldKey: field.key, column: columns[0]!, transform: 'TO_TEXT' }],
    });
  };
  return (
    <Card>
      <CardHeader
        title="Mapiranje u standardne kolone"
        description="Opciono; samo dozvoljene kolone za predmet forme mogu se izabrati."
      />
      <CardContent className="space-y-3">
        {mappings.map((mapping, index) => (
          <div key={mapping.fieldKey} className="grid gap-3 md:grid-cols-3">
            <Field label="Polje" htmlFor={`mapping-field-${index}`}>
              <select
                id={`mapping-field-${index}`}
                className={inputClassName}
                value={mapping.fieldKey}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    normalizedName: mappings.map((item, i) =>
                      i === index ? { ...item, fieldKey: event.target.value } : item,
                    ),
                  })
                }
              >
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kolona" htmlFor={`mapping-column-${index}`}>
              <select
                id={`mapping-column-${index}`}
                className={inputClassName}
                value={mapping.column ?? ''}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    normalizedName: mappings.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            column: event.target.value || null,
                            transform: event.target.value ? item.transform : null,
                          }
                        : item,
                    ),
                  })
                }
              >
                <option value="">Samo JSONB</option>
                {columns.map((column) => (
                  <option key={column}>{column}</option>
                ))}
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <Field label="Transformacija" htmlFor={`mapping-transform-${index}`}>
                <select
                  id={`mapping-transform-${index}`}
                  className={inputClassName}
                  value={mapping.transform ?? ''}
                  disabled={readOnly || !mapping.column}
                  onChange={(event) =>
                    onChange({
                      ...definition,
                      normalizedName: mappings.map((item, i) =>
                        i === index
                          ? { ...item, transform: event.target.value as typeof item.transform }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="">—</option>
                  {TRANSFORMS.map((transform) => (
                    <option key={transform}>{transform}</option>
                  ))}
                </select>
              </Field>
              <Button
                variant="danger"
                size="sm"
                disabled={readOnly}
                onClick={() =>
                  onChange({ ...definition, normalizedName: mappings.filter((_item, i) => i !== index) })
                }
              >
                Ukloni
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          disabled={
            readOnly || columns.length === 0 || mappings.length >= 50 || mappings.length >= fields.length
          }
          onClick={add}
        >
          Dodaj mapiranje
        </Button>
      </CardContent>
    </Card>
  );
}
