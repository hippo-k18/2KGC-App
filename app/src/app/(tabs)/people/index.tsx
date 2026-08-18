import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { threadIdFor } from '@kgc/shared';

import { DECORATIVE } from '@/components/a11y';
import { Avatar } from '@/components/avatar';
import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { Chevron, Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { WhovaHeader } from '@/components/whova-header';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  searchAttendees,
  useDirectory,
  useSavedContacts,
  useInterests,
  useSpeakers,
  useSponsors,
  type DirectoryEntry,
  type Speaker,
  type Sponsor,
} from '@/lib/data/directory';
import { useAuth } from '@/lib/auth/auth-provider';

const SEGMENTS = ['Attendees', 'Speakers', 'Sponsors'] as const;

/**
 * Avatar in a directory row.
 *
 * 44, matching the list-row default — it was 52, which with 16pt of padding
 * above and below made an 84pt row, half again as tall as the one Whova draws.
 * (The comment here used to say "larger than the 44pt list-row default", which
 * this value now contradicts.)
 */
const ROW_AVATAR = 44;
/**
 * Drawn width of the A–Z rail.
 *
 * `Spacing.md`, which is also the row's right gutter — so the rail sits exactly
 * in the margin the rows already leave and never draws on top of their content.
 * It was 24, which put the strip 8pt over the "Say Hi" control as soon as the
 * rows stopped insetting themselves out of its way. iOS's own section index is
 * 15–20pt, so this is the platform's own figure rather than a value chosen to
 * make the arithmetic work.
 *
 * The *touch* target is unchanged at 44pt — `AlphabetRail` makes up the
 * difference with `hitSlop`, which is the whole point of drawing it small.
 */
const RAIL_WIDTH = Spacing.md;
/** Point size of a rail letter, held fixed — see `AlphabetRail`. */
const RAIL_LETTER = 11;
/** Minimum drawn height of one rail letter. The rail distributes the rest. */
const RAIL_LETTER_HEIGHT = 13;

/**
 * One item in the flattened directory list.
 *
 * A `SectionList` would express the A–Z sections more directly, but the index
 * rail has to turn a letter into a scroll position, and `scrollToLocation` on a
 * `SectionList` needs `getItemLayout` to be correct for *every* row — which it
 * cannot be, because these rows are text that grows with Dynamic Type. Flat
 * indices plus `scrollToIndex` with an `onScrollToIndexFailed` fallback works
 * whatever the rows actually measure.
 */
type Row =
  | { kind: 'index'; key: string; letter: string }
  | { kind: 'attendee'; key: string; person: DirectoryEntry }
  | { kind: 'speaker'; key: string; speaker: Speaker }
  | { kind: 'sponsor'; key: string; sponsor: Sponsor };

/**
 * People — attendees, speakers and sponsors as segments of one tab.
 *
 * Whova scatters these across three places, two of which are behind a tile grid
 * most attendees never open. They are the same question — "who is here?" — so
 * they belong behind one control.
 *
 * The layout is Whova's Attendees screen: blue header with the search field in
 * it, a "Browse attendees by" chip row, a count heading, then rows of avatar,
 * name, affiliation and category tags with an A–Z rail down the right edge.
 *
 * ## What is deliberately not here
 *
 * **"Recommended", and its red badge.** That is a matching service, not a
 * filter — there is no interest-similarity score anywhere in this data model.
 *
 * **Location.** `DirectoryDoc` carries name, title, company, photo and
 * interests, and nothing else; Whova's third grey line has no field behind it.
 *
 * "Say Hi" *is* here, because it is real: it opens the 1:1 thread with that
 * attendee, whose id is derived from the two uids and needs no lookup.
 */
export default function PeopleScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  /**
   * Which segment to open on, from `?segment=speakers|sponsors`.
   *
   * The home grid has separate Speakers, Sponsors and Attendees tiles, and all
   * three used to `router.push('/people')` — so two of the three took you
   * somewhere other than the thing you had just tapped, and the only clue was a
   * segmented control you then had to notice and change. Read once, as the
   * initial value: after that the control owns the state, and a tab you have
   * switched by hand should not jump back when the screen re-renders.
   */
  const { segment: segmentParam } = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState(
    segmentParam === 'speakers' ? 1 : segmentParam === 'sponsors' ? 2 : 0,
  );
  const [search, setSearch] = useState('');
  const [interest, setInterest] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const { people, loading, error: peopleError, retry: retryPeople } = useDirectory();
  const { isSaved, toggle: toggleBookmark } = useSavedContacts();
  // Whova's "Bookmarked" chip. Real, because the bookmark itself is real.
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const { speakers, error: speakersError, retry: retrySpeakers } = useSpeakers();
  const { sponsors, error: sponsorsError, retry: retrySponsors } = useSponsors();

  // One segment is visible at a time, and each reads a different collection, so
  // the error belongs to the segment rather than to the screen. Showing the
  // directory's failure while Sponsors is selected would be reporting on a query
  // nobody is looking at.
  const segmentError = segment === 0 ? peopleError : segment === 1 ? speakersError : sponsorsError;
  const retrySegment = segment === 0 ? retryPeople : segment === 1 ? retrySpeakers : retrySponsors;
  const segmentSubject =
    segment === 0 ? 'the attendee list' : segment === 1 ? 'the speaker list' : 'the sponsor list';
  const interests = useInterests(people);

  const visiblePeople = useMemo(() => {
    if (!people) return [];
    const found = searchAttendees(people, search, interest);
    // Applied after the search seam rather than inside it: bookmarks are a
    // per-user overlay on the directory, not a property of it, and
    // `searchAttendees` has to stay the one swappable implementation.
    return bookmarkedOnly ? found.filter((p) => isSaved(p.uid)) : found;
  }, [people, search, interest, bookmarkedOnly, isSaved]);

  const visibleSpeakers = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (speakers ?? []).filter(
      (s) => !n || s.name.toLowerCase().includes(n) || (s.company ?? '').toLowerCase().includes(n),
    );
  }, [speakers, search]);

  const visibleSponsors = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (sponsors ?? []).filter((s) => !n || s.name.toLowerCase().includes(n));
  }, [sponsors, search]);

  /**
   * The flat list, plus where each letter's section starts.
   *
   * Only the attendee segment is sectioned. Speakers are few enough to scroll,
   * and sponsors are ordered by tier — a commercial commitment that an
   * alphabetical rail would quietly reorder.
   */
  const { rows, letterIndex } = useMemo(() => {
    if (segment === 1) {
      return {
        rows: visibleSpeakers.map<Row>((s) => ({ kind: 'speaker', key: s.id, speaker: s })),
        letterIndex: new Map<string, number>(),
      };
    }
    if (segment === 2) {
      return {
        rows: visibleSponsors.map<Row>((s) => ({ kind: 'sponsor', key: s.id, sponsor: s })),
        letterIndex: new Map<string, number>(),
      };
    }

    const out: Row[] = [];
    const index = new Map<string, number>();
    let current = '';
    for (const person of visiblePeople) {
      const letter = initialLetter(person.name);
      if (letter !== current) {
        current = letter;
        index.set(letter, out.length);
        out.push({ kind: 'index', key: `index-${letter}`, letter });
      }
      out.push({ kind: 'attendee', key: person.id, person });
    }
    return { rows: out, letterIndex: index };
  }, [segment, visiblePeople, visibleSpeakers, visibleSponsors]);

  const count =
    segment === 0 ? visiblePeople.length : segment === 1 ? visibleSpeakers.length : visibleSponsors.length;

  const heading =
    segment === 0
      ? `${interest ?? 'All'} Attendees (${count})`
      : segment === 1
        ? `Speakers (${count})`
        : `Sponsors (${count})`;

  const railVisible = segment === 0 && letterIndex.size > 1;

  const jumpTo = (letter: string) => {
    const index = letterIndex.get(letter);
    if (index === undefined) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
  };

  /**
   * Changing what the list *is* has to return it to the top. Without this,
   * switching from a scrolled-to-the-Zs attendee list to Speakers keeps the
   * offset and opens on the last four names, which reads as a broken screen.
   */
  const toTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: false });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WhovaHeader
        title="People"
        userName={profile?.name ?? 'You'}
        userPhotoURL={profile?.photoURL}
        onProfilePress={() => router.push('/me')}
        actions={[
          {
            icon: 'envelope.fill',
            label: 'Messages',
            // `from` names the tab to come back to — see `messages/index.tsx`.
            onPress: () => router.push({ pathname: '/messages', params: { from: 'people' } }),
          },
        ]}
        search={{
          value: search,
          onChangeText: (next) => {
            setSearch(next);
            toTop();
          },
          placeholder: `Search ${SEGMENTS[segment].toLowerCase()}`,
        }}
        segments={{
          options: SEGMENTS,
          value: segment,
          onChange: (next) => {
            setSegment(next);
            setInterest(null);
            toTop();
          },
        }}
      />

      {/*
        Air under the blue chrome. Whova leaves 20pt here and we left none, which
        is what made three headings and a chip row read as 129pt of one crowded
        band with no way in.
      */}
      <View style={{ height: Spacing.md }} {...DECORATIVE} />

      <View style={{ backgroundColor: colors.surface }}>
        {segment === 0 && interests.length ? (
          <>
            <Text
              variant="heading"
              accessibilityRole="header"
              style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.sm + Spacing.xs }}>
              Browse attendees by
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.sm + Spacing.xs,
                gap: Spacing.sm,
              }}>
              <FilterChip
                label="All"
                role="tab"
                selected={interest === null && !bookmarkedOnly}
                onPress={() => {
                  setInterest(null);
                  setBookmarkedOnly(false);
                  toTop();
                }}
              />
              <FilterChip
                label="Bookmarked"
                role="tab"
                selected={bookmarkedOnly}
                onPress={() => {
                  setBookmarkedOnly((on) => !on);
                  setInterest(null);
                  toTop();
                }}
              />
              {interests.map((i) => (
                <FilterChip
                  key={i}
                  label={i}
                  role="tab"
                  selected={interest === i}
                  onPress={() => {
                    setInterest(interest === i ? null : i);
                    toTop();
                  }}
                />
              ))}
            </ScrollView>

            {/* Whova rules off the chip row before the count heading. Without
                it the chips and "All Attendees (n)" are one undifferentiated
                stack, and the chips are a control while the heading is a label. */}
            <View
              style={{ height: HAIRLINE, backgroundColor: colors.separator }}
              {...DECORATIVE}
            />
          </>
        ) : null}

        <Text
          variant="title3"
          accessibilityRole="header"
          style={{
            paddingHorizontal: Spacing.md,
            // A full gutter above the count, always. It used to be 0 whenever
            // the chip row was showing, which put a 20pt heading 12pt under a
            // row of pills with no rule between them.
            paddingTop: Spacing.md,
            paddingBottom: Spacing.sm + Spacing.xs,
          }}>
          {heading}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          // `flexGrow`, so searching for nonsense centres "No matches" in the
          // list rather than leaving 286pt of void under it.
          contentContainerStyle={{ flexGrow: 1, paddingBottom: Spacing.xxl }}
          // Without `getItemLayout` — which text that grows with Dynamic Type
          // makes impossible to state honestly — a jump past the render window
          // fails. Land on the estimate, then take the exact index once the rows
          // there have mounted.
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(
              () => listRef.current?.scrollToIndex({ index: info.index, animated: false }),
              60,
            );
          }}
          renderItem={({ item }) => {
            if (item.kind === 'index') return <IndexHeader letter={item.letter} />;

            if (item.kind === 'speaker') {
              const s = item.speaker;
              return (
                <DirectoryRow
                  name={s.name}
                  photoURL={s.photoURL}
                  lines={[s.title, s.company]}
                  tags={
                    s.sessionIds?.length
                      ? [`${s.sessionIds.length} session${s.sessionIds.length > 1 ? 's' : ''}`]
                      : []
                  }
                  onPress={
                    // A speaker who also holds a ticket gets the richer attendee
                    // card — it carries their interests and a Message button,
                    // neither of which exists for someone with no account. Every
                    // other speaker gets the speaker screen, which reads the
                    // `speakers` document directly. None of the forty-five seeded
                    // speakers has a `userId`, so before that second route
                    // existed this whole segment was inert.
                    s.userId
                      ? () => router.push({ pathname: '/people/[uid]', params: { uid: s.userId! } })
                      : () => router.push({ pathname: '/people/speaker/[id]', params: { id: s.id } })
                  }
                />
              );
            }

            if (item.kind === 'sponsor') {
              const s = item.sponsor;
              return (
                <DirectoryRow
                  name={s.name}
                  photoURL={s.logoURL}
                  lines={[
                    s.tier[0].toUpperCase() + s.tier.slice(1),
                    s.boothLocation ? `Booth ${s.boothLocation}` : undefined,
                  ]}
                  tags={s.offers?.slice(0, 2) ?? []}
                  onPress={() =>
                    router.push({ pathname: '/people/sponsor/[id]', params: { id: s.id } })
                  }
                />
              );
            }

            const p = item.person;
            const isMe = p.uid === user?.uid;
            return (
              <DirectoryRow
                name={isMe ? `${p.name} (you)` : p.name}
                photoURL={p.photoURL}
                lines={[p.title, p.company]}
                tags={p.interests ?? []}
                onPress={() => router.push({ pathname: '/people/[uid]', params: { uid: p.uid } })}
                onSayHi={
                  user && !isMe
                    ? // Pushing out of the tab group into `messages` hoists the
                      // params onto the root-level `messages` route as well as
                      // the leaf, so expo-router serialises the id twice:
                      // `/messages/<id>?threadId=<id>&to=<uid>`. Spelling the
                      // path out by hand does not avoid it — the URL is rebuilt
                      // from the navigation state, not from what was pushed —
                      // and both copies parse to the same value, so this stays
                      // in the form the router documents.
                      () =>
                        router.push({
                          pathname: '/messages/[threadId]',
                          params: { threadId: threadIdFor(user.uid, p.uid), to: p.uid },
                        })
                    : undefined
                }
                sayHiName={p.name}
                bookmarked={isSaved(p.uid)}
                onBookmark={user && p.uid !== user.uid ? () => toggleBookmark(p.uid) : undefined}
              />
            );
          }}
          ListEmptyComponent={
            // The error branch comes first, and it is the reason this component
            // exists in its current shape: "Nobody here yet — attendees appear
            // here as they join and opt in" is what a `permission-denied` on the
            // directory used to render, which is a confident, false, reassuring
            // account of a thousand-person conference.
            segmentError ? (
              <DataError
                error={segmentError}
                subject={segmentSubject}
                onRetry={retrySegment}
              />
            ) : loading ? null : (
              <EmptyState
                icon="person.2"
                title={search || interest ? 'No matches' : 'Nobody here yet'}
                message={
                  search || interest
                    ? 'Try a different name, company or category.'
                    : 'Attendees appear here as they join and opt in.'
                }
              />
            )
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />

        {railVisible ? <AlphabetRail letters={[...letterIndex.keys()]} onJump={jumpTo} /> : null}
      </View>
    </View>
  );
}

/**
 * One directory row, in Whova's shape: photo, name, two grey affiliation lines,
 * category tags, a chevron at the top right and "Say Hi" at the bottom right.
 *
 * The tags are the attendee's `interests`, which is what this app has where
 * Whova has "Organizers / Exhibitors / Speakers". They are capped at two with a
 * "+N more" tail, because a data scientist with nine interests would otherwise
 * push the next attendee off the screen.
 *
 * "Say Hi" is a `Pressable` inside the row's own `Pressable`. That nests two
 * targets, so the inner one gets no `hitSlop` on its left edge — slop there
 * would extend the message affordance under the company name, and tapping a
 * name is meant to open a profile.
 *
 * ## The row does not make room for the A–Z rail
 *
 * It used to: `paddingRight` was `Spacing.md + RAIL_WIDTH`, 40pt, which left the
 * text column 197pt on a 393pt screen and pushed a second interest chip onto its
 * own line — 32pt per row, on every row, to keep clear of a 24pt strip that only
 * one of the three segments even draws. `AlphabetRail` is `position: 'absolute'`
 * and `pointerEvents="box-none"`, so it costs the layout nothing; the row takes
 * an ordinary `Spacing.md` gutter and the rail floats over its last 24pt, which
 * is what Whova does too.
 */
function DirectoryRow({
  name,
  photoURL,
  lines,
  tags,
  onPress,
  onSayHi,
  sayHiName,
  onBookmark,
  bookmarked,
}: {
  name: string;
  photoURL?: string;
  lines: (string | undefined)[];
  tags: string[];
  onPress?: () => void;
  onSayHi?: () => void;
  sayHiName?: string;
  onBookmark?: () => void;
  bookmarked?: boolean;
}) {
  const colors = useTheme();
  const shown = tags.slice(0, 2);
  const extra = tags.length - shown.length;
  const detail = lines.filter(Boolean) as string[];

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm + Spacing.xs,
        paddingLeft: Spacing.md,
        paddingRight: Spacing.md,
        // 12 with a 44pt avatar gives a 68pt row; it was 16 with 52, which is
        // 84 — half again as tall as the directory row Whova draws.
        paddingVertical: Spacing.md - Spacing.xs,
      }}>
      <Avatar name={name} photoURL={photoURL} size={ROW_AVATAR} />

      <View style={{ flex: 1, gap: Spacing.xs }}>
        <Text variant="heading" numberOfLines={2}>
          {name}
        </Text>
        {detail.map((line) => (
          <Text key={line} variant="subhead" tone="secondary" numberOfLines={2}>
            {line}
          </Text>
        ))}

        {/*
          Wraps, and each tag also shrinks. Whova's tags are single words
          ("Exhibitors", "Speakers") and always fit on one line; KGC's interests
          are phrases ("Natural Language Processing"), so forcing one line
          truncated *both* of them to "Health C… | Data Architec…", which is
          worse than a second line. Wrapping keeps short pairs inline and gives a
          long label a line of its own; `flexShrink` plus `numberOfLines` is the
          backstop for a single tag wider than the whole column. The row's
          `accessibilityLabel` below carries every tag in full either way.
        */}
        {shown.length ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: Spacing.xs + 2,
              paddingTop: Spacing.xs,
            }}>
            {shown.map((tag) => (
              <View
                key={tag}
                style={{
                  flexShrink: 1,
                  borderWidth: HAIRLINE,
                  borderColor: colors.border,
                  borderRadius: Radius.sm,
                  paddingHorizontal: Spacing.sm,
                  paddingVertical: Spacing.xs,
                }}>
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {tag}
                </Text>
              </View>
            ))}
            {extra > 0 ? (
              <Text variant="caption" tone="tertiary" numberOfLines={1}>
                + {extra} more
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.md }}>
        {onPress ? (
          <View {...DECORATIVE}>
            <Chevron />
          </View>
        ) : (
          <View style={{ width: 16 }} {...DECORATIVE} />
        )}

        {onBookmark ? (
          <Pressable
            onPress={onBookmark}
            accessibilityRole="button"
            accessibilityState={{ selected: bookmarked }}
            accessibilityLabel={
              bookmarked
                ? `Remove ${sayHiName ?? 'this attendee'} from your bookmarks`
                : `Bookmark ${sayHiName ?? 'this attendee'}`
            }
            hitSlop={Spacing.sm}
            style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1 })}>
            <Icon
              name={bookmarked ? 'star.fill' : 'star'}
              size={20}
              color={bookmarked ? colors.tint : colors.textTertiary}
            />
          </Pressable>
        ) : null}

        {onSayHi ? (
          <Pressable
            onPress={onSayHi}
            accessibilityRole="button"
            accessibilityLabel={sayHiName ? `Say hi to ${sayHiName}` : 'Say hi'}
            accessibilityHint="Opens a message thread"
            hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: 0, right: Spacing.sm }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.xs + 2,
              paddingVertical: Spacing.xs,
              minHeight: HIT_TARGET - Spacing.md,
              opacity: pressed ? 0.4 : 1,
            })}>
            <Icon name="bubble.left" size={16} color={colors.tint} />
            <Text variant="subhead" tone="tint" numberOfLines={1}>
              Say Hi
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  /*
    Inset left to the text column, `Spacing.md` clear of the right edge — the
    one separator rule. A `borderBottomWidth` on the row itself cannot be inset,
    which is why this is a drawn hairline rather than a border.
  */
  const rule = (
    <View
      style={{
        height: HAIRLINE,
        backgroundColor: colors.separator,
        marginLeft: Spacing.md + ROW_AVATAR + Spacing.sm + Spacing.xs,
        marginRight: Spacing.md,
      }}
      {...DECORATIVE}
    />
  );

  if (!onPress) {
    return (
      <View style={{ backgroundColor: colors.surface }}>
        {body}
        {rule}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[name, ...detail, ...tags].join(', ')}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfacePressed : colors.surface,
      })}>
      {body}
      {rule}
    </Pressable>
  );
}

/** The grey "A" band between sections. A real header, so the rotor can reach it. */
function IndexHeader({ letter }: { letter: string }) {
  const colors = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs + 2,
        backgroundColor: colors.groupedBackground,
      }}>
      <Text variant="label" tone="secondary" accessibilityRole="header">
        {letter}
      </Text>
    </View>
  );
}

/**
 * The A–Z index down the right edge.
 *
 * ## It is a real control, not decoration
 *
 * The obvious way to build this is a column of tiny `Text`s, which is what makes
 * every implementation of it unusable with a screen reader: 26 unlabelled
 * single characters between the search field and the list. Each letter here is a
 * button labelled "Jump to A", the rail itself is a `tablist`-free plain group
 * with its own label, and the letters are only those the visible list actually
 * contains — jumping to a letter nobody's surname starts with is a dead control,
 * and a dead control is worse than a missing one.
 *
 * ## Targets
 *
 * A letter is drawn at 13pt tall, because 26 of them at 44 would be 1,144pt on a
 * 852pt screen. The rail stretches to the list's full height and distributes the
 * letters through it, so with the ~15 letters a real directory produces each one
 * gets 40–50pt of vertical space; `hitSlop` extends every letter 20pt to the
 * left, which puts the horizontal target at exactly 44 even though the drawn
 * strip is 24 wide. It used to add another `RAIL_WIDTH` on the right as well,
 * which reached past the screen edge and did nothing except make the target 68
 * wide — 24pt of it lying over the rows' own "Say Hi" control, now that the rows
 * no longer inset themselves out of the rail's way. Vertical slop is zero:
 * adjacent letters share an edge, and overlapping targets in a list of 26 would
 * mean the letter you land on is not the letter you pressed.
 *
 * ## The one place text does not scale
 *
 * `allowFontScaling={false}`, for the same reason `Avatar` does it: the rail is
 * a fixed-height column that cannot grow, and at the largest accessibility sizes
 * 26 letters at 25pt would be twice the height of the phone. Nothing is lost —
 * the rail is an accelerator for a list that is fully navigable without it, and
 * the list's own text scales normally.
 */
function AlphabetRail({ letters, onJump }: { letters: string[]; onJump: (letter: string) => void }) {
  const colors = useTheme();

  return (
    <View
      pointerEvents="box-none"
      accessible={false}
      accessibilityLabel="Alphabet index"
      style={{
        position: 'absolute',
        top: Spacing.sm,
        bottom: Spacing.sm,
        right: 0,
        width: RAIL_WIDTH,
        alignItems: 'center',
        justifyContent: 'space-evenly',
      }}>
      {letters.map((letter) => (
        <Pressable
          key={letter}
          onPress={() => onJump(letter)}
          accessibilityRole="button"
          accessibilityLabel={`Jump to ${letter === '#' ? 'other' : letter}`}
          hitSlop={{ top: 0, bottom: 0, left: HIT_TARGET - RAIL_WIDTH, right: 0 }}
          style={({ pressed }) => ({
            width: RAIL_WIDTH,
            minHeight: RAIL_LETTER_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.4 : 1,
          })}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: RAIL_LETTER, lineHeight: RAIL_LETTER + 2, fontWeight: '600', color: colors.tint }}>
            {letter}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** First letter of a name, with everything non-alphabetic collected under "#". */
function initialLetter(name: string): string {
  const first = name.trim()[0]?.toUpperCase() ?? '#';
  return first >= 'A' && first <= 'Z' ? first : '#';
}
