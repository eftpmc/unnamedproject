import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../components/icon';
import { useCreateChat } from '../../hooks/useChats';
import EmptyState from '../../components/EmptyState';
import { useColors } from '../../lib/colors';

export default function HomeScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const createChat = useCreateChat();

  async function handleNewChat() {
    const { id } = await createChat.mutateAsync();
    router.push(`/(drawer)/c/${id}`);
  }

  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top }} className="bg-background border-b border-border-soft">
        <View className="pl-1 pr-4 h-14 flex-row items-center">
          <TouchableOpacity
            className="h-11 w-11 items-center justify-center rounded-lg"
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
            activeOpacity={0.6}
            accessibilityLabel="Open menu"
          >
            <Icon name="menu" size={22} color={c.fgSoft} />
          </TouchableOpacity>
          <View className="flex-1 flex-row items-center justify-center gap-2">
            <View className="w-6 h-6 rounded-md bg-primary items-center justify-center">
              <Text className="text-primary-foreground text-[11px] font-bold">u</Text>
            </View>
            <Text className="text-foreground text-[15px] font-semibold tracking-tight">unnamed</Text>
          </View>
          <View className="w-11" />
        </View>
      </View>

      <EmptyState
        icon="message-square"
        title="Start a conversation"
        description="Plan work, inspect a project, or make a change — your agent is ready."
        actionLabel={createChat.isPending ? 'Starting…' : 'New chat'}
        onAction={handleNewChat}
      />
    </View>
  );
}
