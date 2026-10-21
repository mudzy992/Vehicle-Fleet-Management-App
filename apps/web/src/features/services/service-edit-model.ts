/** Čista logika izmjene servisa: početne vrijednosti i PATCH payload samo sa stvarnim izmjenama. */
import type { ServiceRecord, UpdateServiceInput } from '@vfm/shared/schemas';

export function initialServiceEditValues(record: ServiceRecord): Record<string, string> {
  return {
    serviceDate: record.serviceDate,
    serviceType: record.serviceType,
    workshopName: record.workshopName ?? '',
    description: record.description ?? '',
    odometerKm: record.odometerKm === null ? '' : String(record.odometerKm),
    nextServiceDueDate: record.nextServiceDueDate ?? '',
    nextServiceDueKm: record.nextServiceDueKm === null ? '' : String(record.nextServiceDueKm),
  };
}

export function buildServiceUpdatePayload(
  record: ServiceRecord,
  values: Readonly<Record<string, string>>,
): UpdateServiceInput {
  const serviceDate = requiredDate(values.serviceDate, 'Datum servisa');
  const serviceType = (values.serviceType ?? '').trim();
  if (!serviceType) throw new Error('Vrsta servisa je obavezna.');

  const workshopName = optionalText(values.workshopName);
  const description = optionalText(values.description);
  const odometerKm = parseOptionalKm(values.odometerKm, 'Kilometraža servisa');
  const nextServiceDueDate = optionalDate(values.nextServiceDueDate, 'Datum sljedećeg servisa');
  const nextServiceDueKm = parseOptionalKm(values.nextServiceDueKm, 'Kilometraža sljedećeg servisa');

  const payload: Record<string, unknown> = { version: record.version };
  if (serviceDate !== record.serviceDate) payload.serviceDate = serviceDate;
  if (serviceType !== record.serviceType) payload.serviceType = serviceType;
  if (workshopName !== record.workshopName) payload.workshopName = workshopName;
  if (description !== record.description) payload.description = description;
  if (odometerKm !== record.odometerKm) payload.odometerKm = odometerKm;
  if (nextServiceDueDate !== record.nextServiceDueDate) payload.nextServiceDueDate = nextServiceDueDate;
  if (nextServiceDueKm !== record.nextServiceDueKm) payload.nextServiceDueKm = nextServiceDueKm;

  const scheduleChanged = ['serviceDate', 'odometerKm', 'nextServiceDueDate', 'nextServiceDueKm'].some(
    (key) => key in payload,
  );
  if (scheduleChanged) {
    if (nextServiceDueDate && nextServiceDueDate < serviceDate) {
      throw new Error('Sljedeći servis ne može prethoditi ovom servisu.');
    }
    if (odometerKm !== null && nextServiceDueKm !== null && nextServiceDueKm < odometerKm) {
      throw new Error('Sljedeći servis ne može biti na manjoj kilometraži od ovog servisa.');
    }
  }

  if (Object.keys(payload).length === 1) throw new Error('Nema izmjena za snimanje.');
  return payload as UpdateServiceInput;
}

function optionalText(raw: string | undefined): string | null {
  return (raw ?? '').trim() || null;
}

function parseOptionalKm(raw: string | undefined, label: string): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (!/^\d+$/u.test(text)) throw new Error(`${label} mora biti nenegativan cijeli broj.`);
  const value = Number(text);
  if (value > 2147483647) throw new Error(`${label} prelazi dozvoljeni opseg.`);
  return value;
}

function requiredDate(raw: string | undefined, label: string): string {
  const value = optionalDate(raw, label);
  if (!value) throw new Error(`${label} je obavezan.`);
  return value;
}

function optionalDate(raw: string | undefined, label: string): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new Error(`${label} nije ispravan datum.`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} nije ispravan datum.`);
  }
  return text;
}
