import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, inputClassName } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';

type Definition = { code: string; title: string; description: string; category: string };
type ReportData = { code: string; title: string; columns: string[]; rows: (string | number | null)[][] };
type VehicleOption = { id: string; label: string };
const dateText = (value: string | number | null) => {
  if (value === null || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('bs-BA').format(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('bs-BA', { dateStyle: 'medium' }).format(date);
};
const csvCell = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function ReportsPage() {
  const [reportCode, setReportCode] = useState('fleet-overview');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const { hasPermission } = useSession();
  const canExport = hasPermission('report:export');
  const catalog = useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: () => api.get<{ items: Definition[] }>('/reports'),
  });
  const vehicles = useQuery({
    queryKey: ['reports', 'vehicles'],
    queryFn: () => api.get<{ items: VehicleOption[] }>('/reports/vehicles'),
  });
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (vehicleId) params.set('vehicleId', vehicleId);
    const suffix = params.toString();
    return `/reports/${reportCode}${suffix ? `?${suffix}` : ''}`;
  }, [reportCode, from, to, vehicleId]);
  const result = useQuery({
    queryKey: ['reports', reportCode, from, to, vehicleId],
    queryFn: () => api.get<ReportData>(query),
    enabled: Boolean(reportCode),
  });
  const selected = catalog.data?.items.find((item) => item.code === reportCode);
  const data = result.data;

  const downloadCsv = async () => {
    if (!canExport || !data || isExporting) return;
    setExportError(null);
    setIsExporting(true);
    try {
      const exportPath = query.replace(`/reports/${reportCode}`, `/reports/${reportCode}/export`);
      const exported = await api.get<ReportData>(exportPath);
      const content = [exported.columns, ...exported.rows]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n');
      const blob = new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${exported.code}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(cause instanceof ApiError ? cause.message : 'CSV izvoz nije uspio. Pokušajte ponovo.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main className="vfm-module-page">
      <header className="vfm-module-heading">
        <div>
          <h1 className="vfm-module-title">Izvještaji</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Pregledajte operativne podatke flote i preuzmite rezultat u CSV formatu.
          </p>
        </div>
        {canExport && (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={downloadCsv}
            disabled={!data?.rows.length || isExporting}
            loading={isExporting}
          >
            Preuzmi CSV
          </Button>
        )}
      </header>
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 vfm-report-filter-grid">
          <label className="grid gap-1.5 text-sm font-medium">
            Izvještaj
            <select
              className={inputClassName}
              value={reportCode}
              onChange={(event) => setReportCode(event.target.value)}
            >
              {(catalog.data?.items ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Vozilo
            <select
              className={inputClassName}
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">Sva vozila</option>
              {(vehicles.data?.items ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Od datuma
            <input
              className={inputClassName}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Do datuma
            <input
              className={inputClassName}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </CardContent>
      </Card>
      {selected && <p className="text-sm text-fg-muted">{selected.description}</p>}
      {exportError && (
        <p role="alert" className="text-sm text-danger">
          {exportError}
        </p>
      )}
      {catalog.isError && (
        <p role="alert" className="text-sm text-danger">
          {catalog.error instanceof ApiError
            ? catalog.error.message
            : 'Izvještaji se trenutno ne mogu učitati.'}
        </p>
      )}
      {result.isPending && (
        <p role="status" className="text-sm text-fg-muted">
          Pripremamo izvještaj…
        </p>
      )}
      {result.isError && (
        <p role="alert" className="text-sm text-danger">
          {result.error instanceof ApiError
            ? result.error.message
            : 'Došlo je do greške pri učitavanju izvještaja.'}
        </p>
      )}
      {data && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="font-semibold">{data.title}</h2>
              <span className="text-sm text-fg-muted">
                {data.rows.length} {data.rows.length === 1 ? 'zapis' : 'zapisa'}
              </span>
            </div>
            {data.rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-fg-muted">
                Nema podataka za odabrane filtere.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full vfm-report-table text-left text-sm">
                  <thead className="bg-surface-muted text-xs uppercase tracking-wide text-fg-muted">
                    <tr>
                      {data.columns.map((column) => (
                        <th className="px-4 py-3 font-semibold" key={column}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, rowIndex) => (
                      <tr className="border-t border-border" key={`${data.code}-${rowIndex}`}>
                        {row.map((value, columnIndex) => (
                          <td className="px-4 py-3" key={`${columnIndex}`}>
                            {dateText(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {['fuel-consumption', 'tire-usage', 'vehicle-costs'].includes(data.code) &&
              data.rows.length >= 1000 && (
                <p className="border-t border-border px-4 py-3 text-xs text-fg-muted">
                  Prikazano je najviše 1.000 najnovijih zapisa. Suzi period ili odaberi vozilo za precizniji
                  izvoz.
                </p>
              )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
