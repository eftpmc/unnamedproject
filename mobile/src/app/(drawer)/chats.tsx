import { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Icon from '../../components/icon';
import { useChats, useDeleteChat } from '../../hooks/useChats';
import ScreenHeader from '../../components/ScreenHeader';
import Surface from '../../components/Surface';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { useColors } from '../../lib/colors';
import { timeAgo } from '../../lib/format';
import type { Chat } from '../../../types';

function ChatRow({ chat, onOpen }: { chat: Chat; onOpen: () => void }) {
  const c = useColors();
  const del = useDeleteChat();
  const swipeRef = useRef<SwipeableMethods>(null);

  function confirmDelete() {
    Alert.alert('Delete chat', 'Delete this conversation? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel', onPress: () => swipeRef.current?.close() },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate(chat.id) },
    ]);
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <TouchableOpacity
          className="bg-destructive items-center justify-center rounded-lg ml-2"
          style={{ width: 76 }}
          onPress={confirmDelete}
          activeOpacity={0.85}
          accessibilityLabel={`Delete chat: ${chat.title ?? 'Untitled chat'}`}
        >
          <Icon name="trash" size={18} color="#fff" />
          <Text className="text-white text-xs font-medium mt-1">Delete</Text>
        </TouchableOpacity>
      )}
    >
      <Surface className="flex-row items-center gap-3 px-4 py-3.5" onPress={onOpen}>
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {chat.title ?? 'Untitled chat'}
          </Text>
          <Text className="text-xs text-faint-fg mt-0.5">{timeAgo(chat.updated_at)}</Text>
        </View>
        <Icon name="chevron-right" size={16} color={c.faintFg} />
      </Surface>
    </ReanimatedSwipeable>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const c = useColors();
  const [query, setQuery] = useState('');
  const { data: chats = [], isLoading, isError, refetch, isFetching } = useChats();

  const filtered = query.trim()
    ? chats.filter(ch => (ch.title ?? '').toLowerCase().includes(query.toLowerCase()))
    : chats;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Chats" />

      <View className="px-4 pt-4 pb-2">
        <View className="flex-row items-center gap-2 rounded-lg border border-border-soft bg-card px-3 h-10">
          <Icon name="search" size={15} color={c.faintFg} />
          <TextInput
            className="flex-1 text-sm text-foreground h-full"
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats…"
            placeholderTextColor={c.faintFg}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.6}>
              <Icon name="x" size={15} color={c.faintFg} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" color={c.primary} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={ch => ch.id}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={c.mutedForeground} />}
          contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
          renderItem={({ item }: { item: Chat }) => (
            <ChatRow chat={item} onOpen={() => router.push(`/(drawer)/c/${item.id}`)} />
          )}
          ListEmptyComponent={
            <View className="mt-24">
              <EmptyState
                icon="message-square"
                title={query ? 'No results' : 'No chats yet'}
                description={query ? `Nothing matched "${query}".` : 'Start a conversation to plan work, inspect a project, or make a change.'}
              />
            </View>
          }
        />
      )}
    </View>
  );
}
