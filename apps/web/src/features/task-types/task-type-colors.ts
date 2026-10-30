export const TASK_TYPE_COLOR_OPTIONS = [
  { key: 'primary', label: 'Akcent', token: '--task-color-primary' },
  { key: 'success', label: 'Zelena', token: '--task-color-success' },
  { key: 'info', label: 'Plava', token: '--task-color-info' },
  { key: 'warning', label: 'Žuta', token: '--task-color-warning' },
  { key: 'danger', label: 'Crvena', token: '--task-color-danger' },
  { key: 'neutral', label: 'Neutralna', token: '--task-color-neutral' },
] as const;

export function taskTypeColorHex(key: string): string {
  const option = TASK_TYPE_COLOR_OPTIONS.find((item) => item.key === key);
  if (!option || typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(option.token).trim().toUpperCase();
}

export function taskTypeColorClass(colorHex: string | null | undefined): string {
  const normalized = colorHex?.trim().toUpperCase();
  const matched = TASK_TYPE_COLOR_OPTIONS.find((item) => taskTypeColorHex(item.key) === normalized);
  return `vfm-task-type-color-${matched?.key ?? 'neutral'}`;
}
