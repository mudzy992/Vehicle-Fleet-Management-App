/**
 * Dinamička polja forme — provjere da ekran stvarno slijedi render model.
 *
 * Fokus je na ponašanju koje korisnik vidi: skriveno polje se ne prikazuje,
 * `hiddenKeys` uklanja duplikate sa statičnim kontrolama, a serverska greška ide
 * uz tačno polje (bez nje korisnik ne zna šta popraviti).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderModel } from '@vfm/form-renderer';
import { CoreFields, FormFields } from './form-fields.js';

function model(overrides: Partial<RenderModel> = {}): RenderModel {
  return {
    title: 'Vozilo',
    version: 1,
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovni podaci',
        visible: true,
        fields: [
          {
            key: 'plateNumber',
            label: 'Registarska oznaka',
            type: 'TEXT',
            widget: 'TEXT',
            required: false,
            visible: true,
            disabled: false,
            readOnly: false,
            value: 'A12-M-345',
            errors: [],
            validation: {},
            options: null,
            helpText: null,
            placeholder: null,
          },
          {
            key: 'odometerKm',
            label: 'Kilometraža',
            type: 'INTEGER',
            widget: 'NUMBER',
            required: false,
            visible: true,
            disabled: false,
            readOnly: false,
            value: 120_000,
            errors: [],
            validation: {},
            options: null,
            helpText: null,
            placeholder: null,
          },
        ],
      },
      {
        key: 'skriveno',
        title: 'Skrivena sekcija',
        visible: false,
        fields: [],
      },
    ],
    computed: {},
    progress: { requiredFields: 0, filledRequired: 0, percent: 0 },
    ...overrides,
  } as unknown as RenderModel;
}

describe('FormFields', () => {
  it('prikazuje samo vidljive sekcije', () => {
    render(<FormFields model={model()} onChange={() => undefined} />);

    expect(screen.getByText('Osnovni podaci')).toBeTruthy();
    expect(screen.queryByText('Skrivena sekcija')).toBeNull();
  });

  it('`hiddenKeys` sklanja polja koja ekran unosi statično', () => {
    render(<FormFields model={model()} hiddenKeys={['plateNumber']} onChange={() => undefined} />);

    expect(screen.queryByLabelText(/Registarska oznaka/u)).toBeNull();
    expect(screen.getByLabelText(/Kilometraža/u)).toBeTruthy();
  });

  it('jasno označava dinamičke opcije koje ekran još nije učitao', () => {
    const base = model();
    const section = base.sections[0]!;
    const field = {
      ...section.fields[0]!,
      widget: 'SELECT' as const,
      optionsSourceKind: 'LIST' as const,
      optionsSource: { kind: 'LIST' as const, listCode: 'WORKSHOP' },
      options: null,
    };
    const dynamicModel = {
      ...base,
      sections: [{ ...section, fields: [field] }, ...base.sections.slice(1)],
    } as unknown as RenderModel;

    render(<FormFields model={dynamicModel} onChange={() => undefined} />);

    expect(screen.getByText('Dinamičke opcije (LIST/QUERY) nisu učitane na ovom ekranu.')).toBeTruthy();
  });

  it('serverska greška ide uz polje', () => {
    render(<FormFields model={model()} errors={{ odometerKm: 'Prevoziljeno' }} onChange={() => undefined} />);

    expect(screen.getByText('Prevoziljeno')).toBeTruthy();
  });

  it('izmjena se javlja po `fieldKey`', () => {
    const onChange = vi.fn();
    render(<FormFields model={model()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/Kilometraža/u), { target: { value: '130000' } });
    expect(onChange).toHaveBeenCalledWith('odometerKm', 130_000);
  });
});

describe('CoreFields', () => {
  const fields = [
    { key: 'internalNo', label: 'Interni broj', kind: 'TEXT' as const, required: true },
    {
      key: 'fuelType',
      label: 'Gorivo',
      kind: 'SELECT' as const,
      options: [{ value: 'DIESEL', label: 'Dizel' }],
    },
  ];

  it('obavezna polja su označena zvjezdicom', () => {
    render(<CoreFields fields={fields} values={{}} onChange={() => undefined} />);
    expect(screen.getByLabelText(/Interni broj \*/u)).toBeTruthy();
  });

  it('`SELECT` prikazuje opcije i javlja odabir', () => {
    const onChange = vi.fn();
    render(<CoreFields fields={fields} values={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/Gorivo/u), { target: { value: 'DIESEL' } });
    expect(onChange).toHaveBeenCalledWith('fuelType', 'DIESEL');
  });

  it('`INTEGER` odbacuje ne-cifre', () => {
    const onChange = vi.fn();
    render(
      <CoreFields
        fields={[{ key: 'year', label: 'Godina', kind: 'INTEGER' }]}
        values={{}}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Godina/u), { target: { value: '20a26' } });
    expect(onChange).toHaveBeenCalledWith('year', '2026');
  });

  it('greška po polju se prikazuje i nosi `aria-invalid`', () => {
    render(
      <CoreFields
        fields={fields}
        values={{ internalNo: 'X' }}
        errors={{ internalNo: 'Već postoji' }}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText('Već postoji')).toBeTruthy();
    expect(screen.getByLabelText(/Interni broj \*/u).getAttribute('aria-invalid')).toBe('true');
  });
});
