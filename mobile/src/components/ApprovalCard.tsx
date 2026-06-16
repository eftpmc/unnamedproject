import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from './icon';
import { useApproveExecution, useRejectExecution } from '../hooks/useActivity';
import { useColors } from '../lib/colors';
import type { PendingApproval } from '../../types';

interface Props {
  approval: PendingApproval;
}

export default function ApprovalCard({ approval }: Props) {
  const c = useColors();
  const approve = useApproveExecution();
  const reject = useRejectExecution();
  const busy = approve.isPending || reject.isPending;

  return (
    <View className="rounded-lg border border-warning bg-card overflow-hidden">
      <View className="p-4 gap-3">
        <View className="flex-row items-center gap-2">
          <View className="h-7 w-7 items-center justify-center rounded-md bg-tint-warning">
            <Icon name="bell" size={14} color={c.warning} />
          </View>
          <View className="flex-1">
            <Text className="text-[11px] font-semibold text-warning">Needs approval</Text>
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{approval.action}</Text>
          </View>
        </View>

        {approval.payload != null && (
          <View className="rounded-md bg-muted p-2.5">
            <Text className="text-xs font-mono text-muted-foreground" numberOfLines={4}>
              {JSON.stringify(approval.payload as object, null, 2)}
            </Text>
          </View>
        )}

        <View className="flex-row gap-2">
          <TouchableOpacity
            className="flex-1 flex-row gap-1.5 bg-primary rounded-md py-2.5 items-center justify-center"
            onPress={() => approve.mutate(approval.execution_id)}
            disabled={busy}
            activeOpacity={0.85}
          >
            {approve.isPending ? (
              <ActivityIndicator size="small" color={c.primaryForeground} />
            ) : (
              <>
                <Icon name="check" size={15} color={c.primaryForeground} />
                <Text className="text-primary-foreground text-sm font-semibold">Approve</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 flex-row gap-1.5 rounded-md py-2.5 items-center justify-center border border-border-soft bg-card"
            onPress={() => reject.mutate(approval.execution_id)}
            disabled={busy}
            activeOpacity={0.7}
          >
            {reject.isPending ? (
              <ActivityIndicator size="small" color={c.mutedForeground} />
            ) : (
              <>
                <Icon name="x" size={15} color={c.mutedForeground} />
                <Text className="text-muted-foreground text-sm font-medium">Reject</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
