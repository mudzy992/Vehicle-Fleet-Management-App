/** Model prikaza liste zadataka (docs/06 §8.1; docs/07 §2.11). */
import type { TaskListResponse } from '@vfm/shared/schemas';
import { toQueryString } from '../vehicles/vehicles-model.js';

export type TaskListTab = 'available' | 'mine' | 'all';
export const TASKS_PAGE_SIZE = 25;

/** Odabir endpointa/parametara bez slanja filtera koje API ne podržava. */
export function taskListPath(tab: TaskListTab, page: number): string {
  const query = { page, pageSize: TASKS_PAGE_SIZE };
  const endpoint = tab === 'available' ? '/tasks/available' : '/tasks';
  const params = tab === 'mine' ? { ...query, mine: true } : query;
  return `${endpoint}?${toQueryString(params)}`;
}

export function taskCountLabel(response: TaskListResponse | undefined): string {
  if (!response) return 'Zadaci';
  const remainder100 = response.total % 100;
  const remainder10 = response.total % 10;
  const noun =
    remainder100 >= 11 && remainder100 <= 14
      ? 'zadataka'
      : remainder10 === 1
        ? 'zadatak'
        : remainder10 >= 2 && remainder10 <= 4
          ? 'zadatka'
          : 'zadataka';
  return `${response.total} ${noun}`;
}

export function taskDateTime(value: string | null): string {
  if (!value) return 'Bez roka';
  return new Date(value).toLocaleString('bs-BA', {
    timeZone: 'Europe/Sarajevo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
