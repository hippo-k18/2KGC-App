import { useState } from 'react';
import { Image, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DECORATIVE } from '@/components/a11y';
import { combineFailures, DataErrorBanner } from '@/components/data-error';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SectionCard } from '@/components/section-card';
import { SessionCard } from '@/components/session-card';
import { Text } from '@/components/text';
import { WhovaHeader } from '@/components/whova-header';
import { EVENT } from '@/config/event';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAnnouncements, useNowNext } from '@/lib/data/announcements';
import { totalUnread, useThreads } from '@/lib/data/messages';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { useDays, useSessions } from '@/lib/data/sessions';

/**
 * Drawn height of the hero. Deliberately a fixed `height` and not a `minHeight`:
 * it holds no text, so Dynamic Type cannot overflow it, and the artwork is a
 * 1500×720 crop that has to keep a stable band of skyline under the logo card
 * whatever the screen width. `cover` does the rest.
 */
const HERO_HEIGHT = 200;
/** Width of the KGC lockup inside its white card. Its aspect ratio is 400:207. */
const LOGO_WIDTH = 116;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 207) / 400);
/** Padding of the white card around the lockup. */
const LOGO_CARD_PADDING = 10;

/**
 * Whova's sections run edge to edge — white blocks separated by thin grey bands,
 * with no gutter and no rounded corners. `SectionCard` is built for the inset
 * grouped style the rest of this app uses, so its radius is overridden here
 * rather than a second component being invented. This is also what buys the
 * resource grid its width: at a 16pt gutter the third tile is 104pt wide and
 * "Leaderboard" breaks mid-word; full-bleed it is 115 and does not.
 */
const FULL_BLEED = { borderRadius: 0 } as const;
/**
 * The grey band between two sections.
 *
 * `Spacing.md`. The comment here used to claim Whova's was "~7pt", which was an
 * eyeball; measured against the real app it is 16.0, and this was drawn at 8 —
 * so the one thing separating five full-bleed white blocks was half the width it
 * should have been, and the page read as one slab with faint scratches in it.
 */
const SECTION_GAP = Spacing.md;
/** `SectionCard`'s own horizontal padding, which the grid has to subtract. */
const CARD_PADDING = Spacing.md;

/** Gap between resource tiles, horizontally and vertically. */
const GRID_GAP = Spacing.sm;
/** Whova's grid is three across at every phone width. */
const GRID_COLUMNS = 3;
/**
 * A `minHeight`, so a long tile label grows the tile rather than clipping.
 *
 * The `minHeight` was always right and the label's `numberOfLines={2}` was not:
 * at 2× Dynamic Type "Session Q&A" needs three lines in a 115pt tile and the
 * third was dropped, so the grid read as "Session / Q&A", "My / schedule",
 * "Leader" — a wall of half-labels in the one block that is pure navigation.
 * The cap is gone; tiles on a wrapped row stretch to the tallest of them, which
 * is flexbox's default and the correct answer here.
 */
const TILE_MIN_HEIGHT = 56;
/** Whova's "there is something new in here" dot. */
const BADGE_DOT = 14;

/** Lines of the description shown before "See more". */
const DESCRIPTION_COLLAPSED_LINES = 4;
/** Drawn height of the "See more" link; `hitSlop` takes it to 44. */
const LINK_HEIGHT = 28;

/**
 * The event blurb.
 *
 * A module constant rather than a field on `EVENT`, because `EVENT` lives in
 * `@kgc/shared` and is imported by Cloud Functions and the importer — marketing
 * copy has no business travelling there. There is also no `events` collection in
 * `COLLECTIONS`, so there is nowhere in Firestore to read it from yet. When an
 * event document is added, this becomes `event.description` and this constant
 * goes away.
 */
const EVENT_DESCRIPTION =
  'Knowledge Graphs for AI in the Enterprise: exploring how knowledge graphs ' +
  'unlock the potential of AI in real-world enterprise applications, driving ' +
  'scalable systems and trusted outcomes.\n\n' +
  'Five days at Cornell Tech on Roosevelt Island bring together the people ' +
  'building enterprise knowledge graphs — practitioners, researchers, vendors ' +
  'and the teams putting graphs into production behind retrieval, reasoning and ' +
  'data governance. Expect workshops, case studies from the companies actually ' +
  'running these systems, and the corridor conversations that are the real ' +
  'reason to fly in.';

/**
 * Home, rebuilt to Whova's shape.
 *
 * Whova's home is one scroll: hero banner with the event's logo card on it,
 * event name / place / dates, a time-zone strip, then grouped white sections —
 * a grid of "Additional Resources" tiles and an expandable event description.
 * That layout is the strongest single signal that this is the same app the
 * attendees used last year, so it is reproduced closely.
 *
 * Two deliberate departures, both noted where they happen:
 *
 * 1. **"Happening now" and "Up next" stay, directly under the hero.** Whova has
 *    no equivalent — its home is navigation and nothing else. This answers the
 *    question an attendee actually has when they take their phone out mid-
 *    conference, and at Cornell Tech, where sessions sit across three buildings
 *    and you walk outside between them, the room matters more than usual.
 *
 * 2. **The time-zone strip states rather than offers.** Whova puts a "Switch"
 *    control there; this app always renders event-local wall clock (see
 *    `useNowNext` and `formatTime` in `lib/data/sessions.ts`), so a control that
 *    did nothing would be worse than no control.
 *
 * Every resource tile goes somewhere. The ones with no screen behind them yet
 * route to `coming-soon`, which names what is missing, rather than being drawn
 * as a live tile that swallows the tap.
 */
export default function HomeScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { sessions, error: sessionsError, retry: retrySessions } = useSessions();
  const days = useDays(sessions);
  const { now, next, usingFallback } = useNowNext(sessions);
  const {
    announcements,
    error: announcementsError,
    retry: retryAnnouncements,
  } = useAnnouncements();
  const { isSaved, error: savedError, retry: retrySaved } = useSavedSessions();
  const { threads } = useThreads(user?.uid);
  const unread = totalUnread(threads, user?.uid);

  const [expanded, setExpanded] = useState(false);

  // One banner, not three. A missing claim denies all three of these listeners at
  // once — see `combineFailures`.
  const failure = combineFailures([
    { error: sessionsError, subject: 'what is on now', retry: retrySessions },
    {
      error: announcementsError,
      subject: 'organizer announcements',
      retry: retryAnnouncements,
    },
    { error: savedError, subject: 'your saved sessions', retry: retrySaved },
  ]);

  const openSession = (id: string) =>
    router.push({ pathname: '/agenda/[id]', params: { id } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBackground }}>
      <WhovaHeader
        title="Home"
        userName={profile?.name ?? 'Attendee'}
        userPhotoURL={profile?.photoURL}
        onProfilePress={() => router.push('/me/profile')}
        actions={[
          {
            icon: 'envelope.fill',
            // The count lives in the label because `WhovaHeader` takes icon
            // names, not nodes, so `MessagesButton`'s drawn badge cannot come
            // along. The Messages tile in the grid below carries the visible dot.
            label: unread ? `Messages, ${unread} unread` : 'Messages',
            onPress: () => router.push({ pathname: '/messages', params: { from: 'home' } }),
          },
        ]}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl, gap: SECTION_GAP }}>
        <EventBanner dateRange={formatEventDates(days)} />

        {/*
          A banner rather than a full-screen error, because most of this screen is
          real without any of these queries: the hero, the resource grid and the
          event description are constants, so replacing the page would take away
          working navigation in order to report that a listener failed.

          All three of these used to fail completely silently. "Happening now" and
          "Up next" simply did not render — the sections are conditional on
          `now.length` — so a refused sessions read looked exactly like a
          conference whose programme was not published yet, on the one screen an
          attendee opens while walking between buildings. Announcements were
          worse: that collection is where a room change is published. And every
          star on the cards is drawn from the saved-sessions listener.
        */}
        {failure ? <DataErrorBanner {...failure} /> : null}

        {now.length ? (
          <SectionCard
            title={usingFallback ? 'Opens with' : 'Happening now'}
            inset={false}
            style={FULL_BLEED}>
            {now.map((s, i) => (
              <SessionCard
                key={s.id}
                session={s}
                saved={isSaved(s.id)}
                last={i === now.length - 1}
                onPress={() => openSession(s.id)}
              />
            ))}
          </SectionCard>
        ) : null}

        {next.length ? (
          <SectionCard
            title={usingFallback ? 'Then' : 'Up next'}
            actionLabel="Full agenda"
            onActionPress={() => router.push('/agenda')}
            inset={false}
            style={FULL_BLEED}>
            {next.map((s, i) => (
              <SessionCard
                key={s.id}
                session={s}
                saved={isSaved(s.id)}
                last={i === next.length - 1}
                onPress={() => openSession(s.id)}
              />
            ))}
          </SectionCard>
        ) : null}

        {announcements.length ? (
          <SectionCard
            title="Announcements"
            inset={false}
            style={FULL_BLEED}>
            {announcements.slice(0, 4).map((a, i, arr) => (
              <ListRow
                key={a.id}
                title={a.title}
                subtitle={a.body}
                last={i === arr.length - 1}
              />
            ))}
          </SectionCard>
        ) : null}

        <ResourceGrid unread={unread} />

        <SectionCard title="Event Description" style={FULL_BLEED}>
          <Text
            variant="body"
            tone="secondary"
            numberOfLines={expanded ? undefined : DESCRIPTION_COLLAPSED_LINES}>
            {EVENT_DESCRIPTION}
          </Text>

          {/*
            Whova puts this link under the paragraph, not in the section's title
            row, so it is drawn here rather than passed as `SectionCard`'s
            `actionLabel`. It keeps the underline for the same reason that one
            does: colour alone failing WCAG 1.4.1 on a text-only control.
          */}
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'See less of the event description' : 'See more of the event description'}
            accessibilityState={{ expanded }}
            hitSlop={{
              top: (HIT_TARGET - LINK_HEIGHT) / 2,
              bottom: (HIT_TARGET - LINK_HEIGHT) / 2,
              left: Spacing.sm,
              right: Spacing.sm,
            }}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              justifyContent: 'center',
              paddingVertical: Spacing.xs,
              minHeight: LINK_HEIGHT,
              opacity: pressed ? 0.4 : 1,
            })}>
            <Text
              variant="subhead"
              tone="tint"
              style={{ fontWeight: '600', textDecorationLine: 'underline' }}>
              {expanded ? 'See less' : 'See more'}
            </Text>
          </Pressable>
        </SectionCard>
      </ScrollView>
    </View>
  );
}

/**
 * The hero, the identity block and the time-zone strip, as one full-bleed white
 * card — which is how Whova draws them, with no gutter and no rounded corners,
 * so the artwork reaches both edges of the screen.
 *
 * The white logo card is `colors.onHeader` rather than `colors.surface`. The
 * lockup is fixed-ink artwork whose "KG" is near-navy and whose strapline is
 * dark grey; on a dark-mode surface (`#1C1C1E`) half of it disappears. Held at
 * white in both schemes it always reads, and `onHeader` is this palette's only
 * scheme-invariant white — the same reasoning that has `whova-header.tsx` reach
 * for `Brand.blueDark` instead of a themed fill.
 */
function EventBanner({ dateRange }: { dateRange: string }) {
  const colors = useTheme();

  return (
    <View style={{ backgroundColor: colors.surface }}>
      <View>
        <Image
          source={require('@/assets/images/hero-kgc.png')}
          style={{ width: '100%', height: HERO_HEIGHT }}
          resizeMode="cover"
          {...DECORATIVE}
        />

        <View
          style={{
            position: 'absolute',
            left: Spacing.md,
            bottom: Spacing.md,
            padding: LOGO_CARD_PADDING,
            borderRadius: Radius.md,
            backgroundColor: colors.onHeader,
          }}>
          <Image
            source={require('@/assets/images/kgc-logo.png')}
            style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
            resizeMode="contain"
            // The name is spelled out in live text immediately below, so the
            // artwork adds nothing a screen reader needs to hear twice.
            {...DECORATIVE}
          />
        </View>
      </View>

      {/*
        Sized against Whova on the same phone rather than against the HIG's
        largest available step. `title` (28pt) wrapped the event name onto two
        lines where Whova fits its own on one, and 17pt venue and date lines gave
        the block four tall rows before the first piece of actual information.
      */}
      <View style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2 }}>
        <Text variant="title2" accessibilityRole="header">
          {EVENT.name}
        </Text>
        <Text variant="subhead" tone="secondary">
          {EVENT.venue}
        </Text>
        {dateRange ? (
          <Text variant="subhead" tone="secondary">
            {dateRange}
          </Text>
        ) : null}
      </View>

      {/* Inset to the text column and `Spacing.md` clear of the right edge, like
          every other rule in the app. Nothing here runs to the screen edge. */}
      <View
        style={{
          height: HAIRLINE,
          backgroundColor: colors.separator,
          marginHorizontal: Spacing.md,
        }}
        {...DECORATIVE}
      />

      <TimeZoneStrip />
    </View>
  );
}

/**
 * Whova's time-zone strip, minus its "Switch" control — see departure 2 above.
 *
 * `mappin.and.ellipse` stands in for Whova's globe-and-clock: the icon table in
 * `components/icon.tsx` has no globe, and adding one is out of this screen's
 * scope. A pin is at least the right idea — the zone is the venue's, and the
 * strip is saying *whose* clock you are reading.
 *
 * Not a control, so it carries no `accessibilityLabel` of its own: the two lines
 * are ordinary text and the icon is `DECORATIVE`, which is exactly what a screen
 * reader should get.
 */
function TimeZoneStrip() {
  const colors = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
      }}>
      <Icon name="mappin.and.ellipse" size={18} color={colors.textSecondary} />
      {/*
        One line, as Whova's is. The second sentence — "Every time in this app is
        New York time, wherever you are reading it" — restated the first at
        greater length and cost three rows of height above the fold, on the
        screen that is supposed to answer "what is on next".
      */}
      <View style={{ flex: 1 }}>
        <Text variant="subhead">Displaying time in the event’s time zone</Text>
      </View>
    </View>
  );
}

/** One tile in the Additional Resources grid. */
interface Resource {
  label: string;
  onPress: () => void;
  /** Spoken after the label when the dot is showing. Presence turns the dot on. */
  badge?: string;
}

/**
 * Whova's "Additional Resources" — a three-across grid of bordered tiles.
 *
 * Text only, no icons: that is what the reference does, and at fifteen tiles a
 * glyph per tile would turn the block into a sticker sheet.
 *
 * ## The dots are real
 *
 * Whova shows a red dot on most of its tiles most of the time, which trains
 * people to ignore them. Exactly one tile here can earn one — Messages, when the
 * inbox actually has unread threads — because that is the only "new since you
 * last looked" signal the app currently computes. The dot is `DECORATIVE` and
 * the state is spoken through the tile's own label instead, so it is never
 * colour-only.
 *
 * ## Tile width is arithmetic, not a percentage
 *
 * React Native has no `calc()`, so `width: '33.33%'` plus a gap overflows the
 * row and drops the third tile onto its own line. The width is computed from the
 * window instead, subtracting the two gutters this card sits inside, the card's
 * own padding, and the two gaps between three tiles.
 */
function ResourceGrid({ unread }: { unread: number }) {
  const colors = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const contentWidth = width - CARD_PADDING * 2;
  const tileWidth = (contentWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  /** Anything with no screen behind it lands here, saying so. */
  const notBuilt = (title: string, detail: string) => () =>
    router.push({ pathname: '/home/coming-soon', params: { title, detail } });

  const resources: Resource[] = [
    {
      label: 'Session Q&A',
      onPress: () => router.push({ pathname: '/home/session-feature', params: { feature: 'qa' } }),
    },
    {
      label: 'Polls',
      onPress: () =>
        router.push({ pathname: '/home/session-feature', params: { feature: 'polls' } }),
    },
    // All of these used to push a bare `/people`, which opens on Attendees — so
    // every tile but one showed you something other than what you tapped.
    {
      label: 'Speakers',
      onPress: () => router.push({ pathname: '/people', params: { segment: 'speakers' } }),
    },
    {
      label: 'Sponsors',
      onPress: () => router.push({ pathname: '/people', params: { segment: 'sponsors' } }),
    },
    {
      label: 'Exhibitors',
      onPress: () => router.push({ pathname: '/people', params: { segment: 'exhibitors' } }),
    },
    { label: 'Attendees', onPress: () => router.push('/people') },
    { label: 'Community', onPress: () => router.push('/community') },
    { label: 'My schedule', onPress: () => router.push('/me/schedule') },
    {
      label: 'Messages',
      onPress: () => router.push({ pathname: '/messages', params: { from: 'home' } }),
      badge: unread ? `${unread} unread` : undefined,
    },
    { label: 'My profile', onPress: () => router.push('/me/profile') },
    {
      label: 'Documents',
      onPress: notBuilt(
        'Documents',
        'Slides and handouts are modelled as a materials subcollection on each ' +
          'session, but nothing writes to them yet and there is no screen that reads ' +
          'them. Once speakers can upload, this becomes the event-wide list.',
      ),
    },
    {
      label: 'Floormap',
      onPress: notBuilt(
        'Floormap',
        'Cornell Tech spans three buildings, so this needs real floor plans from the ' +
          'venue rather than a placeholder image. Rooms are in Firestore already; the ' +
          'plans are not.',
      ),
    },
    // Was a `notBuilt` tile saying this lived "on an event document that does
    // not exist yet — there is no events collection to read it from". Both
    // halves were false by the time anyone read them: the bag is
    // `settings/logistics`, it exists, and the dashboard's Emergency Manager
    // writes it weekly. Same stale-gap-copy defect as the Surveys tile below.
    { label: 'Logistics', onPress: () => router.push('/home/logistics') },
    {
      label: 'Photos',
      onPress: notBuilt(
        'Photos',
        'A shared photo stream needs Firebase Storage provisioned and moderation ' +
          'behind it. Neither is in place.',
      ),
    },
    // Was a `notBuilt` tile saying surveys waited on "the organizer console".
    // The console has authored them since August 2026; the copy outlived the gap
    // it described by several months, which is the defect class AGENTS.md counts.
    { label: 'Surveys', onPress: () => router.push('/home/surveys') },
    {
      label: 'Leaderboard',
      onPress: notBuilt(
        'Leaderboard',
        'Whova gamifies engagement with points for posting and scanning. Scoring ' +
          'has to be server-side to be worth anything, and Cloud Functions are ' +
          'blocked on the project moving to the Blaze plan.',
      ),
    },
  ];

  return (
    <SectionCard title="Additional Resources" style={FULL_BLEED}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
        {resources.map((r) => (
          <Pressable
            key={r.label}
            onPress={r.onPress}
            accessibilityRole="button"
            accessibilityLabel={r.badge ? `${r.label}, ${r.badge}` : r.label}
            style={({ pressed }) => ({
              width: tileWidth,
              minHeight: TILE_MIN_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: Spacing.sm,
              paddingVertical: Spacing.sm,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: Radius.sm,
              backgroundColor: pressed ? colors.surfacePressed : colors.surface,
            })}>
            <Text variant="callout" style={{ textAlign: 'center' }}>
              {r.label}
            </Text>

            {r.badge ? (
              <View
                style={{
                  position: 'absolute',
                  top: -BADGE_DOT / 2,
                  right: -BADGE_DOT / 2,
                  width: BADGE_DOT,
                  height: BADGE_DOT,
                  borderRadius: BADGE_DOT / 2,
                  backgroundColor: colors.dangerFill,
                }}
                {...DECORATIVE}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
    </SectionCard>
  );
}

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
 * `['2027-05-03', …, '2027-05-07']` → `May 3 – 7, 2027`.
 *
 * Derived from the agenda rather than stored, because `EVENT` in `@kgc/shared`
 * carries no dates and adding them there would create a second source of truth
 * for something the sessions already state. An empty or malformed list yields
 * `''` and the line is dropped, never a throw: this renders inside the banner,
 * where throwing unmounts the screen rather than blanking one label.
 */
function formatEventDates(days: string[]): string {
  const first = parseDay(days[0]);
  const last = parseDay(days[days.length - 1]);
  if (!first || !last) return '';

  if (first.y === last.y && first.m === last.m && first.d === last.d) {
    return `${MONTHS[first.m - 1]} ${first.d}, ${first.y}`;
  }
  if (first.y === last.y && first.m === last.m) {
    return `${MONTHS[first.m - 1]} ${first.d} – ${last.d}, ${first.y}`;
  }
  if (first.y === last.y) {
    return `${MONTHS[first.m - 1]} ${first.d} – ${MONTHS[last.m - 1]} ${last.d}, ${first.y}`;
  }
  return (
    `${MONTHS[first.m - 1]} ${first.d}, ${first.y} – ` +
    `${MONTHS[last.m - 1]} ${last.d}, ${last.y}`
  );
}

function parseDay(day: string | undefined): { y: number; m: number; d: number } | null {
  const [y, m, d] = (day ?? '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12) return null;
  return { y, m, d };
}
