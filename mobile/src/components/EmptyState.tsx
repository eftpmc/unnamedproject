import { View, Text, TouchableOpacity } from 'react-native';
import Icon, { type IconName } from './icon';
import { useColors } from '../lib/colors';

interface Props {
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Full-page centered empty state, matching the web `CenteredEmptyState`. */
export default function EmptyState({ icon, title, description, actionLabel, onAction }: Props) {
  const c = useColors();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="w-full max-w-sm items-center">
        {icon && (
          <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <Icon name={icon} size={20} color={c.mutedForeground} />
          </View>
        )}
        <Text className="text-base font-semibold tracking-tight text-foreground text-center">{title}</Text>
        {description && (
          <Text className="mt-2 text-sm leading-relaxed text-muted-foreground text-center">{description}</Text>
        )}
        {actionLabel && onAction && (
          <TouchableOpacity
            className="mt-5 flex-row items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5"
            onPress={onAction}
            activeOpacity={0.85}
          >
            <Text className="text-sm font-medium text-primary-foreground">{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
