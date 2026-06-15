import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../lib/store';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { serverUrl, setToken } = useAppStore();
  const router = useRouter();

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
        <View className="gap-1">
          <Text className="text-2xl font-bold text-foreground">Sign in</Text>
          <Text className="text-muted-foreground text-sm">{serverUrl}</Text>
        </View>
        <View className="gap-3">
          <TextInput
            className="bg-muted rounded-xl px-4 py-3 text-foreground text-base"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#666"
          />
          <TextInput
            className="bg-muted rounded-xl px-4 py-3 text-foreground text-base"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor="#666"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            className="bg-primary rounded-xl py-3 items-center"
            onPress={handleLogin}
            disabled={loading}
          >
            <Text className="text-primary-foreground font-semibold">
              {loading ? 'Signing in…' : 'Sign in'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="py-3 items-center"
            onPress={() => router.replace('/connect')}
          >
            <Text className="text-muted-foreground text-sm">Change server</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
