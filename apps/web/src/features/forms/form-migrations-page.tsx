import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MIGRATION_TARGET_ENTITIES } from '@vfm/shared';
import type { FormMigrationJob, FormMigrationPreview, FormSchemaSummary } from '@vfm/shared/schemas';
import { BareButton, Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';

export function FormMigrationsPage() {
  const queryClient = useQueryClient();
  const [formSchemaId, setFormSchemaId] = useState('');
  const [fromVersionId, setFromVersionId] = useState('');
  const [toVersionId, setToVersionId] = useState('');
  const [targetEntityType, setTargetEntityType] = useState<(typeof MIGRATION_TARGET_ENTITIES)[number]>('TASK');
  const [changeNote, setChangeNote] = useState('Migracija zapisa na novu verziju forme.');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const formsQuery = useQuery({
    queryKey: ['form-schemas'],
    queryFn: () => api.get<FormSchemaSummary[]>('/form-schemas'),
  });
  const jobsQuery = useQuery({
    queryKey: ['form-migrations', formSchemaId],
    queryFn: () =>
      api.get<FormMigrationJob[]>(
        formSchemaId ? `/form-migrations?formSchemaId=${formSchemaId}` : '/form-migrations',
      ),
  });
  const previewQuery = useQuery({
    queryKey: ['form-migration', selectedId],
    queryFn: () => api.get<FormMigrationPreview>(`/form-migrations/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<FormMigrationJob>('/form-migrations', {
        formSchemaId,
        fromVersionId,
        toVersionId,
        targetEntityType,
      }),
    onSuccess: async (job) => {
      setSelectedId(job.id);
      await queryClient.invalidateQueries({ queryKey: ['form-migrations'] });
    },
  });
  const preview = useMutation({
    mutationFn: (id: string) => api.post<FormMigrationPreview>(`/form-migrations/${id}/preview`, {}),
    onSuccess: async (job) => {
      setSelectedId(job.id);
      await queryClient.invalidateQueries({ queryKey: ['form-migration', job.id] });
    },
  });
  const apply = useMutation({
    mutationFn: (id: string) => api.post(`/form-migrations/${id}/apply`, { changeNote }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['form-migrations'] }),
  });
  const rollback = useMutation({
    mutationFn: (id: string) => api.post(`/form-migrations/${id}/rollback`, { changeNote }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['form-migrations'] }),
  });

  return (
    <main className="vfm-module-page mx-auto max-w-4xl space-y-4">
      <h1 className="vfm-module-title">Migracija formi</h1>
      <Card>
        <CardHeader title="Novi posao" description="Preview ništa ne mijenja; apply traži bilješku." />
        <CardContent className="space-y-3">
          <Field label="Forma" htmlFor="mig-form">
            <select
              id="mig-form"
              className={inputClassName}
              value={formSchemaId}
              onChange={(event) => setFormSchemaId(event.target.value)}
            >
              <option value="">Odaberite formu…</option>
              {(formsQuery.data ?? []).map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name} · {form.key}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sa verzije (ID)" htmlFor="mig-from">
            <input id="mig-from" className={inputClassName} value={fromVersionId} onChange={(event) => setFromVersionId(event.target.value)} />
          </Field>
          <Field label="Na verziju (ID)" htmlFor="mig-to">
            <input id="mig-to" className={inputClassName} value={toVersionId} onChange={(event) => setToVersionId(event.target.value)} />
          </Field>
          <Field label="Entitet" htmlFor="mig-entity">
            <select
              id="mig-entity"
              className={inputClassName}
              value={targetEntityType}
              onChange={(event) =>
                setTargetEntityType(event.target.value as (typeof MIGRATION_TARGET_ENTITIES)[number])
              }
            >
              {MIGRATION_TARGET_ENTITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={!formSchemaId || !fromVersionId || !toVersionId || create.isPending}
            onClick={() => create.mutate()}
          >
            Kreiraj posao
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Poslovi" />
        <CardContent className="space-y-2">
          {(jobsQuery.data ?? []).map((job) => (
            <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2">
              <BareButton className="text-left text-sm" onClick={() => setSelectedId(job.id)}>
                {job.id} · {job.status} · {job.targetEntityType}
              </BareButton>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => preview.mutate(job.id)}>
                  Preview
                </Button>
                <Button size="sm" onClick={() => apply.mutate(job.id)}>
                  Primijeni
                </Button>
                <Button size="sm" variant="ghost" onClick={() => rollback.mutate(job.id)}>
                  Vrati
                </Button>
              </div>
            </div>
          ))}
          <Field label="Bilješka" htmlFor="mig-note">
            <input id="mig-note" className={inputClassName} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} />
          </Field>
          {previewQuery.data ? (
            <p className="text-sm text-fg-muted">
              Pregled: {previewQuery.data.summary.total} zapisa, {previewQuery.data.summary.ok} OK.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
