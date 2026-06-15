import { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useChats } from '../../hooks/useChats';
import type { Chat } from '../../../types';

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ChatsScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { data: chats = [], isLoading } = useChats();

  const filtered = query.trim()
    ? chats.filter(c => (c.title ?? '').toLowerCase().includes(query.toLowerCase()))
    : chats;

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg flex-1">Chats</Text>
      </View>

      <View className="px-4 py-2">
        <TextInput
          className="bg-muted rounded-xl px-4 py-2.5 text-foreground text-sm"
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats…"
          placeholderTextColor="#666"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          renderItem={({ item }: { item: Chat }) => (
            <TouchableOpacity
              className="px-4 py-3 border-b border-border/50"
              onPress={() => router.push(`/(drawer)/c/${item.id}`)}
            >
              <Text className="text-foreground font-medium text-sm" numberOfLines={1}>
                {item.title ?? 'Untitled chat'}
              </Text>
              <Text className="text-muted-foreground text-xs mt-0.5">{timeAgo(item.updated_at)}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="items-center mt-12">
              <Text className="text-muted-foreground text-sm">No chats yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
