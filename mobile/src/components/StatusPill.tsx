import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import Icon, { type IconName } from './icon';
import { useColors } from '../lib/colors';

export type PillStatus =
  | 'running'
  | 'done'
  | 'error'
  | 'awaiting_approval'
  | 'pending'
  | 'cancelled'
  | 'ready'
  | 'review';


function Spinner({ color, size }: { color: string; size: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="loader" size={size} color={color} />
    </Animated.View>
  );
}

export default function StatusPill({ status }: { status: PillStatus }) {
  const c = useColors();

  const CONFIG: Record<PillStatus, { label: string; bg: string; text: string; color: string; icon: IconName }> = {
    running: { label: 'Running', bg: 'bg-tint-primary', text: 'text-on-accent-soft', color: c.onAccentSoft, icon: 'loader' },
    done: { label: 'Done', bg: 'bg-tint-success', text: 'text-success', color: c.success, icon: 'check' },
    ready: { label: 'Ready', bg: 'bg-tint-success', text: 'text-success', color: c.success, icon: 'check' },
    error: { label: 'Error', bg: 'bg-tint-destructive', text: 'text-destructive', color: c.destructive, icon: 'alert-circle' },
    awaiting_approval: { label: 'Needs approval', bg: 'bg-tint-warning', text: 'text-warning', color: c.warning, icon: 'bell' },
    review: { label: 'In review', bg: 'bg-tint-warning', text: 'text-warning', color: c.warning, icon: 'clock' },
    pending: { label: 'Pending', bg: 'bg-muted', text: 'text-muted-foreground', color: c.mutedForeground, icon: 'circle' },
    cancelled: { label: 'Cancelled', bg: 'bg-muted', text: 'text-muted-foreground', color: c.mutedForeground, icon: 'circle' },
  };

  const cfg = CONFIG[status];

  return (
    <View className={`flex-row items-center gap-1.5 rounded-full px-2 py-0.5 ${cfg.bg}`}>
      {status === 'running' ? (
        <Spinner color={cfg.color} size={11} />
      ) : (
        <Icon name={cfg.icon} size={11} color={cfg.color} />
      )}
      <Text className={`text-[11px] font-medium ${cfg.text}`}>{cfg.label}</Text>
    </View>
  );
}
