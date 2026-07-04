import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiFetch } from '@/lib/api-client';

/**
 * Requests notification permission and returns an Expo push token, or null
 * if permission was denied, running on a simulator, or no EAS projectId is
 * configured yet (`eas init` must be run before push tokens can be minted).
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('[push] No EAS projectId configured — skipping push token registration. Run `eas init`.');
    return null;
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (error) {
    console.warn('[push] Failed to get Expo push token', error);
    return null;
  }
}

let cachedToken: string | null = null;

export async function registerDeviceToken(organizationId?: string): Promise<void> {
  const token = await getExpoPushToken();
  if (!token) return;
  cachedToken = token;

  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  await apiFetch('/api/mobile/register-device', {
    method: 'POST',
    body: JSON.stringify({ platform, token, deviceName: Device.deviceName ?? undefined, organizationId }),
  }).catch((error) => console.warn('[push] Failed to register device token', error));
}

export function getCachedDeviceToken(): string | null {
  return cachedToken;
}

export async function unregisterDeviceToken(): Promise<void> {
  if (!cachedToken) return;
  await apiFetch('/api/mobile/unregister-device', {
    method: 'DELETE',
    body: JSON.stringify({ token: cachedToken }),
  }).catch(() => null);
  cachedToken = null;
}
