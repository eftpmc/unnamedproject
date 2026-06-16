import { useEffect } from 'react';
import { View, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useActivity } from '../../hooks/useActivity';
import { subscribe } from '../../lib/ws';
import { useAppStore } from '../../lib/store';
import ApprovalCard from '../../components/ApprovalCard';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import { useColors } from '../../lib/colors';
import type { PendingApproval, WSEvent } from '../../../types';

export default function ActivityScreen() {
  const qc = useQueryClient();
  const c = useColors();
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
      <ScreenHeader title="Activity" />

      {isLoading ? (
        <ActivityIndicator className="mt-8" color={c.primary} />
      ) : (
        <FlatList
          data={approvals}
          keyExtractor={a => a.id}
          contentContainerStyle={approvals.length === 0 ? { flexGrow: 1 } : { padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={c.mutedForeground} />}
          renderItem={({ item }: { item: PendingApproval }) => <ApprovalCard approval={item} />}
          ListEmptyComponent={
            <EmptyState icon="check-circle" title="All clear" description="No pending approvals right now." />
          }
        />
      )}
    </View>
  );
}
