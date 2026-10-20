/**
 * VFM — enumi domena.
 *
 * ⚠️ **Izvor istine: `docs/03-MODEL_PODATAKA.md` §2.** Ove vrijednosti su
 * ugovor s bazom (`prisma/schema.prisma` koristi iste nazive kao Postgres enum
 * tipove). Preimenovanje vrijednosti zahtijeva verzionisanu migraciju podataka,
 * nikad ad-hoc izmjenu.
 *
 * Ako se enum ovdje promijeni → obavezno ažurirati:
 *   1. `docs/03-MODEL_PODATAKA.md` §2 (tabela enuma),
 *   2. `apps/api/prisma/schema.prisma` + nova migracija,
 *   3. `status-labels.ts` (bosanski nazivi),
 *   4. `docs/07-API_SPECIFIKACIJA.md` (API ugovor).
 */

// -----------------------------------------------------------------------------
//  Identitet i prava
// -----------------------------------------------------------------------------

/** Status korisničkog naloga. */
export const USER_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'PENDING_PASSWORD_CHANGE',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Tip klijenta — server-side provjera (Super Admin je web-only, N-05). */
export const CLIENT_TYPES = ['WEB', 'MOBILE_ANDROID', 'MOBILE_IOS', 'SERVICE'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

/**
 * Kodovi uloga. `CUSTOM` označava uloge koje kreira Super Admin
 * (stvarni kod je `CUSTOM_<naziv>` u tabeli `Role.code`).
 */
export const ROLE_CODES = ['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK', 'CUSTOM'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Tri sistemske uloge koje se seeduju (zahtjev zadatka). */
export const SYSTEM_ROLE_CODES = ['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK'] as const;
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

/** Opseg podataka uz permisiju (N-02). */
export const PERMISSION_SCOPES = ['ALL', 'OWN', 'VEHICLE_IDS', 'DRIVER_IDS'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

// -----------------------------------------------------------------------------
//  Forme
// -----------------------------------------------------------------------------

/** Stanje životnog ciklusa verzije šeme forme. */
export const FORM_SCHEMA_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type FormSchemaStatus = (typeof FORM_SCHEMA_STATUSES)[number];

/** Entitet na koji se forma vezuje. */
export const FORM_SUBJECTS = [
  'VEHICLE',
  'DRIVER',
  'REGISTRATION',
  'INSURANCE',
  'SERVICE',
  'TIRE_SET',
  'TIRE_INSTALLATION',
  'TASK',
  'VEHICLE_HANDOVER',
  'OTHER',
] as const;
export type FormSubject = (typeof FORM_SUBJECTS)[number];

/**
 * Statusi s kojima je **prijava dozvoljena**.
 *
 * `PENDING_PASSWORD_CHANGE` je normalno stanje naloga s privremenom lozinkom
 * (bootstrap, seed, korisnik kojeg je kreirao administrator): korisnik se mora
 * moći prijaviti da bi lozinku promijenio. Zabrana prijave za taj status
 * zaključala bi svaki novi nalog zauvijek.
 *
 * Sva ostala prava su i dalje zatvorena: `JwtAuthGuard` pušta takav nalog samo
 * na rute za promjenu lozinke, profil, odjavu i vlastite sesije, a efektivna
 * prava su prazna (`evaluateEffectivePermissions` vraća prazan skup).
 */
export const AUTH_ALLOWED_STATUSES = ['ACTIVE', 'PENDING_PASSWORD_CHANGE'] as const;

/** Da li se korisnik s ovim statusom smije prijaviti/obnoviti sesiju. */
export function isAuthAllowedStatus(status: UserStatus): boolean {
  return (AUTH_ALLOWED_STATUSES as readonly string[]).includes(status);
}

/** Tipovi polja dinamičke forme. */
export const FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'INTEGER',
  'DECIMAL',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'DROPDOWN',
  'MONEY',
  'CURRENCY',
  'PHOTO',
  'FILE',
  'REFERENCE_VEHICLE',
  'REFERENCE_DRIVER',
  'REFERENCE_RECORD',
  'SECTION',
  'COMPUTED',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Status migracije zapisa između verzija forme. */
export const MIGRATION_JOB_STATUSES = [
  'PENDING',
  'PREVIEW',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
] as const;
export type MigrationJobStatus = (typeof MIGRATION_JOB_STATUSES)[number];

// -----------------------------------------------------------------------------
//  Vozila i evidencije
// -----------------------------------------------------------------------------

/** Status vozila. */
export const VEHICLE_STATUSES = ['ACTIVE', 'IN_SERVICE', 'INACTIVE', 'DAMAGED', 'ARCHIVED'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Vrsta goriva. */
export const FUEL_TYPES = ['DIESEL', 'PETROL', 'LPG', 'CNG', 'HYBRID', 'ELECTRIC'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/** Status dokumenta/evidencije (registracija, osiguranje, servis…). */
export const RECORD_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'ARCHIVED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Tip vlasništva nad vozilom (R-08). */
export const OWNERSHIP_TYPES = ['OWNED', 'LEASED', 'RENTED'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** Izvor očitanja kilometraže. */
export const ODOMETER_SOURCES = [
  'MANUAL',
  'TASK',
  'SERVICE',
  'REGISTRATION',
  'INSURANCE',
  'TIRE',
  'HANDOVER',
  'SYSTEM',
] as const;
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

// -----------------------------------------------------------------------------
//  Gume
// -----------------------------------------------------------------------------

export const TIRE_SEASONS = ['SUMMER', 'WINTER', 'ALL_SEASON'] as const;
export type TireSeason = (typeof TIRE_SEASONS)[number];

export const TIRE_STATUSES = ['IN_STOCK', 'MOUNTED', 'IN_REPAIR', 'RETIRED', 'SCRAPPED'] as const;
export type TireStatus = (typeof TIRE_STATUSES)[number];

/** Pozicija na vozilu (4 + rezervna). */
export const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR', 'SPARE'] as const;
export type TirePosition = (typeof TIRE_POSITIONS)[number];

/** Razlozi demontaže seta guma. */
export const TIRE_DISMOUNT_REASONS = ['SEASONAL_SWAP', 'DAMAGE', 'WEAR', 'SALE', 'REPAIR'] as const;
export type TireDismountReason = (typeof TIRE_DISMOUNT_REASONS)[number];

// -----------------------------------------------------------------------------
//  Zadaci
// -----------------------------------------------------------------------------

/**
 * Status zadatka.
 *
 * Tranzicije (U-05) su u `TASK_TRANSITIONS` ispod; `OPEN → IN_PROGRESS` se
 * **ne** radi običnim update-om nego atomskim `UPDATE … WHERE status='OPEN'
 * RETURNING` (P-04: tačno jedan izvršilac pod konkurencijom).
 */
export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Način dodjele zadatka. */
export const TASK_ASSIGN_MODES = ['OPEN_CLAIM', 'ASSIGN_DIRECT', 'BROADCAST'] as const;
export type TaskAssignMode = (typeof TASK_ASSIGN_MODES)[number];

/** Uloge u dodjeli zadatka (`ASSIGNEE` je jedinstven → atomski claim). */
export const TASK_ASSIGNMENT_ROLES = ['INVITED', 'ASSIGNEE', 'OBSERVER'] as const;
export type TaskAssignmentRole = (typeof TASK_ASSIGNMENT_ROLES)[number];

/** Akcije u historiji zadatka (`TaskEvent`, immutabilan). */
export const TASK_EVENT_ACTIONS = [
  'CREATED',
  'UPDATED',
  'ASSIGNED',
  'INVITED',
  'CLAIMED',
  'COMPLETED',
  'CANCELLED',
  'REOPENED',
  'RELEASED',
  'COMMENTED',
  'ATTACHMENT_ADDED',
  'OVERRIDE_COMPLETED',
  'FORM_MIGRATED',
  'EXPIRED',
] as const;
export type TaskEventAction = (typeof TASK_EVENT_ACTIONS)[number];

/** Vrste zadataka koje se seeduju (docs/03 §3.6). */
export const TASK_TYPE_CODES = [
  'WASH',
  'INTERIOR_CLEANING',
  'FUEL_REFILL',
  'SERVICE_VISIT',
  'TIRE_CHANGE',
  'TECHNICAL_INSPECTION',
  'REGISTRATION',
  'CUSTOM',
] as const;
export type TaskTypeCode = (typeof TASK_TYPE_CODES)[number];

/** Faze u kojima je prilog obavezan (docs/03 §3.9, U-13). */
export const ATTACHMENT_STAGES = ['ON_CREATE', 'ON_CLAIM', 'ON_COMPLETE', 'ON_CANCEL', 'GENERAL'] as const;
export type AttachmentStage = (typeof ATTACHMENT_STAGES)[number];

// -----------------------------------------------------------------------------
//  Prilozi
// -----------------------------------------------------------------------------

export const ATTACHMENT_OWNER_TYPES = [
  'TASK',
  'VEHICLE',
  'SERVICE',
  'REGISTRATION',
  'INSURANCE',
  'TIRE',
  'DRIVER',
  'REPORT_EXPORT',
  'OTHER',
] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

// -----------------------------------------------------------------------------
//  Outbox i obavijesti
// -----------------------------------------------------------------------------

export const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'READ', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const DELIVERY_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'TOKEN_INVALID'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['FCM', 'SSE', 'EMAIL', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DEVICE_TOKEN_STATUSES = ['ACTIVE', 'INVALID', 'UNREGISTERED', 'DISABLED'] as const;
export type DeviceTokenStatus = (typeof DEVICE_TOKEN_STATUSES)[number];

export const NOTIFICATION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** Tipovi outbox događaja (P-05). */
export const OUTBOX_EVENT_TYPES = [
  'TASK_CREATED',
  'TASK_ASSIGNED',
  'TASK_CLAIMED',
  'TASK_COMPLETED',
  'TASK_RELEASED',
  'TASK_CANCELLED',
  'TASK_REOPENED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'REMINDER_DUE',
  'REGISTRATION_EXPIRING',
  'INSURANCE_EXPIRING',
  'SERVICE_DUE',
  'DRIVER_LICENSE_EXPIRING',
  'REPORT_READY',
  'USER_PERMISSION_CHANGED',
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

// -----------------------------------------------------------------------------
//  Podsjetnici
// -----------------------------------------------------------------------------

export const REMINDER_KINDS = [
  'REGISTRATION',
  'INSURANCE',
  'SERVICE_DATE',
  'SERVICE_KM',
  'DRIVER_LICENSE',
  'TECHNICAL_INSPECTION',
  'TIRE_ROTATION',
  'CUSTOM',
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_STATUSES = ['SCHEDULED', 'SENT', 'ACKNOWLEDGED', 'SNOOZED', 'CANCELLED'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

// -----------------------------------------------------------------------------
//  Audit
// -----------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'ARCHIVE',
  'RESTORE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PERMISSION_CHANGE',
  'ROLE_CHANGE',
  'FORM_PUBLISH',
  'FORM_RETIRE',
  'FORM_MIGRATE',
  'EXPORT',
  'FILE_ACCESS',
  'SECURITY',
  'SETTINGS_CHANGE',
  'CLAIM',
  'COMPLETE',
  'CANCEL',
  'REOPEN',
  'RELEASE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_SEVERITIES = ['INFO', 'WARN', 'SECURITY', 'CRITICAL'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

// -----------------------------------------------------------------------------
//  Izvještaji i postavke
// -----------------------------------------------------------------------------

export const EXPORT_FORMATS = ['PDF', 'XLSX', 'CSV'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const SETTING_TYPES = [
  'STRING',
  'INTEGER',
  'DECIMAL',
  'BOOLEAN',
  'DATE',
  'ENUM',
  'JSON',
  'SECRET',
] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

/** Kategorije izvještaja. */
export const REPORT_CATEGORIES = ['VEHICLE', 'USER', 'GENERAL'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** SQL view-ovi za izvještaje (docs/03 §4) — čitaju samo normalizovane kolone. */
export const REPORT_VIEWS = [
  'vfm_v_vehicle_overview',
  'vfm_v_vehicle_costs',
  'vfm_v_task_stats',
  'vfm_v_user_activity',
  'vfm_v_deadlines',
  'vfm_v_tire_usage',
  'vfm_v_fuel_consumption',
] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

/** Kodovi šifarnika koji se seeduju (U-21). */
export const LIST_CODES = [
  'FUEL_TYPE',
  'WORKSHOP',
  'STORAGE_LOCATION',
  'CANCEL_REASON',
  'INSURANCE_TYPE',
  'SERVICE_TYPE',
  'COST_CENTER',
  'DRIVER_EMPLOYMENT_STATUS',
] as const;
export type ListCode = (typeof LIST_CODES)[number];

// -----------------------------------------------------------------------------
//  Državne mašine
// -----------------------------------------------------------------------------

/**
 * Tranzicije statusa zadatka (U-05, docs/03 §3.6).
 *
 * Napomene:
 * - `IN_PROGRESS → OPEN` = **release** (izvršilac vraća zadatak).
 * - `CANCELLED → OPEN` = **reopen**.
 * - `COMPLETED → IN_PROGRESS` = samo uz `task:reopen` permisiju + audit zapis.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'OPEN'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['OPEN'],
} as const;

/** Da li je prelaz dozvoljen. */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/**
 * Tranzicije koje zahtijevaju posebnu permisiju (nije dovoljan `task:update`).
 * Ključ je `from→to`, vrijednost je potrebna permisija.
 */
export const TASK_GUARDED_TRANSITIONS: Readonly<Record<string, string>> = {
  'OPEN→IN_PROGRESS': 'task:claim',
  'IN_PROGRESS→COMPLETED': 'task:complete',
  'COMPLETED→IN_PROGRESS': 'task:reopen',
  'CANCELLED→OPEN': 'task:reopen',
} as const;

/** Permisija potrebna za prelaz (ili `task:update` ako nije posebno čuvana). */
export function requiredPermissionForTransition(from: TaskStatus, to: TaskStatus): string {
  return TASK_GUARDED_TRANSITIONS[`${from}→${to}`] ?? 'task:update';
}

/** Da li je status terminalan (bez izlaznih prelaza). */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TASK_TRANSITIONS[status].length === 0;
}

/**
 * Tranzicije statusa verzije šeme forme: `DRAFT → PUBLISHED → RETIRED`.
 * Objavljena verzija je **imutabilna** (P-09/P-10) — DB trigger odbija
 * `UPDATE definition` i `DELETE` za `status='PUBLISHED'`.
 */
export const FORM_SCHEMA_TRANSITIONS: Readonly<Record<FormSchemaStatus, readonly FormSchemaStatus[]>> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: [],
} as const;

export function canTransitionFormSchema(from: FormSchemaStatus, to: FormSchemaStatus): boolean {
  return FORM_SCHEMA_TRANSITIONS[from].includes(to);
}

/** Statusi koje `Role.allowedClientTypes` smije sadržavati za Super Admina. */
export const SUPER_ADMIN_ALLOWED_CLIENT_TYPES: readonly ClientType[] = ['WEB'] as const;

/** Default klijenti za ostale uloge. */
export const DEFAULT_ALLOWED_CLIENT_TYPES: readonly ClientType[] = ['WEB', 'MOBILE_ANDROID'] as const;
