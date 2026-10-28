/**
 * Dizajn sistem (Faza 0) — živi pregled tokena i komponenti.
 *
 * Služi kao referenca za sve ekrane (docs/06-UX_UI_DIZAJN.md §5) i kao
 * vizuelni test: ako se tokeni promijene, ovo je prvo mjesto gdje se vidi.
 */
import { Badge, Button, Card, CardContent, CardHeader, Stat, StatusBadge } from '../../components/ui/index.js';
import { formatMoney, formatOdometer, formatDateTime, humanizeRemaining, deadlineLevel, daysUntil } from '@vfm/shared';
import type { SemanticLevel } from '@vfm/shared';

const COLOR_TOKENS: readonly { name: string; variable: string; soft?: string }[] = [
  { name: 'primary', variable: 'var(--primary)', soft: 'var(--primary-soft)' },
  { name: 'success', variable: 'var(--success)', soft: 'var(--success-soft)' },
  { name: 'info', variable: 'var(--info)', soft: 'var(--info-soft)' },
  { name: 'warning', variable: 'var(--warning)', soft: 'var(--warning-soft)' },
  { name: 'danger', variable: 'var(--danger)', soft: 'var(--danger-soft)' },
  { name: 'neutral', variable: 'var(--neutral)', soft: 'var(--neutral-soft)' },
];

const SEMANTIC_LEVELS: readonly SemanticLevel[] = ['success', 'info', 'warning', 'danger', 'neutral'];

const TASK_STATUS_SAMPLES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const RECORD_STATUS_SAMPLES = ['ACTIVE', 'EXPIRED', 'DRAFT', 'CANCELLED'] as const;
const PRIORITY_SAMPLES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

/** Fiksni "sada" za deterministički prikaz rokova. */
const NOW = new Date('2026-10-19T12:00:00.000Z');
const DEADLINE_SAMPLES: readonly { label: string; date: string }[] = [
  { label: 'Registracija ističe za 45 dana', date: '2026-12-03T12:00:00.000Z' },
  { label: 'Osiguranje ističe za 15 dana', date: '2026-11-03T12:00:00.000Z' },
  { label: 'Servis za 4 dana', date: '2026-10-23T12:00:00.000Z' },
  { label: 'Dozvola istekla prije 3 dana', date: '2026-10-16T12:00:00.000Z' },
];

export function DesignSystemPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Dizajn sistem</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Zajednički grafitno-lime tokeni za web i mobilnu aplikaciju; kontrast i usklađenost provjerava web test.
          Web tokeni su u <code className="font-mono text-xs">styles/globals.css</code>, native mapiranje u <code className="font-mono text-xs">apps/mobile/src/lib/theme.ts</code>.
        </p>
      </header>

      <Card>
        <CardHeader title="Boje (dizajn tokeni)" description="Grafitna + lime; tamna tema je zajednički default weba i mobilne aplikacije." />
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {COLOR_TOKENS.map((token) => (
              <div key={token.name} className="space-y-1.5">
                <div className="h-12 rounded-md" style={{ backgroundColor: token.variable }} />
                {token.soft ? (
                  <div className="h-6 rounded-md border border-[var(--border)]" style={{ backgroundColor: token.soft }} />
                ) : null}
                <p className="font-mono text-[11px] text-[var(--fg-muted)]">--{token.name}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Tipografija" description="Inter / sistemski font; tabularni brojevi za tabele." />
        <CardContent className="space-y-2">
          <p className="text-2xl font-semibold tracking-tight">Naslov ekrana (24/600)</p>
          <p className="text-base font-semibold">Naslov sekcije (16/600)</p>
          <p className="text-sm">Osnovni tekst (14/400) — opis vozila ili zadatka.</p>
          <p className="text-xs text-[var(--fg-muted)]">Pomoćni tekst (12/400) — metapodaci i hintovi.</p>
          <p className="tabular text-sm">1.234.567 km · 12.345,67 KM · 08.10.2026 14:32</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Dugmad" description="Jedno primarno dugme po ekranu; ostalo sekundarno/ghost." />
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primarno</Button>
          <Button variant="secondary">Sekundarno</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Obriši</Button>
          <Button variant="primary" size="sm">Malo</Button>
          <Button variant="primary" loading>Učitavanje</Button>
          <Button variant="primary" disabled>Onemogućeno</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Statusi i badge-ovi"
          description="Nazivi i boje dolaze iz @vfm/shared (isti u web, mobilnoj i PDF izvozu)."
        />
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-xs text-[var(--fg-muted)]">Zadaci</span>
            {TASK_STATUS_SAMPLES.map((status) => (
              <StatusBadge key={status} value={status} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-xs text-[var(--fg-muted)]">Evidencije</span>
            {RECORD_STATUS_SAMPLES.map((status) => (
              <StatusBadge key={status} value={status} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-xs text-[var(--fg-muted)]">Prioritet</span>
            {PRIORITY_SAMPLES.map((priority) => (
              <StatusBadge key={priority} value={priority} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-xs text-[var(--fg-muted)]">Semantika</span>
            {SEMANTIC_LEVELS.map((level) => (
              <Badge key={level} level={level}>
                {level}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Rokovi (deadline semantika)"
          description=">30 dana success · 8–30 info · 1–7 warning · ≤0 danger (docs/06 §6.2)."
        />
        <CardContent>
          <ul className="divide-y divide-[var(--border)]">
            {DEADLINE_SAMPLES.map((sample) => {
              const days = daysUntil(sample.date, NOW);
              const level = deadlineLevel(days);
              return (
                <li key={sample.label} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{sample.label}</p>
                    <p className="text-xs text-[var(--fg-muted)]">
                      {formatDateTime(sample.date)} · {humanizeRemaining(days)}
                    </p>
                  </div>
                  <Badge level={level}>{days} dana</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Vozila u upotrebi" value={10} hint="od 12 ukupno" level="success" />
        <Stat label="Otvoreni zadaci" value={7} hint="3 čekaju preuzimanje" level="info" />
        <Stat label="Rokovi u 7 dana" value={2} hint="registracija i osiguranje" level="warning" />
        <Stat label="Probijeni rokovi" value={1} hint="servis V-004" level="danger" />
      </div>

      <Card>
        <CardHeader title="Formati vrijednosti" description="Novac u feninzima, prikaz u KM; UTC u bazi, Sarajevo u prikazu." />
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormatRow label="Iznos" value={formatMoney(123456)} />
          <FormatRow label="Iznos (0)" value={formatMoney(0)} />
          <FormatRow label="Kilometraža" value={formatOdometer(187423)} />
          <FormatRow label="Datum i vrijeme" value={formatDateTime('2026-10-19T13:32:00.000Z')} />
        </CardContent>
      </Card>
    </div>
  );
}

function FormatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] pb-1.5">
      <span className="text-xs text-[var(--fg-muted)]">{label}</span>
      <span className="tabular font-mono text-sm">{value}</span>
    </div>
  );
}
