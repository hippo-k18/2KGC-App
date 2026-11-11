import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Chevron } from '@/components/icon';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { formatDayTab, formatTime, useSessions } from '@/lib/data/sessions';

type Feature = 'qa' | 'polls';

const COPY: Record<Feature, { title: string; blurb: string; empty: string }> = {
  qa: {
    title: 'Session Q&A',
    blurb:
      'Questions are asked and upvoted inside the session they belong to. These are ' +
      'the sessions running Q&A this week.',
    empty: 'No session in the programme has Q&A switched on yet.',
  },
  polls: {
    title: 'Polls',
    blurb:
      'Live polls run inside the session that opened them. These are the sessions ' +
      'with polls switched on.',
    empty: 'No session in the programme has polls switched on yet.',
  },
};

/**
 * Q&A and polls, reached from the home grid.
 *
 * Both features are genuinely built — `components/session-qa.tsx` and
 * `session-poll.tsx` render on the session detail screen whenever `qaEnabled` or
 * `pollsEnabled` is set. What did not exist was a way *in* from home, which is
 * where Whova puts them.
 *
 * So this is an index, not a second implementation: it filters the agenda that
 * `useSessions` has already subscribed to and hands off to `/agenda/[id]`. No
 * new Firestore query, and therefore no new composite index to forget.
 *
 * One screen for two features rather than two near-identical files, because the
 * only difference between them is which boolean is filtered on and three strings.
 */
export default function SessionFeatureScreen() {
  const router = useRouter();
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const { sessions, loading, error, retry } = useSessions();

  const kind: Feature = feature === 'polls' ? 'polls' : 'qa';
  const copy = COPY[kind];

  const matches = useMemo(
    () => (sessions ?? []).filter((s) => (kind === 'polls' ? s.pollsEnabled : s.qaEnabled)),
    [sessions, kind],
  );

  /*
   * By day, in the order the agenda already uses.
   *
   * Seventy-one sessions in one flat run is about seven and a half screens with
   * nothing to steer by, while the agenda next to it groups the same sessions
   * under day headings. `useSessions` is already ordered by day and start time,
   * so this only inserts the breaks.
   */
  const days = useMemo(() => {
    const out: { day: string; sessions: typeof matches }[] = [];
    for (const s of matches) {
      const group = out[out.length - 1];
      if (group && group.day === s.day) group.sessions.push(s);
      else out.push({ day: s.day, sessions: [s] });
    }
    return out;
  }, [matches]);

  return (
    <>
      <PushedHeader backTitle="Home" backHref="/home" />

      <Screen grouped>
        <View style={{ gap: Spacing.xs }}>
          <Text variant="title" accessibilityRole="header">
            {copy.title}
          </Text>
          <Text variant="subhead" tone="secondary">
            {copy.blurb}
          </Text>
        </View>

        {matches.length ? (
          days.map((group) => (
            <View key={group.day} style={{ gap: Spacing.sm }}>
              <Text variant="label" tone="secondary" accessibilityRole="header">
                {formatDayTab(group.day).toUpperCase()}
              </Text>
              <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
                {group.sessions.map((s, i, arr) => (
                  <ListRow
                    key={s.id}
                    title={s.title}
                    // The day is the heading above; the row carries the time
                    // and the room, which is what tells one row from the next.
                    subtitle={formatTime(s.startsAtLocal)}
                    meta={s.roomName}
                    trailing={<Chevron />}
                    first={i === 0}
                    last={i === arr.length - 1}
                    onPress={() => router.push({ pathname: '/agenda/[id]', params: { id: s.id } })}
                  />
                ))}
              </View>
            </View>
          ))
        ) : error ? (
          // Otherwise a refused agenda read says "no session in the programme has
          // Q&A switched on yet" — a claim about the programme, made without
          // having read it.
          <DataError error={error} subject="the programme" onRetry={retry} />
        ) : loading ? null : (
          <EmptyState
            icon="questionmark.circle"
            title="Not inputted yet"
            message={copy.empty}
          />
        )}
      </Screen>
    </>
  );
}
