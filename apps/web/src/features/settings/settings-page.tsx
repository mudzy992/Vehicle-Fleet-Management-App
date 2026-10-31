import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettingList, AppSettingView } from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettingList>('/settings'),
  });
  const save = useMutation({
    mutationFn: (input: { key: string; value: boolean | number | string }) =>
      api.patch<AppSettingView>(`/settings/${encodeURIComponent(input.key)}`, { value: input.value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return (
    <main className="vfm-module-page mx-auto max-w-3xl space-y-4">
      <h1 className="vfm-module-title">Postavke</h1>
      {query.isError ? <p className="text-sm text-danger">Postavke nisu dostupne.</p> : null}
      {(query.data?.items ?? []).map((item) => (
        <Card key={item.key}>
          <CardHeader title={item.key} description={item.description} />
          <CardContent>
            {item.valueType === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  role="switch"
                  checked={Boolean(item.value)}
                  onChange={(event) => save.mutate({ key: item.key, value: event.target.checked })}
                />
                {item.value ? 'Uključeno' : 'Isključeno'}
              </label>
            ) : (
              <Field label={item.valueType === 'number' ? 'Broj' : 'Vrijednost'} htmlFor={`setting-${item.key}`}>
                <input
                  id={`setting-${item.key}`}
                  className={inputClassName}
                  type={item.valueType === 'number' ? 'number' : 'text'}
                  defaultValue={String(item.value)}
                  onBlur={(event) => {
                    const raw = event.target.value;
                    save.mutate({
                      key: item.key,
                      value: item.valueType === 'number' ? Number(raw) : raw,
                    });
                  }}
                />
              </Field>
            )}
          </CardContent>
        </Card>
      ))}
      {save.isError ? <p className="text-sm text-danger">Spremanje nije uspjelo.</p> : null}
      {query.data?.items.length === 0 ? <p className="text-sm text-fg-muted">Nema postavki.</p> : null}
      <Button className="sr-only" type="button" disabled>
        {save.isPending ? 'Spremanje' : 'Spremljeno'}
      </Button>
    </main>
  );
}
