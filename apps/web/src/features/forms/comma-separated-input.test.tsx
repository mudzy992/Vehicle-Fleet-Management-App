import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CommaSeparatedInput } from './comma-separated-input.js';
import { parseMimeTypes } from './comma-separated.js';

function Harness() {
  const [items, setItems] = useState<string[]>([]);
  return (
    <label htmlFor="mime">
      MIME
      <CommaSeparatedInput id="mime" value={items} parse={parseMimeTypes} onChange={setItems} />
    </label>
  );
}

describe('CommaSeparatedInput', () => {
  it('dozvoljava zarez dok se kuca', () => {
    render(<Harness />);
    const input = screen.getByLabelText('MIME') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'JPG,' } });
    expect(input.value).toBe('JPG,');
    fireEvent.change(input, { target: { value: 'JPG, PNG, JPEG, GIF' } });
    expect(input.value).toBe('JPG, PNG, JPEG, GIF');
    fireEvent.blur(input);
    expect(input.value).toBe('image/jpeg, image/png, image/gif');
  });
});
