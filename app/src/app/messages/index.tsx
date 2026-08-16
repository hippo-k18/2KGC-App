import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { differenceInCalendarDays, format } from 'date-fns';

import type { Timestamp } from '@kgc/shared';

import { DECORATIVE } from '@/components/a11y';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { EVENT } from '@/config/event';
import { AVATAR_SIZE, HAIRLINE, HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useDirectory } from '@/lib/data/directory';
import { otherParticipant, totalUnread, useThreads } from '@/lib/data/messages';

/** Whova's inbox avatar is larger than a settings row's. */
const INBOX_AVATAR = AVATAR_SIZE + Spacing.sm; // 52
/** Unread pill on the avatar. A fixed circle, so its digits do not scale freely. */
const BADGE_HEIGHT = 20;
/** Gap between the avatar and the text column. */
const GUTTER = Spacing.md - Spacing.xs; // 12

/**
 * The inbox.
 *
 * Whova's row, closely: avatar on the left with the unread count pinned to it,
 * the correspondent's name, the event the conversation came through, a preview
 * of the last message, and the date on the right. The count sits on the avatar
 * rather than in a trailing slot because that is where the eye already is — you
 * scan an inbox down the left edge, and a badge on the right is found only after
 * you have read the name you were not looking for.
 *
 * ## What is deliberately not Whova here
 *
 * **The notification banner.** Whova opens this screen with a cream strip
 * offering to turn on push. This app has no push — `fcmTokens` and
 * `PushTokenDoc` are modelled and nothing writes to them, and push needs a
 * development build that Expo Go cannot receive (`AGENTS.md`, "Known gaps"). A
 * button that cannot do the thing it names is worse than no button, so the strip
 * stays in the layout and tells the truth instead: messages are only seen in the
 * app. It disappears for the rest of the session once dismissed.
 *
 * **The avatar is round, not square.** `Avatar` draws a circle and is a shared
 * component this screen does not own.
 */
export default function MessagesScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { threads, loading } = useThreads(user?.uid);
  const { people } = useDirectory();
  // Session-scoped, not persisted: a preference this small is not worth a
  // storage round trip on launch, and the strip is one line of standing fact
  // rather than a nag.
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const unread = totalUnread(threads, user?.uid);
  const personFor = (uid: string) => people?.find((p) => p.uid === uid);
  const nameFor = (uid: string) => personFor(uid)?.name ?? 'Attendee';

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen
        options={{
          // Whova puts the unread count in the title. Dropped when it is zero,
          // because "Messages (0)" is noise.
          title: unread ? `Messages (${unread})` : 'Messages',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/people')}
              accessibilityRole="button"
              accessibilityLabel="New message"
              accessibilityHint="Opens the attendee list to choose someone"
              hitSlop={Spacing.md}
              style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1 })}>
              <Icon name="square.and.pencil" size={22} color={colors.onHeader} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        data={threads ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: Spacing.xxl }}
        ListHeaderComponent={
          noticeDismissed ? null : <DeliveryNotice onDismiss={() => setNoticeDismissed(true)} />
        }
        renderItem={({ item, index }) => {
          const other = otherParticipant(item, user?.uid ?? '');
          return (
            <ThreadRow
              name={nameFor(other)}
              photoURL={personFor(other)?.photoURL}
              preview={item.lastMessage}
              unread={item.unread?.[user?.uid ?? ''] ?? 0}
              at={item.lastMessageAt}
              last={index === (threads?.length ?? 0) - 1}
              onPress={() =>
                router.push({
                  pathname: '/messages/[threadId]',
                  params: { threadId: item.id, to: other },
                })
              }
            />
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="envelope"
              title="No messages"
              message="Find someone in Attendees and say hello."
            />
          )
        }
      />
    </View>
  );
}

/**
 * The strip Whova uses to sell push, saying something this app can deliver.
 *
 * Dismissed with a labelled text button rather than Whova's grey ✕: `icon.tsx`
 * carries no close glyph, and adding one is not this screen's call — a 44pt
 * "Dismiss" is a better target than a 20pt ✕ anyway.
 */
function DeliveryNotice({ onDismiss }: { onDismiss: () => void }) {
  const colors = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        padding: Spacing.md,
        backgroundColor: colors.banner,
      }}>
      <Icon
        name="exclamationmark.triangle"
        size={20}
        color={colors.onBanner}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1, gap: Spacing.xs }}>
        <Text variant="heading" style={{ color: colors.onBanner }}>
          New messages only appear here, in the app.
        </Text>
        <Text variant="subhead" style={{ color: colors.onBanner }}>
          {EVENT.shortName} does not send push notifications yet, so check
          Messages between sessions.
        </Text>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this notice"
          hitSlop={Spacing.sm}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            justifyContent: 'center',
            minHeight: HIT_TARGET - Spacing.sm,
            opacity: pressed ? 0.5 : 1,
          })}>
          <Text variant="heading" style={{ color: colors.onBanner }}>
            Dismiss
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ThreadRow({
  name,
  photoURL,
  preview,
  unread,
  at,
  onPress,
  last,
}: {
  name: string;
  photoURL?: string;
  preview?: string;
  unread: number;
  at?: Timestamp;
  onPress: () => void;
  last?: boolean;
}) {
  const colors = useTheme();
  const when = formatThreadDate(at);
  const body = preview ?? 'No messages yet';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        `${name}${unread ? `, ${unread} unread` : ''}, via ${EVENT.name}` +
        `, ${body}${when ? `, ${when}` : ''}`
      }
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfacePressed : colors.surface,
      })}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: GUTTER,
          paddingHorizontal: Spacing.md,
          paddingVertical: GUTTER,
        }}>
        {/* The badge overhangs the avatar, so the wrapper must not clip it. */}
        <View>
          <Avatar name={name} photoURL={photoURL} size={INBOX_AVATAR} />
          {unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -Spacing.xs,
                right: -Spacing.xs,
                minWidth: BADGE_HEIGHT,
                height: BADGE_HEIGHT,
                paddingHorizontal: 5,
                borderRadius: Radius.pill,
                backgroundColor: colors.dangerFill,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              {...DECORATIVE}>
              <Text
                variant="label"
                tone="onAccent"
                // A fixed circle pinned to a fixed avatar: at the largest
                // accessibility sizes an unbounded "32" renders at ~39pt and
                // covers the face it annotates. The count is already spoken in
                // full by the row's label, which is the path someone using large
                // type is on.
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, lineHeight: 15 }}>
                {unread > 99 ? '99+' : unread}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm }}>
            <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
              {name}
            </Text>
            {when ? (
              <Text variant="caption" tone="tertiary">
                {when}
              </Text>
            ) : null}
          </View>

          {/* Whova's "via <event>" line. Every conversation here is event-scoped,
              so it is uniformly true rather than a distinction between sources. */}
          <Text variant="caption" tone="tint" numberOfLines={1}>
            via {EVENT.name}
          </Text>

          <Text
            variant="subhead"
            tone={unread > 0 ? 'primary' : 'secondary'}
            numberOfLines={2}
            style={{ fontWeight: unread > 0 ? '600' : '400' }}>
            {body}
          </Text>
        </View>
      </View>

      {!last ? (
        <View
          style={{
            height: HAIRLINE,
            backgroundColor: colors.separator,
            marginLeft: Spacing.md + INBOX_AVATAR + GUTTER,
          }}
          {...DECORATIVE}
        />
      ) : null}
    </Pressable>
  );
}

/**
 * Whova's inbox date: a time today, a weekday within the week, a date after.
 *
 * `lastMessageAt` is a `serverTimestamp()` sentinel until the write lands, so it
 * is genuinely absent for a moment on the sender's own device — an empty string
 * rather than "Invalid Date" in the corner of the row that just sent.
 */
function formatThreadDate(at?: Timestamp): string {
  if (!at?.toDate) return '';
  const date = at.toDate();
  if (Number.isNaN(date.getTime())) return '';
  const age = differenceInCalendarDays(new Date(), date);
  if (age <= 0) return format(date, 'h:mm a');
  if (age < 7) return format(date, 'EEEE');
  return format(date, 'M/d/yy');
}
