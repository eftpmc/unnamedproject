import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../../components/icon';
import { useAppStore } from '../../lib/store';
import { getSavedHosts, type ThemePreference } from '../../lib/storage';
import ScreenHeader from '../../components/ScreenHeader';
import Surface from '../../components/Surface';
import { useColors } from '../../lib/colors';

export default function SettingsScreen() {
  const router = useRouter();
  const c = useColors();
  const { serverUrl, signOut, themePreference, setThemePreference } = useAppStore();
  const [savedHosts, setSavedHosts] = useState<string[]>([]);

  const themeOptions: Array<{ value: ThemePreference; label: string; icon: 'monitor' | 'sun' | 'moon' }> = [
    { value: 'system', label: 'System', icon: 'monitor' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ];

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
          <Text className="text-[13px] font-semibold text-faint-fg px-1">Theme</Text>
          <Surface className="p-1 flex-row gap-1">
            {themeOptions.map(option => {
              const selected = themePreference === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-md py-3 ${selected ? 'bg-muted' : ''}`}
                  onPress={() => setThemePreference(option.value)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Icon name={option.icon} size={15} color={selected ? c.foreground : c.mutedForeground} />
                  <Text className={`text-sm font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Surface>
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-faint-fg px-1">Server</Text>
          <Surface className="p-4 flex-row items-center gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-md bg-muted">
              <Icon name="server" size={16} color={c.mutedForeground} />
            </View>
            <Text className="text-foreground text-sm flex-1" numberOfLines={1}>{serverUrl}</Text>
            <TouchableOpacity
              onPress={() => router.push('/connect')}
              activeOpacity={0.6}
              className="-my-2 -mr-1 px-2 py-2 rounded-md"
              accessibilityRole="button"
            >
              <Text className="text-primary text-sm font-medium">Change</Text>
            </TouchableOpacity>
          </Surface>
        </View>

        {savedHosts.length > 1 && (
          <View className="gap-2">
            <Text className="text-[13px] font-semibold text-faint-fg px-1">Saved servers</Text>
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
