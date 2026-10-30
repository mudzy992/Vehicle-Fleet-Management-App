import type { OUTBOX_EVENT_TYPES } from '@vfm/shared';
import type { NotificationView } from '@vfm/shared/schemas';

export const NOTIFICATION_TYPE_LABELS: Readonly<Record<(typeof OUTBOX_EVENT_TYPES)[number], string>> = {
  TASK_CREATED: 'Novi zadatak',
  TASK_ASSIGNED: 'Promjena dodjele zadatka',
  TASK_CLAIMED: 'Zadatak preuzet',
  TASK_COMPLETED: 'Zadatak završen',
  TASK_RELEASED: 'Zadatak oslobođen',
  TASK_CANCELLED: 'Zadatak otkazan',
  TASK_REOPENED: 'Zadatak ponovo otvoren',
  TASK_DUE_SOON: 'Rok zadatka se približava',
  TASK_OVERDUE: 'Zadatak je prekoračio rok',
  REMINDER_DUE: 'Podsjetnik dospijeva',
  REGISTRATION_EXPIRING: 'Registracija ističe',
  INSURANCE_EXPIRING: 'Osiguranje ističe',
  SERVICE_DUE: 'Servis je dospio',
  DRIVER_LICENSE_EXPIRING: 'Dozvola vozača ističe',
  TIRE_SET_MOUNTED: 'Komplet guma montiran',
  TIRE_SET_DISMOUNTED: 'Komplet guma demontiran',
  TIRE_SET_SWAPPED: 'Kompleti guma zamijenjeni',
  REPORT_READY: 'Izvještaj je spreman',
  USER_PERMISSION_CHANGED: 'Prava pristupa su promijenjena',
};

export function notificationTypeLabel(type: string): string {
  return type in NOTIFICATION_TYPE_LABELS
    ? NOTIFICATION_TYPE_LABELS[type as keyof typeof NOTIFICATION_TYPE_LABELS]
    : type.toLowerCase().replaceAll('_', ' ');
}

export function notificationDate(value: string): string {
  return new Intl.DateTimeFormat('bs-BA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sarajevo',
  }).format(new Date(value));
}

export function notificationDestination(item: NotificationView): string | null {
  if (!item.linkToId) return null;
  switch (item.linkToType) {
    case 'TASK':
      return `/zadaci/${encodeURIComponent(item.linkToId)}`;
    case 'VEHICLE':
      return `/vozila/${encodeURIComponent(item.linkToId)}`;
    case 'DRIVER':
      return `/vozaci/${encodeURIComponent(item.linkToId)}`;
    default:
      return null;
  }
}

export function eventStreamPath(unreadOnly: boolean, page: number, pageSize: number): string {
  return `/notifications?page=${page}&pageSize=${pageSize}&unreadOnly=${unreadOnly}`;
}
