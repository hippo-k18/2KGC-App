import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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
 * ## Two Material families, and why only one row uses the second
 *
 * `@expo/vector-icons` bundles seventeen families, and each one that is
 * *imported* ships its whole font in the export. MaterialIcons is 357 KB;
 * MaterialCommunityIcons is 1.3 MB. So the table stays on MaterialIcons unless
 * it genuinely has no equivalent glyph, and today exactly one row qualifies:
 * `calendar.badge.plus` — Whova's "Add to Agenda" affordance, the single most
 * tapped control in the agenda. MaterialIcons offers only `edit-calendar`
 * (calendar + pencil, which means "edit") and `event-available` (calendar +
 * tick, which means "already added" — the opposite of the affordance). Getting
 * that one wrong on every Android agenda row is worth the font.
 *
 * If that row ever goes away, drop the `MaterialCommunityIcons` import with it
 * and the 1.3 MB leaves the bundle. Do not reach for the second family for
 * convenience — check MaterialIcons first.
 *
 * No `react-native-svg`, lucide or phosphor. All three need a native module,
 * and `AGENTS.md` gotcha 1 pins SDK 54 precisely so the app stays openable in
 * Expo Go.
 *
 * ## One caveat the table cannot express
 *
 * `fallback` covers *platforms*, not *versions*. `UIImage(systemName:)` returns
 * nil for a symbol the running iOS does not know, and SymbolView then draws
 * nothing — the Material fallback is not consulted. Everything here is iOS 14-
 * or 15-era except `storefront`, which is SF Symbols 4.2 / iOS 17. It is used
 * only as a category tile beside its own text label ("Exhibitor Showcase"), so
 * on iOS 15–16 the row loses decoration and no meaning. Do not use it anywhere
 * the glyph is the only thing carrying the message.
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
type CommunityName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * A MaterialIcons name, or `{ mc }` for the rare glyph only
 * MaterialCommunityIcons has. Both branches are typed against the family's own
 * name union, so a misspelling is still a compile error.
 */
type AndroidGlyph = MaterialName | { readonly mc: CommunityName };

const ANDROID_EQUIVALENT = {
  'chevron.right': 'chevron-right',
  /** Back. Drawn by `pushed-header.tsx`; nothing else in the app points left. */
  'chevron.left': 'chevron-left',
  'chevron.down': 'expand-more',
  'envelope.fill': 'mail',
  envelope: 'mail-outline',
  'star.fill': 'star',
  star: 'star-border',
  bookmark: 'bookmark-border',
  'bookmark.fill': 'bookmark',
  calendar: 'event',
  /** "Add to Agenda". The one row that costs a second font — see above. */
  'calendar.badge.plus': { mc: 'calendar-plus' },
  magnifyingglass: 'search',
  'person.2': 'people-outline',
  'person.2.fill': 'people',
  /** Attendee count on a session — a person with a tick, not a plain headcount. */
  'person.fill.checkmark': 'how-to-reg',
  'person.slash': 'person-off',
  'bubble.left.and.bubble.right': 'forum',
  'bubble.left': 'chat-bubble-outline',
  heart: 'favorite-border',
  'heart.fill': 'favorite',
  'plus.circle.fill': 'add-circle',
  'checkmark.circle.fill': 'check-circle',
  megaphone: 'campaign',
  /** Exhibitor showcase. iOS 17+ — see the availability note below. */
  storefront: 'storefront',
  newspaper: 'article',
  'questionmark.circle': 'help-outline',
  'mappin.and.ellipse': 'place',
  'video.fill': 'videocam',
  wifi: 'wifi',
  /** A read the rules refused — see `components/data-error.tsx`. */
  lock: 'lock-outline',
  /** A read that never reached the server, as distinct from one it refused. */
  'wifi.slash': 'wifi-off',
  trophy: 'emoji-events',
  'pin.fill': 'push-pin',
  ellipsis: 'more-horiz',
  'slider.horizontal.3': 'tune',
  'square.and.pencil': 'edit',
  trash: 'delete-outline',
  'exclamationmark.triangle': 'warning-amber',
  'square.dashed': 'crop-square',
} as const satisfies Record<string, AndroidGlyph>;

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
  const android = ANDROID_EQUIVALENT[name];

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
        fallback={
          typeof android === 'string' ? (
            <MaterialIcons name={android} size={size} color={tint} />
          ) : (
            <MaterialCommunityIcons name={android.mc} size={size} color={tint} />
          )
        }
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
