import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.vehicle.ba101.top/api/v1').replace(/\/$/u, '');
const REFRESH_KEY = 'vfm.refresh-token';

let accessToken: string | null = null;
let refreshFlight: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly details?: Array<{ path: string[]; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope<T> = { data: T } | { error: { code?: string; message?: string; requestId?: string; details?: Array<{ path: string[]; message: string }> } };

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

async function refresh(): Promise<boolean> {
  if (refreshFlight) return refreshFlight;
  const promise = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) return false;
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Client-Type': 'MOBILE_ANDROID' },
        body: JSON.stringify({ refreshToken, clientType: 'MOBILE_ANDROID' }),
      });
      const body = (await response.json()) as Envelope<{ accessToken: string; refreshToken: string }>;
      if (!response.ok || !('data' in body) || !body.data.accessToken || !body.data.refreshToken) return false;
      accessToken = body.data.accessToken;
      await SecureStore.setItemAsync(REFRESH_KEY, body.data.refreshToken);
      return true;
    } catch {
      return false;
    }
  })();
  refreshFlight = promise;
  try {
    return await promise;
  } finally {
    if (refreshFlight === promise) refreshFlight = null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, mayRefresh = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-Client-Type': 'MOBILE_ANDROID',
        ...(init.body && !(typeof FormData !== 'undefined' && init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('Nema mrežne veze. Provjerite internet i pokušajte ponovo.', 0, 'NETWORK_ERROR');
  }

  if (response.status === 401 && mayRefresh && !path.startsWith('/auth/')) {
    if (await refresh()) return request<T>(path, init, false);
    accessToken = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }

  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    if (!response.ok) throw new ApiError(`Zahtjev nije uspio (HTTP ${response.status}).`, response.status, 'HTTP_ERROR');
  }
  if (!response.ok) {
    const error = body && 'error' in body ? body.error : {};
    throw new ApiError(error.message ?? `Zahtjev nije uspio (HTTP ${response.status}).`, response.status, error.code ?? 'HTTP_ERROR', error.requestId, error.details);
  }
  return body && 'data' in body ? body.data : (body as T);
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
}

export interface TaskDetail extends TaskSummary {
  version: number;
  formData: Record<string, unknown>;
  assignments: Array<{ id: string; userId: string; userName: string; role: string }>;
  attachmentIds: string[];
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

export const mobileApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  login: async (email: string, password: string) => {
    const deviceName = Device.modelName ?? 'Android uređaj';
    const session = await request<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        clientType: 'MOBILE_ANDROID',
        deviceInfo: { model: deviceName, osVersion: Device.osVersion ?? undefined, appVersion: Constants.expoConfig?.version ?? '1.0.0' },
      }),
    });
    accessToken = session.accessToken;
    await SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken);
    return session.user;
  },
  restore: async () => {
    if (!(await refresh())) return null;
    return request<MobileUser>('/auth/me');
  },
  logout: async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    try {
      await request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }, false);
    } finally {
      accessToken = null;
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    }
  },
  tasks: () => request<{ items: TaskSummary[]; total: number }>('/tasks/available?page=1&pageSize=50'),
  myTasks: () => request<{ items: TaskSummary[]; page: number; pageSize: number; total: number; totalPages: number }>('/tasks?mine=true&page=1&pageSize=50&sortBy=updatedAt&sortOrder=desc'),
  task: (id: string) => request<TaskDetail>(`/tasks/${encodeURIComponent(id)}`),
  vehicles: () => request<{ items: VehicleSummary[]; page: number; pageSize: number; total: number; totalPages: number }>('/vehicles?page=1&pageSize=50'),
  vehicle: (id: string) => request<VehicleDetail>(`/vehicles/${encodeURIComponent(id)}`),
  formVersion: (task: Pick<TaskSummary, 'formSchemaId' | 'formSchemaVersionId'>) =>
    request<FormVersionSnapshot>(`/form-schemas/${encodeURIComponent(task.formSchemaId)}/versions/${encodeURIComponent(task.formSchemaVersionId)}`),
  claimTask: (id: string, formData: Record<string, unknown>) =>
    request<TaskDetail>(`/tasks/${encodeURIComponent(id)}/claim`, { method: 'POST', body: JSON.stringify({ formData }) }),
  completeTask: (id: string, version: number, formData: Record<string, unknown>, extra: { comment?: string; odometerKm?: number } = {}) =>
    request<TaskDetail>(`/tasks/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ version, formData, ...extra }),
    }),
  uploadAttachment: (uri: string, fileName: string, mimeType: string) => {
    const form = new FormData();
    form.append('file', { uri, name: fileName, type: mimeType } as unknown as Blob);
    return request<AttachmentUploadResult>('/attachments', { method: 'POST', body: form });
  },
};
