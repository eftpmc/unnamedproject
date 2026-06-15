import { View, Text } from 'react-native';
import type { Execution } from '../../types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  running: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  done: { bg: 'bg-green-500/20', text: 'text-green-400' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400' },
  awaiting_approval: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  cancelled: { bg: 'bg-muted', text: 'text-muted-foreground' },
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
  const colors = STATUS_COLORS[execution.status] ?? { bg: 'bg-muted', text: 'text-muted-foreground' };
  const label = STATUS_LABELS[execution.status] ?? execution.status;

  return (
    <View className="mx-4 my-1 bg-muted rounded-xl p-3 gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-mono text-foreground">{execution.tool}</Text>
        <View className={`rounded-full px-2 py-0.5 ${colors.bg}`}>
          <Text className={`text-[10px] font-semibold ${colors.text}`}>{label}</Text>
        </View>
      </View>
      {execution.error && (
        <Text className="text-xs text-red-400" numberOfLines={3}>{execution.error}</Text>
      )}
    </View>
  );
}
