import { useMemo } from 'react';
import { SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { PushedHeader } from '@/components/pushed-header';
import { SessionCard } from '@/components/session-card';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { placementWhen, useMyGatherings } from '@/lib/data/gatherings';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { formatDayTab, useSessions } from '@/lib/data/sessions';

/**
 * My Schedule — the saved sessions, grouped by day and flagged for clashes.
 *
 * The clash warning is the part that earns its place. At eleven tracks people
 * routinely save two things in the same slot and only discover it when they are
 * standing in the wrong room; Whova shows the conflict but does not surface it
 * until you open the session.
 */
export default function MyScheduleScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { sessions, error: sessionsError, retry: retrySessions } = useSessions();
  const { saved, isSaved, error: savedError, retry: retrySaved } = useSavedSessions();
  /**
   * Round tables and meeting slots an organizer placed this attendee at.
   *
   * Here rather than on a screen of its own because a table at 13:00 is a place
   * you have to be at 13:00, which is what this screen is: the saved sessions
   * are only the half of the day an attendee chose for themselves.
   *
   * ⚠️ **Nothing writes these yet** — `useMyGatherings`'s header has the reason
   * in full, and it is a modelling gap rather than an unfinished job: the plan
   * stores typed names, not uids, so there is no key to project on. The section
   * therefore renders nothing at all rather than an empty card promising a
   * feature: a heading over "no tables yet" is a claim that somebody will one
   * day put one there, and until the plan carries a uid nobody can.
   */
  const { placements } = useMyGatherings();

  // This screen is the intersection of two listeners, and either one failing
  // empties it. "Nothing saved yet — add sessions from the agenda" was therefore
  // shown to attendees whose whole week was already in here.
  const error = savedError ?? sessionsError;
  const retry = savedError ? retrySaved : retrySessions;
  const subject = savedError ? 'your saved sessions' : 'the agenda';

  const { sections, clashes } = useMemo(() => {
    const mine = (sessions ?? []).filter((s) => saved.has(s.id));
    const byDay = new Map<string, typeof mine>();
    for (const s of mine) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);

    // Two sessions clash if their local intervals overlap. Comparing wall-clock
    // strings is safe here because everything is in the event's own zone.
    const clash = new Set<string>();
    for (const day of byDay.values()) {
      for (let i = 0; i < day.length; i++) {
        for (let j = i + 1; j < day.length; j++) {
          if (day[i].startsAtLocal < day[j].endsAtLocal && day[j].startsAtLocal < day[i].endsAtLocal) {
            clash.add(day[i].id);
            clash.add(day[j].id);
          }
        }
      }
    }

    return {
      sections: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, data]) => ({ title: day, data })),
      clashes: clash,
    };
  }, [sessions, saved]);

  return (
    <>
      <PushedHeader title="My schedule" backTitle="Me" backHref="/me" />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ flexGrow: 1, padding: Spacing.md, paddingBottom: Spacing.xxl }}
          ListHeaderComponent={
            placements.length ? (
              <View style={{ paddingBottom: Spacing.md }}>
                <Text
                  variant="label"
                  tone="secondary"
                  style={{ paddingBottom: Spacing.sm, paddingLeft: Spacing.xs }}>
                  TABLES AND MEETINGS
                </Text>
                {placements.map((p, i) => (
                  <ListRow
                    key={p.id}
                    title={p.title}
                    // The organizer's own words for where and when. Blank when
                    // they set neither, which is a real state for a table that
                    // has been agreed before the room grid was.
                    subtitle={placementWhen(p) || undefined}
                    // A cancelled table is mirrored rather than dropped: "your
                    // seat is cancelled" is the one status an attendee most
                    // needs, and deleting the row would say only that it had
                    // stopped existing.
                    meta={p.status === 'cancelled' ? 'Cancelled' : p.host || undefined}
                    first={i === 0}
                    last={i === placements.length - 1}
                  />
                ))}
              </View>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <Text
              variant="label"
              tone="secondary"
              style={{ paddingBottom: Spacing.sm, paddingTop: Spacing.md, paddingLeft: Spacing.xs }}>
              {formatDayTab(section.title).toUpperCase()}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
              <SessionCard
                session={item}
                saved={isSaved(item.id)}
                first={index === 0}
                last={index === section.data.length - 1}
                onPress={() => router.push({ pathname: '/agenda/[id]', params: { id: item.id } })}
              />
              {clashes.has(item.id) ? (
                <View style={{ backgroundColor: colors.surface, paddingHorizontal: Spacing.md, paddingBottom: 8 }}>
                  <Text variant="caption" tone="danger">
                    Overlaps another session you saved
                  </Text>
                </View>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            error ? (
              <DataError error={error} subject={subject} onRetry={retry} />
            ) : (
              <EmptyState
                icon="star"
                title="Nothing saved yet"
                message="Add sessions from the agenda and they appear here, grouped by day."
              />
            )
          }
        />
      </View>
    </>
  );
}
