import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useAppStore } from '../../lib/store';
import { getSavedHosts } from '../../lib/storage';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
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
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg">Settings</Text>
      </View>

      <View className="p-4 gap-6">
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Server</Text>
          <View className="bg-muted rounded-xl p-4 flex-row items-center justify-between">
            <Text className="text-foreground text-sm flex-1" numberOfLines={1}>{serverUrl}</Text>
            <TouchableOpacity onPress={() => router.push('/connect')}>
              <Text className="text-primary text-sm font-medium">Change</Text>
            </TouchableOpacity>
          </View>
        </View>

        {savedHosts.length > 1 && (
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Saved servers</Text>
            {savedHosts.map(host => (
              <TouchableOpacity
                key={host}
                className="bg-muted rounded-xl p-4"
                onPress={() => router.push('/connect')}
              >
                <Text className="text-foreground text-sm">{host}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 items-center"
          onPress={handleSignOut}
        >
          <Text className="text-red-400 font-medium">Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
