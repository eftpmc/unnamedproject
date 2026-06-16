import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import Icon from './icon';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useColors } from '../lib/colors';

export interface AttachmentItem {
  uri: string;
  name: string;
  type: string;
}

interface Props {
  onSend: (content: string, attachments: AttachmentItem[]) => Promise<void>;
  disabled?: boolean;
}

const MAX_ATTACHMENTS = 8;
const MAX_BYTES = 10 * 1024 * 1024;

export default function Composer({ onSend, disabled }: Props) {
  const c = useColors();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [sending, setSending] = useState(false);

  async function pickImage() {
    if (attachments.length >= MAX_ATTACHMENTS) { Alert.alert('Max 8 attachments'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const picked = result.assets.map(a => ({
        uri: a.uri,
        name: a.fileName ?? `image_${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
      }));
      setAttachments(prev => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
    }
  }

  async function pickDocument() {
    if (attachments.length >= MAX_ATTACHMENTS) { Alert.alert('Max 8 attachments'); return; }
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) {
      const oversized = result.assets.filter(a => (a.size ?? 0) > MAX_BYTES);
      if (oversized.length > 0) { Alert.alert('Files must be under 10 MB'); return; }
      const picked = result.assets.map(a => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' }));
      setAttachments(prev => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
    }
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSend() {
    if (!text.trim() && attachments.length === 0) return;
    setSending(true);
    try {
      await onSend(text.trim(), attachments);
      setText('');
      setAttachments([]);
    } finally {
      setSending(false);
    }
  }

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !sending;

  return (
    <View className="border-t border-border-soft bg-background px-3 pt-2 pb-4 gap-2">
      {attachments.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {attachments.map((att, i) => (
            <TouchableOpacity
              key={`${att.uri}-${att.name}`}
              className="flex-row items-center gap-1.5 rounded-md border border-border-soft bg-card px-2.5 py-1.5 mr-2"
              onPress={() => removeAttachment(i)}
              activeOpacity={0.7}
            >
              <Icon name="paperclip" size={12} color={c.faintFg} />
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {att.name.length > 20 ? att.name.slice(0, 17) + '…' : att.name}
              </Text>
              <Icon name="x" size={12} color={c.faintFg} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View className="flex-row items-end gap-1">
        <TouchableOpacity className="h-9 w-9 items-center justify-center" onPress={pickImage} disabled={disabled} activeOpacity={0.6}>
          <Icon name="image" size={20} color={c.faintFg} />
        </TouchableOpacity>
        <TouchableOpacity className="h-9 w-9 items-center justify-center" onPress={pickDocument} disabled={disabled} activeOpacity={0.6}>
          <Icon name="paperclip" size={20} color={c.faintFg} />
        </TouchableOpacity>
        <TextInput
          className="flex-1 bg-card border border-border-soft rounded-2xl px-4 py-2.5 text-foreground text-[15px] max-h-32"
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={c.faintFg}
          multiline
          editable={!disabled && !sending}
        />
        <TouchableOpacity
          className={`w-9 h-9 rounded-full items-center justify-center ${canSend ? 'bg-primary' : 'bg-muted'}`}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.85}
        >
          <Icon name="arrow-up" size={18} color={canSend ? c.primaryForeground : c.faintFg} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
