import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CommaSeparatedInput } from './comma-separated-input.js';

function Harness() {
  const [items, setItems] = useState<string[]>([]);
  return (
    <label htmlFor="currencies">
      Valute
      <CommaSeparatedInput id="currencies" value={items} onChange={setItems} />
    </label>
  );
}

describe('CommaSeparatedInput', () => {
  it('dozvoljava zarez dok se kuca', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Valute') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BAM,' } });
    expect(input.value).toBe('BAM,');
    fireEvent.change(input, { target: { value: 'BAM, EUR' } });
    expect(input.value).toBe('BAM, EUR');
    fireEvent.blur(input);
    expect(input.value).toBe('BAM, EUR');
  });
});
