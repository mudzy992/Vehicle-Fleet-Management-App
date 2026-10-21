/** Stavke se snimaju kao cijela verzionisana cjelina; server računa zbir. */
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { ServiceItemInput, ServiceItemsResponse } from '@vfm/shared/schemas';
import { Button, Field, inputClassName } from '../../components/ui/index.js';
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
    <section className="space-y-4">
      <h3 className="font-semibold">Stavke računa · verzija {initial.version}</h3>
      <p>Ukupni trošak: {feninziToInput(initial.totalCost)} KM</p>
      {!editing ? (
        <>
          <ul className="space-y-2">
            {initial.items.map((item) => (
              <li key={item.id}>
                {LABELS[item.kind]} · {item.name} · {item.quantityHundredths / 100} ×{' '}
                {feninziToInput(item.unitPrice)} KM = {feninziToInput(item.totalPrice)} KM
                {item.partNumber && <p>Šifra: {item.partNumber}</p>}
                {item.notes && <p>{item.notes}</p>}
              </li>
            ))}
          </ul>
          {!initial.items.length && <p>Nema stavki. Ukupni trošak je do sada unesen ručno.</p>}
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
              className="grid gap-2 rounded border p-3 sm:grid-cols-2"
            >
              <legend>Stavka {index + 1}</legend>
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
    </section>
  );
}
