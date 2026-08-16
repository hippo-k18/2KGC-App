import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

import { COLLECTIONS, type SessionDoc, type SpeakerDoc, type WithId } from '@kgc/shared';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { SessionPoll } from '@/components/session-poll';
import { SessionQA } from '@/components/session-qa';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDayTab, formatTime } from '@/lib/data/sessions';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { getDb } from '@/lib/firebase/client';

type Session = WithId<SessionDoc>;
type Speaker = WithId<SpeakerDoc>;

/**
 * Session detail — the hub. Everything session-scoped hangs off this screen:
 * materials, Q&A, polls and feedback all land here later.
 *
 * Subscribed rather than fetched, so a room change made in the organizer console
 * updates this screen while an attendee is standing in a corridor reading it.
 * That is the demo's key beat and it is also the thing that actually goes wrong
 * at conferences.
 */
export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const { isSaved, toggle } = useSavedSessions();

  const [session, setSession] = useState<Session | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(getDb(), COLLECTIONS.sessions, id), (snap) => {
      if (!snap.exists()) {
        setMissing(true);
        return;
      }
      setSession({ id: snap.id, ...snap.data() } as Session);
    });
  }, [id]);

  const speakerIds = session?.speakerIds;
  useEffect(() => {
    if (!speakerIds?.length) {
      setSpeakers([]);
      return;
    }
    // Fetched one by one rather than with a `documentId() in [...]` query.
    // Sessions have one to three speakers, so this is the same number of reads,
    // it has no 30-item cap, and it cannot silently return nothing the way the
    // `in` form did here — which fell back to the cached names and quietly
    // dropped every bio.
    (async () => {
      const docs = await Promise.all(
        speakerIds.map((sid) => getDoc(doc(getDb(), COLLECTIONS.speakers, sid))),
      );
      setSpeakers(
        docs
          .filter((d) => d.exists())
          .map((d) => ({ id: d.id, ...d.data() }) as Speaker),
      );
    })();
  }, [speakerIds]);

  if (missing) {
    return (
      <Screen grouped>
        <EmptyState title="Session not found" message="It may have been removed from the programme." />
      </Screen>
    );
  }
  if (!session) {
    // No spinner: the agenda list has already been rendered from cache, so a
    // flash of loading chrome here reads as slower than a brief blank.
    return <Screen grouped><View /></Screen>;
  }

  const saved = isSaved(session.id);
  const accent = session.primaryTrackColor ?? colors.tint;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: 'Agenda' }} />
      <Screen grouped>
        <View style={{ gap: Spacing.sm }}>
          {session.primaryTrackName ? (
            <Text variant="label" style={{ color: accent }}>
              {session.primaryTrackName.toUpperCase()}
            </Text>
          ) : null}
          <Text variant="title">{session.title}</Text>
          <Text tone="secondary">
            {formatDayTab(session.day)} · {formatTime(session.startsAtLocal)} –{' '}
            {formatTime(session.endsAtLocal)}
          </Text>
          {session.roomName ? <Text tone="secondary">{session.roomName}</Text> : null}
          {session.status === 'cancelled' ? (
            <Text tone="danger" variant="heading">
              This session has been cancelled.
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={() => toggle(session.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          accessibilityLabel={saved ? 'Remove from my schedule' : 'Add to my schedule'}
          style={({ pressed }) => ({
            backgroundColor: saved ? colors.surface : colors.accent,
            borderWidth: 1,
            borderColor: saved ? colors.tint : colors.tint,
            borderRadius: Radius.md,
            paddingVertical: Spacing.md,
            alignItems: 'center',
            minHeight: 48,
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon
              name={saved ? 'star.fill' : 'star'}
              color={saved ? colors.tint : colors.onAccent}
            />
            <Text variant="heading" tone={saved ? 'tint' : 'onAccent'}>
              {saved ? 'In my schedule' : 'Add to my schedule'}
            </Text>
          </View>
        </Pressable>

        {session.description ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="heading">About</Text>
            <Text>{session.description}</Text>
          </View>
        ) : null}

        {session.pollsEnabled ? <SessionPoll sessionId={session.id} /> : null}

        {session.qaEnabled ? <SessionQA sessionId={session.id} /> : null}

        {speakers.length || session.speakerNames?.length ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="heading">
              {speakers.length > 1 ? 'Speakers' : 'Speaker'}
            </Text>
            {(speakers.length
              ? speakers
              : (session.speakerNames ?? []).map((n) => ({ id: n, name: n }) as Speaker)
            ).map((sp) => (
              <View
                key={sp.id}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: Radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: Spacing.md,
                  gap: Spacing.xs,
                }}>
                <Text variant="heading">{sp.name}</Text>
                {sp.title || sp.company ? (
                  <Text variant="caption" tone="secondary">
                    {[sp.title, sp.company].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {sp.bio ? <Text variant="caption">{sp.bio}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </Screen>
    </>
  );
}
