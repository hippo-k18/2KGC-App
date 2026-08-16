import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { DECORATIVE } from '@/components/a11y';
import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { WhovaHeader } from '@/components/whova-header';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useCommunityPosts } from '@/lib/data/community';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import {
  filterSessions,
  formatTime,
  useDays,
  useSessions,
  type Session,
} from '@/lib/data/sessions';
import { useTracks } from '@/lib/data/tracks';

/** Width of the row's time column at 1× Dynamic Type — fits "12:30 PM". */
const TIME_COLUMN = 76;
/** Width of the "Add to Agenda" control at 1×. Grows with the font scale. */
const ADD_COLUMN = 72;
/**
 * Font scale past which the two-column row stops paying for itself, and the row
 * stacks instead. The same threshold `session-card.tsx` uses, for the same
 * reason — at 1.35× the time column would want more than half the screen.
 */
const STACK_ABOVE = 1.35;
/** Track-colour swatch beside a title. */
const TRACK_DOT = 6;
/** Thickness of the underline under the selected day. */
const DAY_UNDERLINE = 3;
/** Minimum tap width of one day in the strip. */
const DAY_WIDTH = 54;
/** "Add to Agenda" glyph. Whova draws it noticeably larger than a metadata icon. */
const ADD_GLYPH = 26;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The agenda — the screen the app is judged on. Almost every attendee opens it
 * several times a day, often while walking between buildings.
 *
 * The chrome is Whova's, deliberately: the blue header with an in-header search
 * field and a Full Agenda / My Agenda segmented control, a day strip below it,
 * sticky time-group headers, and a row whose left edge is a time column and
 * whose right edge is an explicit "Add to Agenda" control. Returning attendees
 * used that layout last year and it is worth being the same app.
 *
 * ## The three departures, all deliberate
 *
 * 1. **The track filter is a visible, persistent chip row, not a modal.** Whova
 *    puts it behind the "Filter by tracks" title button and resets it every time
 *    you change day — one of the top-ten complaints about the app, because the
 *    one thing you want on a five-track day is to hold a track across all five
 *    days. Here the filter state lives above the day strip, so changing day
 *    keeps the track, and "All tracks" collapses eleven tracks in one tap. This
 *    is why the header title says "Agenda" rather than "Filter by tracks": the
 *    control it names is already on screen.
 *
 * 2. **No engagement strip.** Whova shows person-check / heart / comment counts
 *    under every row. Nothing in this data model counts any of the three, so the
 *    choice was inventing numbers or rendering three zeros that say "nobody is
 *    interested in this session" under a session nobody has opened yet. Both are
 *    worse than the absence. `StatRow` is ready for the day the aggregate
 *    triggers exist (`AGENTS.md`, "Known gaps").
 *
 * 3. **No stream badge.** `SessionDoc` carries no livestream field, so the green
 *    dot, the video glyph and "Stream has ended" have nothing to render from.
 */
export default function AgendaScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { sessions, error, loading } = useSessions();
  const tracks = useTracks();
  const days = useDays(sessions);
  const { saved, toggle } = useSavedSessions();
  const { posts: meetups } = useCommunityPosts('meetup');

  // Filter state lives above the day strip on purpose: changing day must not
  // drop the track you picked. See departure 1 above.
  const [day, setDay] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);

  const activeDay = day ?? days[0] ?? null;

  const visible = useMemo(() => {
    if (!sessions) return [];
    const matched = filterSessions(sessions, { day: activeDay, trackId, search });
    return mine ? matched.filter((s) => saved.has(s.id)) : matched;
  }, [sessions, activeDay, trackId, search, mine, saved]);

  const sections = useMemo(() => groupByStartTime(visible), [visible]);

  const header = (
    <WhovaHeader
      title="Agenda"
      userName={profile?.name ?? 'You'}
      userPhotoURL={profile?.photoURL}
      onProfilePress={() => router.push('/me/profile')}
      search={{
        value: search,
        onChangeText: setSearch,
        placeholder: 'Search by session, location or speaker',
      }}
      segments={{
        options: ['Full Agenda', 'My Agenda'],
        value: mine ? 1 : 0,
        onChange: (next) => setMine(next === 1),
      }}
    />
  );

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <EmptyState
          icon="calendar"
          title="Could not load the agenda"
          message={
            process.env.EXPO_PUBLIC_USE_EMULATOR === '1'
              ? 'Is the emulator running? Try npm run dev:emulators.'
              : 'Check your connection and try again.'
          }
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}

      <DayStrip days={days} active={activeDay} onSelect={setDay} />

      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        // On iOS this is the default and on Android it is not, so it is spelled
        // out — the sticky "8:00 AM" band is the thing that makes a dense
        // programme scannable while you are walking.
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: Spacing.xxl }}
        ListHeaderComponent={
          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.sm + Spacing.xs,
                gap: Spacing.sm,
              }}>
              <FilterChip
                label="All tracks"
                selected={trackId === null}
                onPress={() => setTrackId(null)}
              />
              {tracks.map((t) => (
                <FilterChip
                  key={t.id}
                  label={t.name}
                  dotColor={t.color}
                  selected={trackId === t.id}
                  onPress={() => setTrackId(trackId === t.id ? null : t.id)}
                />
              ))}
            </ScrollView>

            <MeetupBanner
              count={meetups?.length ?? 0}
              onPress={() => router.push('/community')}
            />
          </View>
        }
        renderSectionHeader={({ section }) => <TimeHeader title={section.title} />}
        renderItem={({ item, index, section }) => (
          <AgendaRow
            session={item}
            saved={saved.has(item.id)}
            onToggleSaved={() => toggle(item.id)}
            last={index === section.data.length - 1}
            onPress={() => router.push({ pathname: '/agenda/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={loading ? null : <AgendaEmpty mine={mine} filtered={Boolean(search || trackId)} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

/** Sessions arrive sorted by `startsAtLocal`, so one pass groups them. */
function groupByStartTime(sessions: Session[]): { title: string; data: Session[] }[] {
  const out: { title: string; data: Session[] }[] = [];
  for (const session of sessions) {
    // A session authored without a wall clock still has to appear somewhere
    // rather than vanish into a section with no name.
    const title = formatTime(session.startsAtLocal) || 'Time to be confirmed';
    const current = out[out.length - 1];
    if (current && current.title === title) current.data.push(session);
    else out.push({ title, data: [session] });
  }
  return out;
}

/** `2027-05-04` → the pieces the day strip draws, or `null` if malformed. */
function dayParts(day: string) {
  const [y, m, d] = (day ?? '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // Built and read back in UTC so the label never shifts with the device's own
  // zone — the day key is already event-local. Same reason as `formatDayTab`.
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  const weekday = WEEKDAYS[date.getUTCDay()];
  const weekdayLong = WEEKDAYS_LONG[date.getUTCDay()];
  const month = MONTHS[m - 1];
  if (!weekday || !weekdayLong || !month) return null;
  return {
    weekday,
    number: String(d),
    month: month.toUpperCase(),
    year: String(y),
    spoken: `${weekdayLong} ${d} ${month} ${y}`,
  };
}

/**
 * Whova's day strip: the year and month held on the left, then one column per
 * day — weekday over date, the selected one in brand blue under a thick rule.
 *
 * It is fixed under the header rather than scrolling with the list. A day strip
 * you have to scroll back up to reach is a day strip you stop using by Tuesday,
 * and it is the single most-tapped control on the screen.
 *
 * The month block reads from the *selected* day, not the first one, so an event
 * that straddles a month boundary relabels itself instead of lying.
 */
function DayStrip({
  days,
  active,
  onSelect,
}: {
  days: string[];
  active: string | null;
  onSelect: (day: string) => void;
}) {
  const colors = useTheme();
  const stamp = dayParts(active ?? days[0] ?? '');

  if (!days.length) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: colors.surface,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: colors.border,
      }}>
      {stamp ? (
        <View
          style={{
            paddingLeft: Spacing.md,
            paddingRight: Spacing.sm,
            paddingTop: Spacing.sm,
            paddingBottom: Spacing.sm + DAY_UNDERLINE,
          }}
          {...DECORATIVE}>
          <Text variant="caption" tone="secondary">
            {stamp.year}
          </Text>
          <Text variant="title3" tone="secondary">
            {stamp.month}
          </Text>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'flex-end' }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row' }}>
          {days.map((d) => {
            const parts = dayParts(d);
            const selected = d === active;
            return (
              <Pressable
                key={d}
                onPress={() => onSelect(d)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={parts?.spoken ?? d}
                style={({ pressed }) => ({
                  alignItems: 'center',
                  minWidth: DAY_WIDTH,
                  minHeight: HIT_TARGET,
                  paddingHorizontal: Spacing.sm,
                  paddingTop: Spacing.sm,
                  backgroundColor: pressed ? colors.surfacePressed : 'transparent',
                })}>
                <Text
                  variant="caption"
                  style={{
                    color: selected ? colors.tint : colors.textSecondary,
                    fontWeight: selected ? '600' : '400',
                  }}>
                  {parts?.weekday ?? ''}
                </Text>
                <Text
                  variant="title3"
                  style={{ color: selected ? colors.tint : colors.text }}>
                  {parts?.number ?? d}
                </Text>
                {/* The underline is always laid out, so selecting a day does not
                    shift the strip by 3pt. */}
                <View
                  style={{
                    alignSelf: 'stretch',
                    height: DAY_UNDERLINE,
                    marginTop: Spacing.sm - Spacing.xs,
                    backgroundColor: selected ? colors.tint : 'transparent',
                  }}
                  {...DECORATIVE}
                />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Whova's amber promo strip.
 *
 * Whova hard-codes a marketing line here; this one carries a real count off the
 * community board and disappears when there is nothing to point at, because a
 * banner that is always present is a banner nobody reads. "Upcoming" is not
 * claimed — `CommunityPostDoc` has no date for the meet-up itself, only when the
 * post was written, and the strip is not worth a lie.
 *
 * The fill is Whova's own amber with near-black text rather than the white it
 * uses: white on `#F2B24A` is 1.87:1. See `theme.ts`.
 */
function MeetupBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useTheme();
  if (count <= 0) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`See ${count} ${count === 1 ? 'meet-up' : 'meet-ups'} in the community`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md - Spacing.xs,
        minHeight: HIT_TARGET,
        backgroundColor: colors.banner,
        opacity: pressed ? 0.85 : 1,
      })}>
      <Text variant="heading" style={{ flex: 1, color: colors.onBanner }}>
        See {count} {count === 1 ? 'meet-up' : 'meet-ups'} in the community
      </Text>
      <Text variant="callout" style={{ color: colors.onBanner }}>
        Details
      </Text>
      <Icon name="chevron.right" size={14} color={colors.onBanner} />
    </Pressable>
  );
}

/** The sticky "8:00 AM" band between groups. */
function TimeHeader({ title }: { title: string }) {
  const colors = useTheme();

  return (
    <View
      style={{
        backgroundColor: colors.background,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: colors.border,
      }}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

/**
 * One session, in Whova's row layout: start over end in a left column, the
 * title and its location and speaker lines in the middle, and "Add to Agenda"
 * as an explicit control on the right.
 *
 * The add control is a real, separately labelled button rather than a swipe or
 * a long-press. Building a personal agenda is the single most valuable thing an
 * attendee does in the first hour, and hiding it behind a gesture is why so many
 * Whova users never find it — except Whova got this one right, so it is copied.
 *
 * The two controls are **siblings, not nested**. Wrapping the whole row in one
 * `Pressable` and putting the add button inside it is the obvious way to write
 * this and it is wrong twice over: react-native-web emits a `<button>` inside a
 * `<button>`, which is invalid HTML that React refuses to hydrate, and on both
 * native platforms a screen reader has to guess which of two overlapping targets
 * a tap belongs to. So the tappable body is its own element beside the add
 * control, and the pressed fill is lifted to the container they share — the whole
 * row still lights up, which is the only thing the nesting was buying.
 *
 * Past `STACK_ABOVE` the row stops being three columns and stacks, which is what
 * iOS's own list content configurations do at accessibility sizes. Nothing here
 * has a fixed `height`; the time and add columns are `width`s that grow with the
 * font scale, and every text box is free to become as tall as it needs.
 */
function AgendaRow({
  session,
  saved,
  onToggleSaved,
  onPress,
  last,
}: {
  session: Session;
  saved: boolean;
  onToggleSaved: () => void;
  onPress: () => void;
  last?: boolean;
}) {
  const colors = useTheme();
  const { fontScale } = useWindowDimensions();
  const [pressed, setPressed] = useState(false);
  const stacked = fontScale > STACK_ABOVE;
  const scale = Math.max(fontScale, 1);
  const timeColumn = Math.round(TIME_COLUMN * scale);
  const accent = session.primaryTrackColor ?? colors.tint;

  return (
    <View style={{ backgroundColor: pressed ? colors.surfacePressed : colors.surface }}>
      <View
        style={{
          flexDirection: stacked ? 'column' : 'row',
          // Top-aligned, as Whova draws it: the calendar sits beside the title
          // rather than floating in the middle of a four-line row.
          alignItems: 'flex-start',
          gap: stacked ? Spacing.xs : Spacing.sm,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md - Spacing.xs,
        }}>
        <Pressable
          onPress={onPress}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={
            `${session.title}, ${formatTime(session.startsAtLocal)} to ` +
            `${formatTime(session.endsAtLocal)}` +
            (session.roomName ? `, ${session.roomName}` : '') +
            (session.speakerNames?.length ? `, ${session.speakerNames.join(', ')}` : '') +
            (saved ? ', in your agenda' : '')
          }
          style={{
            flex: stacked ? undefined : 1,
            alignSelf: 'stretch',
            flexDirection: stacked ? 'column' : 'row',
            gap: stacked ? Spacing.xs : Spacing.sm,
          }}>
          <View
            style={
              stacked
                ? { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' }
                : { width: timeColumn, paddingTop: 1 }
            }>
            <Text variant="subhead" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(session.startsAtLocal)}
              {stacked ? ' –' : ''}
            </Text>
            <Text variant="subhead" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(session.endsAtLocal)}
            </Text>
          </View>

          <View style={{ flex: stacked ? undefined : 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              {session.primaryTrackName ? (
                <View
                  style={{
                    width: TRACK_DOT,
                    height: TRACK_DOT,
                    borderRadius: TRACK_DOT / 2,
                    backgroundColor: accent,
                    // Seated on the cap-height of the first line rather than the
                    // centre of a wrapped block.
                    marginTop: Spacing.sm,
                  }}
                  {...DECORATIVE}
                />
              ) : null}
              <Text variant="heading" style={{ flex: 1 }}>
                {session.title}
              </Text>
            </View>

            {session.roomName ? (
              <Text variant="subhead" tone="secondary">
                Location: {session.roomName}
              </Text>
            ) : null}

            {session.speakerNames?.length ? (
              <Text variant="subhead" tone="secondary">
                {session.speakerNames.length > 1 ? 'Speakers' : 'Speaker'}:{' '}
                {session.speakerNames.join(', ')}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <AddToAgenda
          saved={saved}
          title={session.title}
          onPress={onToggleSaved}
          width={Math.round(ADD_COLUMN * scale)}
        />
      </View>

      {!last ? (
        <View
          style={{ height: HAIRLINE, backgroundColor: colors.separator, marginLeft: Spacing.md }}
          {...DECORATIVE}
        />
      ) : null}
    </View>
  );
}

/** Whova's calendar-plus affordance: glyph over a two-line label, on the right. */
function AddToAgenda({
  saved,
  title,
  onPress,
  width,
}: {
  saved: boolean;
  title: string;
  onPress: () => void;
  width: number;
}) {
  const colors = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={
        saved ? `Remove ${title} from my agenda` : `Add ${title} to my agenda`
      }
      hitSlop={Spacing.sm}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.xs,
        // A max, not a fixed width: the label wraps inside it at 1× and the box
        // grows with the font scale rather than guillotining "Agenda".
        maxWidth: width,
        minWidth: width,
        minHeight: HIT_TARGET,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.sm,
        backgroundColor: pressed ? colors.surfacePressed : 'transparent',
      })}>
      <Icon
        name={saved ? 'checkmark.circle.fill' : 'calendar.badge.plus'}
        size={ADD_GLYPH}
        color={saved ? colors.success : colors.tint}
      />
      <Text
        variant="caption"
        style={{ textAlign: 'center', color: saved ? colors.success : colors.tint }}>
        {saved ? 'In My Agenda' : 'Add to Agenda'}
      </Text>
    </Pressable>
  );
}

function AgendaEmpty({ mine, filtered }: { mine: boolean; filtered: boolean }) {
  if (mine) {
    return (
      <EmptyState
        icon="calendar.badge.plus"
        title="Nothing in My Agenda yet"
        message="Tap Add to Agenda on any session and it appears here, on the day it runs."
      />
    );
  }
  return (
    <EmptyState
      icon={filtered ? 'magnifyingglass' : 'calendar'}
      title={filtered ? 'No matches' : 'No sessions yet'}
      message={
        filtered
          ? 'Try another track, or clear the search.'
          : 'The programme appears here once it is published.'
      }
    />
  );
}
