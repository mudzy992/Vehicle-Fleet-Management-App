import { describe, expect, it } from 'vitest';
import { SETTINGS_REGISTRY } from '../../src/modules/settings/settings.registry.js';

describe('Settings registry', () => {
  it('ima boolean switch, number i string ključeve s opisom', () => {
    expect(SETTINGS_REGISTRY.map((item) => item.key)).toEqual([
      'tasks.default_assign_mode',
      'tasks.link_records_enabled',
      'notifications.socket_enabled',
    ]);
    for (const item of SETTINGS_REGISTRY) {
      expect(item.description.length).toBeGreaterThan(8);
      expect(['boolean', 'number', 'string']).toContain(item.valueType);
      expect(['public', 'private']).toContain(item.scope);
    }
    expect(SETTINGS_REGISTRY.find((item) => item.key === 'tasks.link_records_enabled')?.valueType).toBe(
      'boolean',
    );
  });
});
