import { Image, View } from 'react-native';

import { announced, DECORATIVE } from '@/components/a11y';
import { Text } from '@/components/text';
import { AVATAR_SIZE, AvatarPalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Photo when there is one, initials when there is not.
 *
 * The initials path is not a placeholder to be removed later — Storage may not
 * be provisioned, most attendees never upload a photo, and speaker headshots
 * come from an import that may be incomplete. It is the common case.
 *
 * The tint is derived from the name so the same person is always the same
 * colour, which makes a list of initials scannable instead of uniform. The
 * swatches live in `theme.ts` (`AvatarPalette`) rather than here, both because
 * nothing outside that file may spell a hex value and because four of the seven
 * original swatches failed AA against the white initials sitting on them.
 *
 * ## Accessibility
 *
 * An avatar is decorative in every place this app uses it: it is the `leading`
 * slot of a `ListRow` whose title is the person's name, or it sits directly
 * above that name on a profile. Announcing it would make VoiceOver read the name
 * twice, and the photo branch previously announced nothing useful at all — an
 * unlabelled `Image` is read as "image" by both platforms, and the `View` branch
 * was hidden only on iOS because `accessibilityElementsHidden` is iOS-only. In
 * the People list that meant every row was announced as "AS Ada Silva, Chief
 * Data Officer…", with the initials read out as letters before the name they
 * abbreviate.
 *
 * Both branches now use `DECORATIVE`, which covers iOS, Android and web.
 * `label` is the escape hatch for a future placement where no name is adjacent.
 */
export function Avatar({
  name,
  photoURL,
  size = AVATAR_SIZE,
  label,
}: {
  name: string;
  photoURL?: string;
  size?: number;
  /** Announce the avatar with this label instead of hiding it. */
  label?: string;
}) {
  const colors = useTheme();

  const a11y = label ? announced(label) : DECORATIVE;

  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.surfacePressed,
        }}
        accessibilityIgnoresInvertColors
        accessibilityRole="image"
        {...a11y}
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
  const background = AvatarPalette[Math.abs(hash) % AvatarPalette.length];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
      {...a11y}>
      <Text
        variant="heading"
        tone="onAccent"
        // The circle is a fixed geometric size that cannot grow with Dynamic
        // Type without breaking every row it sits in, so the initials must not
        // grow either — at the largest accessibility sizes they would render at
        // ~57pt inside a 44pt circle. Nothing is lost: the initials are a
        // redundant restatement of the name label beside them, which does scale.
        allowFontScaling={false}
        style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}>
        {initials}
      </Text>
    </View>
  );
}
