import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { clearDeviceTokenId, readDeviceTokenId, storeDeviceTokenId } from '@/lib/api-client';
import { mobileApi } from '@/lib/api';

type NotificationsApi = typeof import('expo-notifications');

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

function canUseNativePush(): boolean {
  return Device.isDevice && !isExpoGo();
}

function loadNotifications(): NotificationsApi | null {
  if (!canUseNativePush()) return null;
  try {
    return require('expo-notifications') as NotificationsApi;
  } catch {
    return null;
  }
}

export async function registerPushToken(permissions: string[]): Promise<void> {
  if (!permissions.includes('notification:manage_preferences')) return;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    if (!token.data) return;
    const registered = await mobileApi.registerDeviceToken({
      token: token.data,
      platform: 'android',
      appVersion: Constants.expoConfig?.version ?? undefined,
      deviceModel: Device.modelName ?? undefined,
      osVersion: Device.osVersion ?? undefined,
      locale: 'bs',
    });
    await storeDeviceTokenId(registered.id);
  } catch {
    // FCM je no-op dok nema google-services / native builda.
  }
}

export async function unregisterPushToken(): Promise<void> {
  const id = await readDeviceTokenId();
  if (!id) return;
  try {
    await mobileApi.revokeDeviceToken(id);
  } catch {
    // Logout i dalje briše lokalni id.
  } finally {
    await clearDeviceTokenId();
  }
}

export function openNotificationLink(linkToType: string | null, linkToId: string | null): void {
  if (!linkToId) return;
  if (linkToType === 'TASK') router.push({ pathname: '/task/[id]', params: { id: linkToId } });
  else if (linkToType === 'VEHICLE') router.push({ pathname: '/vehicle/[id]', params: { id: linkToId } });
}

export function listenForNotificationTaps(): () => void {
  const Notifications = loadNotifications();
  if (!Notifications) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { linkToType?: string; linkToId?: string };
    openNotificationLink(data.linkToType ?? null, data.linkToId ?? null);
  });
  return () => subscription.remove();
}
