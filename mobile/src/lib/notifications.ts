import * as Notifications from 'expo-notifications';
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

  const tokenData = await Notifications.getExpoPushTokenAsync();
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
