import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Icon from '../components/icon';
import { useAppStore } from '../lib/store';
import { getSavedHosts } from '../lib/storage';
import { useColors } from '../lib/colors';

export default function ConnectScreen() {
  const [url, setUrl] = useState('http://');
  const [savedHosts, setSavedHosts] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const scannedRef = useRef(false);
  const { setServerUrl, setToken } = useAppStore();
  const router = useRouter();
  const c = useColors();

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
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScanning(false);
    try {
      const parsed = JSON.parse(data) as { url: string; token: string };
      if (!parsed.url || !parsed.token) throw new Error('Invalid QR');
      // Sync both into store atomically before navigation to avoid intermediate state
      // triggering the auth-gate routing effect with mismatched serverUrl/token
      const { themePreference } = useAppStore.getState();
      useAppStore.getState().hydrate(parsed.url, parsed.token, themePreference);
      const { setServerUrl: persistUrl, setToken: persistToken, addSavedHost } = await import('../lib/storage');
      await Promise.all([persistUrl(parsed.url), persistToken(parsed.token), addSavedHost(parsed.url)]);
      router.replace('/(drawer)');
    } catch {
      scannedRef.current = false;
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
          onPress={() => { scannedRef.current = false; setScanning(false); }}
        >
          <Text className="text-white font-medium">Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background px-6 justify-center gap-8">
      <View className="items-center gap-3">
        <View className="w-14 h-14 rounded-2xl bg-primary items-center justify-center">
          <Text className="text-primary-foreground text-xl font-bold">u</Text>
        </View>
        <View className="items-center gap-1">
          <Text className="text-xl font-semibold tracking-tight text-foreground">Connect to server</Text>
          <Text className="text-muted-foreground text-sm text-center">Enter your server address or scan a QR code</Text>
        </View>
      </View>

      <View className="gap-3">
        <View className="flex-row items-center gap-2 rounded-lg border border-border-soft bg-card px-3.5 h-12">
          <Icon name="globe" size={16} color={c.faintFg} />
          <TextInput
            className="flex-1 text-foreground text-[15px] h-full"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.x:3000"
            placeholderTextColor={c.faintFg}
            onSubmitEditing={() => connect(url)}
          />
        </View>
        <TouchableOpacity
          className="bg-primary rounded-lg h-12 items-center justify-center"
          onPress={() => connect(url)}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text className="text-primary-foreground font-semibold text-[15px]">
            {loading ? 'Connecting…' : 'Connect'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-row items-center justify-center gap-2 rounded-lg border border-border-soft bg-card h-12"
          onPress={handleScanPress}
          activeOpacity={0.7}
        >
          <Icon name="qr-code" size={16} color={c.fgSoft} />
          <Text className="text-foreground font-medium text-[15px]">Scan QR code</Text>
        </TouchableOpacity>
      </View>

      {savedHosts.length > 0 && (
        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-faint-fg px-1">Recent</Text>
          <FlatList
            data={savedHosts}
            keyExtractor={item => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                className="flex-row items-center gap-2 rounded-lg border border-border-soft bg-card px-4 py-3 mb-2"
                onPress={() => connect(item)}
                activeOpacity={0.7}
              >
                <Icon name="clock" size={14} color={c.faintFg} />
                <Text className="text-foreground text-sm flex-1" numberOfLines={1}>{item}</Text>
                <Icon name="chevron-right" size={15} color={c.faintFg} />
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}
