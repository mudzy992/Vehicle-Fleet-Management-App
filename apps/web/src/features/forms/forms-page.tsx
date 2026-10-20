/**
 * Form Builder (W20/W21/W22, docs/06 §5.5; docs/04 §8/§12) — Faza 2.
 *
 * Šta ekran radi i zašto tako:
 * - lijevo: katalog formi (subject, status, broj verzija); desno: verzije
 *   odabrane forme i editor **JSON definicije** — v1 Builder-a ne uvodi
 *   drag&drop, ali uvodi sve što je bitno za integritet: meta-shema se provjerava
 *   u browseru istim kodom kao na serveru (`@vfm/form-engine/definition`),
 *   objava traži bilješku, a greške servera se prikazuju po polju.
 * - `DRAFT` se uređuje i objavljuje; `PUBLISHED`/`RETIRED` su nepromjenjivi
 *   (server bi vratio `409 FORM_VERSION_IMMUTABLE`), pa se za izmjenu pravi nova
 *   verzija kopijom.
 * - „Uporedi s prethodnom" zove `GET /form-schemas/:id/diff` i prikazuje
 *   strukturne promjene — to je i osnov za bilješku pri objavi.
 * - Dozvole: dugmad se prikazuju samo uz permisiju (`form:publish_version`,
 *   `form:manage_schema`, …); server ih ionako provjerava.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseDefinition } from '@vfm/form-engine/definition';
import type {
  FormSchemaDetail,
  FormSchemaSummary,
  FormVersionDetail,
  FormVersionDiff,
  FormVersionSummary,
  PublishFormVersionInput,
} from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
import { useSession } from '../auth/session.js';
import {
  FORM_STATUS_LABELS,
  SUBJECT_LABELS,
  availableActions,
  buildDiffLines,
  formatDateTime,
  shortHash,
  suggestedVersionId,
  toParseResult,
} from './forms-model.js';

const textareaClassName = `${inputClassName} h-64 font-mono text-xs leading-5`;

export function FormsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const [formId, setFormId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [diff, setDiff] = useState<FormVersionDiff | null>(null);

  const permissions = {
    canUpdate: hasPermission('form:update'),
    canManageSchema: hasPermission('form:manage_schema'),
    canPublish: hasPermission('form:publish_version'),
    canRetire: hasPermission('form:retire_version'),
  };

  const formsQuery = useQuery({
    queryKey: ['form-schemas'],
    queryFn: () => api.get<FormSchemaSummary[]>('/form-schemas'),
  });

  const detailQuery = useQuery({
    queryKey: ['form-schemas', formId],
    queryFn: () => api.get<FormSchemaDetail>(`/form-schemas/${formId}`),
    enabled: formId !== null,
  });

  const detail = detailQuery.data ?? null;
  const selected = useMemo<FormVersionSummary | null>(() => {
    if (!detail) return null;
    return detail.versions.find((version) => version.id === versionId) ?? null;
  }, [detail, versionId]);

  // Prva forma i njena predložena verzija kad se podaci učitaju.
  useEffect(() => {
    if (!formId && formsQuery.data && formsQuery.data.length > 0) setFormId(formsQuery.data[0]!.id);
  }, [formsQuery.data, formId]);

  useEffect(() => {
    if (!detail) return;
    const suggested = suggestedVersionId(detail.versions, detail.currentPublishedVersionId);
    setVersionId((current) =>
      current && detail.versions.some((version) => version.id === current) ? current : suggested,
    );
  }, [detail]);

  // Definicija odabrane verzije u editor (samo kad se promijeni odabir).
  const versionQuery = useQuery({
    queryKey: ['form-schemas', formId, 'versions', versionId],
    queryFn: () => api.get<FormVersionDetail>(`/form-schemas/${formId}/versions/${versionId}`),
    enabled: formId !== null && versionId !== null,
  });

  useEffect(() => {
    if (versionQuery.data) {
      setEditor(JSON.stringify(versionQuery.data.definition, null, 2));
      setDiff(null);
      setChangeNote('');
      setMessage(null);
    }
  }, [versionQuery.data]);

  const parsed = useMemo(() => {
    try {
      return toParseResult(parseDefinition(JSON.parse(editor)));
    } catch (error) {
      return toParseResult({
        ok: false,
        issues: [{ path: '$', message: error instanceof Error ? error.message : 'Neispravan JSON.' }],
      });
    }
  }, [editor]);

  const actions = availableActions({
    version: selected,
    currentPublishedVersionId: detail?.currentPublishedVersionId ?? null,
    permissions,
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['form-schemas'] });
  };

  const failure = (error: unknown): void => {
    setMessage({
      kind: 'error',
      text:
        error instanceof ApiError
          ? `${error.message}${error.details && error.details.length > 0 ? ` (${error.details.map((detail) => detail.message).join('; ')})` : ''}`
          : 'Akcija nije uspjela.',
    });
  };

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!formId || !versionId) throw new Error('Nema odabrane verzije.');
      if (!parsed.ok) throw new Error('Definicija nije ispravna — popravi greške prije čuvanja.');
      return api.put<FormVersionDetail>(`/form-schemas/${formId}/versions/${versionId}`, {
        definition: parsed.definition,
      });
    },
    onSuccess: async () => {
      setMessage({ kind: 'ok', text: 'Nacrt je sačuvan.' });
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', formId] });
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', formId, 'versions', versionId] });
    },
    onError: failure,
  });

  const createVersion = useMutation({
    mutationFn: async () => {
      if (!formId || !versionId) throw new Error('Nema odabrane verzije.');
      return api.post<FormVersionDetail>(`/form-schemas/${formId}/versions`, {
        copyFromVersionId: versionId,
      });
    },
    onSuccess: async (created) => {
      setMessage({ kind: 'ok', text: `Kreirana verzija ${created.version} (nacrt).` });
      setVersionId(created.id);
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', formId] });
    },
    onError: failure,
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!formId || !versionId) throw new Error('Nema odabrane verzije.');
      const body: PublishFormVersionInput = { changeNote: changeNote.trim() };
      return api.post<FormVersionDetail>(`/form-schemas/${formId}/versions/${versionId}/publish`, body);
    },
    onSuccess: async () => {
      setMessage({ kind: 'ok', text: 'Verzija je objavljena; prethodna aktivna je povučena.' });
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', formId] });
    },
    onError: failure,
  });

  const retire = useMutation({
    mutationFn: async () => {
      if (!formId || !versionId) throw new Error('Nema odabrane verzije.');
      return api.post<FormVersionDetail>(`/form-schemas/${formId}/versions/${versionId}/retire`, {
        changeNote: changeNote.trim(),
      });
    },
    onSuccess: async () => {
      setMessage({ kind: 'ok', text: 'Verzija je povučena.' });
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', formId] });
    },
    onError: failure,
  });

  const removeDraft = useMutation({
    mutationFn: async () => {
      if (!formId || !versionId) throw new Error('Nema odabrane verzije.');
      return api.delete<void>(`/form-schemas/${formId}/versions/${versionId}`);
    },
    onSuccess: async () => {
      setMessage({ kind: 'ok', text: 'Nacrt je obrisan.' });
      setVersionId(null);
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', formId] });
    },
    onError: failure,
  });

  const compare = useMutation({
    mutationFn: async () => {
      if (!detail || !selected) throw new Error('Nema odabrane verzije.');
      const previous = detail.versions
        .filter((version) => version.version < selected.version)
        .sort((a, b) => b.version - a.version)[0];
      if (!previous) throw new Error('Ovo je prva verzija — nema s čim uporediti.');
      return api.get<FormVersionDiff>(
        `/form-schemas/${detail.id}/diff?from=${previous.id}&to=${selected.id}`,
      );
    },
    onSuccess: (result) => setDiff(result),
    onError: failure,
  });

  const busy =
    saveDraft.isPending ||
    createVersion.isPending ||
    publish.isPending ||
    retire.isPending ||
    removeDraft.isPending;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Forme</h1>
          <p className="text-xs text-[var(--fg-muted)]">
            Verzije su nepromjenjive nakon objave; nova izmjena je nova verzija.
          </p>
        </div>
        <Badge level="info">W20–W22 · Faza 2</Badge>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Katalog" description={`${formsQuery.data?.length ?? 0} formi`} />
          <CardContent className="space-y-1">
            {formsQuery.isLoading ? <p className="text-xs text-[var(--fg-muted)]">Učitavanje…</p> : null}
            {formsQuery.isError ? (
              <p role="alert" className="text-xs text-[var(--danger)]">
                Katalog nije dostupan.
              </p>
            ) : null}
            {formsQuery.data?.length === 0 ? <EmptyState title="Nema formi" /> : null}
            {formsQuery.data?.map((form) => (
              <button
                key={form.id}
                type="button"
                onClick={() => {
                  setFormId(form.id);
                  setVersionId(null);
                  setMessage(null);
                }}
                aria-pressed={form.id === formId}
                className={`w-full rounded-md border px-2.5 py-2 text-left text-xs ${
                  form.id === formId
                    ? 'border-[var(--primary)] bg-[var(--surface-2)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-2)]'
                }`}
              >
                <span className="block font-medium">{form.name}</span>
                <span className="block text-[11px] text-[var(--fg-muted)]">
                  {SUBJECT_LABELS[form.subject]} · {FORM_STATUS_LABELS[form.status]} · {form.versionCount}{' '}
                  {form.versionCount === 1 ? 'verzija' : 'verzije'}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {detail ? (
            <Card>
              <CardHeader
                title={detail.name}
                description={`${detail.key} · ${SUBJECT_LABELS[detail.subject]} · aktivna verzija: ${detail.currentPublishedVersion ?? '—'}`}
                actions={
                  <Badge level={detail.status === 'PUBLISHED' ? 'success' : 'warning'}>
                    {FORM_STATUS_LABELS[detail.status]}
                  </Badge>
                }
              />
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Verzija</TH>
                      <TH>Status</TH>
                      <TH>Bilješka</TH>
                      <TH>Hash</TH>
                      <TH>Objavljena</TH>
                      <TH>Zapisa</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.versions.map((version) => (
                      <TR
                        key={version.id}
                        className={version.id === versionId ? 'bg-[var(--surface-2)]' : undefined}
                      >
                        <TD>
                          <button
                            type="button"
                            className="font-medium underline-offset-2 hover:underline"
                            onClick={() => setVersionId(version.id)}
                          >
                            v{version.version}
                          </button>
                        </TD>
                        <TD>
                          <Badge
                            level={
                              version.status === 'PUBLISHED'
                                ? 'success'
                                : version.status === 'DRAFT'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {FORM_STATUS_LABELS[version.status]}
                          </Badge>
                        </TD>
                        <TD>{version.changeNote ?? '—'}</TD>
                        <TD>
                          <code className="text-[11px]">{shortHash(version.contentHash)}</code>
                        </TD>
                        <TD>{formatDateTime(version.publishedAt)}</TD>
                        <TD>{version.recordCount}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {selected ? (
            <Card>
              <CardHeader
                title={`Definicija v${selected.version}`}
                description={
                  selected.status === 'DRAFT'
                    ? 'Nacrt se može mijenjati.'
                    : 'Verzija je nepromjenjiva — izmjena ide kroz novu verziju.'
                }
                actions={
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {actions.includes('edit') ? (
                      <Button
                        size="sm"
                        onClick={() => saveDraft.mutate()}
                        disabled={busy || !parsed.ok}
                        title={parsed.ok ? 'Sačuvaj nacrt' : 'Popravi greške u definiciji'}
                      >
                        Sačuvaj nacrt
                      </Button>
                    ) : null}
                    {actions.includes('newVersion') ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => createVersion.mutate()}
                        disabled={busy}
                      >
                        Nova verzija
                      </Button>
                    ) : null}
                    {actions.includes('publish') ? (
                      <Button size="sm" onClick={() => publish.mutate()} disabled={busy || !parsed.ok}>
                        Objavi…
                      </Button>
                    ) : null}
                    {actions.includes('retire') ? (
                      <Button variant="danger" size="sm" onClick={() => retire.mutate()} disabled={busy}>
                        Povuci
                      </Button>
                    ) : null}
                    {actions.includes('delete') ? (
                      <Button variant="danger" size="sm" onClick={() => removeDraft.mutate()} disabled={busy}>
                        Obriši nacrt
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => compare.mutate()} disabled={busy}>
                      Uporedi s prethodnom
                    </Button>
                  </div>
                }
              />
              <CardContent className="space-y-3">
                {actions.includes('publish') || actions.includes('retire') ? (
                  <Field
                    label="Bilješka o promjeni (obavezna, najmanje 5 znakova)"
                    htmlFor="change-note"
                    hint="Upisuje se uz objavu/povlačenje i vidljiva je u historiji verzija."
                  >
                    <input
                      id="change-note"
                      className={inputClassName}
                      value={changeNote}
                      maxLength={500}
                      onChange={(event) => setChangeNote(event.target.value)}
                    />
                  </Field>
                ) : null}

                <Field
                  label="Definicija (JSON)"
                  htmlFor="form-definition"
                  hint={
                    parsed.ok
                      ? 'Meta-shema je ispravna. Server ponovo provjerava pri čuvanju i objavi.'
                      : 'Definicija ima greške — čuvanje i objava su onemogućeni.'
                  }
                >
                  <textarea
                    id="form-definition"
                    className={textareaClassName}
                    spellCheck={false}
                    value={editor}
                    onChange={(event) => setEditor(event.target.value)}
                    readOnly={!actions.includes('edit')}
                  />
                </Field>

                {!parsed.ok ? (
                  <ul role="alert" className="space-y-1 rounded-md border border-[var(--danger)] p-2 text-xs">
                    {parsed.issues.map((issue) => (
                      <li key={`${issue.path}-${issue.message}`}>
                        <code>{issue.path}</code> — {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {message ? (
                  <p
                    role={message.kind === 'error' ? 'alert' : 'status'}
                    className={`text-xs ${
                      message.kind === 'error' ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                    }`}
                  >
                    {message.text}
                  </p>
                ) : null}

                {diff ? (
                  <div className="rounded-md border border-[var(--border)] p-2 text-xs">
                    <p className="mb-1 font-medium">
                      Diff v{diff.from.version} → v{diff.to.version}
                    </p>
                    {diff.empty ? (
                      <p className="text-[var(--fg-muted)]">Nema strukturnih razlika.</p>
                    ) : (
                      <ul className="space-y-0.5 font-mono text-[11px]">
                        {buildDiffLines(diff).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {!detail && !formsQuery.isLoading ? (
            <Card>
              <CardContent>
                <EmptyState title="Odaberi formu iz kataloga" />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
