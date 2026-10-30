export const ID = {
  vehicle: '55555555-5555-4555-8555-555555555555',
  driver: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  task: '44444444-4444-4444-8444-444444444444',
  user: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: '22222222-2222-4222-8222-222222222222',
  reminder: '44444444-4444-4444-8444-444444444444',
  tire: '99999999-9999-4999-8999-999999999999',
  taskType: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  notification: '66666666-6666-4666-8666-666666666666',
  audit: '42',
  record: '77777777-7777-4777-8777-777777777777',
} as const;

export const vehicleRow = {
  id: ID.vehicle,
  internalNo: 'V-014',
  make: 'Škoda',
  model: 'Octavia',
  year: 2022,
  plateNumber: 'E12-M-345',
  fuelType: 'DIESEL',
  status: 'ACTIVE',
  odometerKm: 84500,
  odometerUpdatedAt: '2026-10-28T08:30:00.000Z',
  registrationExpiresAt: null,
  insuranceExpiresAt: null,
  archivedAt: null,
  version: 1,
  updatedAt: '2026-10-28T08:30:00.000Z',
};

export const driverRow = {
  id: ID.driver,
  firstName: 'Aida',
  lastName: 'Karić',
  employeeNumber: 'DRV-017',
  employmentStatus: 'ACTIVE',
  status: 'ACTIVE',
  licenseExpiresAt: null,
  categories: ['B', 'C'],
  licenseDaysLeft: null,
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const taskRow = {
  id: ID.task,
  code: 'Z-2026-000007',
  title: 'Pregled kočnica',
  description: 'Provjeriti kočioni sistem prije polaska.',
  vehicleInternalNo: 'V-007',
  vehicleMake: 'Škoda',
  vehicleModel: 'Octavia',
  taskTypeName: 'Redovni pregled',
  priority: 'HIGH',
  status: 'OPEN',
  dueAt: '2026-11-01T12:00:00.000Z',
};

export const reminderRow = {
  id: ID.reminder,
  kind: 'SERVICE_KM',
  entityType: 'Vehicle',
  entityId: ID.vehicle,
  dueDate: null,
  dueKm: 120000,
  thresholdDays: null,
  thresholdKm: 10000,
  fireAt: '2026-10-29T08:30:00.000Z',
  status: 'SCHEDULED',
  sentAt: null,
  acknowledgedAt: null,
  due: true,
  createdAt: '2026-10-28T08:30:00.000Z',
};

export const insuranceRow = {
  id: ID.record,
  vehicleId: ID.vehicle,
  policyNumber: 'POL-001',
  validFrom: '2026-01-01',
  validUntil: '2027-01-01',
  status: 'ACTIVE',
  premiumAmount: 12500,
  insuranceCompany: 'Test osiguranje',
  type: 'Obavezno',
};

export const registrationRow = {
  id: ID.record,
  vehicleId: ID.vehicle,
  registrationNumber: 'E12-M-345',
  validFrom: '2026-01-01',
  validUntil: '2027-01-01',
  status: 'ACTIVE',
  costAmount: 18000,
  issuedBy: 'MUP',
};

export const tireRow = {
  id: ID.tire,
  code: 'G-Z-021',
  brand: 'Continental',
  model: 'WinterContact',
  size: '205/55 R16 91V',
  season: 'SUMMER',
  tireCount: 4,
  purchaseDate: '2025-10-01',
  purchasePrice: 62000,
  currency: 'BAM',
  status: 'IN_STOCK',
  currentLocation: 'Centralno skladište',
  notes: null,
  mountedVehicleId: null,
  mountedVehicleInternalNo: null,
  mountedVehiclePlateNumber: null,
  version: 1,
  formSchemaId: null,
  formSchemaVersionId: null,
};

export const taskTypeRow = {
  id: ID.taskType,
  code: 'OIL_CHANGE',
  name: 'Zamjena ulja i filtera',
  description: 'Redovni servis vozila',
  iconName: null,
  colorHex: null,
  requiresVehicle: true,
  requiresOdometer: true,
  requiresPhotos: false,
  defaultPriority: 'NORMAL',
  defaultAssignMode: 'OPEN_CLAIM',
  allowMultipleClaimants: false,
  dueOffsetHours: 48,
  formSchemaId: null,
  formSchemaKey: null,
  formSchemaName: null,
  formSchemaVersion: null,
  active: true,
  sortOrder: 1,
  completionRequirementCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const userRow = {
  id: ID.user,
  email: 'a***@example.test',
  firstName: 'Lejla',
  lastName: 'Hadžić',
  displayName: null,
  phone: null,
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: [{ id: ID.role, code: 'DISPATCHER', name: 'Dispečer' }],
  lastLoginAt: null,
  lockedUntil: null,
  piiRedacted: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const notificationRow = {
  id: ID.notification,
  type: 'TASK_CREATED',
  title: 'Novi zadatak',
  body: 'Pregled vozila · V-014',
  data: null,
  linkToType: 'TASK',
  linkToId: ID.task,
  priority: 'HIGH',
  status: 'PENDING',
  isRead: false,
  readAt: null,
  createdAt: '2026-10-30T10:00:00.000Z',
};

export const auditRow = {
  id: ID.audit,
  action: 'ROLE_CHANGE',
  severity: 'WARN',
  actorId: '11111111-1111-4111-8111-111111111111',
  actorEmail: 'admin@example.test',
  actorRoles: ['Administrator'],
  entityType: 'User',
  entityId: ID.user,
  changedFields: ['roles'],
  createdAt: '2026-10-29T10:00:00.000Z',
};

export const roleMatrix = {
  modules: [{
    module: 'Vozila',
    permissions: [{ code: 'vehicle:view', action: 'view', description: 'Pregled vozila', isSensitive: false, inDatabase: true }],
  }],
  roles: [{
    id: ID.role, code: 'DISPATCHER', name: 'Dispečer', description: null, isSystem: false,
    allowedClientTypes: ['WEB'], permissionsVersion: 1, priority: 10, activeUserCount: 2,
    grantedCount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }],
  grants: [{
    roleId: ID.role, permission: 'vehicle:view', scope: 'ALL',
    scopeVehicleIds: [], scopeDriverIds: [], conditions: null, grantedAt: null,
  }],
  generatedAt: '2026-01-01T00:00:00.000Z',
};
