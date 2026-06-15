import { View, Text } from 'react-native';
import type { Message } from '../../types';

interface Props {
  message: Message;
}

export default function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';
  return (
    <View className={`px-4 py-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? 'bg-primary rounded-tr-sm' : 'bg-muted rounded-tl-sm'
        }`}
      >
        <Text className={`text-sm leading-5 ${isUser ? 'text-primary-foreground' : 'text-foreground'}`}>
          {message.content}
        </Text>
      </View>
      {message.attachments && message.attachments.length > 0 && (
        <View className={`mt-1 max-w-[85%] gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
          {message.attachments.map(att => (
            <View key={att.id} className="bg-muted rounded-lg px-3 py-1.5">
              <Text className="text-xs text-muted-foreground">📎 {att.filename}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
