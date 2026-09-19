import { Platform, type ViewStyle } from 'react-native';

/**
 * Hiding something from a screen reader takes three props, not one.
 *
 * `accessibilityElementsHidden` is **iOS-only** — it compiles and does nothing
 * on Android, which is why TalkBack was announcing "envelope", "black star" and
 * "black circle" between every meaningful label in this app. Android's
 * equivalent is `importantForAccessibility="no-hide-descendants"`, and
 * react-native-web honours neither: it reads `aria-hidden`, so the web preview
 * was reading avatar initials as "AS Ada Silva …" too.
 *
 * Spreading this constant is the only supported way to mark something
 * decorative here. Setting one of the three by hand is a bug on two platforms.
 */
export const DECORATIVE = {
  accessible: false,
  /** iOS. */
  accessibilityElementsHidden: true,
  /** Android. */
  importantForAccessibility: 'no-hide-descendants',
  /** Web (react-native-web). */
  'aria-hidden': true,
} as const;

/**
 * The inverse, for the rare decorative element that must be announced — an icon
 * with no adjacent label of its own.
 */
export function announced(label: string) {
  return {
    accessible: true,
    accessibilityLabel: label,
    accessibilityElementsHidden: false,
    importantForAccessibility: 'yes',
    'aria-hidden': false,
  } as const;
}

interface Edges {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * `hitSlop`, for the web build.
 *
 * react-native-web drops `hitSlop` entirely, so a control drawn at 28pt and
 * brought up to 44 with slop is a 28px target in a phone browser. The browser
 * has no invisible target, but it has the next best thing: padding grows the
 * box that takes the tap and an equal negative margin gives the space back, so
 * nothing around the control moves. Spread this after the control's own
 * padding, and pass that padding in, because it has to be restated as a sum.
 *
 * Only for a control with no fill of its own: a background would grow with the
 * padding. `FilterChip` draws its pill on an inner view for that reason.
 *
 * Empty on iOS and Android, where `hitSlop` does the job properly.
 */
export function webSlop(padding: Edges, slop: Edges): ViewStyle {
  if (Platform.OS !== 'web') return {};
  const top = slop.top ?? 0;
  const bottom = slop.bottom ?? 0;
  const left = slop.left ?? 0;
  const right = slop.right ?? 0;
  return {
    paddingTop: (padding.top ?? 0) + top,
    paddingBottom: (padding.bottom ?? 0) + bottom,
    paddingLeft: (padding.left ?? 0) + left,
    paddingRight: (padding.right ?? 0) + right,
    marginTop: -top,
    marginBottom: -bottom,
    marginLeft: -left,
    marginRight: -right,
  };
}
