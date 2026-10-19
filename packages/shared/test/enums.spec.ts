import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_STAGES,
  AUDIT_ACTIONS,
  canTransitionFormSchema,
  canTransitionTask,
  CLIENT_TYPES,
  DEFAULT_ALLOWED_CLIENT_TYPES,
  EXPORT_FORMATS,
  FIELD_TYPES,
  FORM_SCHEMA_STATUSES,
  FORM_SUBJECTS,
  FUEL_TYPES,
  isTerminalTaskStatus,
  ODOMETER_SOURCES,
  OUTBOX_EVENT_TYPES,
  OUTBOX_STATUSES,
  QUEUE_NAMES,
  queueName,
  RECORD_STATUSES,
  REMINDER_KINDS,
  requiredPermissionForTransition,
  ROLE_ALLOWED_CLIENT_TYPES,
  SUPER_ADMIN_ALLOWED_CLIENT_TYPES,
  SYSTEM_ROLE_CODES,
  TASK_ASSIGN_MODES,
  TASK_ASSIGNMENT_ROLES,
  TASK_EVENT_ACTIONS,
  TASK_GUARDED_TRANSITIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TASK_TYPE_CODES,
  TIRE_POSITIONS,
  TIRE_SEASONS,
  TIRE_STATUSES,
  USER_STATUSES,
  VEHICLE_STATUSES,
} from '../dist/index.js';

/**
 * Ovi testovi čuvaju **ugovor s bazom** (docs/03 §2): ako se enum ovdje
 * promijeni, migracija i dokumentacija moraju ići u istom commitu.
 */
describe('državna mašina zadataka (U-05, docs/03 §3.6)', () => {
  it('statusi su tačno OPEN/IN_PROGRESS/COMPLETED/CANCELLED', () => {
    expect(TASK_STATUSES).toEqual(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
  });

  it('dozvoljeni prelazi iz dokumentacije', () => {
    expect(canTransitionTask('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionTask('OPEN', 'CANCELLED')).toBe(true);
    expect(canTransitionTask('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransitionTask('IN_PROGRESS', 'CANCELLED')).toBe(true);
    expect(canTransitionTask('IN_PROGRESS', 'OPEN')).toBe(true); // release
    expect(canTransitionTask('CANCELLED', 'OPEN')).toBe(true); // reopen
    expect(canTransitionTask('COMPLETED', 'IN_PROGRESS')).toBe(true); // samo task:reopen
  });

  it('nedozvoljeni prelazi se odbijaju', () => {
    expect(canTransitionTask('OPEN', 'COMPLETED')).toBe(false);
    expect(canTransitionTask('COMPLETED', 'OPEN')).toBe(false);
    expect(canTransitionTask('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canTransitionTask('CANCELLED', 'COMPLETED')).toBe(false);
    expect(canTransitionTask('CANCELLED', 'IN_PROGRESS')).toBe(false);
  });

  it('nema samoprelaza (X → X)', () => {
    for (const status of TASK_STATUSES) {
      expect(canTransitionTask(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it('svaki prelaz cilja postojeći status', () => {
    for (const status of TASK_STATUSES) {
      for (const target of TASK_TRANSITIONS[status]) {
        expect(TASK_STATUSES).toContain(target);
      }
    }
  });

  it('nijedan status nije terminalan (reopen/restart je uvijek moguć uz permisiju)', () => {
    for (const status of TASK_STATUSES) {
      expect(isTerminalTaskStatus(status), `${status} ne bi trebao biti terminalan`).toBe(false);
    }
  });

  it('čuvani prelazi zahtijevaju specifičnu permisiju', () => {
    expect(requiredPermissionForTransition('OPEN', 'IN_PROGRESS')).toBe('task:claim');
    expect(requiredPermissionForTransition('IN_PROGRESS', 'COMPLETED')).toBe('task:complete');
    expect(requiredPermissionForTransition('COMPLETED', 'IN_PROGRESS')).toBe('task:reopen');
    expect(requiredPermissionForTransition('CANCELLED', 'OPEN')).toBe('task:reopen');
    expect(requiredPermissionForTransition('OPEN', 'CANCELLED')).toBe('task:update');
  });

  it('svaki čuvani prelaz je i dozvoljen prelaz', () => {
    for (const key of Object.keys(TASK_GUARDED_TRANSITIONS)) {
      const [from, to] = key.split('→') as [string, string];
      expect(TASK_STATUSES).toContain(from);
      expect(TASK_STATUSES).toContain(to);
      expect(
        canTransitionTask(from as (typeof TASK_STATUSES)[number], to as (typeof TASK_STATUSES)[number]),
        `${key} mora biti dozvoljen`,
      ).toBe(true);
    }
  });
});

describe('državna mašina šeme forme (P-09…P-12)', () => {
  it('DRAFT → PUBLISHED → RETIRED je jedini put', () => {
    expect(FORM_SCHEMA_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'RETIRED']);
    expect(canTransitionFormSchema('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransitionFormSchema('PUBLISHED', 'RETIRED')).toBe(true);
  });

  it('objavljena verzija je imutabilna (nema povratka u nacrt)', () => {
    expect(canTransitionFormSchema('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransitionFormSchema('PUBLISHED', 'PUBLISHED')).toBe(false);
    expect(canTransitionFormSchema('RETIRED', 'PUBLISHED')).toBe(false);
    expect(canTransitionFormSchema('RETIRED', 'DRAFT')).toBe(false);
  });
});

describe('enumi usklađeni s docs/03 §2', () => {
  it('3 sistemske uloge + CUSTOM', () => {
    expect(SYSTEM_ROLE_CODES).toEqual(['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK']);
    expect(ROLE_ALLOWED_CLIENT_TYPES.SUPER_ADMIN).toEqual(SUPER_ADMIN_ALLOWED_CLIENT_TYPES);
    expect(ROLE_ALLOWED_CLIENT_TYPES.SUPER_ADMIN).toEqual(['WEB']);
    expect(DEFAULT_ALLOWED_CLIENT_TYPES).toEqual(['WEB', 'MOBILE_ANDROID']);
  });

  it('Super Admin je web-only (N-05): mobilni klijenti nisu dozvoljeni', () => {
    for (const client of ROLE_ALLOWED_CLIENT_TYPES.SUPER_ADMIN) {
      expect(client).not.toMatch(/^MOBILE_/u);
    }
  });

  it('tipovi klijenta', () => {
    expect(CLIENT_TYPES).toEqual(['WEB', 'MOBILE_ANDROID', 'MOBILE_IOS', 'SERVICE']);
  });

  it('statusi naloga uključuju PENDING_PASSWORD_CHANGE', () => {
    expect(USER_STATUSES).toEqual(['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_PASSWORD_CHANGE']);
  });

  it('statusi vozila', () => {
    expect(VEHICLE_STATUSES).toEqual(['ACTIVE', 'IN_SERVICE', 'INACTIVE', 'DAMAGED', 'ARCHIVED']);
  });

  it('statusi evidencija (registracija/osiguranje/servis)', () => {
    expect(RECORD_STATUSES).toEqual(['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'ARCHIVED']);
  });

  it('goriva', () => {
    expect(FUEL_TYPES).toEqual(['DIESEL', 'PETROL', 'LPG', 'CNG', 'HYBRID', 'ELECTRIC']);
  });

  it('gume: sezone, statusi, pozicije', () => {
    expect(TIRE_SEASONS).toEqual(['SUMMER', 'WINTER', 'ALL_SEASON']);
    expect(TIRE_STATUSES).toEqual(['IN_STOCK', 'MOUNTED', 'IN_REPAIR', 'RETIRED', 'SCRAPPED']);
    expect(TIRE_POSITIONS).toEqual(['FL', 'FR', 'RL', 'RR', 'SPARE']);
  });

  it('tipovi polja forme (19 tipova iz docs/03)', () => {
    expect(FIELD_TYPES).toHaveLength(19);
    for (const required of [
      'TEXT',
      'INTEGER',
      'MONEY',
      'DATE',
      'SINGLE_CHOICE',
      'MULTI_CHOICE',
      'PHOTO',
      'FILE',
      'REFERENCE_VEHICLE',
      'SECTION',
      'COMPUTED',
    ]) {
      expect(FIELD_TYPES, `nedostaje ${required}`).toContain(required);
    }
    expect(new Set(FIELD_TYPES).size).toBe(FIELD_TYPES.length);
  });

  it('subjekti forme', () => {
    expect(FORM_SUBJECTS).toContain('TASK');
    expect(FORM_SUBJECTS).toContain('VEHICLE_HANDOVER');
    expect(FORM_SUBJECTS).toHaveLength(10);
  });

  it('prioriteti, načini dodjele i uloge u dodjeli zadatka', () => {
    expect(TASK_PRIORITIES).toEqual(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
    expect(TASK_ASSIGN_MODES).toEqual(['OPEN_CLAIM', 'ASSIGN_DIRECT', 'BROADCAST']);
    expect(TASK_ASSIGNMENT_ROLES).toEqual(['INVITED', 'ASSIGNEE', 'OBSERVER']);
  });

  it('8 vrsta zadataka koje se seeduju', () => {
    expect(TASK_TYPE_CODES).toEqual([
      'WASH',
      'INTERIOR_CLEANING',
      'FUEL_REFILL',
      'SERVICE_VISIT',
      'TIRE_CHANGE',
      'TECHNICAL_INSPECTION',
      'REGISTRATION',
      'CUSTOM',
    ]);
  });

  it('14 akcija u historiji zadatka', () => {
    expect(TASK_EVENT_ACTIONS).toHaveLength(14);
    expect(TASK_EVENT_ACTIONS).toContain('CLAIMED');
    expect(TASK_EVENT_ACTIONS).toContain('OVERRIDE_COMPLETED');
  });

  it('faze priloga', () => {
    expect(ATTACHMENT_STAGES).toEqual(['ON_CREATE', 'ON_CLAIM', 'ON_COMPLETE', 'ON_CANCEL', 'GENERAL']);
  });

  it('outbox statusi i tipovi događaja', () => {
    expect(OUTBOX_STATUSES).toEqual(['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD']);
    for (const required of ['TASK_CREATED', 'TASK_CLAIMED', 'TASK_COMPLETED', 'REMINDER_DUE']) {
      expect(OUTBOX_EVENT_TYPES, `nedostaje ${required}`).toContain(required);
    }
  });

  it('vrste podsjetnika pokrivaju sve rokove iz zadatka', () => {
    for (const required of [
      'REGISTRATION',
      'INSURANCE',
      'SERVICE_DATE',
      'SERVICE_KM',
      'DRIVER_LICENSE',
      'TECHNICAL_INSPECTION',
    ]) {
      expect(REMINDER_KINDS, `nedostaje ${required}`).toContain(required);
    }
  });

  it('audit akcije uključuju sigurnosne i RBAC događaje', () => {
    for (const required of [
      'LOGIN',
      'LOGIN_FAILED',
      'PERMISSION_CHANGE',
      'ROLE_CHANGE',
      'FORM_PUBLISH',
      'EXPORT',
      'FILE_ACCESS',
      'SECURITY',
      'CLAIM',
      'COMPLETE',
      'REOPEN',
      'RELEASE',
    ]) {
      expect(AUDIT_ACTIONS, `nedostaje ${required}`).toContain(required);
    }
  });

  it('izvor očitanja kilometraže', () => {
    expect(ODOMETER_SOURCES).toContain('TASK');
    expect(ODOMETER_SOURCES).toContain('SERVICE');
    expect(ODOMETER_SOURCES).toContain('HANDOVER');
  });

  it('formati izvoza', () => {
    expect(EXPORT_FORMATS).toEqual(['PDF', 'XLSX', 'CSV']);
  });
});

describe('nazivi BullMQ redova', () => {
  it('svaki red dobija pun naziv vfm-queue-<name>', () => {
    expect(queueName('outbox')).toBe('vfm-queue-outbox');
    expect(queueName('notifications')).toBe('vfm-queue-notifications');
    expect(queueName('reminders')).toBe('vfm-queue-reminders');
    expect(queueName('reports')).toBe('vfm-queue-reports');
    expect(queueName('maintenance')).toBe('vfm-queue-maintenance');
  });

  it('svaki puni naziv počinje prefiksom vfm (ACL ~vfm:*)', () => {
    for (const name of QUEUE_NAMES) {
      expect(queueName(name)).toMatch(/^vfm-/u);
    }
  });
});
