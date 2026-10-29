import { formatServiceMoney, formatServiceQuantity } from './service-items-display.js';
/** Stavke se snimaju kao cijela verzionisana cjelina; server računa zbir. */
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { ServiceItemInput, ServiceItemsResponse } from '@vfm/shared/schemas';
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
import { api, ApiError } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { moneyToFeninzi, feninziToInput } from '../vehicles/records-model.js';

type Draft = {
  kind: ServiceItemInput['kind'];
  name: string;
  quantity: string;
  price: string;
  partNumber: string;
  notes: string;
};
const LABELS = { PART: 'Dio', LABOR: 'Rad', FLUID: 'Tečnost', OTHER: 'Ostalo' } as const;
export function ServiceItemsPanel({ serviceId, onClose }: { serviceId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['service-items', serviceId],
    queryFn: () => api.get<ServiceItemsResponse>(`/services/${serviceId}/items`),
  });
  if (query.isPending) return <p>Učitavanje stavki…</p>;
  if (query.error || !query.data)
    return (
      <div role="alert">
        <p>Stavke nije moguće učitati.</p>
        <Button onClick={onClose}>Zatvori</Button>
      </div>
    );
  return (
    <ItemsEditor
      key={`${serviceId}-${query.data.version}`}
      serviceId={serviceId}
      initial={query.data}
      onClose={onClose}
    />
  );
}
function ItemsEditor({
  serviceId,
  initial,
  onClose,
}: {
  serviceId: string;
  initial: ServiceItemsResponse;
  onClose: () => void;
}) {
  const { hasPermission } = useSession();
  const canEdit = hasPermission('service:update');
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<Draft[]>(() =>
    initial.items.map((item) => ({
      kind: item.kind,
      name: item.name,
      quantity: (item.quantityHundredths / 100).toFixed(2),
      price: feninziToInput(item.unitPrice),
      partNumber: item.partNumber ?? '',
      notes: item.notes ?? '',
    })),
  );
  const [message, setMessage] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const parsed = items.map((item) => {
        const quantity = item.quantity.trim().replace(',', '.');
        const unitPrice = moneyToFeninzi(item.price);
        if (!/^\d+(\.\d{1,2})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 10000)
          throw new Error('Količina mora biti veća od nule, do 10000, s najviše dvije decimale.');
        if (unitPrice === null) throw new Error('Unesite ispravnu jediničnu cijenu u KM.');
        if (!item.name.trim()) throw new Error('Naziv je obavezan za svaku stavku.');
        return {
          kind: item.kind,
          name: item.name.trim(),
          quantityHundredths: Math.round(Number(quantity) * 100),
          unitPrice,
          partNumber: item.partNumber.trim() || null,
          notes: item.notes.trim() || null,
        };
      });
      return api.put(`/services/${serviceId}/items`, { version: initial.version, items: parsed });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['services'] }),
        client.invalidateQueries({ queryKey: ['service-items', serviceId] }),
      ]);
      onClose();
    },
    onError: (error) =>
      setMessage(
        error instanceof ApiError || error instanceof Error ? error.message : 'Snimanje nije uspjelo.',
      ),
  });
  function change(index: number, key: keyof Draft, value: string) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }
  return (
    <Card>
      <CardHeader
        title="Stavke računa"
        description={`Verzija zapisa ${initial.version} · ${initial.items.length} stavki`}
        actions={
          <Button size="sm" variant="ghost" disabled={save.isPending} onClick={onClose}>
            Nazad na servise
          </Button>
        }
      />
      <CardContent>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--hover)] p-4">
            <div>
              <p className="text-xs text-[var(--fg-muted)]">Sačuvani ukupni trošak</p>
              <p className="text-xl font-semibold tabular-nums">{formatServiceMoney(initial.totalCost)}</p>
            </div>
            <p className="max-w-sm text-sm text-[var(--fg-muted)]">
              {editing
                ? 'Nove vrijednosti se primjenjuju tek nakon potvrde snimanja.'
                : 'Iznosi stavki su zaokruženi na fening.'}
            </p>
          </div>
          {!editing ? (
            <>
              {initial.items.length ? (
                <Table scrollLabel="Stavke servisa — pomjerite tabelu horizontalno za pregled svih kolona">
                  <THead>
                    <TR>
                      <TH>Stavka</TH>
                      <TH>Vrsta</TH>
                      <TH align="right">Količina</TH>
                      <TH align="right">Jedinična cijena</TH>
                      <TH align="right">Iznos</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {initial.items.map((item) => (
                      <TR key={item.id}>
                        <TD>
                          <p className="font-medium break-words">{item.name}</p>
                          {item.partNumber && (
                            <p className="text-xs text-[var(--fg-muted)]">Šifra: {item.partNumber}</p>
                          )}
                          {item.notes && (
                            <p className="max-w-md whitespace-pre-wrap break-words text-sm text-[var(--fg-muted)]">
                              {item.notes}
                            </p>
                          )}
                        </TD>
                        <TD>
                          <Badge level="neutral">{LABELS[item.kind]}</Badge>
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatServiceQuantity(item.quantityHundredths)}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatServiceMoney(item.unitPrice)}
                        </TD>
                        <TD align="right" className="whitespace-nowrap font-semibold tabular-nums">
                          {formatServiceMoney(item.totalPrice)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState
                  title="Nema stavki računa"
                  description="Ukupni trošak je unesen ručno. Dodavanjem stavki njihov zbir zamjenjuje taj iznos."
                />
              )}
              {canEdit && (
                <Button size="sm" onClick={() => setEditing(true)}>
                  Uredi stavke
                </Button>
              )}
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  window.confirm(
                    'Zamijeniti sve stavke i ukupni trošak njihovim zbirom? Prazna lista postavlja trošak na 0 KM.',
                  )
                ) {
                  setMessage('');
                  save.mutate();
                }
              }}
            >
              <p className="text-sm">
                Zbir stavki zamjenjuje prethodni ukupni trošak. Svaka stavka se zaokružuje na fening.
              </p>
              {items.map((item, index) => (
                <fieldset
                  key={index}
                  disabled={save.isPending}
                  className="min-w-0 rounded-lg border border-[var(--border)] p-4"
                >
                  <legend className="px-2 text-sm font-semibold">Stavka {index + 1}</legend>
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Vrsta" htmlFor={`stavka-${index}-kind`}>
                      <select
                        id={`stavka-${index}-kind`}
                        className={inputClassName}
                        value={item.kind}
                        onChange={(e) => change(index, 'kind', e.target.value)}
                      >
                        {Object.entries(LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {(
                      [
                        ['name', 'Naziv'],
                        ['quantity', 'Količina'],
                        ['price', 'Jedinična cijena (KM)'],
                        ['partNumber', 'Šifra dijela'],
                        ['notes', 'Napomena'],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} label={label} htmlFor={`stavka-${index}-${key}`}>
                        <input
                          id={`stavka-${index}-${key}`}
                          className={inputClassName}
                          value={item[key]}
                          inputMode={key === 'quantity' || key === 'price' ? 'decimal' : undefined}
                          maxLength={
                            key === 'notes' ? 2000 : key === 'name' ? 200 : key === 'partNumber' ? 120 : 30
                          }
                          required={key === 'name' || key === 'quantity' || key === 'price'}
                          onChange={(e) => change(index, key, e.target.value)}
                        />
                      </Field>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    >
                      Ukloni stavku
                    </Button>
                  </div>
                </fieldset>
              ))}
              {message && (
                <p role="alert" className="text-[var(--danger)]">
                  {message} Unos nije obrisan. Ako je verzija zastarjela, zatvorite i ponovo otvorite stavke.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={items.length >= 100 || save.isPending}
                  onClick={() =>
                    setItems((current) => [
                      ...current,
                      { kind: 'PART', name: '', quantity: '1', price: '', partNumber: '', notes: '' },
                    ])
                  }
                >
                  Dodaj stavku
                </Button>
                <Button type="submit" loading={save.isPending}>
                  Sačuvaj stavke
                </Button>
              </div>
            </form>
          )}
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
