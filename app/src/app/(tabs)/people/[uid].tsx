import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc } from 'firebase/firestore';

import { COLLECTIONS, threadIdFor, type DirectoryDoc, type WithId } from '@kgc/shared';

import { Avatar } from '@/components/avatar';
import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useDocument } from '@/lib/data/use-document';
import { getDb } from '@/lib/firebase/client';

type Entry = WithId<DirectoryDoc>;

/**
 * The card's avatar and its primary action, as constants rather than literals,
 * because the loading placeholder has to draw the same two boxes. A skeleton that
 * disagrees with the real layout by a few points makes the content jump when it
 * arrives, which is the jitter the placeholder exists to prevent.
 */
const AVATAR_PLACEHOLDER = 88;
const MESSAGE_BUTTON_HEIGHT = 50;

/**
 * An attendee's public card.
 *
 * Everything here comes from the `directory` projection, not from `users` —
 * the full profile carries an email address and notification preferences that
 * no other attendee has any business reading, and the security rules enforce
 * that. If someone has opted out, this document does not exist and the screen
 * says so rather than leaking the fact that they are registered.
 */
export default function PersonScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  // `useDocument`, not a bare `onSnapshot`. The listener this replaces had no
  // error callback — the omission that unmounts the entire app rather than one
  // screen — and no error state either, so a refused read parked the card on a
  // permanently blank body. "Profile not available: this attendee is not listed
  // in the directory" is the *correct* answer for a genuine opt-out and a false
  // one for a denial, and the two were indistinguishable.
  const {
    data: person,
    status,
    error,
    retry,
  } = useDocument<Entry>(
    () => (uid ? doc(getDb(), COLLECTIONS.directory, uid) : null),
    [uid],
    (id, d) => ({ id, ...d }) as Entry,
  );
  // Settled and absent — an opt-out, which is a real answer and not an error.
  const missing = status === 'ready' && !person;

  // Above the early returns — see the note in `agenda/[id].tsx`. Both states
  // below are reachable from a cold link, and neither had a way out.
  const header = <PushedHeader backTitle="People" backHref="/people" />;

  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="this profile" onRetry={retry} />
        </Screen>
      </>
    );
  }
  if (missing) {
    return (
      <>
        {header}
        <Screen grouped>
          <EmptyState
            icon="person.slash"
            title="Profile not available"
            message="This attendee is not listed in the directory."
          />
        </Screen>
      </>
    );
  }
  if (!person) {
    // A card-shaped placeholder rather than the empty `View` this replaces —
    // same reasoning as `agenda/[id].tsx`: the wait is floored by the SDK's
    // ten-second offline timeout, and a blank that long reads as a crash.
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen
            label="this profile"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
              <SkeletonBlock width={AVATAR_PLACEHOLDER} height={AVATAR_PLACEHOLDER} radius={Radius.pill} />
              <SkeletonBlock width="45%" height={22} />
              <SkeletonBlock width="65%" height={16} />
            </View>
            <SkeletonBlock height={MESSAGE_BUTTON_HEIGHT} radius={Radius.md} />
            <View style={{ gap: Spacing.sm }}>
              <SkeletonBlock width="25%" height={12} />
              <SkeletonBlock width="80%" height={28} radius={Radius.pill} />
            </View>
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const isMe = person.uid === user?.uid;

  return (
    <>
      {header}
      <Screen grouped>
        <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
          <Avatar name={person.name} photoURL={person.photoURL} size={AVATAR_PLACEHOLDER} />
          <Text variant="title3">{person.name}</Text>
          {person.title || person.company ? (
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {[person.title, person.company].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>

        {!isMe && user ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/messages/[threadId]',
                params: { threadId: threadIdFor(user.uid, person.uid), to: person.uid },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`Message ${person.name}`}
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              height: MESSAGE_BUTTON_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
            })}>
            <Text variant="heading" tone="onAccent">
              Message
            </Text>
          </Pressable>
        ) : null}

        {person.interests?.length ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              INTERESTS
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              {person.interests.map((i) => (
                <View
                  key={i}
                  style={{
                    backgroundColor: colors.tintSoft,
                    borderRadius: Radius.pill,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}>
                  <Text variant="subhead" tone="tint">
                    {i}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </Screen>
    </>
  );
}
