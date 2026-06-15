import { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useActivity } from '../../hooks/useActivity';
import { subscribe } from '../../lib/ws';
import { useAppStore } from '../../lib/store';
import ApprovalCard from '../../components/ApprovalCard';
import type { PendingApproval, WSEvent } from '../../../types';

export default function ActivityScreen() {
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { data: approvals = [], isLoading, isFetching, refetch } = useActivity();
  const { setPendingApprovalCount } = useAppStore();

  useEffect(() => {
    setPendingApprovalCount(approvals.length);
  }, [approvals.length, setPendingApprovalCount]);

  useEffect(() => {
    const unsub = subscribe((event: WSEvent) => {
      if (event.type === 'approval_requested' || event.type === 'execution_update') {
        qc.invalidateQueries({ queryKey: ['activity'] });
      }
    });
    return unsub;
  }, [qc]);

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 py-2.5 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 bg-muted rounded-lg items-center justify-center"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        >
          <Text className="text-foreground">☰</Text>
        </TouchableOpacity>
        <Text className="text-foreground font-bold text-lg">Activity</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={approvals}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
          renderItem={({ item }: { item: PendingApproval }) => <ApprovalCard approval={item} />}
          ListEmptyComponent={
            <View className="items-center mt-12 gap-2">
              <Text className="text-3xl">✓</Text>
              <Text className="text-muted-foreground text-sm">No pending approvals</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
