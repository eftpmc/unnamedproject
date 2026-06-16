import { useEffect, useRef, useCallback } from 'react';
import { View, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMessages, useSendMessage } from '../../../hooks/useMessages';
import { useChatStatus } from '../../../hooks/useChatStatus';
import { subscribe } from '../../../lib/ws';
import ChatBubble from '../../../components/ChatBubble';
import ExecutionCard from '../../../components/ExecutionCard';
import Composer from '../../../components/Composer';
import ScreenHeader from '../../../components/ScreenHeader';
import { useColors } from '../../../lib/colors';
import type { Message, WSEvent } from '../../../../types';

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const qc = useQueryClient();
  const c = useColors();
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
        {item.executions?.map(ex => <ExecutionCard key={ex.executionId} execution={ex} />)}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Chat" subtitle={status?.active ? 'Agent running…' : undefined} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 8 }}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <Composer onSend={handleSend} disabled={status?.active} />
    </KeyboardAvoidingView>
  );
}
