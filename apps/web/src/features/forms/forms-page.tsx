/**
 * Form Builder (W20/W21/W22, docs/06 §5.5; docs/04 §8/§12) — Faza 2.
 *
 * Šta ekran radi i zašto tako:
 * - lijevo: katalog formi (subject, status, broj verzija); desno: verzije
 *   odabrane forme i vizuelni form-builder (sekcije, polja, opcije, uslovi,
 *   mapiranja i pregled) — korisnik ne uređuje sirovi JSON; meta-shema se provjerava
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseDefinition } from '@vfm/form-engine/definition';
import { FORM_SUBJECTS } from '@vfm/shared';
import type { FormSubject } from '@vfm/shared';
import type {
  CreateFormSchemaInput,
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
  Modal,
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
import { FormsPreview } from './forms-preview.js';
import { FormsDesigner } from './forms-designer.js';

function formKeyFromName(name: string): string {
  const stem = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return (/^[a-z]/u.test(stem) ? stem : `forma_${stem}`).slice(0, 49).replace(/_+$/u, '') || 'nova_forma';
}

export function FormsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const [formId, setFormId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [diff, setDiff] = useState<FormVersionDiff | null>(null);
  const [mode, setMode] = useState<'editor' | 'pregled'>('editor');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createKey, setCreateKey] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createSubject, setCreateSubject] = useState<FormSubject>('OTHER');
  const loadedVersionId = useRef<string | null>(null);

  const canCreateForm = hasPermission('form:create');
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
  const subjectsWithoutPublishedForm = useMemo(() => {
    const requiredSubjects: FormSubject[] = [
      'VEHICLE', 'DRIVER', 'REGISTRATION', 'INSURANCE', 'SERVICE',
      'TIRE_SET', 'TIRE_INSTALLATION', 'TASK', 'VEHICLE_HANDOVER',
    ];
    const forms = formsQuery.data ?? [];
    return requiredSubjects.filter((subject) =>
      !forms.some((form) => form.subject === subject && form.status === 'PUBLISHED'),
    );
  }, [formsQuery.data]);
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
    const loaded = versionQuery.data;
    if (!loaded || loadedVersionId.current === loaded.id) return;
    // Samo promjena odabrane verzije resetuje editor i poruku. Refetch nakon
    // čuvanja nacrta vraća isti ID; ne smije obrisati potvrdu niti prepisati
    // lokalni editor ponovo učitanim snapshotom.
    loadedVersionId.current = loaded.id;
    setEditor(JSON.stringify(loaded.definition, null, 2));
    setDiff(null);
    setChangeNote('');
    setMessage(null);
  }, [versionQuery.data]);

  //  Isti parser kao na serveru. Rezultat se drži u dva oblika: `definition`
  //  (tipizirano, za pregled) i `parsed` (poruke za UI).
  const definitionResult = useMemo(() => {
    try {
      return parseDefinition(JSON.parse(editor));
    } catch (error) {
      return {
        ok: false as const,
        issues: [{ path: '$', message: error instanceof Error ? error.message : 'Neispravan JSON.' }],
      };
    }
  }, [editor]);

  const parsed = useMemo(() => toParseResult(definitionResult), [definitionResult]);

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

  const createForm = useMutation({
    mutationFn: (input: CreateFormSchemaInput) => api.post<FormSchemaDetail>('/form-schemas', input),
    onSuccess: async (created) => {
      setCreateOpen(false);
      setFormId(created.id);
      setVersionId(null);
      setMessage({
        kind: 'ok',
        text: `Kreiran je nacrt forme „${created.name}“. Dodajte polja kroz vizuelni dizajner.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['form-schemas'] });
      await queryClient.invalidateQueries({ queryKey: ['form-schemas', created.id] });
    },
    onError: failure,
  });

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
    createForm.isPending ||
    saveDraft.isPending ||
    createVersion.isPending ||
    publish.isPending ||
    retire.isPending ||
    removeDraft.isPending;

  return (
    <div className="vfm-module-page">
      <header className="vfm-module-heading">
        <div>
          <h1 className="vfm-module-title">Forme</h1>
          <p className="text-xs text-fg-muted">
            Verzije su nepromjenjive nakon objave; nova izmjena je nova verzija.
          </p>
        </div>
        {canCreateForm ? (
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setCreateName('');
              setCreateKey('');
              setCreateDescription('');
              setCreateOpen(true);
            }}
          >
            Nova forma
          </Button>
        ) : null}
      </header>

      <div className="grid gap-4 vfm-form-builder-grid">
        <Card>
          <CardHeader title="Katalog" description={`${formsQuery.data?.length ?? 0} formi`} />
          <CardContent className="space-y-1">
            {!formsQuery.isPending && !formsQuery.isError && subjectsWithoutPublishedForm.length > 0 ? (
              <p
                role="alert"
                className="mb-2 rounded-md border border-warning bg-warning-soft p-3 text-xs text-warning"
              >
                Nema aktivne objavljene forme za: {' '}
                {subjectsWithoutPublishedForm.map((subject) => SUBJECT_LABELS[subject]).join(', ')}.
                {' '}Provjerite katalog i objavite potrebne forme prije unosa podataka.
              </p>
            ) : null}
            {formsQuery.isPending ? (
              <p role="status" className="text-xs text-fg-muted">
                Učitavanje…
              </p>
            ) : null}
            {formsQuery.isError ? (
              <p role="alert" className="text-xs text-danger">
                Katalog nije dostupan.
              </p>
            ) : null}
            {formsQuery.data?.length === 0 ? <EmptyState title="Nema formi" /> : null}
            {formsQuery.data?.map((form) => (
              <Button
                key={form.id}
                type="button"
                size="md"
                variant={form.id === formId ? 'secondary' : 'ghost'}
                onClick={() => {
                  setFormId(form.id);
                  setVersionId(null);
                  setMessage(null);
                }}
                aria-pressed={form.id === formId}
                className="w-full justify-start whitespace-normal text-left"
              >
                <span className="block font-medium">{form.name}</span>
                <span className="block text-xs text-fg-muted">
                  {SUBJECT_LABELS[form.subject]} · {FORM_STATUS_LABELS[form.status]} · {form.versionCount}{' '}
                  {form.versionCount === 1 ? 'verzija' : 'verzije'}
                </span>
              </Button>
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
                <Table scrollLabel="Verzije forme — pomjerite tabelu horizontalno za pregled svih kolona">
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
                        className={version.id === versionId ? 'bg-surface-muted' : undefined}
                      >
                        <TD>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="font-medium underline-offset-2 hover:underline"
                            onClick={() => setVersionId(version.id)}
                          >
                            v{version.version}
                          </Button>
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
                          <code className="text-xs">{shortHash(version.contentHash)}</code>
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

          {selected && versionQuery.data ? (
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

                <div className="flex gap-1" role="tablist" aria-label="Način prikaza">
                  <Button
                    size="sm"
                    variant={mode === 'editor' ? 'primary' : 'ghost'}
                    role="tab"
                    aria-selected={mode === 'editor'}
                    onClick={() => setMode('editor')}
                  >
                    Dizajn
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === 'pregled' ? 'primary' : 'ghost'}
                    role="tab"
                    aria-selected={mode === 'pregled'}
                    onClick={() => setMode('pregled')}
                  >
                    Pregled
                  </Button>
                </div>

                {mode === 'pregled' && definitionResult.ok ? (
                  <div className="rounded-md border border-border p-3">
                    <FormsPreview
                      definition={definitionResult.definition}
                      version={selected.version}
                      formSchemaVersionId={selected.id}
                    />
                  </div>
                ) : null}

                {mode === 'editor' ? (
                  definitionResult.ok ? (
                    <FormsDesigner
                      definition={definitionResult.definition}
                      readOnly={!actions.includes('edit')}
                      onChange={(definition) => setEditor(JSON.stringify(definition, null, 2))}
                    />
                  ) : (
                    <p
                      role="alert"
                      className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger"
                    >
                      Definicija nije ispravna za vizuelni prikaz. Izmjena je zaustavljena da se sačuvani
                      sadržaj ne prepiše.
                    </p>
                  )
                ) : null}

                {!parsed.ok ? (
                  <ul role="alert" className="space-y-1 rounded-md border border-danger p-2 text-xs">
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
                    className={`text-xs ${message.kind === 'error' ? 'text-danger' : 'text-success'}`}
                  >
                    {message.text}
                  </p>
                ) : null}

                {diff ? (
                  <div className="rounded-md border border-border p-2 text-xs">
                    <p className="mb-1 font-medium">
                      Diff v{diff.from.version} → v{diff.to.version}
                    </p>
                    {diff.empty ? (
                      <p className="text-fg-muted">Nema strukturnih razlika.</p>
                    ) : (
                      <ul className="space-y-0.5 font-mono text-xs">
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

          {formId && detailQuery.isPending && !detail ? (
            <p role="status" className="text-sm text-fg-muted">
              Učitavanje detalja forme…
            </p>
          ) : null}

          {formId && detailQuery.isError ? (
            <Card>
              <CardContent className="space-y-3">
                <p role="alert" className="text-sm text-danger">
                  {detailQuery.error instanceof ApiError
                    ? detailQuery.error.message
                    : 'Detalj forme nije moguće učitati.'}
                </p>
                <Button size="sm" variant="secondary" onClick={() => void detailQuery.refetch()}>
                  Pokušaj ponovo
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {selected && versionQuery.isPending ? (
            <p role="status" className="text-sm text-fg-muted">
              Učitavanje definicije verzije…
            </p>
          ) : null}

          {selected && versionQuery.isError ? (
            <Card>
              <CardContent className="space-y-3">
                <p role="alert" className="text-sm text-danger">
                  {versionQuery.error instanceof ApiError
                    ? versionQuery.error.message
                    : 'Definiciju verzije nije moguće učitati.'}
                </p>
                <Button size="sm" variant="secondary" onClick={() => void versionQuery.refetch()}>
                  Pokušaj ponovo
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {!detail &&
          !formsQuery.isPending &&
          !formsQuery.isError &&
          !detailQuery.isPending &&
          !detailQuery.isError ? (
            <Card>
              <CardContent>
                <EmptyState title="Odaberi formu iz kataloga" />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      <Modal
        open={createOpen}
        title="Nova forma"
        description="Kreirajte nacrt kroz osnovne podatke, zatim dodajte sekcije i polja u vizuelnom dizajneru."
        onClose={() => setCreateOpen(false)}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createForm.isPending}>
              Odustani
            </Button>
            <Button type="submit" form="create-form-schema" loading={createForm.isPending}>
              Kreiraj nacrt
            </Button>
          </>
        }
      >
        <form
          id="create-form-schema"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createForm.mutate({
              key: createKey.trim(),
              name: createName.trim(),
              subject: createSubject,
              taskTypeId: null,
              description: createDescription.trim() || null,
              ownerModule: null,
              definition: {
                $schema: 'vfm-form/1',
                meta: {
                  title: createName.trim(),
                  description: createDescription.trim() || null,
                  subject: createSubject,
                  language: 'bs',
                },
                layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
                sections: [
                  {
                    key: 'osnovno',
                    title: 'Osnovno',
                    description: null,
                    order: 1,
                    visibleWhen: null,
                    fields: [
                      {
                        key: 'napomena',
                        type: 'TEXT',
                        label: 'Napomena',
                        order: 1,
                        required: false,
                        visibleWhen: null,
                        disabled: false,
                        visibleOnForm: true,
                        storeInFormData: true,
                      },
                    ],
                  },
                ],
              },
            });
          }}
        >
          <Field label="Naziv forme" htmlFor="create-form-name">
            <input
              id="create-form-name"
              className={inputClassName}
              required
              minLength={3}
              maxLength={120}
              value={createName}
              onChange={(event) => {
                setCreateName(event.target.value);
                setCreateKey((current) =>
                  current === formKeyFromName(createName) || !current
                    ? formKeyFromName(event.target.value)
                    : current,
                );
              }}
            />
          </Field>
          <Field
            label="Jedinstveni ključ"
            htmlFor="create-form-key"
            hint="Mala slova, brojevi i donja crta; stabilan identifikator."
          >
            <input
              id="create-form-key"
              className={inputClassName}
              required
              minLength={3}
              maxLength={49}
              pattern="[a-z][a-z0-9_]{2,48}"
              value={createKey}
              onChange={(event) => setCreateKey(event.target.value)}
            />
          </Field>
          <Field label="Predmet forme" htmlFor="create-form-subject">
            <select
              id="create-form-subject"
              className={inputClassName}
              value={createSubject}
              onChange={(event) => setCreateSubject(event.target.value as FormSubject)}
            >
              {FORM_SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {SUBJECT_LABELS[subject]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opis" htmlFor="create-form-description">
            <input
              id="create-form-description"
              className={inputClassName}
              maxLength={500}
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
