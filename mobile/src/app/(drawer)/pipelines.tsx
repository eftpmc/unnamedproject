import { View, Text, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import Icon from '../../components/icon';
import { usePipelines } from '../../hooks/usePipelines';
import ScreenHeader from '../../components/ScreenHeader';
import Surface from '../../components/Surface';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { useColors } from '../../lib/colors';
import type { Pipeline } from '../../../types';

export default function PipelinesScreen() {
  const c = useColors();
  const { data: pipelines = [], isLoading, isError, refetch, isFetching } = usePipelines();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Pipelines" />

      {isLoading ? (
        <ActivityIndicator className="mt-8" color={c.primary} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <FlatList
          data={pipelines}
          keyExtractor={p => p.id}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={c.mutedForeground} />}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }: { item: Pipeline }) => (
            <Surface className="flex-row items-center gap-3 p-4">
              <View className="h-9 w-9 items-center justify-center rounded-md bg-muted">
                <Icon name="git-merge" size={16} color={c.mutedForeground} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{item.name}</Text>
                {item.description ? (
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>{item.description}</Text>
                ) : null}
              </View>
            </Surface>
          )}
          ListEmptyComponent={
            <View className="mt-24">
              <EmptyState icon="git-merge" title="No pipelines" description="Automated pipelines will appear here once configured." />
            </View>
          }
        />
      )}
    </View>
  );
}
