import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon, type IconName } from '@/components/icon';
import { WEB_TAB_BAR } from '@/components/pushed-header';
import { Text } from '@/components/text';
import { Brand, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Avatar inside the profile pill. Smaller than a list row's 44pt one. */
const PILL_AVATAR = 28;
/** Ring of pill fill around the avatar. */
const PILL_PADDING = 2;
/** Drawn height of the pill at 1×. `hitSlop` makes up the rest of HIT_TARGET. */
const PILL_HEIGHT = PILL_AVATAR + PILL_PADDING * 2;
/** Chevron on the profile pill — deliberately smaller than a list chevron. */
const PILL_CHEVRON = 13;
/** Header action glyph, matching `MessagesButton`. */
const ACTION_GLYPH = 22;
/** Padding around an action glyph; the rest of the 44pt target is `hitSlop`. */
const ACTION_PADDING = Spacing.xs;
/** Search field height at 1× Dynamic Type. A `minHeight`, never a `height`. */
const FIELD_HEIGHT = 38;
/** Body size, so the field's text matches everything else at every font scale. */
const FIELD_FONT = 17;
/** Drawn height of one segment at 1×. */
const SEGMENT_HEIGHT = 34;
/** Inset of the segments from the track that holds them. */
const SEGMENT_INSET = 3;

/** An icon button in the header's right slot. */
export interface HeaderAction {
  icon: IconName;
  /** Spoken name. Required — an icon button has no visible label to fall back on. */
  label: string;
  onPress: () => void;
}

export interface HeaderSearch {
  value: string;
  onChangeText: (next: string) => void;
  /** Shown when empty. Also the field's accessible name. */
  placeholder: string;
  onSubmit?: () => void;
}

export interface HeaderSegments {
  /** Two or three labels. Whova uses two — "Full Agenda" / "My Agenda". */
  options: readonly string[];
  /** Index into `options`. */
  value: number;
  onChange: (next: number) => void;
}

/**
 * Turns the title into a control, which is what Whova's agenda does with
 * "Filter by tracks". It is the cheapest slot in the app: a filter that lives
 * here costs zero vertical points, where a chip row below the header costs 60.
 */
export interface HeaderTitleAction {
  icon: IconName;
  onPress: () => void;
  /** A short state label — "3" or "Ontologies" — drawn as a pill after the title. */
  badge?: string;
  /** Spoken after the title. */
  hint?: string;
}

interface WhovaHeaderProps {
  title: string;
  /** Name behind the profile pill's avatar; also its spoken label. */
  userName: string;
  userPhotoURL?: string;
  onProfilePress: () => void;
  /** Up to two. Anything past the second is dropped — see the note below. */
  actions?: readonly HeaderAction[];
  /** Makes the title itself a button. */
  titleAction?: HeaderTitleAction;
  /** Adds the second row. */
  search?: HeaderSearch;
  /** Adds the third row. */
  segments?: HeaderSegments;
}

/**
 * The blue bar at the top of every screen.
 *
 * Whova's chrome is one solid brand colour carrying white content, with up to
 * three stacked rows: identity + title + actions, then a search field, then a
 * segmented control. It is the single strongest signal that this is the same
 * app as the one the attendees used last year, so it is worth reproducing
 * exactly — with three deliberate departures, all noted below.
 *
 * ## The inset is measured, never guessed
 *
 * The bar extends under the status bar and the notch, so its top padding is
 * `useSafeAreaInsets().top` — 47pt on a Dynamic Island phone, 44 on a notched
 * one, 20 on an SE, and on Android whatever the OEM's status bar is, which is
 * genuinely unpredictable. A hard-coded 44 puts the avatar under the clock on
 * one device and leaves a band of dead blue on another. Android is edge-to-edge
 * by default from RN 0.81, so this is not iOS-only bookkeeping.
 *
 * The web branch is unrelated to safe areas: `NativeTabs` draws a real bottom
 * tab bar on the devices and a bar pinned to the *top* of the window on web, so
 * the browser preview needs the header pushed clear of it. Same constant, same
 * reason, as `screen-header.tsx`.
 *
 * ## Departures from Whova
 *
 * 1. **The status bar is forced light.** White-on-blue chrome with the OS's
 *    default dark status bar text is unreadable in light mode. The root layout
 *    sets `style="auto"`; this component overrides it for as long as it is
 *    mounted, so the header stays self-sufficient and no screen has to remember.
 *
 * 2. **The title is centred in the space that is left, not on the bar.** True
 *    optical centring needs the title absolutely positioned, which caps it at
 *    one line and clips at accessibility text sizes. A `flex: 1` title between
 *    two natural-width slots drifts by at most a few points and grows properly
 *    instead. Nothing here has a fixed `height` for the same reason.
 *
 * 3. **Everything reaches 44pt.** The pill is drawn at 32 and the actions at 30;
 *    both make up the difference with `hitSlop`, which is how the platform does
 *    it — growing the drawn shapes would make the bar Android-tall.
 *
 * `actions` is `slice`d to two rather than typed as a tuple: callers build this
 * list conditionally ("search icon only on the list screen"), and a tuple union
 * would force `as const` gymnastics at every one of those call sites. Two is the
 * point past which the title has no room left.
 */
export function WhovaHeader({
  title,
  userName,
  userPhotoURL,
  onProfilePress,
  actions,
  titleAction,
  search,
  segments,
}: WhovaHeaderProps) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: colors.header,
        paddingTop: Platform.OS === 'web' ? WEB_TAB_BAR : insets.top,
      }}>
      {/* White status bar content — see departure 1. No-op on web. */}
      <StatusBar style="light" />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
        }}>
        <ProfilePill name={userName} photoURL={userPhotoURL} onPress={onProfilePress} />

        {titleAction ? (
          <HeaderTitleButton title={title} {...titleAction} />
        ) : (
          <Text
            variant="heading"
            numberOfLines={2}
            accessibilityRole="header"
            style={{ flex: 1, textAlign: 'center', color: colors.onHeader }}>
            {title}
          </Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
          {actions?.slice(0, 2).map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              hitSlop={(HIT_TARGET - ACTION_GLYPH - ACTION_PADDING * 2) / 2}
              style={({ pressed }) => ({
                padding: ACTION_PADDING,
                opacity: pressed ? 0.4 : 1,
              })}>
              <Icon name={action.icon} size={ACTION_GLYPH} color={colors.onHeader} />
            </Pressable>
          ))}
        </View>
      </View>

      {search ? <HeaderSearchField {...search} /> : null}
      {segments ? <HeaderSegmentedControl {...segments} /> : null}
    </View>
  );
}

/**
 * The title, as a button — Whova's "Filter by tracks".
 *
 * Still `accessibilityRole="header"`? No: it is a button, and calling it a
 * header would put a control in the rotor's header list where a screen reader
 * user expects a landmark. The screen name is already carried by the tab bar.
 *
 * The badge is a state label, not a decoration, so it is inside the button's
 * `accessibilityLabel` rather than left as an unlabelled pill. `numberOfLines`
 * is 2, not 1: at accessibility sizes a one-line cap turns "Filter by tracks"
 * into "Filter by…", and the whole point of this control is that it says what
 * it does.
 */
function HeaderTitleButton({
  title,
  icon,
  onPress,
  badge,
  hint,
}: HeaderTitleAction & { title: string }) {
  const colors = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
      accessibilityHint={hint}
      hitSlop={Spacing.sm}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        minHeight: PILL_HEIGHT,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Icon name={icon} size={ACTION_GLYPH} color={colors.onHeader} />
      <Text
        variant="heading"
        numberOfLines={2}
        style={{ flexShrink: 1, textAlign: 'center', color: colors.onHeader }}>
        {title}
      </Text>
      {badge ? (
        <View
          style={{
            paddingHorizontal: Spacing.sm,
            paddingVertical: 1,
            borderRadius: Radius.pill,
            backgroundColor: Brand.blueDark,
          }}>
          <Text variant="caption" style={{ fontWeight: '600', color: colors.onHeader }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Avatar plus chevron in a darker capsule — Whova's "you are signed in as this
 * person, tap to change" affordance, and the only place the app shows the
 * signed-in user's face.
 *
 * The capsule fill is `Brand.blueDark` rather than a `useTheme()` colour on
 * purpose. The header is the one surface that is deliberately scheme-invariant
 * (`theme.ts`: "Held at Whova's blue in dark too — the header is the brand"), so
 * a fill that shifted with the scheme would be the thing that looked wrong, and
 * there is no `onHeaderMuted` token to reach for. It is a named brand token, not
 * a hex literal at the call site.
 *
 * The avatar itself is `DECORATIVE` inside `Avatar`; the whole pill carries one
 * label instead, so VoiceOver says "Thomas Deely, profile" once rather than
 * reading initials, then a name, then "chevron right".
 */
function ProfilePill({
  name,
  photoURL,
  onPress,
}: {
  name: string;
  photoURL?: string;
  onPress: () => void;
}) {
  const colors = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, profile`}
      accessibilityHint="Opens your profile"
      hitSlop={{
        top: (HIT_TARGET - PILL_HEIGHT) / 2,
        bottom: (HIT_TARGET - PILL_HEIGHT) / 2,
        left: Spacing.xs,
        right: Spacing.xs,
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1,
        padding: PILL_PADDING,
        paddingRight: Spacing.xs,
        borderRadius: Radius.pill,
        backgroundColor: Brand.blueDark,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Avatar name={name} photoURL={photoURL} size={PILL_AVATAR} />
      <Icon name="chevron.right" size={PILL_CHEVRON} color={colors.onHeader} />
    </Pressable>
  );
}

/**
 * The search field in the header's second row.
 *
 * `TextInput` cannot go through `Text`, so the size is spelled out — 17pt, the
 * body size, with `allowFontScaling` left at its default of `true`. The box is a
 * `minHeight` plus padding, so at accessibility sizes the field grows and the
 * two rows below it move down, rather than the text being clipped inside a 38pt
 * slot.
 *
 * `colors.headerField` is a pale grey in light mode and near-black in dark, so
 * the text on it is `colors.text` in both — the field is a light surface sitting
 * on the brand blue, not part of the blue.
 */
function HeaderSearchField({ value, onChangeText, placeholder, onSubmit }: HeaderSearch) {
  const colors = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.md,
        // A full gutter, not half of one. Whova leaves 16pt under its field and
        // this left 8, which is what made the three blue rows read as one slab.
        marginBottom: Spacing.md,
        paddingHorizontal: Spacing.sm + Spacing.xs,
        minHeight: FIELD_HEIGHT,
        borderRadius: Radius.md,
        backgroundColor: colors.headerField,
      }}>
      <Icon name="magnifyingglass" size={18} color={colors.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={{
          flex: 1,
          paddingVertical: Spacing.sm,
          fontSize: FIELD_FONT,
          color: colors.text,
        }}
      />
    </View>
  );
}

/**
 * Whova's third header row — "Full Agenda" / "My Agenda".
 *
 * A row of `tab`s inside a `tablist`, not a group of buttons: the distinction is
 * what makes VoiceOver announce "Full Agenda, tab, 1 of 2" and TalkBack say
 * "selected", instead of two unrelated buttons whose state is carried only by a
 * blue fill. The selected fill is `colors.accent`, which is the corrected brand
 * blue that white actually passes AA on — Whova's own bright `#24A8E4` selected
 * state is 2.69:1 and is one of the three defects `theme.ts` refuses to copy.
 *
 * Segments are drawn at 34pt, inside a 40pt track, and `hitSlop` takes each one
 * to 44. Horizontal slop is zero: adjacent segments share an edge, so any
 * horizontal slop would overlap the neighbour's target.
 */
function HeaderSegmentedControl({ options, value, onChange }: HeaderSegments) {
  const colors = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        marginHorizontal: Spacing.md,
        marginBottom: Spacing.sm,
        padding: SEGMENT_INSET,
        borderRadius: Radius.md,
        backgroundColor: colors.headerField,
      }}>
      {options.map((option, index) => {
        const selected = index === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(index)}
            accessibilityRole="tab"
            accessibilityLabel={option}
            accessibilityState={{ selected }}
            hitSlop={{
              top: (HIT_TARGET - SEGMENT_HEIGHT) / 2,
              bottom: (HIT_TARGET - SEGMENT_HEIGHT) / 2,
            }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: Spacing.sm,
              paddingVertical: Spacing.sm - 1,
              minHeight: SEGMENT_HEIGHT,
              borderRadius: Radius.sm,
              backgroundColor: selected
                ? colors.accent
                : pressed
                  ? colors.surfacePressed
                  : 'transparent',
            })}>
            {/*
              Two lines, not one. Three segments across a 393pt bar give each
              about 120pt, and at 2× Dynamic Type a one-line cap rendered the
              People control as "Atten… / Spea… / Spon…" — three ellipses where
              the labels are the only thing telling you what the control does.
              Wrapping costs the header some height at those sizes, which is
              exactly the trade the platform makes.
            */}
            <Text
              variant="callout"
              numberOfLines={2}
              style={{
                fontWeight: selected ? '600' : '400',
                textAlign: 'center',
                color: selected ? colors.onAccent : colors.tint,
              }}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
