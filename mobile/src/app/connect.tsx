import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAppStore } from '../lib/store';
import { getSavedHosts } from '../lib/storage';

export default function ConnectScreen() {
  const [url, setUrl] = useState('http://');
  const [savedHosts, setSavedHosts] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const { setServerUrl, setToken } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    getSavedHosts().then(setSavedHosts);
  }, []);

  async function connect(targetUrl: string) {
    setLoading(true);
    try {
      const normalized = targetUrl.replace(/\/$/, '');
      const res = await fetch(`${normalized}/auth/me`, {
        headers: useAppStore.getState().token
          ? { Authorization: `Bearer ${useAppStore.getState().token}` }
          : {},
      });
      if (res.status === 401) {
        await setServerUrl(normalized);
        router.replace('/login');
      } else if (res.ok) {
        await setServerUrl(normalized);
        router.replace('/(drawer)');
      } else {
        Alert.alert('Connection failed', `Server returned ${res.status}`);
      }
    } catch {
      Alert.alert('Connection failed', 'Could not reach that address. Check the URL and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleQrScan({ data }: { data: string }) {
    setScanning(false);
    try {
      const parsed = JSON.parse(data) as { url: string; token: string };
      if (!parsed.url || !parsed.token) throw new Error('Invalid QR');
      await setServerUrl(parsed.url);
      await setToken(parsed.token);
      router.replace('/(drawer)');
    } catch {
      Alert.alert('Invalid QR code', 'Could not read server info from the QR code.');
    }
  }

  async function handleScanPress() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { Alert.alert('Camera permission required'); return; }
    }
    setScanning(true);
  }

  if (scanning) {
    return (
      <View className="flex-1 bg-black">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleQrScan}
        />
        <TouchableOpacity
          className="absolute bottom-12 self-center bg-white/20 px-6 py-3 rounded-full"
          onPress={() => setScanning(false)}
        >
          <Text className="text-white font-medium">Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background px-6 justify-center gap-8">
      <View className="gap-1">
        <Text className="text-2xl font-bold text-foreground">Connect to server</Text>
        <Text className="text-muted-foreground text-sm">Enter your server address or scan a QR code</Text>
      </View>

      <View className="gap-3">
        <TextInput
          className="bg-muted rounded-xl px-4 py-3 text-foreground text-base"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.x:3000"
          placeholderTextColor="#666"
          onSubmitEditing={() => connect(url)}
        />
        <TouchableOpacity
          className="bg-primary rounded-xl py-3 items-center"
          onPress={() => connect(url)}
          disabled={loading}
        >
          <Text className="text-primary-foreground font-semibold">
            {loading ? 'Connecting…' : 'Connect'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="border border-border rounded-xl py-3 items-center"
          onPress={handleScanPress}
        >
          <Text className="text-foreground font-medium">Scan QR code</Text>
        </TouchableOpacity>
      </View>

      {savedHosts.length > 0 && (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</Text>
          <FlatList
            data={savedHosts}
            keyExtractor={item => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                className="bg-muted rounded-xl px-4 py-3 mb-2"
                onPress={() => connect(item)}
              >
                <Text className="text-foreground text-sm">{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}
