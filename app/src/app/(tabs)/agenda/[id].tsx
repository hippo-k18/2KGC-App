import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore';

import { COLLECTIONS, type SessionDoc, type SpeakerDoc, type WithId } from '@kgc/shared';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { PushedHeader } from '@/components/pushed-header';
import { SessionPoll } from '@/components/session-poll';
import { SessionQA } from '@/components/session-qa';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen, SkeletonText } from '@/components/skeleton';
import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDayTab, formatTime } from '@/lib/data/sessions';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { refreshCredentials } from '@/lib/data/errors';
import { getDb } from '@/lib/firebase/client';

type Session = WithId<SessionDoc>;
type Speaker = WithId<SpeakerDoc>;

function speakerRef(id: string) {
  return doc(getDb(), COLLECTIONS.speakers, id);
}

/**
 * The cached copy of a speaker, or `null` if the phone does not hold one.
 *
 * This exists because `getDoc` is not the cheap read it looks like. It listens
 * with `waitForSyncWhenOnline`, so it deliberately ignores a perfectly good
 * cached copy and waits for the server — and when the server does not answer it
 * waits out the SDK's whole ten-second offline timeout before rejecting with
 * `unavailable`. That is ten seconds of missing bios, for data already on the
 * device, every time you reopen a session you have looked at before.
 *
 * A cache miss costs nothing: `getDocFromCache` fails locally and immediately.
 */
async function cachedSpeaker(id: string) {
  try {
    return await getDocFromCache(speakerRef(id));
  } catch {
    return null;
  }
}

async function serverSpeaker(id: string) {
  try {
    return await getDoc(speakerRef(id));
  } catch {
    return null;
  }
}

function toSpeakers(docs: (DocumentSnapshot | null)[]): Speaker[] {
  return docs
    .filter((d): d is DocumentSnapshot => Boolean(d?.exists()))
    .map((d) => ({ id: d.id, ...d.data() }) as Speaker);
}

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
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    setError(null);
    // Cleared per subscription, not just on mount. This screen is reused when one
    // session pushes another, so a `missing` left over from the previous id
    // reported the new session as withdrawn before its first snapshot arrived.
    setMissing(false);
    return onSnapshot(
      doc(getDb(), COLLECTIONS.sessions, id),
      (snap) => {
        if (!snap.exists()) {
          // `fromCache` is the whole difference between "this session was
          // withdrawn" and "this phone cannot reach the server". The SDK gives
          // the backend ten seconds and then hands the listener whatever the
          // local cache holds — for a session the agenda list has not loaded,
          // that is an *absent* document. Taking that at face value put
          // "Session not found — it may have been removed from the programme"
          // in front of attendees standing outside a room the session was
          // running in, and it is the one wrong answer worse than no answer.
          // A server-confirmed absence is the only absence worth believing.
          if (!snap.metadata.fromCache) setMissing(true);
          return;
        }
        setSession({ id: snap.id, ...snap.data() } as Session);
      },
      // This observer was missing entirely, and without one the SDK rethrows
      // asynchronously and React unmounts the whole tree — one refused session
      // took the tab bar down with it. This listener stays hand-rolled rather
      // than moving to `useDocument` only because it reads `snap.metadata`.
      (e) => {
        console.warn('[firestore] session listener failed:', e.code, e.message);
        setError(e as Error);
      },
    );
  }, [id, attempt]);

  const retry = () => {
    setError(null);
    // Claims reach the SDK only through a new token — see `refreshCredentials`.
    void refreshCredentials().then(() => setAttempt((n) => n + 1));
  };

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
    let live = true;
    // Cache first, then the server. The cache pass is what stops a revisit — or
    // a visit on venue wifi — from showing bare names for ten seconds while
    // `getDoc` waits out the SDK's offline timeout for documents the phone
    // already has. The server pass then replaces them, because a bio edited in
    // the console has to win over the copy on the device.
    (async () => {
      const fromCache = toSpeakers(await Promise.all(speakerIds.map(cachedSpeaker)));
      if (live && fromCache.length) setSpeakers(fromCache);

      // Each read is caught on its own. An uncaught rejection here is an
      // unhandled promise — a red box in development and silence in production —
      // and one unreadable speaker would drop the other two. What survives is
      // the denormalised `speakerNames` fallback below: the names still show,
      // the bios do not, which is a visible degradation rather than a blank.
      const fromServer = toSpeakers(await Promise.all(speakerIds.map(serverSpeaker)));
      if (!live) return;
      // Never trade down. A refused or timed-out server pass returns nulls, and
      // overwriting the cached bios with those would make a working screen worse
      // the moment the network went.
      if (fromServer.length >= fromCache.length) setSpeakers(fromServer);
    })();
    return () => {
      live = false;
    };
  }, [speakerIds]);

  // The header goes above the early returns, not inside the success branch.
  // A link opened cold spends a second or two in `!session` and a removed
  // session stays in `missing` for good; drawn only on success, the back
  // button was missing in exactly the two states you most need it.
  const header = <PushedHeader backTitle="Agenda" backHref="/agenda" />;

  // Before the error branch: "Session not found — it may have been removed from
  // the programme" is a specific and reassuring account of a refused read, and it
  // is the sentence that sends someone away from a room the session is still in.
  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="this session" onRetry={retry} />
        </Screen>
      </>
    );
  }
  if (missing) {
    return (
      <>
        {header}
        <Screen grouped>
          <EmptyState title="Session not found" message="It may have been removed from the programme." />
        </Screen>
      </>
    );
  }
  if (!session) {
    // This used to be an empty `View`, on the argument that the agenda list has
    // already been rendered from cache so a flash of loading chrome reads as
    // slower than a brief blank. The argument holds for a brief blank and this
    // wait is not reliably brief: a session the list has not cached gets nothing
    // at all until the SDK's ten-second offline timer fires. Fifteen seconds of
    // nothing after a tap reads as a crash, and the recovery an attendee tries
    // is to back out and tap again, which starts the clock over.
    //
    // The shape mirrors the real screen below — track label, title, time, room,
    // the primary action, a paragraph — so nothing jumps when the data lands.
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen
            label="session details"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <View style={{ gap: Spacing.sm }}>
              <SkeletonBlock width="35%" height={12} />
              <SkeletonBlock width="90%" height={26} />
              <SkeletonBlock width="70%" height={26} />
              <SkeletonBlock width="55%" height={16} />
              <SkeletonBlock width="40%" height={16} />
            </View>
            <SkeletonBlock height={HIT_TARGET + Spacing.sm} radius={Radius.md} />
            <View style={{ gap: Spacing.sm }}>
              <SkeletonBlock width="25%" height={16} />
              <SkeletonText lines={4} />
            </View>
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const saved = isSaved(session.id);
  const accent = session.primaryTrackColor ?? colors.tint;

  return (
    <>
      {header}
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

        {/*
          Worded and drawn to match the control on every agenda row — same verb,
          same calendar-plus glyph. It was "Add to my schedule" with a star here
          and "Add to Agenda" with a calendar in the list, which reads as two
          different features to anyone who has not written the code.
        */}
        <Pressable
          onPress={() => toggle(session.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          accessibilityLabel={saved ? 'Remove from my agenda' : 'Add to my agenda'}
          style={({ pressed }) => ({
            backgroundColor: saved ? colors.surface : colors.accent,
            borderWidth: 1,
            borderColor: colors.tint,
            borderRadius: Radius.md,
            paddingVertical: Spacing.md,
            alignItems: 'center',
            minHeight: HIT_TARGET,
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon
              name={saved ? 'checkmark.circle.fill' : 'calendar.badge.plus'}
              size={20}
              color={saved ? colors.tint : colors.onAccent}
            />
            <Text variant="heading" tone={saved ? 'tint' : 'onAccent'}>
              {saved ? 'In My Agenda' : 'Add to Agenda'}
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
