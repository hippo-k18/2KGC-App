import { useMemo } from 'react';
import { SectionList, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { SessionCard } from '@/components/session-card';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const { sessions } = useSessions();
  const { saved, isSaved } = useSavedSessions();

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
      <Stack.Screen options={{ headerShown: true, title: 'My schedule', headerBackTitle: 'Me' }} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xxl }}
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
            <EmptyState
              icon="star"
              title="Nothing saved yet"
              message="Add sessions from the agenda and they appear here, grouped by day."
            />
          }
        />
      </View>
    </>
  );
}
