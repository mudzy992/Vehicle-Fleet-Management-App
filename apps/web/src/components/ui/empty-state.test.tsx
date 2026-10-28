import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state.js';

describe('EmptyState', () => {
  it('exposes its title as a heading and preserves optional guidance', () => {
    render(<EmptyState title="Registar je prazan" description="Dodajte prvo vozilo." />);

    expect(screen.getByRole('heading', { level: 3, name: 'Registar je prazan' })).toBeDefined();
    expect(screen.getByText('Dodajte prvo vozilo.')).toBeDefined();
  });

  it('renders the next action when provided', () => {
    render(<EmptyState title="Nema rezultata" action={<button type="button">Očisti filtere</button>} />);

    expect(screen.getByRole('button', { name: 'Očisti filtere' })).toBeDefined();
  });
});
