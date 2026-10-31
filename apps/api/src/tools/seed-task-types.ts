/**
 * Početne vrste zadataka (docs/03 §3.6).
 *
 * Ovo je konfiguracija sistema, ne demo sadržaj: seed je dodaje i u
 * produkciji, ali postojeći red s istim kodom nikad ne prepisuje. Tako
 * arhivirana ili ručno prilagođena vrsta ostaje onakva kakvu je administrator
 * ostavio, a ponovni deploy ne pravi duplikat.
 */
import type { TaskAssignMode, TaskPriority, TaskTypeCode } from '@vfm/shared';

export interface SeedTaskType {
  readonly code: TaskTypeCode;
  readonly name: string;
  readonly description: string;
  readonly iconName: string;
  readonly colorHex: string;
  readonly requiresVehicle: boolean;
  readonly requiresOdometer: boolean;
  readonly requiresPhotos: boolean;
  readonly defaultPriority: TaskPriority;
  readonly defaultAssignMode: TaskAssignMode;
  readonly dueOffsetHours: number | null;
  readonly sortOrder: number;
  readonly orderFormKey?: string;
  readonly realizationFormKey?: string;
  /** @deprecated alias nalog forme */
  readonly formKey?: string;
}

export const SEED_TASK_TYPES: readonly SeedTaskType[] = [
  {
    code: 'WASH',
    name: 'Pranje vozila',
    description: 'Vanjsko i/ili unutrašnje pranje vozila.',
    iconName: 'car-wash',
    colorHex: '#2563EB',
    requiresVehicle: true,
    requiresOdometer: false,
    requiresPhotos: true,
    defaultPriority: 'NORMAL',
    defaultAssignMode: 'BROADCAST',
    dueOffsetHours: 24,
    sortOrder: 10,
    orderFormKey: 'pranje_vozila_nalog',
    realizationFormKey: 'pranje_vozila',
    formKey: 'pranje_vozila_nalog',
  },
  {
    code: 'INTERIOR_CLEANING',
    name: 'Čišćenje unutrašnjosti',
    description: 'Detaljno čišćenje kabine i prtljažnika.',
    iconName: 'armchair',
    colorHex: '#7C3AED',
    requiresVehicle: true,
    requiresOdometer: false,
    requiresPhotos: true,
    defaultPriority: 'NORMAL',
    defaultAssignMode: 'BROADCAST',
    dueOffsetHours: 24,
    sortOrder: 20,
    orderFormKey: 'ciscenje_nalog',
    realizationFormKey: 'ciscenje_realizacija',
  },
  {
    code: 'FUEL_REFILL',
    name: 'Dopuna goriva',
    description: 'Točenje goriva uz očitanje kilometraže i trošak.',
    iconName: 'fuel',
    colorHex: '#D97706',
    requiresVehicle: true,
    requiresOdometer: true,
    requiresPhotos: false,
    defaultPriority: 'NORMAL',
    defaultAssignMode: 'OPEN_CLAIM',
    dueOffsetHours: 8,
    sortOrder: 30,
    orderFormKey: 'gorivo_nalog',
    realizationFormKey: 'gorivo_realizacija',
  },
  {
    code: 'SERVICE_VISIT',
    name: 'Odlazak na servis',
    description: 'Odvoženje vozila na planirani ili vanredni servis.',
    iconName: 'wrench',
    colorHex: '#DC2626',
    requiresVehicle: true,
    requiresOdometer: true,
    requiresPhotos: false,
    defaultPriority: 'HIGH',
    defaultAssignMode: 'ASSIGN_DIRECT',
    dueOffsetHours: 48,
    sortOrder: 40,
    orderFormKey: 'servis_nalog',
    realizationFormKey: 'servis_realizacija',
  },
  {
    code: 'TIRE_CHANGE',
    name: 'Zamjena guma',
    description: 'Sezonska ili vanredna zamjena kompleta guma.',
    iconName: 'circle-dot',
    colorHex: '#475569',
    requiresVehicle: true,
    requiresOdometer: true,
    requiresPhotos: true,
    defaultPriority: 'HIGH',
    defaultAssignMode: 'OPEN_CLAIM',
    dueOffsetHours: 48,
    sortOrder: 50,
    orderFormKey: 'gume_nalog',
    realizationFormKey: 'gume_realizacija',
  },
  {
    code: 'TECHNICAL_INSPECTION',
    name: 'Tehnički pregled',
    description: 'Priprema i odlazak vozila na tehnički pregled.',
    iconName: 'clipboard-check',
    colorHex: '#0891B2',
    requiresVehicle: true,
    requiresOdometer: true,
    requiresPhotos: false,
    defaultPriority: 'HIGH',
    defaultAssignMode: 'ASSIGN_DIRECT',
    dueOffsetHours: 72,
    sortOrder: 60,
    orderFormKey: 'tehnicki_nalog',
    realizationFormKey: 'tehnicki_realizacija',
  },
  {
    code: 'REGISTRATION',
    name: 'Registracija vozila',
    description: 'Obnova registracije i prateće dokumentacije vozila.',
    iconName: 'file-check',
    colorHex: '#059669',
    requiresVehicle: true,
    requiresOdometer: false,
    requiresPhotos: false,
    defaultPriority: 'HIGH',
    defaultAssignMode: 'ASSIGN_DIRECT',
    dueOffsetHours: 72,
    sortOrder: 70,
    orderFormKey: 'registracija_nalog',
    realizationFormKey: 'registracija_zadatak_realizacija',
  },
  {
    code: 'CUSTOM',
    name: 'Prilagođeni zadatak',
    description: 'Zadatak koji ne pripada nijednoj unaprijed definisanoj vrsti.',
    iconName: 'clipboard-list',
    colorHex: '#64748B',
    requiresVehicle: false,
    requiresOdometer: false,
    requiresPhotos: false,
    defaultPriority: 'NORMAL',
    defaultAssignMode: 'BROADCAST',
    dueOffsetHours: null,
    sortOrder: 100,
    orderFormKey: 'prilagodeni_nalog',
    realizationFormKey: 'prilagodeni_realizacija',
  },
  {
    code: 'HANDOVER',
    name: 'Predaja vozila',
    description: 'Predaja i povrat vozila uz evidentirano stanje.',
    iconName: 'handshake',
    colorHex: '#0F766E',
    requiresVehicle: true,
    requiresOdometer: true,
    requiresPhotos: true,
    defaultPriority: 'HIGH',
    defaultAssignMode: 'ASSIGN_DIRECT',
    dueOffsetHours: 24,
    sortOrder: 80,
    orderFormKey: 'predaja_nalog',
    realizationFormKey: 'predaja_realizacija',
  },
] as const;
