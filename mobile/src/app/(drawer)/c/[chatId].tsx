import { useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useMessages, useSendMessage } from '../../../hooks/useMessages';
import { useChatStatus } from '../../../hooks/useChatStatus';
import { subscribe } from '../../../lib/ws';
import ChatBubble from '../../../components/ChatBubble';
import ExecutionCard from '../../../components/ExecutionCard';
import Composer from '../../../components/Composer';
import type { Message, WSEvent } from '../../../../types';

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const listRef = useRef<FlatList>(null);

  const { data: messages = [], isLoading } = useMessages(chatId);
  const { data: status } = useChatStatus(chatId);
  const sendMessage = useSendMessage(chatId);

  useEffect(() => {
    const unsub = subscribe((event: WSEvent) => {
      if (event.sessionId !== chatId) return;
      if (
        event.type === 'message_created' ||
        event.type === 'message_delta' ||
        event.type === 'turn_complete' ||
        event.type === 'execution_update'
      ) {
        qc.invalidateQueries({ queryKey: ['messages', chatId] });
        qc.invalidateQueries({ queryKey: ['chat-status', chatId] });
      }
      if (event.type === 'session_title_updated') {
        qc.invalidateQueries({ queryKey: ['chats'] });
      }
    });
    return unsub;
  }, [chatId, qc]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(
    async (content: string, attachments: Array<{ uri: string; name: string; type: string }>) => {
      await sendMessage.mutateAsync({ content, attachments });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
    },
    [sendMessage]
  );

  function renderItem({ item }: { item: Message }) {
    return (
      <View>
        <ChatBubble message={item} />
        {item.executions?.map(ex => <ExecutionCard key={ex.id} execution={ex} />)}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-foreground font-semibold text-sm" numberOfLines={1}>
            Chat
          </Text>
          {status?.active && (
            <Text className="text-xs text-muted-foreground">Agent running…</Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <Composer onSend={handleSend} disabled={status?.active} />
    </View>
  );
}
