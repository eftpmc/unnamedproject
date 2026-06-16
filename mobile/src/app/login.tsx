import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../components/icon';
import { useAppStore } from '../lib/store';
import { useColors } from '../lib/colors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { serverUrl, setToken } = useAppStore();
  const router = useRouter();
  const c = useColors();

  async function handleLogin() {
    if (!email || !password) { Alert.alert('Enter email and password'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const { error } = await res.json() as { error?: string };
        Alert.alert('Login failed', error ?? 'Invalid credentials');
        return;
      }
      const { token } = await res.json() as { token: string };
      await setToken(token);
      router.replace('/(drawer)');
    } catch {
      Alert.alert('Login failed', 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 px-6 justify-center gap-8">
        <View className="items-center gap-3">
          <View className="w-14 h-14 rounded-2xl bg-primary items-center justify-center">
            <Text className="text-primary-foreground text-xl font-bold">u</Text>
          </View>
          <View className="items-center gap-1">
            <Text className="text-xl font-semibold tracking-tight text-foreground">Sign in</Text>
            <Text className="text-muted-foreground text-sm" numberOfLines={1}>{serverUrl}</Text>
          </View>
        </View>

        <View className="gap-3">
          <View className="flex-row items-center gap-2 rounded-lg border border-border-soft bg-card px-3.5 h-12">
            <Icon name="mail" size={16} color={c.faintFg} />
            <TextInput
              className="flex-1 text-foreground text-[15px] h-full"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={c.faintFg}
            />
          </View>
          <View className="flex-row items-center gap-2 rounded-lg border border-border-soft bg-card px-3.5 h-12">
            <Icon name="lock" size={16} color={c.faintFg} />
            <TextInput
              className="flex-1 text-foreground text-[15px] h-full"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={c.faintFg}
              onSubmitEditing={handleLogin}
            />
          </View>
          <TouchableOpacity
            className="bg-primary rounded-lg h-12 items-center justify-center"
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text className="text-primary-foreground font-semibold text-[15px]">
              {loading ? 'Signing in…' : 'Sign in'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity className="py-2 items-center" onPress={() => router.replace('/connect')} activeOpacity={0.6}>
            <Text className="text-muted-foreground text-sm">Change server</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
