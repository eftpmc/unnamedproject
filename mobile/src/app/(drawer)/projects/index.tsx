import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../../../components/icon';
import { useProjects } from '../../../hooks/useProjects';
import ScreenHeader from '../../../components/ScreenHeader';
import Surface from '../../../components/Surface';
import EmptyState from '../../../components/EmptyState';
import { useColors } from '../../../lib/colors';
import type { Project } from '../../../../types';

export default function ProjectsScreen() {
  const router = useRouter();
  const c = useColors();
  const { data: projects = [], isLoading } = useProjects();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Projects" />

      {isLoading ? (
        <ActivityIndicator className="mt-8" color={c.primary} />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }: { item: Project }) => (
            <Surface className="flex-row items-center gap-3 p-4" onPress={() => router.push(`/(drawer)/projects/${item.id}`)}>
              <View className="h-9 w-9 items-center justify-center rounded-md bg-muted">
                <Icon name="grid" size={16} color={c.mutedForeground} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{item.name}</Text>
                {item.description ? (
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>{item.description}</Text>
                ) : null}
              </View>
              <Icon name="chevron-right" size={16} color={c.faintFg} />
            </Surface>
          )}
          ListEmptyComponent={
            <View className="mt-24">
              <EmptyState icon="grid" title="No projects yet" description="Projects you create will show up here." />
            </View>
          }
        />
      )}
    </View>
  );
}
