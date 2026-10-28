/**
 * Zdravlje sistema (Faza 0) — jedini ekran koji već radi s pravim API-jem.
 *
 * Pita `/health/live`, `/health/ready` i `/health/startup` i prikazuje stanje.
 * U dev-u zahtjevi idu kroz Vite proxy (`vite.config.ts`), u produkciji kroz
 * nginx `/health` → API kontejner, tako da browser nikad ne zove drugi origin.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, EmptyState } from '../../components/ui/index.js';
import { fetchLiveness, fetchReadiness, fetchStartup } from '../../lib/api.js';
import type { HealthDetails, StartupInfo } from '../../lib/api.js';

interface HealthState {
  live?: HealthDetails;
  ready?: { status: number; body: HealthDetails };
  startup?: StartupInfo;
  error?: string;
  checkedAt?: string;
}

export function HealthPage() {
  const [state, setState] = useState<HealthState>({});
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setState({});
    try {
      const [live, ready, startup] = await Promise.all([
        fetchLiveness().catch(() => undefined),
        fetchReadiness().catch(() => undefined),
        fetchStartup().catch(() => undefined),
      ]);

      if (!live && !ready && !startup) {
        setState({
          error:
            'API nije dostupan. Pokrenite `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` ' +
            'ili lokalno `pnpm --filter @vfm/api dev` (dev proxy cilja http://localhost:3000).',
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      setState({ live, ready, startup, checkedAt: new Date().toISOString() });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const readyOk = state.ready?.status === 200 && state.ready.body?.status === 'ok';

  return (
    <div className="vfm-module-page mx-auto max-w-3xl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="vfm-module-title">Zdravlje sistema</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Probe koje koriste Docker i Coolify: <code className="font-mono text-xs">/health/live</code>,{' '}
            <code className="font-mono text-xs">/health/ready</code>,{' '}
            <code className="font-mono text-xs">/health/startup</code>.
          </p>
        </div>
        <Button variant="primary" onClick={() => void check()} loading={loading}>
          Provjeri ponovo
        </Button>
      </header>

      {state.error ? (
        <Card>
          <CardContent>
            <EmptyState
              icon="!"
              title="API nije dostupan"
              description={state.error}
              action={
                <Button variant="secondary" onClick={() => void check()}>
                  Pokušaj ponovo
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <ProbeCard
          title="Liveness"
          path="/health/live"
          ok={state.live?.status === 'ok'}
          unknown={!state.live}
          detail="Proces radi. Ne provjerava zavisnosti (bez restart petlje)."
        />
        <ProbeCard
          title="Readiness"
          path="/health/ready"
          ok={readyOk}
          unknown={!state.ready}
          detail="Redis (kritičan), Postgres i disk za priloge."
        />
        <ProbeCard
          title="Startup"
          path="/health/startup"
          ok={state.startup?.status === 'ok'}
          unknown={!state.startup}
          detail={`Boot završen; uptime ${state.startup?.uptimeSeconds ?? '—'} s`}
        />
      </div>

      <Card flush>
        <CardHeader title="Detalji" description="Sirovi odgovori probe-ova (za dijagnostiku)." />
        <CardContent className="border-t border-[var(--border)]">
          <pre className="overflow-x-auto bg-[var(--surface-muted)] p-4 font-mono text-[11px] leading-relaxed text-[var(--fg)]">
            {JSON.stringify(state, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function ProbeCard({
  title,
  path,
  ok,
  unknown,
  detail,
}: {
  title: string;
  path: string;
  ok: boolean;
  unknown: boolean;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <Badge level={unknown ? 'neutral' : ok ? 'success' : 'danger'} dot>
            {unknown ? 'nepoznato' : ok ? 'ok' : 'greška'}
          </Badge>
        </div>
        <p className="font-mono text-[11px] text-[var(--fg-muted)]">{path}</p>
        <p className="text-xs text-[var(--fg-muted)]">{detail}</p>
      </CardContent>
    </Card>
  );
}
