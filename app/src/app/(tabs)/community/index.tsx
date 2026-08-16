import { useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Timestamp } from '@kgc/shared';

import { DECORATIVE } from '@/components/a11y';
import { CategoryTile, type CategoryTint } from '@/components/category-tile';
import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { Chevron, Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { WhovaHeader } from '@/components/whova-header';
import { HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAnnouncements } from '@/lib/data/announcements';
import {
  CATEGORIES,
  categoryLabel,
  createPost,
  useCommunityPosts,
  type Post,
} from '@/lib/data/community';

/**
 * Decoration for each of the six categories in `lib/data/community.ts`.
 *
 * Keyed by the category id rather than folded into `CATEGORIES` itself, because
 * that list lives in the data layer and an icon name is a presentation concern —
 * the importer and any future Cloud Function read those ids too and have no
 * business knowing what a `storefront` is.
 *
 * The glyphs are chosen to be distinguishable in *shape*, not just in hue: the
 * tints are the second signal, never the only one. Whova's own board uses the
 * same idea — red megaphone for organizer posts, blue speech bubbles for
 * discussion, purple storefront for exhibitors.
 */
const CATEGORY_STYLE: Record<string, { icon: IconName; tint: CategoryTint }> = {
  meetup: { icon: 'person.2.fill', tint: 'amber' },
  'ride-share': { icon: 'mappin.and.ellipse', tint: 'teal' },
  jobs: { icon: 'storefront', tint: 'purple' },
  questions: { icon: 'questionmark.circle', tint: 'green' },
  'lost-and-found': { icon: 'exclamationmark.triangle', tint: 'orange' },
  'ice-breakers': { icon: 'bubble.left.and.bubble.right', tint: 'blue' },
};

/** Fallback for a category id that predates or postdates this table. */
const DEFAULT_STYLE = { icon: 'bubble.left' as IconName, tint: 'blue' as CategoryTint };

/**
 * How the board is ordered.
 *
 * These sort the *loaded page* — `useCommunityPosts` fetches the newest 50 in
 * `createdAt desc` and this reorders those in memory. That is honest for a board
 * of this size and needs no second composite index; if the board ever outgrows
 * one page, sorting has to move into the query and each option needs its own
 * index entry before it can ship.
 */
const SORTS = [
  { id: 'newest', label: 'Newest', compare: (a: Post, b: Post) => millis(b.createdAt) - millis(a.createdAt) },
  { id: 'replies', label: 'Most Replies', compare: (a: Post, b: Post) => b.replyCount - a.replyCount },
  { id: 'liked', label: 'Most Liked', compare: (a: Post, b: Post) => b.reactionCount - a.reactionCount },
] as const;

type SortId = (typeof SORTS)[number]['id'];

/**
 * The community board.
 *
 * Whova's Community tab is a list of topic rows: a coloured category square, a
 * pin on the boards the organizers run, a title, one line of the newest content
 * in it, and a metadata line of counts. This reproduces that shape over the data
 * this app actually has — one row per post, decorated by its category.
 *
 * ## What is deliberately not here
 *
 * **Whova's four filter chips** are All / Following / From organizers / New.
 * Three of them need state this app does not store: there is no post-follow
 * collection, no author role on a post, and nothing recording what you have
 * already read. The chips here are the six real categories instead, which is
 * what `useCommunityPosts` can actually filter on.
 *
 * **The "⊕ Follow" pill** at the right of every Whova row is absent for the same
 * reason. `components/follow-button.tsx` exists and is ready, but nothing in the
 * data model can answer "am I following this?" — a pill that toggled local state
 * and forgot it on the next render is worse than no pill, because it silently
 * promises notifications that will never arrive.
 *
 * **"(N New)" in red** needs a per-attendee last-read marker. Same story.
 *
 * Categories are fixed rather than free-form, which is what keeps a board of
 * this size navigable — "ride share" and "travel" as separate user-invented
 * topics is how these turn into noise by day two.
 */
export default function CommunityScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortId>('newest');
  const [sorting, setSorting] = useState(false);
  const [composing, setComposing] = useState(false);
  const listRef = useRef<FlatList<Post>>(null);

  const { posts, loading } = useCommunityPosts(category);
  const announcements = useAnnouncements();

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const compare = SORTS.find((s) => s.id === sort)!.compare;
    return (posts ?? [])
      .filter((p) => !needle || p.title.toLowerCase().includes(needle))
      .sort(compare);
  }, [posts, search, sort]);

  const sortLabel = SORTS.find((s) => s.id === sort)!.label;

  // Changing the filter, the query or the order changes what the list *is*; a
  // retained scroll offset then opens it halfway down a different board.
  const toTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: false });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WhovaHeader
        title="Community"
        userName={profile?.name ?? 'You'}
        userPhotoURL={profile?.photoURL}
        onProfilePress={() => router.push('/me')}
        actions={[
          { icon: 'envelope.fill', label: 'Messages', onPress: () => router.push('/messages') },
        ]}
        search={{
          value: search,
          onChangeText: (next) => {
            setSearch(next);
            toTop();
          },
          placeholder: 'Search topic title',
        }}
      />

      {/* Whova's chip row sits on the page, not in the blue — see the note above
          about why these are categories rather than All / Following / New. */}
      <View style={{ backgroundColor: colors.surface }}>
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
            selected={category === null}
            onPress={() => {
              setCategory(null);
              toTop();
            }}
          />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.id}
              label={c.label}
              role="tab"
              selected={category === c.id}
              onPress={() => {
                setCategory(category === c.id ? null : c.id);
                toTop();
              }}
            />
          ))}
        </ScrollView>

        {/* "Sort by: Newest Reply ▾" — Whova's row. Its right-hand
            "💡 Suggestions" needs a recommendation service and is omitted. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: Spacing.sm,
            paddingHorizontal: Spacing.md,
            paddingBottom: Spacing.sm + Spacing.xs,
          }}>
          <Pressable
            onPress={() => setSorting(true)}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${sortLabel}`}
            accessibilityHint="Opens the sort options"
            hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.xs,
              opacity: pressed ? 0.4 : 1,
            })}>
            <Text variant="subhead" tone="secondary">
              Sort by:
            </Text>
            <Text variant="subhead" style={{ fontWeight: '600' }}>
              {sortLabel}
            </Text>
            <Icon name="chevron.down" size={14} color={colors.textSecondary} />
          </Pressable>

          <Text variant="subhead" tone="tertiary">
            {visible.length} {visible.length === 1 ? 'topic' : 'topics'}
          </Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: Spacing.lg }}
        ListHeaderComponent={
          // The one pinned board, and the only genuinely pinned thing this app
          // has: organizer broadcasts. Whova pins the same row at the top of
          // its board and calls it "Organizer Announcements".
          !category && !search.trim() && announcements.length ? (
            <TopicRow
              icon="megaphone"
              tint="red"
              pinned
              caption={`Last announcement ${relative(announcements[0].createdAt)}`}
              title="Organizer Announcements"
              preview={announcements[0].title}
              meta={`${announcements.length} ${announcements.length === 1 ? 'Announcement' : 'Announcements'}`}
              onPress={() => router.push('/community/announcements')}
            />
          ) : null
        }
        renderItem={({ item }) => {
          const style = CATEGORY_STYLE[item.category] ?? DEFAULT_STYLE;
          return (
            <TopicRow
              icon={style.icon}
              tint={style.tint}
              caption={`Posted ${relative(item.createdAt)}`}
              title={item.title}
              preview={item.body}
              meta={[
                replyLabel(item.replyCount),
                item.reactionCount ? `${item.reactionCount} Likes` : null,
                categoryLabel(item.category),
              ]
                .filter(Boolean)
                .join('  ·  ')}
              onPress={() =>
                router.push({ pathname: '/community/[id]', params: { id: item.id } })
              }
            />
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="bubble.left.and.bubble.right"
              title={search.trim() ? 'No matching topics' : category ? 'Nothing here yet' : 'No topics yet'}
              message={
                search.trim()
                  ? 'Try a different word from the topic title.'
                  : 'Start a meet-up, ask a question, or offer a ride from the tram.'
              }
            />
          )
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      {/* Whova's blue CTA, pinned above the tab bar. Its left-hand trophy square
          opens a gamification leaderboard that does not exist here. */}
      {user ? (
        <View
          style={{
            padding: Spacing.md,
            borderTopWidth: HAIRLINE,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          }}>
          <Pressable
            onPress={() => setComposing(true)}
            accessibilityRole="button"
            accessibilityLabel="Add topic"
            accessibilityHint="Opens the composer for a new community topic"
            style={({ pressed }) => ({
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: HIT_TARGET + Spacing.xs,
              paddingVertical: Spacing.sm + Spacing.xs,
              borderRadius: Radius.md,
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1,
            })}>
            <Text variant="heading" tone="onAccent">
              Add Topic
            </Text>
          </Pressable>
        </View>
      ) : null}

      <SortSheet
        visible={sorting}
        value={sort}
        onClose={() => setSorting(false)}
        onSelect={(next) => {
          setSort(next);
          setSorting(false);
          toTop();
        }}
      />

      <Composer
        visible={composing}
        onClose={() => setComposing(false)}
        onSubmit={async (title, body, cat) => {
          if (!user) return;
          await createPost({ authorId: user.uid, category: cat, title, body });
          setComposing(false);
        }}
      />
    </View>
  );
}

/**
 * One row of Whova's board.
 *
 * Full-bleed white with an edge-to-edge separator rather than the inset grouped
 * card `ListRow` draws, because that is what the reference does and because the
 * row has three bands — caption, tile + text, metadata — which `ListRow`'s
 * single text column cannot express.
 *
 * The metadata line starts at the *left gutter*, not at the text column, which
 * looks like a mistake until you compare it against Whova and see that it is
 * exactly what Whova does. It reads as a footer for the row rather than as a
 * third subtitle.
 *
 * Nothing carries a fixed `height`: every band is text that must be free to grow
 * with Dynamic Type. The tile and the pin are `DECORATIVE` — the title beside
 * them already says which board this is, and the pin's meaning is carried into
 * the row's spoken label instead of being announced as "push pin".
 */
function TopicRow({
  icon,
  tint,
  pinned,
  caption,
  title,
  preview,
  meta,
  onPress,
}: {
  icon: IconName;
  tint: CategoryTint;
  pinned?: boolean;
  caption: string;
  title: string;
  preview?: string;
  meta: string;
  onPress: () => void;
}) {
  const colors = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[pinned ? 'Pinned' : null, title, preview, meta].filter(Boolean).join('. ')}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        borderBottomWidth: HAIRLINE,
        borderBottomColor: colors.separator,
      })}>
      <View style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, gap: Spacing.sm }}>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {caption}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm + Spacing.xs }}>
          <CategoryTile icon={icon} tint={tint} />
          {pinned ? (
            <Icon name="pin.fill" size={16} color={colors.textSecondary} style={{ marginTop: 4 }} />
          ) : null}

          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={2}>
              {title}
            </Text>
            {preview ? (
              <Text variant="subhead" tone="tertiary" numberOfLines={1}>
                {preview}
              </Text>
            ) : null}
          </View>

          <View style={{ paddingTop: Spacing.xs }} {...DECORATIVE}>
            <Chevron />
          </View>
        </View>

        <Text variant="subhead" tone="secondary" numberOfLines={2}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

/** Whova's "Sort by" dropdown, as a sheet — a menu anchored to a link is not a thing React Native gives you. */
function SortSheet({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: SortId;
  onClose: () => void;
  onSelect: (next: SortId) => void;
}) {
  const colors = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close sort options"
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <Pressable
          // Swallows the backdrop's press without becoming a control itself.
          onPress={() => {}}
          accessible={false}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.lg,
            borderTopRightRadius: Radius.lg,
            paddingVertical: Spacing.sm,
          }}>
          <Text
            variant="label"
            tone="secondary"
            accessibilityRole="header"
            style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
            SORT BY
          </Text>
          {SORTS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => onSelect(option.id)}
              accessibilityRole="menuitem"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: option.id === value }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: Spacing.sm,
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.sm + Spacing.xs,
                minHeight: HIT_TARGET,
                backgroundColor: pressed ? colors.surfacePressed : 'transparent',
              })}>
              <Text tone={option.id === value ? 'tint' : 'primary'}>{option.label}</Text>
              {option.id === value ? (
                <Icon name="checkmark.circle.fill" size={20} color={colors.tint} />
              ) : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Composer({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (title: string, body: string, category: string) => Promise<void>;
}) {
  const colors = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0].id);
  const [busy, setBusy] = useState(false);

  const field = {
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background, padding: Spacing.md, gap: Spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={12}>
            <Text tone="tint">Cancel</Text>
          </Pressable>
          <Text variant="heading">New topic</Text>
          <Pressable
            disabled={busy || !title.trim() || !body.trim()}
            onPress={async () => {
              setBusy(true);
              try {
                await onSubmit(title.trim(), body.trim(), category);
                setTitle('');
                setBody('');
              } finally {
                setBusy(false);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Post topic"
            accessibilityState={{ disabled: busy || !title.trim() || !body.trim() }}
            hitSlop={12}>
            <Text tone="tint" style={{ opacity: title.trim() && body.trim() ? 1 : 0.4 }}>
              Post
            </Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.sm }}>
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.id}
              label={c.label}
              selected={category === c.id}
              onPress={() => setCategory(c.id)}
            />
          ))}
        </ScrollView>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={colors.textTertiary}
          style={field}
          accessibilityLabel="Post title"
          maxLength={120}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Say a bit more…"
          placeholderTextColor={colors.textTertiary}
          style={[field, { minHeight: 140, textAlignVertical: 'top' }]}
          multiline
          accessibilityLabel="Post body"
          maxLength={2000}
        />
      </View>
    </Modal>
  );
}

function replyLabel(count: number): string {
  if (!count) return 'No replies yet';
  return `${count} ${count === 1 ? 'Reply' : 'Replies'}`;
}

/** Milliseconds, tolerating a `serverTimestamp()` that has not resolved yet. */
function millis(t: Timestamp | undefined): number {
  return t?.toMillis?.() ?? 0;
}

/**
 * "3 months ago". Deliberately not `date-fns`: nothing else in the app imports
 * it, Metro does not tree-shake, and this is nine lines of arithmetic against
 * about 20 KB of bundle.
 *
 * A pending `serverTimestamp()` reads as "just now" rather than "56 years ago",
 * which is what a zero epoch would give between the local write and the server's
 * acknowledgement.
 */
export function relative(t: Timestamp | undefined): string {
  const ms = millis(t);
  if (!ms) return 'just now';
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
  ];
  let value = seconds;
  for (const [size, name] of units) {
    if (value < size) {
      const n = Math.max(1, Math.floor(value));
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
    value /= size;
  }
  const years = Math.max(1, Math.floor(value));
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
