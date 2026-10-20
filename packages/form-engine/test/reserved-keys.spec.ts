import { describe, expect, it } from 'vitest';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_KEY_MIN_LENGTH,
  FIELD_KEY_PATTERN,
  RESERVED_FIELD_KEYS,
  checkFieldKey,
  checkFieldKeys,
  isReservedFieldKey,
  isValidFieldKeyFormat,
} from '../dist/index.js';

describe('rezervisani ključevi (docs/04 §5)', () => {
  it('odbija svaki ključ iz dokumentovane liste', () => {
    for (const key of RESERVED_FIELD_KEYS) {
      expect(isReservedFieldKey(key), key).toBe(true);

      const issue = checkFieldKey(key);
      expect(issue?.code, key).toBe('RESERVED_FIELD_KEY');
    }
  });

  it('lista sadrži sve ključeve iz dokumenta (B-17/U-05)', () => {
    // Dokumentovana lista iz docs/04 §5 — promjena dokumenta bez promjene koda
    // mora pasti ovdje, jer bi inače dinamičko polje moglo pregaziti kolonu.
    const documented = [
      'id',
      'code',
      'status',
      'priority',
      'vehicleId',
      'taskTypeId',
      'createdById',
      'assigneeUserId',
      'claimedAt',
      'completedAt',
      'completedById',
      'cancelledAt',
      'cancelReason',
      'dueAt',
      'dueDate',
      'durationMinutes',
      'version',
      'formSchemaId',
      'formSchemaVersionId',
      'formData',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'roles',
      'permissions',
      '__proto__',
      'constructor',
      'prototype',
    ];
    expect([...RESERVED_FIELD_KEYS].sort()).toEqual([...documented].sort());
  });

  it('poređenje je case-insensitive (Status != status u JSONB-u)', () => {
    expect(isReservedFieldKey('Status')).toBe(true);
    expect(isReservedFieldKey('vehicleid')).toBe(true);
    expect(isReservedFieldKey('  createdAt  ')).toBe(true);
    expect(checkFieldKey('DeletedAt')?.code).toBe('RESERVED_FIELD_KEY');
  });

  it('rezervisan ključ ima prednost nad formatom (čitljivija greška)', () => {
    // `__proto__` ne zadovoljava format, ali poruka mora biti o rezervaciji.
    expect(isValidFieldKeyFormat('__proto__')).toBe(false);
    expect(checkFieldKey('__proto__')?.code).toBe('RESERVED_FIELD_KEY');
  });

  it('prihvata ispravne ključeve u donjemCamelCase i snake_case formatu', () => {
    for (const key of ['odometerKm', 'washType', 'photos_after', 'a1', 'x_9']) {
      expect(checkFieldKey(key), key).toBeNull();
      expect(isValidFieldKeyFormat(key), key).toBe(true);
    }
  });

  it('odbija ključ koji počinje velikim slovom, brojem ili donjom crtom', () => {
    for (const key of ['OdometerKm', '1polje', '_internal']) {
      expect(checkFieldKey(key)?.code, key).toBe('INVALID_FIELD_KEY_FORMAT');
    }
  });

  it('odbija tačke, razmake, crtice i dijakritiku', () => {
    for (const key of ['a.b', 'a b', 'a-b', 'dužina', 'polje!']) {
      expect(checkFieldKey(key)?.code, key).toBe('INVALID_FIELD_KEY_FORMAT');
    }
  });

  it('poštuje granice dužine iz dokumenta (2–49)', () => {
    expect(checkFieldKey('a')).not.toBeNull();
    expect(checkFieldKey('ab')).toBeNull();
    expect(checkFieldKey('a'.repeat(FIELD_KEY_MAX_LENGTH))).toBeNull();
    expect(checkFieldKey('a'.repeat(FIELD_KEY_MAX_LENGTH + 1))).not.toBeNull();
    expect(FIELD_KEY_MIN_LENGTH).toBe(2);
    expect(FIELD_KEY_PATTERN.source).toBe('^[a-z][a-zA-Z0-9_]{1,48}$');
  });

  it('checkFieldKeys vraća sve probleme, ne samo prvi', () => {
    const issues = checkFieldKeys(['ok_kljuc', 'status', 'Loše', 'drugi_ok']);

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.code)).toEqual(['RESERVED_FIELD_KEY', 'INVALID_FIELD_KEY_FORMAT']);
    expect(issues[0]?.message).toContain('status');
  });

  it('poruke su na bosanskom i sadrže ključ', () => {
    const issue = checkFieldKey('status');

    expect(issue?.message).toContain('rezervisan');
    expect(issue?.message).toContain('status');
  });
});
