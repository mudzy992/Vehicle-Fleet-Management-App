/**
 * VFM — fiksni nazivi statusa na bosanskom (`bs`) + semantički nivo boje.
 *
 * Jedinstven izvor istine za badge-ove u web i mobilnoj aplikaciji te za izvoz u
 * PDF/Excel. **Nikad** ne prevoditi status ad-hoc u komponenti — dodati ovdje i
 * koristiti `statusLabel()`.
 *
 * Semantika mapira na dizajn tokene iz `docs/06-UX_UI_DIZAJN.md` §5.1:
 * `success #16A34A` · `info #0EA5E9` · `warning #D97706` · `danger #DC2626` ·
 * `neutral` (siva).
 *
 * Enumi su iz `docs/03-MODEL_PODATAKA.md` §2 — ako se tamo doda nova vrijednost,
 * test `status-labels.spec.ts` pada dok se naziv ne dopuni ovdje.
 */
import type {
  AUDIT_SEVERITIES,
  ATTACHMENT_STAGES,
  CLIENT_TYPES,
  DELIVERY_STATUSES,
  DEVICE_TOKEN_STATUSES,
  DRIVER_STATUSES,
  EXPORT_STATUSES,
  FIELD_TYPES,
  FORM_SCHEMA_STATUSES,
  FORM_SUBJECTS,
  FUEL_TYPES,
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
} from './enums.js';
import type { DeadlineLevel } from './format.js';

/** Semantički nivo (mapira se na dizajn token boje). */
export type SemanticLevel = DeadlineLevel | 'default';

export interface StatusMeta {
  /** Naziv na bosanskom (UI). */
  readonly label: string;
  /** Semantika boje (badge). */
  readonly level: SemanticLevel;
  /** Kratak opis (tooltip / help tekst). */
  readonly description?: string;
}

type Meta = StatusMeta;

// --- Uloge i nalozi ---------------------------------------------------------

export const ROLE_LABELS: Readonly<Record<(typeof ROLE_CODES)[number], string>> = {
  SUPER_ADMIN: 'Super administrator',
  ADMINISTRATOR: 'Administrator',
  OBICNI_KORISNIK: 'Obični korisnik',
  CUSTOM: 'Prilagođena uloga',
} as const;

export const USER_STATUS_LABELS: Readonly<Record<(typeof USER_STATUSES)[number], Meta>> = {
  ACTIVE: { label: 'Aktivan', level: 'success' },
  SUSPENDED: { label: 'Suspendovan', level: 'warning', description: 'Privremeno bez pristupa' },
  DEACTIVATED: { label: 'Deaktiviran', level: 'neutral', description: 'Trajno bez pristupa' },
  PENDING_PASSWORD_CHANGE: {
    label: 'Čeka promjenu lozinke',
    level: 'warning',
    description: 'Obavezna promjena lozinke pri sljedećoj prijavi',
  },
} as const;

export const CLIENT_TYPE_LABELS: Readonly<Record<(typeof CLIENT_TYPES)[number], string>> = {
  WEB: 'Web portal',
  MOBILE_ANDROID: 'Android aplikacija',
  MOBILE_IOS: 'iOS aplikacija',
  SERVICE: 'Servisni nalog',
} as const;

// --- Vozila -----------------------------------------------------------------

export const VEHICLE_STATUS_LABELS: Readonly<Record<(typeof VEHICLE_STATUSES)[number], Meta>> = {
  ACTIVE: { label: 'Aktivno', level: 'success', description: 'U redovnoj upotrebi' },
  IN_SERVICE: { label: 'Na servisu', level: 'warning' },
  INACTIVE: { label: 'Neaktivno', level: 'neutral', description: 'Privremeno van upotrebe' },
  DAMAGED: { label: 'Oštećeno', level: 'danger' },
  ARCHIVED: { label: 'Arhivirano', level: 'neutral', description: 'Otpisano iz voznog parka' },
} as const;

export const DRIVER_STATUS_LABELS: Readonly<Record<(typeof DRIVER_STATUSES)[number], Meta>> = {
  ACTIVE: { label: 'Aktivan', level: 'success' },
  INACTIVE: { label: 'Neaktivan', level: 'neutral', description: 'Ne dodjeljuje se na zadatke' },
  ARCHIVED: { label: 'Arhiviran', level: 'neutral', description: 'Evidencije ostaju' },
} as const;

export const FUEL_TYPE_LABELS: Readonly<Record<(typeof FUEL_TYPES)[number], string>> = {
  DIESEL: 'Dizel',
  PETROL: 'Benzin',
  LPG: 'Plin (LPG)',
  CNG: 'CNG',
  HYBRID: 'Hibrid',
  ELECTRIC: 'Električno',
} as const;

export const OWNERSHIP_TYPE_LABELS: Readonly<Record<(typeof OWNERSHIP_TYPES)[number], string>> = {
  OWNED: 'U vlasništvu',
  LEASED: 'Na leasing',
  RENTED: 'Iznajmljeno',
} as const;

export const RECORD_STATUS_LABELS: Readonly<Record<(typeof RECORD_STATUSES)[number], Meta>> = {
  DRAFT: { label: 'Nacrt', level: 'neutral' },
  ACTIVE: { label: 'Vrijedi', level: 'success' },
  EXPIRED: { label: 'Isteklo', level: 'danger' },
  CANCELLED: { label: 'Otkazano', level: 'neutral' },
  ARCHIVED: { label: 'Arhivirano', level: 'neutral' },
} as const;

export const ODOMETER_SOURCE_LABELS: Readonly<Record<(typeof ODOMETER_SOURCES)[number], string>> = {
  MANUAL: 'Ručni unos',
  TASK: 'Zadatak',
  SERVICE: 'Servis',
  REGISTRATION: 'Registracija',
  INSURANCE: 'Osiguranje',
  TIRE: 'Zamjena guma',
  HANDOVER: 'Primopredaja',
  SYSTEM: 'Sistem',
} as const;

// --- Zadaci -----------------------------------------------------------------

export const TASK_STATUS_LABELS: Readonly<Record<(typeof TASK_STATUSES)[number], Meta>> = {
  OPEN: { label: 'Otvoren', level: 'info', description: 'Čeka preuzimanje' },
  IN_PROGRESS: { label: 'U radu', level: 'warning', description: 'Preuzeo izvršilac' },
  COMPLETED: { label: 'Završen', level: 'success' },
  CANCELLED: { label: 'Otkazan', level: 'neutral' },
} as const;

export const TASK_PRIORITY_LABELS: Readonly<Record<(typeof TASK_PRIORITIES)[number], Meta>> = {
  LOW: { label: 'Nizak', level: 'neutral' },
  NORMAL: { label: 'Normalan', level: 'info' },
  HIGH: { label: 'Visok', level: 'warning' },
  URGENT: { label: 'Hitan', level: 'danger' },
} as const;

export const TASK_ASSIGN_MODE_LABELS: Readonly<Record<(typeof TASK_ASSIGN_MODES)[number], string>> = {
  OPEN_CLAIM: 'Slobodno preuzimanje',
  ASSIGN_DIRECT: 'Direktna dodjela',
  BROADCAST: 'Obavijest svima',
} as const;

export const TASK_ASSIGNMENT_ROLE_LABELS: Readonly<
  Record<(typeof TASK_ASSIGNMENT_ROLES)[number], string>
> = {
  INVITED: 'Pozvan',
  ASSIGNEE: 'Izvršilac',
  OBSERVER: 'Posmatrač',
} as const;

export const TASK_EVENT_ACTION_LABELS: Readonly<Record<(typeof TASK_EVENT_ACTIONS)[number], string>> = {
  CREATED: 'Kreiran',
  UPDATED: 'Izmijenjen',
  ASSIGNED: 'Dodijeljen',
  INVITED: 'Pozvan korisnik',
  CLAIMED: 'Preuzet',
  COMPLETED: 'Završen',
  CANCELLED: 'Otkazan',
  REOPENED: 'Ponovo otvoren',
  RELEASED: 'Vraćen među slobodne',
  COMMENTED: 'Komentar',
  ATTACHMENT_ADDED: 'Dodan prilog',
  OVERRIDE_COMPLETED: 'Završen od druge osobe',
  FORM_MIGRATED: 'Forma migrirana',
  EXPIRED: 'Probijen rok',
} as const;

export const TASK_TYPE_LABELS: Readonly<Record<(typeof TASK_TYPE_CODES)[number], string>> = {
  WASH: 'Pranje vozila',
  INTERIOR_CLEANING: 'Čišćenje unutrašnjosti',
  FUEL_REFILL: 'Dopuna goriva',
  SERVICE_VISIT: 'Odlazak na servis',
  TIRE_CHANGE: 'Zamjena guma',
  TECHNICAL_INSPECTION: 'Tehnički pregled',
  REGISTRATION: 'Registracija vozila',
  CUSTOM: 'Prilagođeni zadatak',
} as const;

// --- Forme ------------------------------------------------------------------

export const FORM_SCHEMA_STATUS_LABELS: Readonly<
  Record<(typeof FORM_SCHEMA_STATUSES)[number], Meta>
> = {
  DRAFT: { label: 'Nacrt', level: 'neutral', description: 'Može se mijenjati' },
  PUBLISHED: { label: 'Objavljeno', level: 'success', description: 'Imutabilna verzija' },
  RETIRED: { label: 'Povučeno', level: 'warning', description: 'Ne koristi se za nove unose' },
} as const;

export const FORM_SUBJECT_LABELS: Readonly<Record<(typeof FORM_SUBJECTS)[number], string>> = {
  VEHICLE: 'Vozilo',
  DRIVER: 'Vozač',
  REGISTRATION: 'Registracija',
  INSURANCE: 'Osiguranje',
  SERVICE: 'Servis',
  TIRE_SET: 'Komplet guma',
  TIRE_INSTALLATION: 'Montaža guma',
  TASK: 'Zadatak',
  VEHICLE_HANDOVER: 'Primopredaja vozila',
  OTHER: 'Ostalo',
} as const;

export const FIELD_TYPE_LABELS: Readonly<Record<(typeof FIELD_TYPES)[number], string>> = {
  TEXT: 'Tekst',
  TEXTAREA: 'Duži tekst',
  INTEGER: 'Cijeli broj',
  DECIMAL: 'Decimalni broj',
  DATE: 'Datum',
  DATETIME: 'Datum i vrijeme',
  BOOLEAN: 'Da/Ne',
  SINGLE_CHOICE: 'Jednostruki odabir',
  MULTI_CHOICE: 'Višestruki odabir',
  DROPDOWN: 'Padajuća lista',
  MONEY: 'Iznos',
  CURRENCY: 'Valuta',
  PHOTO: 'Fotografija',
  FILE: 'Datoteka',
  REFERENCE_VEHICLE: 'Vozilo (referenca)',
  REFERENCE_DRIVER: 'Vozač (referenca)',
  REFERENCE_RECORD: 'Zapis (referenca)',
  SECTION: 'Sekcija',
  COMPUTED: 'Izračunato polje',
} as const;

export const MIGRATION_JOB_STATUS_LABELS: Readonly<
  Record<(typeof MIGRATION_JOB_STATUSES)[number], Meta>
> = {
  PENDING: { label: 'Na čekanju', level: 'neutral' },
  PREVIEW: { label: 'Pregled', level: 'info', description: 'Rezultat prije izvršenja' },
  RUNNING: { label: 'U toku', level: 'info' },
  COMPLETED: { label: 'Završeno', level: 'success' },
  FAILED: { label: 'Neuspješno', level: 'danger' },
  ROLLED_BACK: { label: 'Poništeno', level: 'warning' },
} as const;

// --- Gume -------------------------------------------------------------------

export const TIRE_SEASON_LABELS: Readonly<Record<(typeof TIRE_SEASONS)[number], string>> = {
  SUMMER: 'Ljetne',
  WINTER: 'Zimske',
  ALL_SEASON: 'Cjelogodišnje',
} as const;

export const TIRE_STATUS_LABELS: Readonly<Record<(typeof TIRE_STATUSES)[number], Meta>> = {
  IN_STOCK: { label: 'Na skladištu', level: 'neutral' },
  MOUNTED: { label: 'Montirane', level: 'info' },
  IN_REPAIR: { label: 'Na popravci', level: 'warning' },
  RETIRED: { label: 'Povučene', level: 'neutral' },
  SCRAPPED: { label: 'Otpisane', level: 'danger' },
} as const;

export const TIRE_POSITION_LABELS: Readonly<Record<(typeof TIRE_POSITIONS)[number], string>> = {
  FL: 'Naprijed lijevo',
  FR: 'Naprijed desno',
  RL: 'Nazad lijevo',
  RR: 'Nazad desno',
  SPARE: 'Rezervna',
} as const;

export const TIRE_DISMOUNT_REASON_LABELS: Readonly<
  Record<(typeof TIRE_DISMOUNT_REASONS)[number], string>
> = {
  SEASONAL_SWAP: 'Sezonska zamjena',
  DAMAGE: 'Oštećenje',
  WEAR: 'Istrošenost',
  SALE: 'Prodaja',
  REPAIR: 'Popravka',
} as const;

// --- Prilozi ----------------------------------------------------------------

export const ATTACHMENT_STAGE_LABELS: Readonly<Record<(typeof ATTACHMENT_STAGES)[number], string>> = {
  ON_CREATE: 'Pri kreiranju',
  ON_CLAIM: 'Pri preuzimanju',
  ON_COMPLETE: 'Pri završetku',
  ON_CANCEL: 'Pri otkazivanju',
  GENERAL: 'Opšti prilog',
} as const;

// --- Outbox i obavijesti ----------------------------------------------------

export const OUTBOX_STATUS_LABELS: Readonly<Record<(typeof OUTBOX_STATUSES)[number], Meta>> = {
  PENDING: { label: 'Na čekanju', level: 'neutral' },
  PROCESSING: { label: 'U obradi', level: 'info' },
  PROCESSED: { label: 'Obrađeno', level: 'success' },
  FAILED: { label: 'Neuspješno', level: 'warning' },
  DEAD: { label: 'Trajno neuspješno', level: 'danger', description: 'Iscrpljeni pokušaji' },
} as const;

export const NOTIFICATION_STATUS_LABELS: Readonly<
  Record<(typeof NOTIFICATION_STATUSES)[number], Meta>
> = {
  PENDING: { label: 'Na čekanju', level: 'neutral' },
  SENT: { label: 'Poslana', level: 'info' },
  READ: { label: 'Pročitana', level: 'success' },
  FAILED: { label: 'Neuspješna', level: 'danger' },
} as const;

export const DELIVERY_STATUS_LABELS: Readonly<Record<(typeof DELIVERY_STATUSES)[number], Meta>> = {
  QUEUED: { label: 'U redu', level: 'neutral' },
  SENT: { label: 'Poslano', level: 'info' },
  DELIVERED: { label: 'Isporučeno', level: 'success' },
  FAILED: { label: 'Neuspješno', level: 'danger' },
  TOKEN_INVALID: { label: 'Token nevažeći', level: 'warning' },
} as const;

export const NOTIFICATION_CHANNEL_LABELS: Readonly<
  Record<(typeof NOTIFICATION_CHANNELS)[number], string>
> = {
  FCM: 'Push obavijest',
  SSE: 'Prijenos uživo',
  EMAIL: 'E-mail',
  IN_APP: 'U aplikaciji',
} as const;

export const DEVICE_TOKEN_STATUS_LABELS: Readonly<
  Record<(typeof DEVICE_TOKEN_STATUSES)[number], Meta>
> = {
  ACTIVE: { label: 'Aktivan', level: 'success' },
  INVALID: { label: 'Nevažeći', level: 'warning' },
  UNREGISTERED: { label: 'Odregistrovan', level: 'neutral' },
  DISABLED: { label: 'Onemogućen', level: 'neutral' },
} as const;

export const NOTIFICATION_PRIORITY_LABELS: Readonly<
  Record<(typeof NOTIFICATION_PRIORITIES)[number], Meta>
> = {
  LOW: { label: 'Nizak', level: 'neutral' },
  NORMAL: { label: 'Normalan', level: 'info' },
  HIGH: { label: 'Visok', level: 'warning' },
  URGENT: { label: 'Hitan', level: 'danger' },
} as const;

// --- Podsjetnici ------------------------------------------------------------

export const REMINDER_KIND_LABELS: Readonly<Record<(typeof REMINDER_KINDS)[number], string>> = {
  REGISTRATION: 'Istek registracije',
  INSURANCE: 'Istek osiguranja',
  SERVICE_DATE: 'Servis po datumu',
  SERVICE_KM: 'Servis po kilometraži',
  DRIVER_LICENSE: 'Istek vozačke dozvole',
  TECHNICAL_INSPECTION: 'Tehnički pregled',
  TIRE_ROTATION: 'Rotacija guma',
  CUSTOM: 'Prilagođeni podsjetnik',
} as const;

export const REMINDER_STATUS_LABELS: Readonly<Record<(typeof REMINDER_STATUSES)[number], Meta>> = {
  SCHEDULED: { label: 'Zakazan', level: 'neutral' },
  SENT: { label: 'Poslan', level: 'info' },
  ACKNOWLEDGED: { label: 'Potvrđen', level: 'success' },
  SNOOZED: { label: 'Odgođen', level: 'warning' },
  CANCELLED: { label: 'Otkazan', level: 'neutral' },
} as const;

// --- Audit, izvještaji ------------------------------------------------------

export const AUDIT_SEVERITY_LABELS: Readonly<Record<(typeof AUDIT_SEVERITIES)[number], Meta>> = {
  INFO: { label: 'Info', level: 'neutral' },
  WARN: { label: 'Upozorenje', level: 'warning' },
  SECURITY: { label: 'Sigurnosni događaj', level: 'danger' },
  CRITICAL: { label: 'Kritično', level: 'danger' },
} as const;

export const EXPORT_FORMAT_LABELS: Readonly<Record<string, string>> = {
  PDF: 'PDF',
  XLSX: 'Excel',
  CSV: 'CSV',
} as const;

export const EXPORT_STATUS_LABELS: Readonly<Record<(typeof EXPORT_STATUSES)[number], Meta>> = {
  QUEUED: { label: 'U redu', level: 'neutral' },
  RUNNING: { label: 'U obradi', level: 'info' },
  DONE: { label: 'Spremno', level: 'success' },
  FAILED: { label: 'Neuspješno', level: 'danger' },
  EXPIRED: { label: 'Isteklo', level: 'warning' },
} as const;

// -----------------------------------------------------------------------------
//  Jedinstveni pristup
// -----------------------------------------------------------------------------

type LabelMap = Readonly<Record<string, StatusMeta | string>>;

/** Domeni naziva — isti kod enuma može imati različit rod/naziv po domenu. */
export type LabelDomain =
  | 'role'
  | 'clientType'
  | 'user'
  | 'vehicle'
  | 'driver'
  | 'record'
  | 'taskStatus'
  | 'taskPriority'
  | 'taskAssignMode'
  | 'taskAssignmentRole'
  | 'taskEvent'
  | 'taskType'
  | 'formSchemaStatus'
  | 'formSubject'
  | 'fieldType'
  | 'migrationJob'
  | 'tireSeason'
  | 'tireStatus'
  | 'tirePosition'
  | 'tireDismountReason'
  | 'attachmentStage'
  | 'outbox'
  | 'notification'
  | 'notificationChannel'
  | 'notificationPriority'
  | 'delivery'
  | 'deviceToken'
  | 'reminderKind'
  | 'reminderStatus'
  | 'auditSeverity'
  | 'exportFormat'
  | 'exportStatus'
  | 'fuelType'
  | 'ownershipType'
  | 'odometerSource';

/** Sve mape naziva po domenu. */
export const LABEL_MAPS: Readonly<Record<LabelDomain, LabelMap>> = {
  role: ROLE_LABELS,
  clientType: CLIENT_TYPE_LABELS,
  user: USER_STATUS_LABELS,
  vehicle: VEHICLE_STATUS_LABELS,
  driver: DRIVER_STATUS_LABELS,
  record: RECORD_STATUS_LABELS,
  taskStatus: TASK_STATUS_LABELS,
  taskPriority: TASK_PRIORITY_LABELS,
  taskAssignMode: TASK_ASSIGN_MODE_LABELS,
  taskAssignmentRole: TASK_ASSIGNMENT_ROLE_LABELS,
  taskEvent: TASK_EVENT_ACTION_LABELS,
  taskType: TASK_TYPE_LABELS,
  formSchemaStatus: FORM_SCHEMA_STATUS_LABELS,
  formSubject: FORM_SUBJECT_LABELS,
  fieldType: FIELD_TYPE_LABELS,
  migrationJob: MIGRATION_JOB_STATUS_LABELS,
  tireSeason: TIRE_SEASON_LABELS,
  tireStatus: TIRE_STATUS_LABELS,
  tirePosition: TIRE_POSITION_LABELS,
  tireDismountReason: TIRE_DISMOUNT_REASON_LABELS,
  attachmentStage: ATTACHMENT_STAGE_LABELS,
  outbox: OUTBOX_STATUS_LABELS,
  notification: NOTIFICATION_STATUS_LABELS,
  notificationChannel: NOTIFICATION_CHANNEL_LABELS,
  notificationPriority: NOTIFICATION_PRIORITY_LABELS,
  delivery: DELIVERY_STATUS_LABELS,
  deviceToken: DEVICE_TOKEN_STATUS_LABELS,
  reminderKind: REMINDER_KIND_LABELS,
  reminderStatus: REMINDER_STATUS_LABELS,
  auditSeverity: AUDIT_SEVERITY_LABELS,
  exportFormat: EXPORT_FORMAT_LABELS,
  exportStatus: EXPORT_STATUS_LABELS,
  fuelType: FUEL_TYPE_LABELS,
  ownershipType: OWNERSHIP_TYPE_LABELS,
  odometerSource: ODOMETER_SOURCE_LABELS,
};

/**
 * Redoslijed pretrage za generički `statusLabel(value)`.
 *
 * Važno: isti kod postoji u više enuma s različitim rodom — npr. `CANCELLED`
 * je za zadatak „Otkazan“, a za evidenciju „Otkazano“. Zato je redoslijed
 * determinisan: prvo statusi zadatka (najčešći u UI-u), pa evidencije itd.
 * Kad je domen poznat, uvijek proslijediti `domain` (npr. `statusLabel(x,'record')`)
 * — ili koristiti `<StatusBadge domain="record" … />`.
 */
const ALL_LABEL_MAPS: readonly LabelMap[] = [
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  USER_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  DRIVER_STATUS_LABELS,
  RECORD_STATUS_LABELS,
  FORM_SCHEMA_STATUS_LABELS,
  OUTBOX_STATUS_LABELS,
  NOTIFICATION_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  REMINDER_STATUS_LABELS,
  EXPORT_STATUS_LABELS,
  AUDIT_SEVERITY_LABELS,
  MIGRATION_JOB_STATUS_LABELS,
  TIRE_STATUS_LABELS,
  DEVICE_TOKEN_STATUS_LABELS,
  ROLE_LABELS,
  CLIENT_TYPE_LABELS,
  TASK_ASSIGN_MODE_LABELS,
  TASK_ASSIGNMENT_ROLE_LABELS,
  TASK_EVENT_ACTION_LABELS,
  TASK_TYPE_LABELS,
  FORM_SUBJECT_LABELS,
  FIELD_TYPE_LABELS,
  TIRE_SEASON_LABELS,
  TIRE_POSITION_LABELS,
  TIRE_DISMOUNT_REASON_LABELS,
  ATTACHMENT_STAGE_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_PRIORITY_LABELS,
  REMINDER_KIND_LABELS,
  EXPORT_FORMAT_LABELS,
  FUEL_TYPE_LABELS,
  OWNERSHIP_TYPE_LABELS,
  ODOMETER_SOURCE_LABELS,
];

/**
 * Naziv statusa/enuma na bosanskom za bilo koju vrijednost.
 *
 * @param value  vrijednost enuma (npr. `IN_PROGRESS`)
 * @param domain opciono: tačan domen → otklanja dvosmislenost (npr. `CANCELLED`)
 *
 * Za nepoznatu vrijednost vraća nju samu (nikad `undefined`) — UI uvijek mora
 * nešto prikazati; nepoznata vrijednost je signal za dopunu mapa.
 */
export function statusLabel(value: string, domain?: LabelDomain): string {
  const maps = domain ? [LABEL_MAPS[domain]] : ALL_LABEL_MAPS;
  for (const map of maps) {
    const entry = map[value];
    if (entry === undefined) continue;
    return typeof entry === 'string' ? entry : entry.label;
  }
  return value;
}

/** Semantički nivo (boja) za status; `default` ako nije definisan. */
export function statusLevel(value: string, domain?: LabelDomain): SemanticLevel {
  const maps = domain ? [LABEL_MAPS[domain]] : ALL_LABEL_MAPS;
  for (const map of maps) {
    const entry = map[value];
    if (entry !== undefined && typeof entry !== 'string') {
      return entry.level;
    }
  }
  return 'default';
}

/** Puni `StatusMeta` ili `null` ako vrijednost nije poznata. */
export function statusMeta(value: string, domain?: LabelDomain): StatusMeta | null {
  const maps = domain ? [LABEL_MAPS[domain]] : ALL_LABEL_MAPS;
  for (const map of maps) {
    const entry = map[value];
    if (entry !== undefined && typeof entry !== 'string') {
      return entry;
    }
  }
  return null;
}

/**
 * Provjera kompletnosti: koje vrijednosti enuma nemaju naziv u mapi.
 * Koristi se u unit testovima da se spriječi "zaboravljeno" novo stanje.
 */
export function findMissingLabels(values: readonly string[], map: LabelMap): readonly string[] {
  return values.filter((value) => map[value] === undefined);
}
