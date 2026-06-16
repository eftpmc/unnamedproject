import { ReactNode } from 'react';
import { View, TouchableOpacity } from 'react-native';

interface Props {
  children: ReactNode;
  className?: string;
  onPress?: () => void;
}

/** Bordered card surface — the base container, matching the web `Surface`. */
export default function Surface({ children, className = '', onPress }: Props) {
  const cls = `rounded-lg border border-border-soft bg-card ${className}`;
  if (onPress) {
    return (
      <TouchableOpacity className={cls} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View className={cls}>{children}</View>;
}
