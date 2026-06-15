import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { useChats, useCreateChat } from '../hooks/useChats';
import { useAppStore } from '../lib/store';
import type { Chat } from '../../types';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const NAV_ITEMS = [
  { label: 'Activity', href: '/(drawer)/activity', showBadge: true },
  { label: 'Chats', href: '/(drawer)/chats' },
  { label: 'Projects', href: '/(drawer)/projects' },
  { label: 'Pipelines', href: '/(drawer)/pipelines' },
];

export default function DrawerContent(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: chats = [] } = useChats();
  const createChat = useCreateChat();
  const { pendingApprovalCount, signOut } = useAppStore();

  async function handleNewChat() {
    const { id } = await createChat.mutateAsync();
    router.push(`/(drawer)/c/${id}`);
    props.navigation?.closeDrawer?.();
  }

  function go(href: string) {
    router.push(href as Parameters<typeof router.push>[0]);
    props.navigation?.closeDrawer?.();
  }

  const recentChats = chats.slice(0, 5);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }}>
      <View className="flex-1 px-3 py-4 gap-4">
        {/* Header */}
        <View className="flex-row items-center gap-2 px-2">
          <View className="w-7 h-7 rounded-lg bg-primary items-center justify-center">
            <Text className="text-primary-foreground text-xs font-bold">u</Text>
          </View>
          <Text className="text-foreground font-semibold">unnamed</Text>
        </View>

        {/* New Chat */}
        <TouchableOpacity
          className="bg-primary rounded-xl py-2.5 items-center"
          onPress={handleNewChat}
          disabled={createChat.isPending}
        >
          <Text className="text-primary-foreground font-medium">+ New chat</Text>
        </TouchableOpacity>

        {/* Nav */}
        <View className="gap-1">
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <TouchableOpacity
                key={item.href}
                className={`flex-row items-center justify-between rounded-lg px-3 py-2.5 ${active ? 'bg-muted' : ''}`}
                onPress={() => go(item.href)}
              >
                <Text className={`text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {item.label}
                </Text>
                {item.showBadge && pendingApprovalCount > 0 && (
                  <View className="bg-yellow-500 rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
                    <Text className="text-white text-[10px] font-bold">{pendingApprovalCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Recent chats */}
        {recentChats.length > 0 && (
          <View className="gap-1">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2">Recent</Text>
            {recentChats.map((chat: Chat) => {
              const active = pathname === `/(drawer)/c/${chat.id}`;
              return (
                <TouchableOpacity
                  key={chat.id}
                  className={`rounded-lg px-2.5 py-2 ${active ? 'bg-muted' : ''}`}
                  onPress={() => go(`/(drawer)/c/${chat.id}`)}
                >
                  <Text className="text-xs font-medium text-foreground truncate" numberOfLines={1}>
                    {chat.title ?? 'Untitled chat'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Footer */}
        <View className="mt-auto border-t border-border pt-3 gap-1">
          <TouchableOpacity
            className="flex-row items-center gap-2 px-2 py-2.5"
            onPress={() => go('/(drawer)/settings')}
          >
            <Text className="text-sm text-muted-foreground">Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center gap-2 px-2 py-2.5"
            onPress={() => signOut()}
          >
            <Text className="text-sm text-muted-foreground">Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </DrawerContentScrollView>
  );
}
