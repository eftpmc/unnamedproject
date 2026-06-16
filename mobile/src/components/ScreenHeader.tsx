import { ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import Icon from './icon';
import { useColors } from '../lib/colors';

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

/**
 * Shared top bar for drawer screens (drawer sets `headerShown: false`).
 * Applies the top safe-area inset and mirrors the web `PageHeader` styling.
 */
export default function ScreenHeader({ title, subtitle, right }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const c = useColors();

  return (
    <View style={{ paddingTop: insets.top }} className="bg-background border-b border-border-soft">
      <View className="px-3 pr-4 h-14 flex-row items-center gap-1">
        <TouchableOpacity
          className="h-9 w-9 items-center justify-center rounded-md"
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          accessibilityLabel="Open menu"
          activeOpacity={0.6}
        >
          <Icon name="menu" size={21} color={c.fgSoft} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-[17px] font-semibold tracking-tight text-foreground" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}
