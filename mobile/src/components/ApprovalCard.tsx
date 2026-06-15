import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useApproveExecution, useRejectExecution } from '../hooks/useActivity';
import type { PendingApproval } from '../../types';

interface Props {
  approval: PendingApproval;
}

export default function ApprovalCard({ approval }: Props) {
  const approve = useApproveExecution();
  const reject = useRejectExecution();
  const busy = approve.isPending || reject.isPending;

  return (
    <View className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 gap-3">
      <View className="gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wider text-yellow-400">
          Action needed
        </Text>
        <Text className="text-sm font-medium text-foreground">{approval.action}</Text>
        {approval.session_id && (
          <Text className="text-xs text-muted-foreground">in chat</Text>
        )}
      </View>

      {approval.payload != null && (
        <View className="bg-black/20 rounded-lg p-2">
          <Text className="text-xs font-mono text-muted-foreground" numberOfLines={4}>
            {JSON.stringify(approval.payload as object, null, 2)}
          </Text>
        </View>
      )}

      <View className="flex-row gap-2">
        <TouchableOpacity
          className="flex-1 bg-primary rounded-xl py-2.5 items-center"
          onPress={() => approve.mutate(approval.execution_id)}
          disabled={busy}
        >
          {approve.isPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-primary-foreground text-sm font-semibold">Approve</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-muted rounded-xl py-2.5 items-center border border-border"
          onPress={() => reject.mutate(approval.execution_id)}
          disabled={busy}
        >
          {reject.isPending ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text className="text-muted-foreground text-sm font-medium">Reject</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
