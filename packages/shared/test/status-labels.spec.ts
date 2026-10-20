import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_STAGES,
  AUDIT_SEVERITIES,
  CLIENT_TYPES,
  DELIVERY_STATUSES,
  DEVICE_TOKEN_STATUSES,
  DRIVER_STATUSES,
  EXPORT_STATUSES,
  FIELD_TYPES,
  findMissingLabels,
  FORM_SCHEMA_STATUSES,
  FORM_SUBJECTS,
  FUEL_TYPES,
  LABEL_MAPS,
  MIGRATION_JOB_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUSES,
  ODOMETER_SOURCES,
  OUTBOX_STATUSES,
  OWNERSHIP_TYPES,
  RECORD_STATUSES,
  REMINDER_KINDS,
  REMINDER_STATUSES,
  ROLE_CODES,
  statusLabel,
  statusLevel,
  statusMeta,
  TASK_ASSIGN_MODES,
  TASK_ASSIGNMENT_ROLES,
  TASK_EVENT_ACTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPE_CODES,
  TIRE_DISMOUNT_REASONS,
  TIRE_POSITIONS,
  TIRE_SEASONS,
  TIRE_STATUSES,
  USER_STATUSES,
  VEHICLE_STATUSES,
} from '../dist/index.js';

/**
 * Kompletnost naziva: svaka vrijednost svakog enuma mora imati bosanski naziv.
 * Ako se u `docs/03` §2 doda nova vrijednost, ovi testovi padaju dok se naziv
 * ne dopuni u `status-labels.ts`.
 */
const COMPLETENESS: readonly [string, readonly string[], Record<string, unknown>][] = [
  ['USER_STATUS', USER_STATUSES, LABEL_MAPS.user],
  ['VEHICLE_STATUS', VEHICLE_STATUSES, LABEL_MAPS.vehicle],
  ['DRIVER_STATUS', DRIVER_STATUSES, LABEL_MAPS.driver],
  ['RECORD_STATUS', RECORD_STATUSES, LABEL_MAPS.record],
  ['TASK_STATUS', TASK_STATUSES, LABEL_MAPS.taskStatus],
  ['TASK_PRIORITY', TASK_PRIORITIES, LABEL_MAPS.taskPriority],
  ['TASK_ASSIGN_MODE', TASK_ASSIGN_MODES, LABEL_MAPS.taskAssignMode],
  ['TASK_ASSIGNMENT_ROLE', TASK_ASSIGNMENT_ROLES, LABEL_MAPS.taskAssignmentRole],
  ['TASK_EVENT_ACTION', TASK_EVENT_ACTIONS, LABEL_MAPS.taskEvent],
  ['TASK_TYPE', TASK_TYPE_CODES, LABEL_MAPS.taskType],
  ['FORM_SCHEMA_STATUS', FORM_SCHEMA_STATUSES, LABEL_MAPS.formSchemaStatus],
  ['FORM_SUBJECT', FORM_SUBJECTS, LABEL_MAPS.formSubject],
  ['FIELD_TYPE', FIELD_TYPES, LABEL_MAPS.fieldType],
  ['MIGRATION_JOB_STATUS', MIGRATION_JOB_STATUSES, LABEL_MAPS.migrationJob],
  ['TIRE_SEASON', TIRE_SEASONS, LABEL_MAPS.tireSeason],
  ['TIRE_STATUS', TIRE_STATUSES, LABEL_MAPS.tireStatus],
  ['TIRE_POSITION', TIRE_POSITIONS, LABEL_MAPS.tirePosition],
  ['TIRE_DISMOUNT_REASON', TIRE_DISMOUNT_REASONS, LABEL_MAPS.tireDismountReason],
  ['ATTACHMENT_STAGE', ATTACHMENT_STAGES, LABEL_MAPS.attachmentStage],
  ['OUTBOX_STATUS', OUTBOX_STATUSES, LABEL_MAPS.outbox],
  ['NOTIFICATION_STATUS', NOTIFICATION_STATUSES, LABEL_MAPS.notification],
  ['NOTIFICATION_CHANNEL', NOTIFICATION_CHANNELS, LABEL_MAPS.notificationChannel],
  ['NOTIFICATION_PRIORITY', NOTIFICATION_PRIORITIES, LABEL_MAPS.notificationPriority],
  ['DELIVERY_STATUS', DELIVERY_STATUSES, LABEL_MAPS.delivery],
  ['DEVICE_TOKEN_STATUS', DEVICE_TOKEN_STATUSES, LABEL_MAPS.deviceToken],
  ['REMINDER_KIND', REMINDER_KINDS, LABEL_MAPS.reminderKind],
  ['REMINDER_STATUS', REMINDER_STATUSES, LABEL_MAPS.reminderStatus],
  ['AUDIT_SEVERITY', AUDIT_SEVERITIES, LABEL_MAPS.auditSeverity],
  ['EXPORT_STATUS', EXPORT_STATUSES, LABEL_MAPS.exportStatus],
  ['FUEL_TYPE', FUEL_TYPES, LABEL_MAPS.fuelType],
  ['OWNERSHIP_TYPE', OWNERSHIP_TYPES, LABEL_MAPS.ownershipType],
  ['ODOMETER_SOURCE', ODOMETER_SOURCES, LABEL_MAPS.odometerSource],
  ['CLIENT_TYPE', CLIENT_TYPES, LABEL_MAPS.clientType],
  ['ROLE', ROLE_CODES, LABEL_MAPS.role],
];

describe('kompletnost naziva (svaki enum ima bs naziv)', () => {
  it.each(COMPLETENESS)('%s: sve vrijednosti imaju naziv', (_name, values, map) => {
    expect(findMissingLabels(values, map as Record<string, string>)).toEqual([]);
  });

  it('uloge: 3 sistemske + CUSTOM, s nazivima na bosanskom', () => {
    expect(ROLE_CODES).toEqual(['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK', 'CUSTOM']);
    expect(statusLabel('SUPER_ADMIN')).toBe('Super administrator');
    expect(statusLabel('OBICNI_KORISNIK')).toBe('Obični korisnik');
  });
});

describe('nazivi su na bosanskom (latinica s dijakriticima)', () => {
  it('koriste č/ć/š/ž/đ gdje je potrebno', () => {
    expect(statusLabel('COMPLETED')).toBe('Završen');
    expect(statusLabel('IN_PROGRESS')).toBe('U radu');
    expect(statusLabel('PUBLISHED')).toBe('Objavljeno');
    expect(statusLabel('DAMAGED')).toBe('Oštećeno');
    expect(statusLabel('IN_REPAIR')).toBe('Na popravci');
    expect(statusLabel('FL')).toBe('Naprijed lijevo');
    expect(statusLabel('SEASONAL_SWAP')).toBe('Sezonska zamjena');
    expect(statusLabel('DEACTIVATED')).toBe('Deaktiviran');
  });

  it('ne sadrže placeholder tekst', () => {
    for (const [_name, _values, map] of COMPLETENESS) {
      for (const entry of Object.values(map as Record<string, unknown>)) {
        const label = typeof entry === 'string' ? entry : (entry as { label: string }).label;
        expect(label, label).not.toMatch(/todo|xxx|lorem|undefined|null/iu);
        expect(label.length).toBeGreaterThan(1);
      }
    }
  });
});

describe('pristup nazivima', () => {
  it('statusLabel vraća naziv za poznatu vrijednost', () => {
    expect(statusLabel('COMPLETED')).toBe('Završen');
    expect(statusLabel('OPEN')).toBe('Otvoren');
    expect(statusLabel('URGENT')).toBe('Hitan');
    expect(statusLabel('DIESEL')).toBe('Dizel');
    expect(statusLabel('PDF')).toBe('PDF');
  });

  it('statusLabel vraća ulaznu vrijednost za nepoznatu (nikad undefined)', () => {
    expect(statusLabel('NEPOSTOJECI_STATUS')).toBe('NEPOSTOJECI_STATUS');
    expect(statusLabel('')).toBe('');
  });

  it('statusLevel vraća semantiku boje', () => {
    expect(statusLevel('COMPLETED')).toBe('success');
    expect(statusLevel('IN_PROGRESS')).toBe('warning');
    expect(statusLevel('OPEN')).toBe('info');
    expect(statusLevel('DEAD')).toBe('danger');
    expect(statusLevel('NEPOZNATO')).toBe('default');
  });

  it('statusMeta vraća pun zapis ili null', () => {
    expect(statusMeta('SUSPENDED')).toMatchObject({ label: 'Suspendovan', level: 'warning' });
    expect(statusMeta('NEPOZNATO')).toBeNull();
  });

  it('semantički nivoi su iz dozvoljenog skupa', () => {
    const allowed = new Set(['success', 'info', 'warning', 'danger', 'neutral', 'default']);
    for (const [_name, _values, map] of COMPLETENESS) {
      for (const entry of Object.values(map as Record<string, unknown>)) {
        if (typeof entry === 'string') continue;
        const level = (entry as { level: string }).level;
        expect(allowed.has(level), `${(entry as { label: string }).label} → ${level}`).toBe(true);
      }
    }
  });

  it('opisi (description) postoje tamo gdje pomažu korisniku', () => {
    expect(statusMeta('PUBLISHED')?.description).toMatch(/imutabilna/iu);
    expect(statusMeta('OPEN')?.description).toMatch(/čeka preuzimanje/iu);
    expect(statusMeta('DEAD')?.description).toMatch(/pokušaj/iu);
  });
});
