export interface FormVersionSnapshot {
  id: string;
  formSchemaId: string;
  version: number;
  definition: unknown;
}

export interface AttachmentUploadResult {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface MobileUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  mustChangePassword: boolean;
  isSuperAdmin: boolean;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: MobileUser;
}

export interface TaskSummary {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  createdAt: string;
  taskTypeName: string;
  vehicleInternalNo: string | null;
  vehicleId: string | null;
  assigneeName: string | null;
  formSchemaId: string;
  formSchemaName: string;
  formSchemaVersionId: string;
  formSchemaVersion: number;
  realizationFormSchemaId?: string | null;
  realizationFormSchemaVersionId?: string | null;
}

export interface TaskDetail extends TaskSummary {
  version: number;
  formData: Record<string, unknown>;
  orderFormData?: Record<string, unknown>;
  realizationFormData?: Record<string, unknown>;
  assignments: Array<{ id: string; userId: string; userName: string; role: string }>;
  attachmentIds: string[];
}

export interface ActiveSession {
  id: string;
  clientType: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: { model?: string; osVersion?: string; appVersion?: string } | null;
}

export interface NotificationSummary {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  linkToType: string | null;
  linkToId: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'SENT' | 'READ' | 'FAILED';
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  status: string;
}

export interface VehicleSummary {
  id: string;
  internalNo: string;
  make: string;
  model: string;
  year: number | null;
  plateNumber: string | null;
  fuelType: string;
  status: string;
  odometerKm: number;
  odometerUpdatedAt: string | null;
  registrationExpiresAt: string | null;
  insuranceExpiresAt: string | null;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface MobileTaskType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requiresVehicle: boolean;
  requiresOdometer: boolean;
  requiresPhotos: boolean;
  defaultPriority: string;
  defaultAssignMode: string;
  formSchemaId: string | null;
}

export interface ActiveTaskForm {
  formSchemaId: string;
  key: string;
  name: string;
  subject: string;
  formSchemaVersionId: string;
  version: number;
  contentHash: string;
  mobileCompatible: boolean;
  definition: unknown;
}

export interface VehicleDetail extends VehicleSummary {
  vin: string | null;
  transmission: string | null;
  color: string | null;
  bodyType: string | null;
  engineCcm: number | null;
  enginePowerKw: number | null;
  seats: number | null;
  ownershipType: string;
  acquisitionDate: string | null;
  acquisitionPrice: number | null;
  costCenter: string | null;
  nextServiceDueDate: string | null;
  nextServiceDueKm: number | null;
  notes: string | null;
  photoAttachmentId: string | null;
  formSchemaId: string;
  formSchemaVersionId: string;
  formData: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationPreferenceView {
  id: string;
  type: string;
  channelFcm: boolean;
  channelInApp: boolean;
  channelEmail: boolean;
  updatedAt: string;
}

export interface DeviceTokenView {
  id: string;
  platform: 'android' | 'ios' | 'web';
  status: string;
}
