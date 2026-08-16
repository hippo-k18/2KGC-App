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
