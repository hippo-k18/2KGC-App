import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc } from 'firebase/firestore';

import { COLLECTIONS, type SpeakerDoc, type WithId } from '@kgc/shared';

import { Avatar } from '@/components/avatar';
import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SessionCard } from '@/components/session-card';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useDocument } from '@/lib/data/use-document';
import { useSessions } from '@/lib/data/sessions';
import { getDb } from '@/lib/firebase/client';

type Entry = WithId<SpeakerDoc>;

const AVATAR = 88;

/**
 * A speaker's card, and the sessions they are on.
 *
 * This route did not exist, and its absence was the largest dead end in the
 * app: the People tab's Speakers segment made a row pressable only when the
 * speaker also held a ticket (`userId`, which resolves to an attendee profile),
 * and **none of the forty-five speakers has one**. So every row in the segment
 * was inert — forty-five people with a written bio and a list of sessions,
 * behind a row that did nothing when you tapped it.
 *
 * `userId` is still worth honouring where it exists, and the row keeps sending
 * those to `/people/[uid]`: an attendee card carries interests and a Message
 * button, which this screen deliberately does not, because a speaker with no
 * ticket has no account to message.
 */
export default function SpeakerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const {
    data: speaker,
    status,
    error,
    retry,
  } = useDocument<Entry>(
    () => (id ? doc(getDb(), COLLECTIONS.speakers, id) : null),
    [id],
    (docId, d) => ({ id: docId, ...d }) as Entry,
  );

  // The whole agenda is already loaded and cached for the Agenda tab, so
  // filtering it here costs nothing. Reading `sessionIds` one document at a time
  // would be up to six extra round trips for a screen that is mostly a bio.
  const { sessions } = useSessions();
  const mine = speaker?.sessionIds?.length
    ? (sessions ?? []).filter((s) => speaker.sessionIds.includes(s.id))
    : [];

  const missing = status === 'ready' && !speaker;
  const header = <PushedHeader backTitle="People" backHref="/people" />;

  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="this speaker" onRetry={retry} />
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
            title="Speaker not found"
            message="This speaker is no longer on the programme."
          />
        </Screen>
      </>
    );
  }
  if (!speaker) {
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen
            label="this speaker"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
              <SkeletonBlock width={AVATAR} height={AVATAR} radius={Radius.pill} />
              <SkeletonBlock width="45%" height={22} />
              <SkeletonBlock width="65%" height={16} />
            </View>
            <SkeletonBlock height={80} radius={Radius.md} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  return (
    <>
      {header}
      <Screen grouped>
        <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
          <Avatar name={speaker.name} photoURL={speaker.photoURL} size={AVATAR} />
          <Text variant="title3">{speaker.name}</Text>
          {speaker.title || speaker.company ? (
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {[speaker.title, speaker.company].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>

        {speaker.bio ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              ABOUT
            </Text>
            <Text>{speaker.bio}</Text>
          </View>
        ) : null}

        {mine.length > 0 ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              {mine.length === 1 ? 'SESSION' : `SESSIONS (${mine.length})`}
            </Text>
            <View>
              {mine.map((s, i) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  first={i === 0}
                  last={i === mine.length - 1}
                  onPress={() => router.push({ pathname: '/agenda/[id]', params: { id: s.id } })}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Screen>
    </>
  );
}
