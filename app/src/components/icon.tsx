import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { View, type ViewStyle } from 'react-native';

import { announced, DECORATIVE } from '@/components/a11y';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's only icon primitive.
 *
 * It replaces the text glyphs this codebase used to draw icons with — `✉`, `›`,
 * `★`, `●`. Those were a problem twice over. They are ordinary characters, so
 * they render in whatever the system font happens to have: `›` is a French
 * quotation mark rather than a chevron and sits on the text baseline instead of
 * optically centred, `✉` is an outline on iOS and a colour emoji on several
 * Android builds, and both scale on the text metric so they drift out of
 * alignment with their labels as Dynamic Type grows. And screen readers read
 * them aloud — VoiceOver and TalkBack announce "envelope", "black star",
 * "black circle" between every meaningful label unless each one is silenced.
 *
 * ## Gotcha 3, made unskippable
 *
 * `AGENTS.md` warns that `sf` is iOS-only and that supplying only `sf` leaves
 * Android with nothing at all. That had already shipped here: `EmptyState`
 * guarded its `SymbolView` with `Platform.OS === 'ios' &&`, so every empty state
 * on Android rendered a bare title with a gap above it.
 *
 * The guard is now structural rather than a convention. `ANDROID_EQUIVALENT`
 * below is the single table of every icon in the app, keyed by SF Symbol name,
 * and `IconName` is derived from its keys. Using an SF Symbol that has no
 * Material pairing is a compile error, not a blank space on half the devices.
 * If you hit that error, add the row — do not widen the type.
 *
 * (`SymbolView` renders its `fallback` verbatim off iOS — see
 * `expo-symbols/src/SymbolView.tsx` — so no `Platform.OS` branch is needed here,
 * and the web build takes the same path via `SymbolView.web.tsx`.)
 *
 * ## Accessibility
 *
 * Icons are decorative by default and hidden from every screen reader via
 * `DECORATIVE`, which sets the iOS, Android and web props — see `a11y.ts` for
 * why one of them is not enough. Pass a `label` only when the icon is the sole
 * carrier of its meaning, which in this app it never is: every icon sits beside
 * a labelled control, or inside one whose `accessibilityLabel` already says it.
 */
type MaterialName = ComponentProps<typeof MaterialIcons>['name'];

const ANDROID_EQUIVALENT = {
  'chevron.right': 'chevron-right',
  'envelope.fill': 'mail',
  envelope: 'mail-outline',
  'star.fill': 'star',
  star: 'star-border',
  calendar: 'event',
  magnifyingglass: 'search',
  'person.2': 'people-outline',
  'person.slash': 'person-off',
  'bubble.left.and.bubble.right': 'forum',
  trash: 'delete-outline',
  'exclamationmark.triangle': 'warning-amber',
  'square.dashed': 'crop-square',
} as const satisfies Record<string, MaterialName>;

/** Every icon the app may draw. Keys are SF Symbol names. */
export type IconName = keyof typeof ANDROID_EQUIVALENT;

interface IconProps {
  name: IconName;
  /** Point size of the glyph box. Defaults to 17, the body text size. */
  size?: number;
  /** Defaults to `textTertiary` — the tone chevrons and metadata glyphs use. */
  color?: string;
  weight?: SymbolWeight;
  /**
   * Announce the icon with this label instead of hiding it. Only correct when
   * nothing adjacent already carries the same meaning.
   */
  label?: string;
  style?: ViewStyle;
}

export function Icon({ name, size = 17, color, weight = 'semibold', label, style }: IconProps) {
  const colors = useTheme();
  const tint = color ?? colors.textTertiary;

  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityRole={label ? 'image' : undefined}
      {...(label ? announced(label) : DECORATIVE)}>
      <SymbolView
        name={name}
        size={size}
        weight={weight}
        tintColor={tint}
        resizeMode="scaleAspectFit"
        fallback={<MaterialIcons name={ANDROID_EQUIVALENT[name]} size={size} color={tint} />}
      />
    </View>
  );
}

/**
 * The disclosure indicator on a tappable list row.
 *
 * Its own component because it is the one icon with a fixed size and tone across
 * the whole app, and because two screens were each hand-rolling a private
 * `Chevron()` helper that drew a `›`.
 */
export function Chevron() {
  const colors = useTheme();
  return <Icon name="chevron.right" size={16} color={colors.textTertiary} />;
}
