/**
 * PlaceholderPage — privremeni sadržaj ekrana dok se ne implementira faza.
 *
 * Namjerno prikazuje: naziv ekrana, oznaku iz `docs/06` (W01…W28), fazu u kojoj
 * dolazi i šta će ekran raditi. Time je navigacija kompletna i pregledna od
 * Faze 0, a ništa ne izgleda "gotovo" prije nego što jeste.
 */
import { Badge, Card, CardContent, CardHeader, EmptyState } from '../components/ui/index.js';

export interface PlaceholderPageProps {
  title: string;
  code?: string;
  phase?: string;
  description?: string;
}

export function PlaceholderPage({ title, code, phase, description }: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {code ? <Badge level="neutral">{code}</Badge> : null}
        {phase ? <Badge level="info" dot>{phase}</Badge> : null}
      </div>

      {description ? <p className="text-sm text-[var(--fg-muted)]">{description}</p> : null}

      <Card>
        <CardHeader
          title="Ekran još nije implementiran"
          description="Ovo je kostur navigacije iz Faze 0. Sadržaj dolazi u navedenoj fazi."
        />
        <CardContent>
          <EmptyState
            icon="◇"
            title="Nema podataka"
            description={
              phase
                ? `Planirano u: ${phase}. Specifikacija ekrana je u docs/06-UX_UI_DIZAJN.md (§5.5).`
                : 'Specifikacija ekrana je u docs/06-UX_UI_DIZAJN.md (§5.5).'
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
