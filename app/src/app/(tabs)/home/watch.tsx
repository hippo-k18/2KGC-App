import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { Chevron } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useSessions } from '@/lib/data/sessions';
import { useWatchLists, type WatchCandidateSession } from '@/lib/data/watch';
import type { WatchEntry } from '@/lib/data/watch-core';

/**
 * Everything there is to watch, in one place.
 *
 * ── Why this reads no video document at all ─────────────────────────────────
 *
 * `list` is refused on `sessions/{id}/watch`, deliberately: a query across it
 * would be denied outright the moment one session in range was restricted,
 * which is a video library that fails for exactly the people who paid for it.
 * And a `get` per row would be seventy reads and seventy rule evaluations to
 * draw a list.
 *
 * So this screen is built from the session documents the agenda already has in
 * memory. `streamState`, `hasRecording`, the two ticket-name lists and the
 * recording's closing date are on the session for this screen; the links are
 * not, and the player is one tap away on the session's own screen where the
 * gated read actually happens.
 *
 * That means a tag here is the session's word and not the rules'. It is right
 * in every case the dashboard has stamped, and where the reader's own ticket
 * could not be read it says nothing rather than barring somebody on a guess —
 * the same rule `useSessionSeat` follows on the agenda.
 *
 * ── Three lists, and one talk can be in two of them ─────────────────────────
 *
 * A session that streamed this morning and has its recording up belongs under
 * both Live and Recordings at different hours of the day, and somebody looking
 * for the recording should not have to know it was ever live.
 */
export default function WatchScreen() {
  const router = useRouter();
  const { sessions, error, loading, retry } = useSessions();
  const { live, upcoming, recordings, anything } = useWatchLists(sessions);

  const header = <PushedHeader backTitle="Home" backHref="/home" />;

  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="what is streaming" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (loading) {
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen label="what is streaming" slowNotice="Still loading. Check your connection.">
            <SkeletonBlock width="40%" height={26} />
            <SkeletonBlock height={64} radius={Radius.lg} />
            <SkeletonBlock height={64} radius={Radius.lg} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const open = (id: string) => router.push({ pathname: '/agenda/[id]', params: { id } });

  return (
    <>
      {header}
      <Screen grouped>
        <View style={{ gap: Spacing.xs }}>
          <Text variant="title" accessibilityRole="header">
            Watch
          </Text>
          <Text variant="subhead" tone="secondary">
            {anything
              ? 'Sessions you can watch online. Open one to play it.'
              : 'Sessions you can watch online.'}
          </Text>
        </View>

        {anything ? null : (
          // Not an error and not a blank: the organizers have not put anything
          // online yet, and that is a sentence rather than an empty box.
          <EmptyState
            icon="video.fill"
            title="Nothing online yet"
            message="When the organizers put a session online it appears here. Everything on the agenda is running in a room."
          />
        )}

        <WatchSection
          heading="LIVE NOW"
          rows={live}
          empty={anything ? 'Nothing is streaming at the moment.' : ''}
          onOpen={open}
        />
        <WatchSection
          heading="COMING UP"
          rows={upcoming}
          empty={anything ? 'Nothing else is scheduled to stream.' : ''}
          onOpen={open}
        />
        <WatchSection
          heading="RECORDINGS"
          rows={recordings}
          empty={anything ? 'No recordings have been posted yet.' : ''}
          onOpen={open}
        />
      </Screen>
    </>
  );
}

/**
 * One group.
 *
 * An empty group keeps its heading and says why it is empty, but only once
 * something on the event is online at all — on an event with no streaming the
 * three headings and three apologies would be the whole screen, which is the
 * product narrating its own settings at somebody who can do nothing about it.
 */
function WatchSection({
  heading,
  rows,
  empty,
  onOpen,
}: {
  heading: string;
  rows: WatchEntry<WatchCandidateSession>[];
  /** '' hides the group entirely when it is empty. */
  empty: string;
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0 && !empty) return null;

  return (
    <View style={{ gap: Spacing.sm }}>
      <Text variant="label" tone="secondary">
        {heading}
      </Text>

      {rows.length === 0 ? (
        <Text variant="subhead" tone="tertiary">
          {empty}
        </Text>
      ) : (
        <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
          {rows.map((row, i, arr) => (
            <ListRow
              key={row.item.session.id}
              title={row.item.session.title}
              subtitle={[row.item.when, row.item.session.roomName].filter(Boolean).join(' · ')}
              // Everything the reader has to know before tapping, on one line:
              // whether their ticket covers it, and when it closes.
              meta={[row.tag, row.note].filter(Boolean).join(' · ')}
              trailing={<Chevron />}
              first={i === 0}
              last={i === arr.length - 1}
              onPress={() => onOpen(row.item.session.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
