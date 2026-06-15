import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { usePipelines } from '../../hooks/usePipelines';
import type { Pipeline } from '../../../types';

export default function PipelinesScreen() {
  const navigation = useNavigation();
  const { data: pipelines = [], isLoading } = usePipelines();

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg flex-1">Pipelines</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={pipelines}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }: { item: Pipeline }) => (
            <View className="bg-muted rounded-xl p-4 gap-1">
              <Text className="text-foreground font-semibold">{item.name}</Text>
              {item.description && (
                <Text className="text-muted-foreground text-sm" numberOfLines={2}>{item.description}</Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center mt-12">
              <Text className="text-muted-foreground text-sm">No pipelines</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
