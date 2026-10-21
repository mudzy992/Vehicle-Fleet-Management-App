/** Čisti tekstovi i paginacija za soft-delete servisa; API ostaje autoritet za dozvolu i rokove. */
import type { ServiceRecord } from '@vfm/shared/schemas';

type ServiceDeleteRecord = Pick<ServiceRecord, 'serviceDate' | 'serviceType'>;

function formatServiceDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' });
}

export function serviceDeleteConfirmation(record: ServiceDeleteRecord): string {
  return (
    `Obrisati servis „${record.serviceType}“ od ${formatServiceDate(record.serviceDate)}? ` +
    'Servis i njegove stavke nestaju iz aktivne evidencije, rokovi vozila se ponovo računaju, ' +
    'a historija kilometraže ostaje sačuvana.'
  );
}

export function serviceDeletedMessage(record: ServiceDeleteRecord): string {
  return `Servis „${record.serviceType}“ od ${formatServiceDate(record.serviceDate)} je obrisan.`;
}

/** Nakon brisanja jedinog reda na strani korisnik ne smije ostati na nepostojećoj strani. */
export function nextServicesPageAfterDelete(currentPage: number, itemsOnCurrentPage: number): number {
  return itemsOnCurrentPage <= 1 && currentPage > 1 ? currentPage - 1 : currentPage;
}
