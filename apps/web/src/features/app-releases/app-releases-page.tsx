import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, Modal, Table, TBody, TD, TH, THead, TR } from '../../components/ui/index.js';
import { toast } from '../../lib/toast.js';
import {
  activateAppRelease,
  fetchAppReleaseHistory,
  formatBytes,
  uploadAppRelease,
  type AppReleaseListItem,
} from './app-releases-api.js';
import { AppReleaseUploadForm } from './app-release-upload-form.js';

export function AppReleasesPage() {
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const history = useQuery({ queryKey: ['app-releases'], queryFn: fetchAppReleaseHistory });
  const upload = useMutation({
    mutationFn: ({ file, notes }: { file: File; notes: string }) => uploadAppRelease(file, notes),
    onSuccess: async (release) => {
      toast.success(`Objavljena verzija ${release.versionName} (${release.versionCode}).`);
      setUploadOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['app-releases'] });
    },
    onError: () => toast.danger('Upload APK-a nije uspio.'),
  });
  const activate = useMutation({
    mutationFn: activateAppRelease,
    onSuccess: async (release) => {
      toast.success(`Aktivirana verzija ${release.versionName} (${release.versionCode}).`);
      await queryClient.invalidateQueries({ queryKey: ['app-releases'] });
    },
    onError: () => toast.danger('Aktivacija izdanja nije uspjela.'),
  });

  return (
    <main className="vfm-module-page mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="vfm-module-title">Mobilna aplikacija</h1>
        <Button type="button" variant="primary" onClick={() => setUploadOpen(true)}>
          Objavi APK
        </Button>
      </div>
      <Card className="p-4">
        {history.data?.items.length ? (
          <HistoryTable
            items={history.data.items}
            busyId={activate.isPending ? activate.variables : null}
            onActivate={(id) => activate.mutate(id)}
          />
        ) : (
          <EmptyState title="Nema izdanja" description="Objavite prvi APK da bi prijava i mobilna aplikacija dobile zadnju verziju." />
        )}
      </Card>
      <Modal
        open={uploadOpen}
        title="Novo izdanje"
        description="versionCode i versionName se čitaju iz APK-a."
        onClose={() => setUploadOpen(false)}
      >
        <AppReleaseUploadForm
          busy={upload.isPending}
          onSubmitFile={(file, notes) => upload.mutate({ file, notes })}
        />
        {upload.data ? (
          <p className="mt-4 text-sm text-fg-muted" role="status">
            {upload.data.versionName} · {upload.data.versionCode} · {upload.data.sha256.slice(0, 12)}… ·{' '}
            {formatBytes(upload.data.sizeBytes)}
          </p>
        ) : null}
      </Modal>
    </main>
  );
}

function HistoryTable({
  items,
  busyId,
  onActivate,
}: {
  readonly items: readonly AppReleaseListItem[];
  readonly busyId: string | null | undefined;
  readonly onActivate: (id: string) => void;
}) {
  return (
    <Table scrollLabel="Historija APK izdanja">
      <THead>
        <TR>
          <TH>Verzija</TH>
          <TH>SHA-256</TH>
          <TH>Veličina</TH>
          <TH>Status</TH>
          <TH>Akcija</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((item) => (
          <TR key={item.id}>
            <TD>
              {item.versionName} ({item.versionCode})
            </TD>
            <TD className="font-mono text-xs">{item.sha256.slice(0, 16)}…</TD>
            <TD>{formatBytes(item.sizeBytes)}</TD>
            <TD>{item.isLatest ? 'Zadnja' : 'Arhiva'}</TD>
            <TD>
              {item.isLatest ? (
                '—'
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === item.id}
                  onClick={() => onActivate(item.id)}
                >
                  Aktiviraj
                </Button>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
