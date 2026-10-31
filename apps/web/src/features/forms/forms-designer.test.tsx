import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseDefinition } from '@vfm/form-engine/definition';
import { FormsDesigner } from './forms-designer.js';

function fixture() {
  const result = parseDefinition({
    $schema: 'vfm-form/1',
    meta: { title: 'Inspekcija', description: null, subject: 'VEHICLE', language: 'bs' },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovno',
        description: null,
        order: 1,
        visibleWhen: null,
        fields: [
          {
            key: 'napomena',
            type: 'TEXT',
            label: 'Napomena',
            order: 1,
            required: false,
            visibleWhen: null,
            disabled: false,
            visibleOnForm: true,
            storeInFormData: true,
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error('Fixture definicije nije ispravan.');
  return result.definition;
}

describe('FormsDesigner', () => {
  it('uređuje naslov i raspored kroz kontrole umjesto JSON editora', () => {
    const onChange = vi.fn();
    render(<FormsDesigner definition={fixture()} readOnly={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Naslov'), { target: { value: 'Pregled vozila' } });
    expect(onChange.mock.lastCall?.[0].meta.title).toBe('Pregled vozila');
    expect(screen.queryByLabelText(/JSON|Definicija/u)).toBeNull();
  });

  it('dodaje sekciju i polje kroz vizuelne akcije', () => {
    const onChange = vi.fn();
    const definition = fixture();
    const { rerender } = render(
      <FormsDesigner definition={definition} readOnly={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj sekciju' }));
    const withSection = onChange.mock.lastCall?.[0];
    expect(withSection.sections).toHaveLength(2);
    rerender(<FormsDesigner definition={withSection} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dodaj polje' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Dodaj polje' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Naziv polja'), { target: { value: 'Broj šasije' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sačuvaj polje' }));
    expect(onChange.mock.lastCall?.[0].sections[0]?.fields).toHaveLength(2);
    expect(onChange.mock.lastCall?.[0].sections[0]?.fields[1]?.label).toBe('Broj šasije');
  });

  it('sakriva identitetska polja vozila u dizajneru', () => {
    const definition = fixture();
    definition.sections[0]!.fields.push({
      ...definition.sections[0]!.fields[0]!,
      key: 'internalNo',
      label: 'Interni broj',
      order: 2,
    });
    render(<FormsDesigner definition={definition} subject="VEHICLE" readOnly={false} onChange={vi.fn()} />);
    expect(screen.queryByText('Interni broj')).toBeNull();
    expect(screen.getByText('Napomena')).toBeTruthy();
  });

  it('uklanja polje iz definicije', () => {
    const onChange = vi.fn();
    const withTwo = structuredClone(fixture());
    withTwo.sections[0]!.fields.push({
      ...withTwo.sections[0]!.fields[0]!,
      key: 'ocjena',
      label: 'Ocjena',
      order: 2,
    });
    render(<FormsDesigner definition={withTwo} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ukloni Napomena' }));
    expect(onChange.mock.lastCall?.[0].sections[0]?.fields.map((field: { key: string }) => field.key)).toEqual([
      'ocjena',
    ]);
  });
});
