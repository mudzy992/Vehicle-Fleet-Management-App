import { useEffect, useRef, useState } from 'react';
import { inputClassName } from '../../components/ui/index.js';
import { parseCommaSeparated } from './comma-separated.js';

interface CommaSeparatedInputProps {
  readonly id: string;
  readonly value: unknown;
  readonly parse?: (raw: string) => string[];
  readonly onChange: (items: string[]) => void;
}

export function CommaSeparatedInput({
  id,
  value,
  parse = parseCommaSeparated,
  onChange,
}: CommaSeparatedInputProps) {
  const committed = Array.isArray(value) ? value.join(', ') : '';
  const [draft, setDraft] = useState(committed);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(committed);
  }, [committed]);
  return (
    <input
      id={id}
      className={inputClassName}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const items = parse(draft);
        onChange(items);
        setDraft(items.join(', '));
      }}
      onChange={(event) => {
        focused.current = true;
        const next = event.target.value;
        setDraft(next);
        onChange(parse(next));
      }}
    />
  );
}
