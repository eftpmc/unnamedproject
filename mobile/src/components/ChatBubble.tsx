import { View, Text } from 'react-native';
import Icon from './icon';
import { useColors } from '../lib/colors';
import type { Message } from '../../types';

interface Props {
  message: Message;
}

export default function ChatBubble({ message }: Props) {
  const c = useColors();
  const isUser = message.role === 'user';
  const hasAttachments = !!message.attachments && message.attachments.length > 0;

  if (isUser) {
    return (
      <View className="px-4 py-1.5 items-end">
        <View className="max-w-[88%] rounded-lg rounded-tr-md bg-muted px-4 py-2.5">
          {!!message.content && (
            <Text className="text-[15px] leading-relaxed text-foreground">{message.content}</Text>
          )}
          {hasAttachments && (
            <View className={`flex-row flex-wrap gap-1.5 ${message.content ? 'mt-2' : ''}`}>
              {message.attachments!.map(att => (
                <View key={att.id} className="flex-row items-center gap-1.5 rounded-md border border-border-soft bg-background px-2 py-1">
                  <Icon name="paperclip" size={11} color={c.faintFg} />
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>{att.filename}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  // Assistant — plain body text, no bubble
  if (!message.content.trim()) return null;
  return (
    <View className="px-4 py-1.5">
      <Text className="text-[15px] leading-[24px] text-fg-soft">{message.content}</Text>
    </View>
  );
}
