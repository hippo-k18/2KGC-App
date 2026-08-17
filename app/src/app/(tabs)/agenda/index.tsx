import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { DECORATIVE } from '@/components/a11y';
import { DataError, DataErrorBanner } from '@/components/data-error';
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
  formatDayTab,
  formatTime,
  isSearching,
  useDays,
  useSessions,
  type Session,
} from '@/lib/data/sessions';
import { useTracks } from '@/lib/data/tracks';

/**
 * Width of the row's time column at 1× Dynamic Type — fits "12:30 PM" in
 * tabular figures with nothing to spare, which is the point. It was 76 with a
 * `Spacing.sm` gap after it; both were paid for out of the title, which ended
 * up 185pt wide against Whova's 203–228 and wrapped three-line titles that
 * Whova fits on two. There is no gap now: the column's own trailing space is
 * the gap.
 */
const TIME_COLUMN = 70;
/**
 * Width of the "Add to Agenda" control at 1×. Grows with the font scale.
 *
 * 60, not 72. The label wraps to "Add to / Agenda" at either width, so the extra
 * 12pt bought nothing and cost the title column the same 12.
 */
const ADD_COLUMN = 60;
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
 * 1. **The track filter is persistent — but it is not a permanent chip row.**
 *    Whova puts tracks behind a "Filter by tracks" button in the nav bar and
 *    resets the selection every time you change day. The reset is one of the
 *    top-ten complaints about the app, because the one thing you want on a
 *    five-track day is to hold a track across all five days; the *placement* is
 *    correct, and copying it costs nothing.
 *
 *    So the placement is Whova's and the behaviour is not. The control lives in
 *    the header title, where it takes zero vertical points, and the chips it
 *    opens live in a sheet. **The persistence is deliberate and the sheet keeps
 *    it**: `trackId` is screen state that `setDay` never touches, so changing
 *    day holds the track, and the header carries the active track's name so a
 *    filter can never be silently on. The chip row this replaces cost 60pt of a
 *    852pt screen — more than a whole session row — for a control most attendees
 *    touch once a day.
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
 *
 * 4. **Search spans the whole programme, and says so.** A query drops the day
 *    filter (`filterSessions`), so typing "Vasquez" on Monday finds Wednesday's
 *    panel. That is worthless without the second half: results regroup under day
 *    headers instead of time headers, and the day strip — which no longer
 *    constrains anything — is replaced by a line stating how many results across
 *    how many days, and which track, if one is set. A cross-day list under time
 *    headers reading "9:00 AM" three times is its own bug.
 */
export default function AgendaScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { sessions, error, loading, retry } = useSessions();
  const { tracks, error: tracksError } = useTracks();
  const days = useDays(sessions);
  const { saved, toggle, error: savedError, retry: retrySaved } = useSavedSessions();
  const { posts: meetups } = useCommunityPosts('meetup');

  // `trackId` is deliberately independent of `day`: nothing in `setDay` clears
  // it, so changing day holds the track. That persistence is the whole point of
  // departure 1 above and the sheet below must not undo it — it edits this
  // state, it does not own it.
  const [day, setDay] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [filtering, setFiltering] = useState(false);

  const activeDay = day ?? days[0] ?? null;
  const activeTrack = tracks.find((t) => t.id === trackId) ?? null;
  // The predicate's own answer, not a second guess at it — see `isSearching`.
  const searching = isSearching(search);

  const visible = useMemo(() => {
    if (!sessions) return [];
    const matched = filterSessions(sessions, { day: activeDay, trackId, search });
    return mine ? matched.filter((s) => saved.has(s.id)) : matched;
  }, [sessions, activeDay, trackId, search, mine, saved]);

  // Days that actually returned something, not the days of the programme: "12
  // results across 3 days" has to be countable off the list below it.
  const matchedDays = useMemo(() => new Set(visible.map((s) => s.day)).size, [visible]);

  const sections = useMemo(
    () => (searching ? groupByDay(visible) : groupByStartTime(visible)),
    [visible, searching],
  );

  const header = (
    <WhovaHeader
      title="Filter by tracks"
      userName={profile?.name ?? 'You'}
      userPhotoURL={profile?.photoURL}
      onProfilePress={() => router.push('/me/profile')}
      titleAction={{
        icon: 'slider.horizontal.3',
        onPress: () => setFiltering(true),
        // The active track's name, not a count: with one selectable track at a
        // time a "1" would say a filter is on without saying which, and the
        // whole complaint this screen answers is filters you forget are set.
        badge: activeTrack?.name,
        hint: 'Opens the track filter',
      }}
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

  // This used to be an `EmptyState` reading "Could not load the agenda — is the
  // emulator running? Try npm run dev:emulators", which is a developer's guess
  // shown to an attendee: it says the same thing to a `permission-denied` (their
  // token is stale, and signing in again fixes it), to `unavailable` (their wifi
  // dropped, and nothing needs fixing) and to `failed-precondition` (an index is
  // missing and only the organizers can do anything). `DataError` reads the code.
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <DataError error={error} subject="the agenda" onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}

      {/* Whova leaves 9pt of grey between the blue chrome and the day strip; we
          left none, which is what fused header, strip and chip row into one
          slab. `Spacing.sm` is the scale's nearest value. */}
      <View style={{ height: Spacing.sm }} {...DECORATIVE} />

      {/* The agenda itself loaded, so the list is worth keeping — but every "Add
          to Agenda" control on it is drawn from `saved`, and a refused read of
          that subcollection makes all of them read "not added". Silently, that
          invites an attendee to rebuild a personal agenda they already have. */}
      {savedError ? (
        <DataErrorBanner
          error={savedError}
          subject="your saved sessions"
          onRetry={retrySaved}
        />
      ) : null}

      {/* The day strip is not merely dimmed while a query is active — it is
          taken away, because a control that is visible and inert is read as a
          control that works. What replaces it says what the search covered. */}
      {searching ? (
        <SearchScope
          results={visible.length}
          days={matchedDays}
          trackName={activeTrack?.name}
          mine={mine}
          onClear={() => setSearch('')}
        />
      ) : (
        <DayStrip days={days} active={activeDay} onSelect={setDay} />
      )}

      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        // On iOS this is the default and on Android it is not, so it is spelled
        // out — the sticky "8:00 AM" band is the thing that makes a dense
        // programme scannable while you are walking.
        stickySectionHeadersEnabled
        // `flexGrow`, so an empty agenda's `EmptyState` centres itself in the
        // list's own height instead of hanging from the top of it.
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Spacing.xxl }}
        ListHeaderComponent={
          // Dropped while searching. An amber promo wedged between "9 results
          // across 3 days" and the first day header breaks the one association
          // that line exists to make, and a search is the moment an attendee is
          // least interested in being sold a meet-up.
          searching ? null : (
            <MeetupBanner
              count={meetups?.length ?? 0}
              onPress={() => router.push('/community')}
            />
          )
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
        ListEmptyComponent={
          loading ? null : (
            <AgendaEmpty
              mine={mine}
              search={search}
              trackName={activeTrack?.name}
              programmeDays={days.length}
            />
          )
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      <TrackSheet
        visible={filtering}
        tracks={tracks}
        tracksError={tracksError}
        value={trackId}
        onClose={() => setFiltering(false)}
        onSelect={(next) => {
          setTrackId(next);
          setFiltering(false);
        }}
      />
    </View>
  );
}

/**
 * The track chips, moved off the screen and into a sheet.
 *
 * **This does not make the filter non-persistent.** It writes `trackId` on the
 * screen and closes; nothing here clears it, and nothing in the day strip
 * clears it either. That is the deliberate improvement over Whova, whose own
 * version of this sheet resets on every day change, and it is why the header
 * button carries the selected track's name — a filter that persists must also
 * be visible, or it becomes the bug it was meant to fix.
 *
 * A `Modal` rather than a bottom-sheet library: the app has one already
 * (`SortSheet` on Community), it needs no gesture, and eleven chips fit.
 */
function TrackSheet({
  visible,
  tracks,
  tracksError,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  tracks: { id: string; name: string; color?: string }[];
  /** A refused tracks read leaves this sheet holding only "All tracks". */
  tracksError?: Error | null;
  value: string | null;
  onClose: () => void;
  onSelect: (next: string | null) => void;
}) {
  const colors = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close track filter"
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <Pressable
          // Swallows the backdrop's press without becoming a control itself.
          onPress={() => {}}
          accessible={false}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.lg,
            borderTopRightRadius: Radius.lg,
            paddingBottom: Spacing.xl,
          }}>
          <Text
            variant="label"
            tone="secondary"
            accessibilityRole="header"
            style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}>
            FILTER BY TRACKS
          </Text>

          <Text
            variant="caption"
            tone="tertiary"
            style={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.md }}>
            Your choice is kept when you change day.
          </Text>

          {/* Without this the sheet holds a single "All tracks" chip and reads as
              a one-track conference. */}
          {tracksError ? (
            <DataErrorBanner error={tracksError} subject="the track list" />
          ) : null}

          <ScrollView
            contentContainerStyle={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: Spacing.sm,
              paddingHorizontal: Spacing.md,
            }}>
            <FilterChip
              label="All tracks"
              selected={value === null}
              onPress={() => onSelect(null)}
            />
            {tracks.map((t) => (
              <FilterChip
                key={t.id}
                label={t.name}
                dotColor={t.color}
                selected={value === t.id}
                onPress={() => onSelect(value === t.id ? null : t.id)}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Search results, grouped under their date.
 *
 * A cross-day result set under the usual time headers is unreadable — three
 * separate "9:00 AM" bands with no indication that they are three different
 * mornings — and worse than unreadable, it is misleading, because the reader's
 * only model of this screen is that everything on it is one day. The row's own
 * time column still carries the clock, so nothing is lost by spending the header
 * on the date instead.
 *
 * Sessions arrive sorted by `startsAtLocal`, whose first ten characters are the
 * day key, so one pass groups them and the days come out in order.
 */
function groupByDay(sessions: Session[]): { title: string; data: Session[] }[] {
  const out: { title: string; data: Session[] }[] = [];
  for (const session of sessions) {
    // Same reasoning as `groupByStartTime`: a session whose day key will not
    // parse has to land somewhere named rather than disappear.
    const title = formatDayTab(session.day) || 'Date to be confirmed';
    const current = out[out.length - 1];
    if (current && current.title === title) current.data.push(session);
    else out.push({ title, data: [session] });
  }
  return out;
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
 * What a search actually covered, in the slot the day strip vacated.
 *
 * This exists because the fix it belongs to is only half a fix without it. A
 * search that quietly widens from one day to five is better than one that
 * quietly narrows, but both are quiet, and the app's problem has always been
 * scope the user cannot see. So the line is specific: a count, the number of days
 * those results are spread over, and the track if one is set — every narrowing
 * still in force, named. "12 results across 3 days" is checkable against the day
 * headers immediately below it.
 *
 * `Clear` restores the day strip and the day that was selected before the
 * search; `day` state is never touched by any of this, so the strip comes back
 * exactly where it was left.
 */
function SearchScope({
  results,
  days,
  trackName,
  mine,
  onClear,
}: {
  results: number;
  days: number;
  trackName?: string;
  mine: boolean;
  onClear: () => void;
}) {
  const colors = useTheme();

  // No count of days when nothing matched: "0 results across 0 days" is noise on
  // top of a no-results state that already explains itself.
  const summary =
    results === 0
      ? 'No results'
      : `${results} ${results === 1 ? 'result' : 'results'} across ` +
        `${days} ${days === 1 ? 'day' : 'days'}`;
  const scope = [mine ? 'in My Agenda' : null, trackName ? `in ${trackName}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: colors.surface,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        minHeight: HIT_TARGET,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: colors.border,
      }}>
      <View style={{ flex: 1 }}>
        <Text variant="subhead" accessibilityRole="header" style={{ fontWeight: '600' }}>
          {summary}
        </Text>
        {/* Said plainly rather than implied by an inert day strip: the whole
            programme was searched, and this is what else is still narrowing it. */}
        <Text variant="caption" tone="secondary">
          Whole agenda searched{scope ? `, ${scope}` : ''}
        </Text>
      </View>

      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Clear the search and go back to the day you were on"
        hitSlop={Spacing.sm}
        style={({ pressed }) => ({
          justifyContent: 'center',
          minHeight: HIT_TARGET,
          paddingHorizontal: Spacing.sm,
          borderRadius: Radius.sm,
          backgroundColor: pressed ? colors.surfacePressed : 'transparent',
        })}>
        <Text variant="callout" style={{ color: colors.tint }}>
          Clear
        </Text>
      </Pressable>
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
    <View
      // The rule that used to sit under the chip row. Without a boundary here
      // the amber band runs straight into the first "8:00 AM" band and the
      // stack of full-bleed bands reads as one object.
      style={{ borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>
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
    </View>
  );
}

/**
 * The sticky "8:00 AM" band between groups.
 *
 * It is a divider that happens to be labelled, not a heading — Whova draws it at
 * 25pt and we drew it at 39, which on a five-group day was 70pt of band. A
 * `subhead` in `Spacing.xs` of padding lands at 28 and reads the same. It keeps
 * `accessibilityRole="header"` regardless: the rotor is how someone using
 * VoiceOver skips a time group, and that is worth more than the point size.
 */
function TimeHeader({ title }: { title: string }) {
  const colors = useTheme();

  return (
    <View
      style={{
        backgroundColor: colors.background,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: colors.border,
      }}>
      <Text variant="subhead" accessibilityRole="header" style={{ fontWeight: '600' }}>
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
          // A full gutter between the text and "Add to Agenda". At `Spacing.sm`
          // this closed to 1pt at 2× Dynamic Type, because the add column grows
          // with the font scale and the gap did not — the title ran straight
          // into the calendar glyph.
          gap: stacked ? Spacing.xs : Spacing.md,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md,
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
            // No gap between the time column and the text: `TIME_COLUMN` is
            // wider than the widest time it holds, so its own slack is the gap,
            // and an explicit `Spacing.sm` on top of it was 8pt taken straight
            // out of the title.
            gap: stacked ? Spacing.xs : 0,
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

          <View style={{ flex: stacked ? undefined : 1, gap: Spacing.xs }}>
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

      {/* Inset left to the text column, `Spacing.md` clear of the right edge.
          It used to start at the row's left gutter, which contradicted the
          identical Home row (`SessionCard`) starting at the title. */}
      {!last ? (
        <View
          style={{
            height: HAIRLINE,
            backgroundColor: colors.separator,
            marginLeft: stacked ? Spacing.md : Spacing.md + timeColumn,
            marginRight: Spacing.md,
          }}
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

/**
 * The four ways this list can be empty, kept apart.
 *
 * "No matches" over a five-day agenda that only ever searched Monday was the
 * defect this screen was carrying: an attendee reads it as "that speaker is not
 * at this conference" and stops looking. So the query is quoted back — nobody
 * trusts a search that will not repeat what it heard — and the scope is stated
 * outright, including the number of days and any track still narrowing it, which
 * is also the only thing that makes the next action obvious.
 *
 * Nothing here claims a scope the predicate does not have: it searches title,
 * location and speaker across every published day, which is what these strings
 * say and no more. Description and track name are *not* matched, so this stops
 * short of promising "anything about the session".
 */
function AgendaEmpty({
  mine,
  search,
  trackName,
  programmeDays,
}: {
  mine: boolean;
  search: string;
  trackName?: string;
  programmeDays: number;
}) {
  const query = search.trim();

  // A query comes first, even inside My Agenda: it is the most recent thing the
  // attendee did, and "nothing saved yet" would be a lie about why the list is
  // empty when they have in fact just typed something with no match.
  if (query) {
    const where = mine
      ? 'in My Agenda'
      : `across all ${programmeDays} ${programmeDays === 1 ? 'day' : 'days'}`;
    return (
      <EmptyState
        icon="magnifyingglass"
        title={`No sessions match “${query}”`}
        message={
          `Searched session titles, locations and speaker names ${where}` +
          (trackName
            ? `, in the ${trackName} track. Clearing the track filter may find it.`
            : '. Check the spelling, or try part of a name.')
        }
      />
    );
  }

  if (mine) {
    return (
      <EmptyState
        icon="calendar.badge.plus"
        title="Nothing in My Agenda yet"
        message="Tap Add to Agenda on any session and it appears here, on the day it runs."
      />
    );
  }

  if (trackName) {
    return (
      <EmptyState
        icon="slider.horizontal.3"
        title={`Nothing in ${trackName} today`}
        message="That track has no sessions on this day. Try another day, or clear the track filter."
      />
    );
  }

  return (
    <EmptyState
      icon="calendar"
      title="No sessions yet"
      message="The programme appears here once it is published."
    />
  );
}
