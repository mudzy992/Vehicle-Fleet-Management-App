import Constants from 'expo-constants';
import * as Device from 'expo-device';
import {
  clearDeviceTokenId,
  clearRefreshToken,
  clearSessionMemory,
  currentSessionId,
  onAuthExpired,
  readDeviceTokenId,
  readRefreshToken,
  request,
  restoreSession,
  setSession,
  storeDeviceTokenId,
  storeRefreshToken,
} from '@/lib/api-client';
import { appendAttachmentFile } from '@/lib/api-form-data';
import { ApiError } from '@/lib/api-error';
import type {
  ActiveSession,
  ActiveTaskForm,
  AttachmentUploadResult,
  AuthResult,
  DeviceTokenView,
  FormVersionSnapshot,
  MobileTaskType,
  MobileUser,
  NotificationPreferenceView,
  NotificationSummary,
  TaskDetail,
  TaskSummary,
  UserSummary,
  VehicleDetail,
  VehicleSummary,
} from '@/lib/api-types';

export { ApiError, toUserMessage, isOfflineError } from '@/lib/api-error';
export { onAuthExpired, currentSessionId, readDeviceTokenId, storeDeviceTokenId, clearDeviceTokenId } from '@/lib/api-client';
export type * from '@/lib/api-types';

const UNSUPPORTED_RECORD_TYPES = new Set(['VEHICLE_HANDOVER', 'OTHER']);

export const mobileApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  currentSessionId,
  activeSessions: () => request<ActiveSession[]>('/auth/sessions'),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  logoutAll: () => request<void>('/auth/logout-all', { method: 'POST', body: JSON.stringify({}) }),
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
    setSession({ accessToken: session.accessToken, sessionId: session.sessionId });
    await storeRefreshToken(session.refreshToken);
    return session.user;
  },
  restore: async () => {
    if (!(await restoreSession())) return null;
    return request<MobileUser>('/auth/me');
  },
  logout: async () => {
    const refreshToken = await readRefreshToken();
    try {
      await request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }, false);
    } finally {
      clearSessionMemory();
      await clearRefreshToken();
    }
  },
  tasks: () => request<{ items: TaskSummary[]; total: number }>('/tasks/available?page=1&pageSize=50'),
  myTasks: () => request<{ items: TaskSummary[]; page: number; pageSize: number; total: number; totalPages: number }>('/tasks?mine=true&page=1&pageSize=50&sortBy=updatedAt&sortOrder=desc'),
  taskTypes: () => request<{ items: MobileTaskType[]; page: number; pageSize: number; total: number; totalPages: number }>('/task-types?activeOnly=true&page=1&pageSize=100'),
  activeTaskForm: (taskTypeId: string, role: 'ORDER' | 'REALIZATION' = 'ORDER') =>
    request<ActiveTaskForm>(`/form-schemas/active?subject=TASK&taskTypeId=${encodeURIComponent(taskTypeId)}&role=${role}`),
  formOptions: (listCode: string) => request<Array<{ value: string; label: string }>>(`/form-schemas/options?listCode=${encodeURIComponent(listCode)}`),
  tireSets: () => request<{ items: Array<{ id: string; code: string; brand: string | null; model: string | null; size: string | null; mountedVehicleId: string | null }> }>('/tire-sets?page=1&pageSize=100'),
  recordOptions: async (entityType: string) => {
    if (UNSUPPORTED_RECORD_TYPES.has(entityType)) {
      throw new ApiError(`Reference entiteta ${entityType} nije podržan.`, 400, 'UNSUPPORTED_REFERENCE');
    }
    const paths: Record<string, string> = {
      VEHICLE: '/vehicles?page=1&pageSize=100&status=ACTIVE',
      DRIVER: '/drivers?page=1&pageSize=100&status=ACTIVE',
      REGISTRATION: '/registrations?page=1&pageSize=100',
      INSURANCE: '/insurances?page=1&pageSize=100',
      SERVICE: '/services?page=1&pageSize=100',
      TIRE_SET: '/tire-sets?page=1&pageSize=100',
      TIRE_INSTALLATION: '/tire-installations?page=1&pageSize=100',
      TASK: '/tasks?mine=true&page=1&pageSize=50&sortBy=updatedAt&sortOrder=desc',
    };
    const path = paths[entityType];
    if (!path) throw new ApiError(`Reference entiteta ${entityType} nije podržan.`, 400, 'UNSUPPORTED_REFERENCE');
    const response = await request<{ items: Array<Record<string, unknown>> }>(path);
    return response.items.flatMap((item) => {
      if (typeof item['id'] !== 'string') return [];
      const personLabel = [item['firstName'], item['lastName']].filter((part): part is string => typeof part === 'string').join(' ');
      const label = [
        item['displayName'], item['internalNo'], item['code'], item['registrationNumber'],
        item['policyNumber'], item['setCode'], item['serviceType'], item['taskTypeName'], item['title'], item['name'],
      ].find((part): part is string => typeof part === 'string' && part.length > 0)
        ?? (personLabel || item['id']);
      const suffix = [item['validUntil'], item['serviceDate'], item['mountedAt']].find((part): part is string => typeof part === 'string');
      return [{ entityId: item['id'], label: suffix ? `${label} · ${suffix}` : label }];
    });
  },
  users: () => request<{ items: UserSummary[]; page: number; pageSize: number; total: number; totalPages: number }>('/users?status=ACTIVE&page=1&pageSize=100'),
  createTask: (input: { taskTypeId: string; vehicleId: string | null; title?: string; description?: string | null; priority?: string; assignMode: 'OPEN_CLAIM' | 'ASSIGN_DIRECT' | 'BROADCAST'; assigneeUserId?: string; invitedUserIds?: string[]; observerUserIds?: string[]; dueAt?: string | null; formData?: Record<string, unknown>; orderFormData?: Record<string, unknown> }) =>
    request<TaskDetail>('/tasks', { method: 'POST', body: JSON.stringify({ ...input, orderFormData: input.orderFormData ?? input.formData ?? {} }) }),
  task: (id: string) => request<TaskDetail>(`/tasks/${encodeURIComponent(id)}`),
  notifications: () => request<{ items: NotificationSummary[]; page: number; pageSize: number; total: number; totalPages: number }>('/notifications?page=1&pageSize=50&sortOrder=desc'),
  unreadNotificationCount: () => request<{ count: number }>('/notifications/unread-count'),
  markAllNotificationsRead: () => request<{ updatedCount: number }>('/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }),
  markNotificationRead: (id: string) => request<NotificationSummary>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: JSON.stringify({}) }),
  notificationPreferences: () => request<{ items: NotificationPreferenceView[] }>('/notifications/preferences'),
  saveNotificationPreference: (input: { type: string; channelFcm: boolean; channelInApp: boolean; channelEmail: boolean }) =>
    request<NotificationPreferenceView>('/notifications/preferences', { method: 'PUT', body: JSON.stringify(input) }),
  registerDeviceToken: (input: { token: string; platform: 'android'; appVersion?: string; deviceModel?: string; osVersion?: string; locale?: string }) =>
    request<DeviceTokenView>('/devices/tokens', { method: 'POST', body: JSON.stringify(input) }),
  revokeDeviceToken: (id: string) => request<void>(`/devices/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  vehicles: () => request<{ items: VehicleSummary[]; page: number; pageSize: number; total: number; totalPages: number }>('/vehicles?page=1&pageSize=100&status=ACTIVE'),
  drivers: () => request<{ items: Array<{ id: string; firstName: string; lastName: string; displayName: string | null; status: string }> }>('/drivers?page=1&pageSize=100&status=ACTIVE'),
  vehicle: (id: string) => request<VehicleDetail>(`/vehicles/${encodeURIComponent(id)}`),
  formVersion: (task: Pick<TaskSummary, 'formSchemaId' | 'formSchemaVersionId'>) =>
    request<FormVersionSnapshot>(`/form-schemas/${encodeURIComponent(task.formSchemaId)}/versions/${encodeURIComponent(task.formSchemaVersionId)}`),
  claimTask: (id: string) =>
    request<TaskDetail>(`/tasks/${encodeURIComponent(id)}/claim`, { method: 'POST', body: JSON.stringify({}) }),
  completeTask: (id: string, version: number, formData: Record<string, unknown>, extra: { comment?: string; odometerKm?: number } = {}) =>
    request<TaskDetail>(`/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST', body: JSON.stringify({ version, realizationFormData: formData, ...extra }) }),
  uploadAttachment: async (uri: string, fileName: string, mimeType: string) => {
    const form = new FormData();
    await appendAttachmentFile(form, uri, fileName, mimeType);
    return request<AttachmentUploadResult>('/attachments', { method: 'POST', body: form });
  },
};
