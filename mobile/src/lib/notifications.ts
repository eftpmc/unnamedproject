import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiFetch } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken(): Promise<void> {
  // Push tokens can only be issued on physical devices — simulators/emulators
  // can't register with APNs/FCM, so skip silently to avoid a noisy failure.
  if (!Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('approvals', {
      name: 'Approvals',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  // getExpoPushTokenAsync requires an EAS projectId. Without it (e.g. before
  // `eas init`), bail out with a warning instead of throwing an unhandled error.
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId) {
    console.warn('Skipping push registration: no EAS projectId configured (run `eas init`).');
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const pushToken = tokenData.data;

  await apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify({ expoPushToken: pushToken }),
  });
}

export function configurePushHandlers(
  onNotification: (data: { sessionId?: string; executionId?: string }) => void
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as {
      sessionId?: string;
      executionId?: string;
    };
    onNotification(data);
  });

  return () => sub.remove();
}
