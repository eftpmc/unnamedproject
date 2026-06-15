import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

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
    <View className="border-t border-border px-3 pt-2 pb-4 gap-2">
      {attachments.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
          {attachments.map((att, i) => (
            <TouchableOpacity
              key={`${att.uri}-${att.name}`}
              className="bg-muted rounded-lg px-3 py-1.5 flex-row items-center gap-1.5 mr-2"
              onPress={() => removeAttachment(i)}
            >
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                📎 {att.name.length > 20 ? att.name.slice(0, 17) + '…' : att.name}
              </Text>
              <Text className="text-xs text-muted-foreground">×</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View className="flex-row items-end gap-2">
        <TouchableOpacity className="mb-1" onPress={pickImage} disabled={disabled}>
          <Text className="text-muted-foreground text-xl">🖼</Text>
        </TouchableOpacity>
        <TouchableOpacity className="mb-1" onPress={pickDocument} disabled={disabled}>
          <Text className="text-muted-foreground text-xl">📎</Text>
        </TouchableOpacity>
        <TextInput
          className="flex-1 bg-muted rounded-2xl px-4 py-2.5 text-foreground text-sm max-h-32"
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor="#666"
          multiline
          editable={!disabled && !sending}
        />
        <TouchableOpacity
          className={`w-9 h-9 rounded-full items-center justify-center mb-0.5 ${canSend ? 'bg-primary' : 'bg-muted'}`}
          onPress={handleSend}
          disabled={!canSend}
        >
          <Text className={`text-base ${canSend ? 'text-primary-foreground' : 'text-muted-foreground'}`}>↑</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
