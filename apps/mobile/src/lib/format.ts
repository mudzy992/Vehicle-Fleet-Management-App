import { deadlineInfo, formatDate, formatDateTime, formatOdometer, humanizeRemaining } from '@vfm/shared';

export function displayDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return value.length === 10 ? formatDate(`${value}T00:00:00Z`) : formatDateTime(value);
  } catch {
    return value;
  }
}

export function displayDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return formatDateTime(value);
  } catch {
    return value;
  }
}

export function displayOdometer(km: number): string {
  return formatOdometer(km);
}

export function dueAtFromDate(value: string): string | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(trimmed);
  const iso = /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : dotted ? `${dotted[3]}-${dotted[2]}-${dotted[1]}` : null;
  if (!iso) return null;
  const date = new Date(`${iso}T23:59:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return date.toISOString();
}

export function dueMeta(value: string | null | undefined): { label: string; level: ReturnType<typeof deadlineInfo>['level'] } | null {
  if (!value) return null;
  try {
    const info = deadlineInfo(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (info.days <= 0) return { label: 'Isteklo', level: 'danger' };
    return { label: humanizeRemaining(info.days), level: info.level };
  } catch {
    return null;
  }
}
