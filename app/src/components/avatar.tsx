import { Image, View } from 'react-native';

import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

/**
 * Photo when there is one, initials when there is not.
 *
 * The initials path is not a placeholder to be removed later — Storage may not
 * be provisioned, most attendees never upload a photo, and speaker headshots
 * come from an import that may be incomplete. It is the common case.
 *
 * The tint is derived from the name so the same person is always the same
 * colour, which makes a list of initials scannable instead of uniform.
 */
const PALETTE = ['#2B6CB0', '#3AAFA9', '#7C3AED', '#D97706', '#DC2626', '#059669', '#0891B2'];

export function Avatar({
  name,
  photoURL,
  size = 44,
}: {
  name: string;
  photoURL?: string;
  size?: number;
}) {
  const colors = useTheme();

  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfacePressed }}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const background = PALETTE[Math.abs(hash) % PALETTE.length];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden>
      <Text
        variant="heading"
        tone="onAccent"
        style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}>
        {initials}
      </Text>
    </View>
  );
}
