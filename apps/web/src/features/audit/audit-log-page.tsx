/**
 * Audit log (W27+, docs/06 §5.5; docs/07 §2.16).
 *
 * - Filteri idu na server (akcija, ozbiljnost, period) → paginacija i `total`
 *   su tačni i za velike baze.
 * - `SECURITY` redovi su vidljivi samo uz `audit:view_security`; kad ih server
 *   sakrije, ekran to **kaže** (`securityHidden`) umjesto da izgleda prazno.
 * - Detalj (`before`/`after`) se učitava tek na klik — lista ostaje lagana.
 * - Zapisi su immutabilni: nema uređivanja ni brisanja, samo uvid.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_ACTIONS, AUDIT_SEVERITIES } from '@vfm/shared';
import type { AuditLogDetail, AuditLogListResponse, AuditLogSummary } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  inputClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';

const PAGE_SIZE = 50;

function severityLevel(severity: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'SECURITY') return 'warning';
  if (severity === 'WARN') return 'warning';
  return 'neutral';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [severity, setSeverity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['audit-logs', { page, action, severity, from, to }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (action) params.set('action', action);
      if (severity) params.set('severity', severity);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      return api.get<AuditLogListResponse>(`/audit-logs?${params.toString()}`);
    },
  });

  const detail = useQuery({
    queryKey: ['audit-logs', 'detail', selected],
    queryFn: () => api.get<AuditLogDetail>(`/audit-logs/${selected ?? ''}`),
    enabled: selected !== null,
  });

  const data = query.data;
  const totalPages = data?.totalPages ?? 0;
  const error = query.error;

  return (
    <div className="vfm-module-page">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Akcija" htmlFor="audit-action">
          <select
            id="audit-action"
            className={inputClassName}
            value={action}
            onChange={(event) => {
              setPage(1);
              setAction(event.target.value);
            }}
          >
            <option value="">Sve</option>
            {AUDIT_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ozbiljnost" htmlFor="audit-severity">
          <select
            id="audit-severity"
            className={inputClassName}
            value={severity}
            onChange={(event) => {
              setPage(1);
              setSeverity(event.target.value);
            }}
          >
            <option value="">Sve</option>
            {AUDIT_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Od" htmlFor="audit-from">
          <input
            id="audit-from"
            type="datetime-local"
            className={inputClassName}
            value={from}
            onChange={(event) => {
              setPage(1);
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field label="Do" htmlFor="audit-to">
          <input
            id="audit-to"
            type="datetime-local"
            className={inputClassName}
            value={to}
            onChange={(event) => {
              setPage(1);
              setTo(event.target.value);
            }}
          />
        </Field>
      </div>

      {data?.securityHidden ? (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--fg-muted)]">
          Sigurnosni zapisi (<code>SECURITY</code>) nisu prikazani — potrebno je pravo{' '}
          <code>audit:view_security</code>.
        </p>
      ) : null}

      <Card flush>
        {query.isLoading ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]">Učitavanje…</p>
        ) : error ? (
          <p className="p-4 text-sm text-[var(--danger)]" role="alert">
            {error instanceof ApiError
              ? `Greška (${error.code}): ${error.message}`
              : 'Greška pri učitavanju audit loga.'}
          </p>
        ) : !data || data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nema zapisa" description="Promijenite filtere ili period." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Vrijeme</TH>
                <TH>Akcija</TH>
                <TH>Ozbiljnost</TH>
                <TH>Akter</TH>
                <TH>Entitet</TH>
                <TH>Polja</TH>
                <TH align="right"> </TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((item) => (
                <AuditRow key={item.id} item={item} onOpen={() => setSelected(item.id)} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
        <span>
          Stranica {page} / {Math.max(totalPages, 1)} · ukupno {data?.total ?? 0}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prethodna
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sljedeća
          </Button>
        </div>
      </div>

      {selected ? (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">Detalj zapisa #{selected}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Zatvori
            </Button>
          </div>

          {detail.isLoading ? <p className="mt-2 text-xs text-[var(--fg-muted)]">Učitavanje…</p> : null}
          {detail.error ? (
            <p className="mt-2 text-xs text-[var(--danger)]">
              {detail.error instanceof ApiError
                ? `${detail.error.message} (${detail.error.code})`
                : 'Greška.'}
            </p>
          ) : null}
          {detail.data ? (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase text-[var(--fg-muted)]">Prije</p>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[var(--surface-muted)] p-2 text-[11px]">
                  {JSON.stringify(detail.data.before ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-[11px] uppercase text-[var(--fg-muted)]">Poslije</p>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[var(--surface-muted)] p-2 text-[11px]">
                  {JSON.stringify(detail.data.after ?? {}, null, 2)}
                </pre>
              </div>
              {detail.data.metadata ? (
                <div className="md:col-span-2">
                  <p className="text-[11px] uppercase text-[var(--fg-muted)]">Metapodaci</p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-[var(--surface-muted)] p-2 text-[11px]">
                    {JSON.stringify(detail.data.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function AuditRow({ item, onOpen }: { item: AuditLogSummary; onOpen: () => void }) {
  return (
    <TR>
      <TD className="whitespace-nowrap text-[11px] text-[var(--fg-muted)]">
        {formatDateTime(item.createdAt)}
      </TD>
      <TD className="font-mono text-xs">{item.action}</TD>
      <TD>
        <Badge level={severityLevel(item.severity)} dot>
          {item.severity}
        </Badge>
      </TD>
      <TD className="text-xs">
        {item.actorEmail ?? item.actorId ?? '—'}
        {item.actorRoles.length > 0 ? (
          <span className="ml-1 text-[10px] text-[var(--fg-muted)]">({item.actorRoles.join(', ')})</span>
        ) : null}
      </TD>
      <TD className="text-xs">
        {item.entityType ?? '—'}
        {item.entityId ? (
          <span className="ml-1 font-mono text-[10px]">{item.entityId.slice(0, 8)}…</span>
        ) : null}
      </TD>
      <TD className="text-[11px] text-[var(--fg-muted)]">{item.changedFields.join(', ') || '—'}</TD>
      <TD align="right">
        <Button type="button" size="sm" variant="ghost" onClick={onOpen}>
          Detalj
        </Button>
      </TD>
    </TR>
  );
}
