import { servableLogoURL } from '@kgc/shared';
import { Image, View } from 'react-native';

import { DECORATIVE } from '@/components/a11y';
import { Text } from '@/components/text';
import { AVATAR_SIZE, AvatarPalette, HAIRLINE, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A sponsor's logo — a rounded square, contained, on white.
 *
 * Deliberately not `Avatar`, which is what both sponsor surfaces used before the
 * logos existed and there was nothing to notice. `Avatar` is a circle and React
 * Native's default `resizeMode` is `cover`, so it fills the frame and crops the
 * overflow. That is right for a face and wrong for every logo we actually have:
 * these run from 1:1 up to about 4:1 — Accenture's is 700x184 — and a circular
 * cover crop of a wide wordmark is an unreadable slice of its middle. Nine of
 * the eighteen would have been illegible.
 *
 * So: `contain`, so nothing is cropped; a square with a small radius, because
 * letterboxing a wide logo inside a circle wastes most of the frame; and a white
 * plate, because these are supplied as transparent PNGs drawn in dark ink and
 * several vanish outright against a dark-mode surface.
 *
 * Falls back to the sponsor's initials on the same tinted circle `Avatar` uses,
 * so a sponsor with no logo still looks deliberate. Five of ours have no
 * description and any of them could arrive without a logo.
 *
 * Decorative in both placements — the list row and the detail header both put
 * the sponsor's name directly beside or beneath it, and announcing it would make
 * VoiceOver read the name twice. Same reasoning as `Avatar`; see its header.
 *
 * ⚠️ `logoURL` is filtered through `servableLogoURL()` rather than trusted. A
 * sponsor or exhibitor document imported from a Whova CSV — and eighteen on the
 * live project — still holds a URL on Whova's own CDN, and rendering it makes
 * the phone fetch an asset we do not own from the product this app replaces.
 * The website has refused that request since the sponsor page was built; this
 * did not, so the same sponsor showed a local logo on one surface and a hotlink
 * on the other. A dropped URL falls through to the initials plate below, which
 * is what a sponsor with no logo has always looked like.
 */
export function SponsorLogo({
  name,
  logoURL,
  size = AVATAR_SIZE,
}: {
  name: string;
  logoURL?: string;
  size?: number;
}) {
  const colors = useTheme();
  const servable = servableLogoURL(logoURL);

  if (servable) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Radius.sm,
          backgroundColor: colors.logoPlate,
          borderWidth: HAIRLINE,
          borderColor: colors.border,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          // The plate is intentionally white in both schemes, so it needs its
          // own inset rather than inheriting the row's padding.
          padding: Math.round(size * 0.12),
        }}
        {...DECORATIVE}>
        <Image
          source={{ uri: servable }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
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
        borderRadius: Radius.sm,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
      {...DECORATIVE}>
      <Text
        variant="heading"
        tone="onAccent"
        // Fixed geometry, so the initials must not scale with Dynamic Type — the
        // name beside them does. Same trade as `Avatar`.
        allowFontScaling={false}
        style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}>
        {initials}
      </Text>
    </View>
  );
}
