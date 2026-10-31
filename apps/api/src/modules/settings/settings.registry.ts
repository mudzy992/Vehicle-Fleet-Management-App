export interface SettingDefinition {
  readonly key: string;
  readonly valueType: 'boolean' | 'number' | 'string';
  readonly scope: 'public' | 'private';
  readonly description: string;
  readonly defaultValue: boolean | number | string;
}

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  {
    key: 'tasks.default_assign_mode',
    valueType: 'string',
    scope: 'private',
    description: 'Zadani način dodjele u wizardu kad vrsta nema vlastiti default (BROADCAST, OPEN_CLAIM, ASSIGN_DIRECT).',
    defaultValue: 'BROADCAST',
  },
  {
    key: 'tasks.link_records_enabled',
    valueType: 'boolean',
    scope: 'private',
    description: 'Pri završetku zadatka kreirati povezani zapis (servis, registracija, gume).',
    defaultValue: true,
  },
  {
    key: 'notifications.socket_enabled',
    valueType: 'boolean',
    scope: 'public',
    description: 'Realtime osvježavanje obavijesti i zadataka preko Socket.IO.',
    defaultValue: true,
  },
];
