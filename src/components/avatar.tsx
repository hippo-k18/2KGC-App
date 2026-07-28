import { View } from 'react-native';

import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

/** Initials placeholder. Swap for an <Image> once photoURL is populated. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const colors = useTheme();

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text variant="heading" tone="onAccent" style={{ fontSize: size * 0.36 }}>
        {initials}
      </Text>
    </View>
  );
}
