import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, StatusBadge } from './badge.js';

/**
 * Badge/StatusBadge: naziv i boja dolaze iz `@vfm/shared`, pa se ovdje
 * provjerava da UI zaista koristi dijeljeni izvor (a ne lokalni prijevod).
 */
describe('Badge', () => {
  it('prikazuje tekst i semantičku klasu', () => {
    render(<Badge level="danger">Probijen rok</Badge>);
    const badge = screen.getByText('Probijen rok');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('bg-danger-soft');
  });

  it('bez nivoa koristi neutralnu (default) boju', () => {
    render(<Badge>Obično</Badge>);
    expect(screen.getByText('Obično').className).toContain('bg-neutral-soft');
  });

  it('tačka je dekorativna (aria-hidden)', () => {
    const { container } = render(
      <Badge level="success" dot>
        Aktivno
      </Badge>,
    );
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });
});

describe('StatusBadge — koristi @vfm/shared nazive i boje', () => {
  it.each([
    ['OPEN', 'Otvoren'],
    ['IN_PROGRESS', 'U radu'],
    ['COMPLETED', 'Završen'],
    ['CANCELLED', 'Otkazan'],
    ['PUBLISHED', 'Objavljeno'],
    ['RETIRED', 'Povučeno'],
    ['EXPIRED', 'Isteklo'],
  ] as const)('%s → %s', (value, label) => {
    render(<StatusBadge value={value} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('nivo boje prati semantiku iz shared paketa', () => {
    const { rerender } = render(<StatusBadge value="COMPLETED" />);
    expect(screen.getByText('Završen').className).toContain('bg-success-soft');

    rerender(<StatusBadge value="IN_PROGRESS" />);
    expect(screen.getByText('U radu').className).toContain('bg-warning-soft');

    rerender(<StatusBadge value="OPEN" />);
    expect(screen.getByText('Otvoren').className).toContain('bg-info-soft');
  });

  it('domen otklanja dvosmislenost (CANCELLED: zadatak vs evidencija)', () => {
    const { rerender } = render(<StatusBadge value="CANCELLED" />);
    expect(screen.getByText('Otkazan')).toBeTruthy();

    rerender(<StatusBadge value="CANCELLED" domain="record" />);
    expect(screen.getByText('Otkazano')).toBeTruthy();
  });

  it('nepoznata vrijednost se ipak prikazuje (nikad prazan badge)', () => {
    render(<StatusBadge value="NEKI_NOVI_STATUS" />);
    expect(screen.getByText('NEKI_NOVI_STATUS')).toBeTruthy();
  });

  it('label/level se mogu prepisati', () => {
    render(<StatusBadge value="ACTIVE" label="Vrijedi do 12.11.2026." level="info" />);
    const badge = screen.getByText('Vrijedi do 12.11.2026.');
    expect(badge.className).toContain('bg-info-soft');
  });

  it('title atribut nosi sirovu vrijednost enuma (za dev/inspect)', () => {
    render(<StatusBadge value="IN_PROGRESS" />);
    expect(screen.getByTitle('IN_PROGRESS')).toBeTruthy();
  });
});
