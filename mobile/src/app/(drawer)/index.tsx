import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useCreateChat } from '../../hooks/useChats';

export default function HomeScreen() {
  const navigation = useNavigation();
  const createChat = useCreateChat();
  const router = useRouter();

  async function handleNewChat() {
    const { id } = await createChat.mutateAsync();
    router.push(`/(drawer)/c/${id}`);
  }

  return (
    <View className="flex-1 bg-background">
      {/* Mobile top bar */}
      <View className="border-b border-border px-4 py-2.5 flex-row items-center justify-between">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground text-lg">☰</Text>
        </TouchableOpacity>
        <View className="w-7 h-7 rounded-lg bg-primary items-center justify-center">
          <Text className="text-primary-foreground text-xs font-semibold">u</Text>
        </View>
        <View className="w-9" />
      </View>

      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-2xl font-bold text-foreground">unnamed</Text>
        <Text className="text-muted-foreground text-center text-sm">
          Start a new conversation or open an existing one from the menu.
        </Text>
        <TouchableOpacity
          className="bg-primary rounded-xl px-6 py-3 mt-2"
          onPress={handleNewChat}
          disabled={createChat.isPending}
        >
          <Text className="text-primary-foreground font-medium">New chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
