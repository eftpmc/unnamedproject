import { View, Text, TouchableOpacity } from 'react-native';
import Icon from './icon';
import { useColors } from '../lib/colors';

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/** Full-page error state with a retry action — shown when a query fails. */
export default function ErrorState({
  title = "Couldn't load",
  description = "We couldn't reach the server. Check your connection and try again.",
  onRetry,
}: Props) {
  const c = useColors();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="w-full max-w-sm items-center">
        <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl bg-tint-destructive">
          <Icon name="alert-circle" size={20} color={c.destructive} />
        </View>
        <Text className="text-base font-semibold tracking-tight text-foreground text-center">{title}</Text>
        <Text className="mt-2 text-sm leading-relaxed text-muted-foreground text-center">{description}</Text>
        {onRetry && (
          <TouchableOpacity
            className="mt-5 rounded-lg border border-border-soft bg-card px-4 py-2.5"
            onPress={onRetry}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text className="text-sm font-medium text-foreground">Try again</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
