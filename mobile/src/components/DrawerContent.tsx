import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="flex-1 px-3 py-3 gap-5">
        {/* Brand */}
        <View className="flex-row items-center gap-2.5 px-1 h-9">
          <View className="w-9 h-9 rounded-xl bg-primary items-center justify-center">
            <Text className="text-primary-foreground text-base font-bold">u</Text>
          </View>
          <Text className="text-foreground text-lg font-semibold tracking-tight">unnamed</Text>
        </View>

        {/* New chat */}
        <TouchableOpacity
          className="flex-row items-center justify-center gap-2 bg-primary rounded-xl h-12"
          onPress={handleNewChat}
          disabled={createChat.isPending}
          activeOpacity={0.85}
        >
          <Icon name="plus" size={18} color={c.primaryForeground} />
          <Text className="text-primary-foreground text-[15px] font-semibold">New chat</Text>
        </TouchableOpacity>

        {/* Nav */}
        <View className="gap-1">
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <TouchableOpacity
                key={item.href}
                className={`flex-row items-center gap-3 rounded-xl px-3 h-12 ${active ? 'bg-muted' : ''}`}
                onPress={() => go(item.href)}
                activeOpacity={0.7}
              >
                <Icon
                  name={item.icon}
                  size={20}
                  color={active ? c.foreground : c.mutedForeground}
                />
                <Text className={`flex-1 text-[15px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {item.label}
                </Text>
                {item.showBadge && pendingApprovalCount > 0 && (
                  <View className="h-5 min-w-5 items-center justify-center rounded-full px-1.5" style={{ backgroundColor: c.warning }}>
                    <Text className="text-[11px] font-bold" style={{ color: c.warningForeground }}>{pendingApprovalCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Recent — the only scrollable region */}
        {recentChats.length > 0 && (
          <View className="flex-1 min-h-0">
            <Text className="text-xs font-semibold text-faint-fg px-3 pb-1.5">Recent</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 2 }}>
              {recentChats.map((chat: Chat) => {
                const active = pathname === `/(drawer)/c/${chat.id}`;
                return (
                  <TouchableOpacity
                    key={chat.id}
                    className={`rounded-xl px-3 py-2.5 ${active ? 'bg-muted' : ''}`}
                    onPress={() => go(`/(drawer)/c/${chat.id}`)}
                    activeOpacity={0.7}
                  >
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {chat.title ?? 'Untitled chat'}
                    </Text>
                    <Text className="text-xs text-faint-fg mt-0.5">{timeAgo(chat.updated_at)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Footer */}
        <View className="mt-auto border-t border-border-soft pt-2 gap-1">
          <TouchableOpacity
            className="flex-row items-center gap-3 rounded-xl px-3 h-12"
            onPress={() => go('/(drawer)/settings')}
            activeOpacity={0.7}
          >
            <Icon name="settings" size={20} color={c.mutedForeground} />
            <Text className="text-[15px] font-medium text-muted-foreground">Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center gap-3 rounded-xl px-3 h-12"
            onPress={() => signOut()}
            activeOpacity={0.7}
          >
            <Icon name="log-out" size={20} color={c.mutedForeground} />
            <Text className="text-[15px] font-medium text-muted-foreground">Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
