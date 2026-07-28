import { View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Deliberately blank screen. Every tab renders this for now — the navigation,
 * theming and data layer are all in place, but no feature UI has been built.
 *
 * Replace this with the real screen contents one tab at a time.
 */
export function DemoScreen() {
  const colors = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
        padding: Spacing.lg,
      }}>
      <Text
        variant="title"
        style={{ textAlign: 'center', letterSpacing: 1.5 }}>
        KGC WHOVA DEMO
      </Text>
    </View>
  );
}
