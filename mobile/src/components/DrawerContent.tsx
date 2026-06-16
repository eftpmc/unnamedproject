import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import Icon, { type IconName } from './icon';
import { useChats, useCreateChat } from '../hooks/useChats';
import { useAppStore } from '../lib/store';
import { useColors } from '../lib/colors';
import { timeAgo } from '../lib/format';
import type { Chat } from '../../types';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}


const NAV_ITEMS: { label: string; href: string; icon: IconName; showBadge?: boolean }[] = [
  { label: 'Activity', href: '/(drawer)/activity', icon: 'activity', showBadge: true },
  { label: 'Chats', href: '/(drawer)/chats', icon: 'message-square' },
  { label: 'Projects', href: '/(drawer)/projects', icon: 'grid' },
  { label: 'Pipelines', href: '/(drawer)/pipelines', icon: 'git-merge' },
];

export default function DrawerContent(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const c = useColors();
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
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }} className="bg-background">
      <View className="flex-1 px-3 py-3 gap-4">
        {/* Brand */}
        <View className="flex-row items-center gap-2 px-1">
          <View className="w-7 h-7 rounded-lg bg-primary items-center justify-center">
            <Text className="text-primary-foreground text-xs font-bold">u</Text>
          </View>
          <Text className="text-foreground text-sm font-semibold">unnamed</Text>
        </View>

        {/* New chat */}
        <TouchableOpacity
          className="flex-row items-center justify-center gap-1.5 bg-primary rounded-xl py-2.5"
          onPress={handleNewChat}
          disabled={createChat.isPending}
          activeOpacity={0.85}
        >
          <Icon name="plus" size={15} color={c.primaryForeground} />
          <Text className="text-primary-foreground text-sm font-medium">New chat</Text>
        </TouchableOpacity>

        {/* Nav */}
        <View className="gap-0.5">
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <TouchableOpacity
                key={item.href}
                className={`flex-row items-center gap-2.5 rounded-lg px-2.5 h-10 ${active ? 'bg-muted' : ''}`}
                onPress={() => go(item.href)}
                activeOpacity={0.7}
              >
                <Icon
                  name={item.icon}
                  size={16}
                  color={active ? c.foreground : c.mutedForeground}
                />
                <Text className={`flex-1 text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {item.label}
                </Text>
                {item.showBadge && pendingApprovalCount > 0 && (
                  <View className="h-4 min-w-4 items-center justify-center rounded-full px-1" style={{ backgroundColor: c.warning }}>
                    <Text className="text-[10px] font-bold" style={{ color: '#1f1306' }}>{pendingApprovalCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Recent */}
        {recentChats.length > 0 && (
          <View className="gap-0.5 flex-1 min-h-0">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-faint-fg px-2.5 pb-1">Recent</Text>
            {recentChats.map((chat: Chat) => {
              const active = pathname === `/(drawer)/c/${chat.id}`;
              return (
                <TouchableOpacity
                  key={chat.id}
                  className={`rounded-lg px-2.5 py-2 ${active ? 'bg-muted' : ''}`}
                  onPress={() => go(`/(drawer)/c/${chat.id}`)}
                  activeOpacity={0.7}
                >
                  <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                    {chat.title ?? 'Untitled chat'}
                  </Text>
                  <Text className="text-[11px] text-faint-fg mt-0.5">{timeAgo(chat.updated_at)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Footer */}
        <View className="mt-auto border-t border-border-soft pt-2 gap-0.5">
          <TouchableOpacity
            className="flex-row items-center gap-2.5 px-2.5 h-10"
            onPress={() => go('/(drawer)/settings')}
            activeOpacity={0.7}
          >
            <Icon name="settings" size={16} color={c.mutedForeground} />
            <Text className="text-sm font-medium text-muted-foreground">Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center gap-2.5 px-2.5 h-10"
            onPress={() => signOut()}
            activeOpacity={0.7}
          >
            <Icon name="log-out" size={16} color={c.mutedForeground} />
            <Text className="text-sm font-medium text-muted-foreground">Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </DrawerContentScrollView>
  );
}
