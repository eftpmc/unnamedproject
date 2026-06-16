import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from './icon';
import Surface from './Surface';
import { useUpdateProject, useDeleteProject } from '../hooks/useProjects';
import { useColors } from '../lib/colors';
import type { Project } from '../../types';

export default function ProjectSettings({ project }: { project: Project }) {
  const c = useColors();
  const router = useRouter();
  const [description, setDescription] = useState(project.description ?? '');
  const update = useUpdateProject(project.id);
  const del = useDeleteProject();

  const dirty = description.trim() !== (project.description ?? '').trim();

  function handleDelete() {
    Alert.alert(
      'Delete project',
      'Delete this project and all its campaigns? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            del.mutate(project.id, {
              onSuccess: () => router.replace('/(drawer)/projects'),
            }),
        },
      ],
    );
  }

  return (
    <View className="gap-6">
      <View className="gap-2">
        <Text className="text-[13px] font-semibold text-faint-fg px-1">Project name</Text>
        <Surface className="px-3.5 h-12 justify-center">
          <Text className="text-foreground text-[15px]" numberOfLines={1}>{project.name}</Text>
        </Surface>
      </View>

      <View className="gap-2">
        <Text className="text-[13px] font-semibold text-faint-fg px-1">Description</Text>
        <TextInput
          className="rounded-lg border border-border-soft bg-card px-3.5 py-3 text-foreground text-[15px] min-h-[88px]"
          value={description}
          onChangeText={setDescription}
          placeholder="What is this project about?"
          placeholderTextColor={c.faintFg}
          multiline
          textAlignVertical="top"
        />
        <TouchableOpacity
          className={`rounded-lg h-12 flex-row items-center justify-center gap-2 ${dirty ? 'bg-primary' : 'bg-muted'}`}
          onPress={() => update.mutate({ description: description.trim() })}
          disabled={!dirty || update.isPending}
          activeOpacity={0.85}
        >
          {update.isPending && <ActivityIndicator size="small" color={c.primaryForeground} />}
          <Text className={`text-[15px] font-semibold ${dirty ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
            {!dirty && update.isSuccess ? 'Saved' : 'Save changes'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        className="flex-row items-center justify-center gap-2 rounded-lg border border-border-soft bg-card h-12"
        onPress={handleDelete}
        disabled={del.isPending}
        activeOpacity={0.7}
      >
        <Icon name="x" size={16} color={c.destructive} />
        <Text className="font-medium text-destructive">Delete project</Text>
      </TouchableOpacity>
    </View>
  );
}
