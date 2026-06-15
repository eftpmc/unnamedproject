import { View, Text } from 'react-native';
import type { Execution } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  awaiting_approval: 'bg-yellow-500/20 text-yellow-400',
  cancelled: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  awaiting_approval: 'Waiting for approval',
  cancelled: 'Cancelled',
};

interface Props {
  execution: Execution;
}

export default function ExecutionCard({ execution }: Props) {
  const colorClass = STATUS_COLORS[execution.status] ?? 'bg-muted text-muted-foreground';
  const label = STATUS_LABELS[execution.status] ?? execution.status;

  return (
    <View className="mx-4 my-1 bg-muted rounded-xl p-3 gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-mono text-foreground">{execution.tool}</Text>
        <View className={`rounded-full px-2 py-0.5 ${colorClass.split(' ')[0]}`}>
          <Text className={`text-[10px] font-semibold ${colorClass.split(' ')[1]}`}>{label}</Text>
        </View>
      </View>
      {execution.error && (
        <Text className="text-xs text-red-400" numberOfLines={3}>{execution.error}</Text>
      )}
    </View>
  );
}
