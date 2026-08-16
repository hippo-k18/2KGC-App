import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';

import { COLLECTIONS, threadIdFor, type DirectoryDoc, type WithId } from '@kgc/shared';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';

type Entry = WithId<DirectoryDoc>;

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

  const [person, setPerson] = useState<Entry | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(getDb(), COLLECTIONS.directory, uid), (snap) => {
      if (!snap.exists()) return setMissing(true);
      setPerson({ id: snap.id, ...snap.data() } as Entry);
    });
  }, [uid]);

  if (missing) {
    return (
      <Screen grouped>
        <EmptyState
          icon="person.slash"
          title="Profile not available"
          message="This attendee is not listed in the directory."
        />
      </Screen>
    );
  }
  if (!person) {
    return (
      <Screen grouped>
        <View />
      </Screen>
    );
  }

  const isMe = person.uid === user?.uid;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: 'People' }} />
      <Screen grouped>
        <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
          <Avatar name={person.name} photoURL={person.photoURL} size={88} />
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
              backgroundColor: colors.tint,
              opacity: pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              height: 50,
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
