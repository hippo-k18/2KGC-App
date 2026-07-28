import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface EmptyStateProps {
  /** SF Symbol name, e.g. `calendar`. Ignored off iOS. */
  icon?: SymbolViewProps['name'];
  title: string;
  message?: string;
}

/**
 * Placeholder for a screen that has no data yet. Every tab currently renders
 * one of these — replace them as each feature gets built.
 */
export function EmptyState({ icon = 'square.dashed', title, message }: EmptyStateProps) {
  const colors = useTheme();

  return (
    <View style={{ alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl }}>
      {Platform.OS === 'ios' && (
        <SymbolView name={icon} size={48} tintColor={colors.textSecondary} />
      )}
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
