import { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore';

import {
  COLLECTIONS,
  googleCalendarUrl,
  outlookCalendarUrl,
  sessionCalendarPath,
  type SessionDoc,
  type SpeakerDoc,
  type WithId,
} from '@kgc/shared';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { Chevron, Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { PushedHeader } from '@/components/pushed-header';
import { SessionPoll } from '@/components/session-poll';
import { SessionQA } from '@/components/session-qa';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen, SkeletonText } from '@/components/skeleton';
import { Text } from '@/components/text';
import { SITE_ORIGIN } from '@/config/event';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDayTab, formatTime } from '@/lib/data/sessions';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { useSessionSeat } from '@/lib/data/session-seats';
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

interface CalendarLinks {
  google: string;
  outlook: string;
  /** The website's `.ics` route, absolute — the app never generates the file. */
  ics: string;
}

/**
 * The three destinations "Add to My Calendar" can send a session to, or `null`
 * when this session cannot honestly be offered.
 *
 * ── Why nothing here is a native calendar write ─────────────────────────────
 *
 * Writing straight into the phone's calendar wants `expo-calendar`, and
 * `AGENTS.md` gotcha 1 pins this project to the fixed set of native modules
 * Expo Go ships so the app stays openable without a development build. It would
 * also do nothing at all on the web target, and the app *is* deployed to the web
 * at `kgc27-app.netlify.app`. Three URLs opened with `Linking` behave the same
 * in Expo Go, in a real build and in a browser.
 *
 * ── Why the builders come from `@kgc/shared` ────────────────────────────────
 *
 * They are the same functions the website's `/agenda` dialog calls, moved out of
 * `apps/web` the day this screen needed them. A second copy of the wall clock to
 * UTC conversion would be a second answer to "when is the keynote", and the two
 * would disagree silently — nothing renders wrong, the attendee just arrives an
 * hour late. `AGENTS.md` makes the identical argument about `ensureRegistration`.
 *
 * ── Two reasons this returns `null` ─────────────────────────────────────────
 *
 * The `.ics` route serves `status === 'published' && !deletedAt` only, so for a
 * draft or cancelled session two of the three destinations would work and the
 * third would 404. And the builders throw on a session whose stored wall clocks
 * are malformed or inverted — deliberately, because an entry at a guessed hour
 * is worse than no entry. Either way the control is not drawn, rather than drawn
 * and then failing under the attendee's thumb.
 */
function calendarLinks(session: Session): CalendarLinks | null {
  if (session.status !== 'published') return null;

  try {
    // Stated once and passed to all three, so the two compose links and the
    // download cannot end up naming different hosts. `SITE_ORIGIN` and not the
    // builders' own `publicSiteOrigin()` default: that one reads a server
    // variable the phone does not have and falls back to the conference's front
    // door rather than to this Next deployment — see its docblock.
    const origin = SITE_ORIGIN;
    const entry = {
      id: session.id,
      title: session.title,
      description: session.description,
      startsAtLocal: session.startsAtLocal,
      endsAtLocal: session.endsAtLocal,
      roomName: session.roomName,
      trackName: session.primaryTrackName,
      speakerNames: session.speakerNames,
    };

    return {
      google: googleCalendarUrl(entry, { origin }),
      outlook: outlookCalendarUrl(entry, { origin }),
      ics: `${origin}${sessionCalendarPath(session.id)}`,
    };
  } catch (e) {
    console.warn('[agenda] session cannot become a calendar entry:', session.id, e);
    return null;
  }
}

/**
 * Which calendar, asked once.
 *
 * ⚠️ This is **not** "Add to My Agenda". That control is above it, it writes
 * `users/{uid}/savedSessions`, and it is the app's own schedule. Whova ships
 * both features under names one word apart and the comment on the button above
 * records that the two labels for *that* action were already confused once; this
 * one keeps a different verb phrase, a different glyph (`calendar`, not
 * `calendar.badge.plus`) and a secondary weight, so nothing about it reads as a
 * second way to do the same thing.
 *
 * One button opening a chooser rather than three buttons in a row, which is the
 * shape Whova's own web client uses. The website puts three links side by side
 * instead, and says why: its dialog is already open, so a chooser there would be
 * a dialog inside a dialog. Here there is no dialog, the screen's vertical
 * budget is already spent on the primary action, the description, polls, Q&A and
 * the speaker cards, and three full-width buttons stacked under the one that
 * matters would bury it.
 *
 * A `Modal` rather than a bottom-sheet library, for the reason `TrackSheet`
 * gives on the agenda list: the app has two already, this needs no gesture, and
 * three rows fit.
 */
function CalendarSheet({
  visible,
  links,
  title,
  onClose,
}: {
  visible: boolean;
  links: CalendarLinks;
  /** The session's own title, so the rows can say what they are adding. */
  title: string;
  onClose: () => void;
}) {
  const colors = useTheme();

  // `openURL` rejects on an address the platform cannot handle — a phone with no
  // browser, an OS that refuses the scheme. Out of a press handler that would be
  // an unhandled rejection, which is a red box in development and silence here.
  const open = (url: string) => {
    onClose();
    Linking.openURL(url).catch((e: unknown) => {
      console.warn('[agenda] could not open calendar link', e);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close calendar options"
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}>
        <Pressable
          // Swallows the backdrop's press without becoming a control itself.
          onPress={() => {}}
          accessible={false}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: Radius.lg,
            borderTopRightRadius: Radius.lg,
            paddingBottom: Spacing.xl,
            gap: Spacing.md,
          }}>
          <Text
            variant="label"
            tone="secondary"
            accessibilityRole="header"
            style={{
              paddingHorizontal: Spacing.md,
              paddingTop: Spacing.md,
            }}>
            ADD TO MY CALENDAR
          </Text>

          <View
            style={{
              marginHorizontal: Spacing.md,
              borderRadius: Radius.lg,
              overflow: 'hidden',
            }}>
            <ListRow
              title="Google Calendar"
              subtitle="Opens a pre-filled event in your browser."
              trailing={<Chevron />}
              first
              onPress={() => open(links.google)}
            />
            <ListRow
              title="Outlook.com"
              subtitle="Opens a pre-filled event in your browser."
              trailing={<Chevron />}
              onPress={() => open(links.outlook)}
            />
            <ListRow
              // Apple Calendar is the one most attendees on this screen are
              // holding, so it leads the label — but the file is a plain `.ics`
              // and opens in anything, which the subtitle says rather than
              // leaving Android readers to guess the row is not for them.
              title="Apple Calendar or other"
              subtitle={`Downloads an .ics file for ${title}.`}
              trailing={<Chevron />}
              last
              onPress={() => open(links.ics)}
            />
          </View>

          {/* The same sentence the website prints under its three links. The
              entries carry UTC instants, so every calendar app shows them in the
              reader's own zone — correct, and the moment somebody joining from
              London wonders whether the agenda lied to them. */}
          <Text variant="caption" tone="tertiary" style={{ paddingHorizontal: Spacing.md }}>
            Times are local to the venue. Your calendar converts them to whatever zone you are in.
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  const [choosingCalendar, setChoosingCalendar] = useState(false);
  // A capped or ticket-restricted session: the count, the caller's own place,
  // and whatever the last press was refused with.
  const seat = useSessionSeat(session);
  const [seatMessage, setSeatMessage] = useState<string | null>(null);
  const [seatBusy, setSeatBusy] = useState(false);

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

  // Above the early returns for the same reason the header is: hooks cannot sit
  // behind a conditional. Recomputed on every snapshot, which is what makes a
  // room change made in the console reach the calendar entry as well as the
  // screen — the two compose URLs carry the room in their body.
  const calendar = useMemo(() => (session ? calendarLinks(session) : null), [session]);

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
            slowNotice="Still loading. Check your connection.">
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

  // With a cap or a ticket list, being in the agenda means holding a place. A
  // bookmark from before the session was capped does not count as one.
  const saved = seat.gated ? seat.mine !== null : isSaved(session.id);
  const seated = seat.gated ? seat.mine === 'seated' : saved;
  const onToggle = async () => {
    if (!seat.gated) {
      void toggle(session.id, session);
      return;
    }
    if (seatBusy) return;
    setSeatBusy(true);
    setSeatMessage(null);
    const result = await toggle(session.id, session);
    // A waitlist place is not a refusal; the lines under the button say it.
    setSeatMessage(result.ok ? null : result.message);
    setSeatBusy(false);
  };
  const accent = session.primaryTrackColor ?? colors.tint;

  return (
    <>
      {header}
      <Screen grouped avoidKeyboard>
        <View style={{ gap: Spacing.sm }}>
          {session.primaryTrackName ? (
            <Text variant="label" style={{ color: accent }}>
              {session.primaryTrackName.toUpperCase()}
            </Text>
          ) : null}
          {/* `title2`, not `title`: session titles here run to sixty characters
              and at 28pt the longest of them filled four lines before any of the
              detail below it. Whova sets its own at about 22. */}
          <Text variant="title2">{session.title}</Text>
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
          onPress={onToggle}
          disabled={seatBusy || (seat.gated && !seat.ready)}
          accessibilityRole="button"
          accessibilityState={{ selected: saved, busy: seatBusy }}
          accessibilityLabel={
            seat.gated ? seat.buttonLabel : saved ? 'Remove from my agenda' : 'Add to my agenda'
          }
          style={({ pressed }) => ({
            backgroundColor: saved ? colors.surface : colors.accent,
            borderWidth: 1,
            borderColor: colors.tint,
            borderRadius: Radius.md,
            paddingVertical: Spacing.md,
            alignItems: 'center',
            minHeight: HIT_TARGET,
            justifyContent: 'center',
            opacity: pressed || seatBusy ? 0.8 : 1,
          })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon
              name={seated ? 'checkmark.circle.fill' : 'calendar.badge.plus'}
              size={20}
              color={saved ? colors.tint : colors.onAccent}
            />
            <Text variant="heading" tone={saved ? 'tint' : 'onAccent'}>
              {seat.gated ? seat.buttonLabel : saved ? 'In My Agenda' : 'Add to Agenda'}
            </Text>
          </View>
        </Pressable>

        {seat.gated && (seat.seatLine || seat.mySeatLine || seatMessage) ? (
          <View style={{ gap: Spacing.xs }}>
            {seatMessage ? <Text tone="danger">{seatMessage}</Text> : null}
            {seat.mySeatLine ? <Text>{seat.mySeatLine}</Text> : null}
            {seat.seatLine ? <Text tone="secondary">{seat.seatLine}</Text> : null}
          </View>
        ) : null}

        {/*
          A *different* feature from the button above, and drawn so it reads that
          way: no fill, so it never competes with the primary action, and a plain
          `calendar` glyph rather than the calendar-plus one the agenda uses for
          "Add to Agenda". The agenda is this app's own schedule; this exports
          the session to Google, Outlook or the phone's own calendar, which is
          the thing the app had no answer for at all.
        */}
        {calendar ? (
          <Pressable
            onPress={() => setChoosingCalendar(true)}
            accessibilityRole="button"
            accessibilityHint="Choose Google, Outlook or a downloadable calendar file"
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.surfacePressed : colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: Radius.md,
              paddingVertical: Spacing.md,
              alignItems: 'center',
              minHeight: HIT_TARGET,
              justifyContent: 'center',
            })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <Icon name="calendar" size={20} color={colors.tint} />
              <Text variant="heading" tone="tint">
                Add to My Calendar
              </Text>
            </View>
          </Pressable>
        ) : null}

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

      {calendar ? (
        <CalendarSheet
          visible={choosingCalendar}
          links={calendar}
          title={session.title}
          onClose={() => setChoosingCalendar(false)}
        />
      ) : null}
    </>
  );
}
