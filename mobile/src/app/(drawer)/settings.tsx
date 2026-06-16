import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../../components/icon';
import { useAppStore } from '../../lib/store';
import { getSavedHosts } from '../../lib/storage';
import ScreenHeader from '../../components/ScreenHeader';
import Surface from '../../components/Surface';
import { useColors } from '../../lib/colors';

export default function SettingsScreen() {
  const router = useRouter();
  const c = useColors();
  const { serverUrl, signOut } = useAppStore();
  const [savedHosts, setSavedHosts] = useState<string[]>([]);

  useEffect(() => {
    getSavedHosts().then(setSavedHosts);
  }, []);

  function handleSignOut() {
    Alert.alert('Sign out', 'Sign out of this server?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" />

      <View className="p-4 gap-6">
        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-faint-fg px-1">SERVER</Text>
          <Surface className="p-4 flex-row items-center gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-md bg-muted">
              <Icon name="server" size={16} color={c.mutedForeground} />
            </View>
            <Text className="text-foreground text-sm flex-1" numberOfLines={1}>{serverUrl}</Text>
            <TouchableOpacity onPress={() => router.push('/connect')} activeOpacity={0.6}>
              <Text className="text-primary text-sm font-medium">Change</Text>
            </TouchableOpacity>
          </Surface>
        </View>

        {savedHosts.length > 1 && (
          <View className="gap-2">
            <Text className="text-[13px] font-semibold text-faint-fg px-1">SAVED SERVERS</Text>
            {savedHosts.map(host => (
              <Surface key={host} className="p-4" onPress={() => router.push('/connect')}>
                <Text className="text-foreground text-sm" numberOfLines={1}>{host}</Text>
              </Surface>
            ))}
          </View>
        )}

        <TouchableOpacity
          className="flex-row items-center justify-center gap-2 rounded-lg border border-border-soft bg-card p-4"
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Icon name="log-out" size={16} color={c.destructive} />
          <Text className="font-medium text-destructive">Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
