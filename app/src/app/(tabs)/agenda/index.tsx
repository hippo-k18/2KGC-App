import { useMemo, useState } from 'react';
import { FlatList, Platform, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { SessionCard } from '@/components/session-card';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { filterSessions, formatDayTab, useDays, useSessions } from '@/lib/data/sessions';
import { useTracks } from '@/lib/data/tracks';

/**
 * The agenda — the screen the app is judged on. Almost every attendee opens it
 * several times a day, often while walking between buildings.
 *
 * Two deliberate departures from Whova, both taken from its most-cited
 * complaints: the filters persist as you move between days instead of silently
 * resetting, and eleven tracks collapse to one in a single tap rather than an
 * endless scroll.
 */
export default function AgendaScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { sessions, error, loading } = useSessions();
  const tracks = useTracks();
  const days = useDays(sessions);

  // Filter state lives above the day tabs on purpose: changing day must not
  // drop the track you picked.
  const [day, setDay] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const activeDay = day ?? days[0] ?? null;

  const visible = useMemo(
    () => (sessions ? filterSessions(sessions, { day: activeDay, trackId, search }) : []),
    [sessions, activeDay, trackId, search],
  );

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          icon="calendar"
          title="Could not load the agenda"
          message={
            process.env.EXPO_PUBLIC_USE_EMULATOR === '1'
              ? 'Is the emulator running? Try npm run dev:emulators.'
              : 'Check your connection and try again.'
          }
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/*
        On iOS and Android `NativeTabs` draws a real bottom tab bar, so the
        header starts at the top of the screen. On web it renders as a floating
        bar pinned to the top instead, which would sit on top of the title —
        this inset is purely for the browser preview.
      */}
      <View style={{ paddingTop: Platform.OS === 'web' ? 68 : Spacing.sm, gap: 12 }}>
        <View style={{ paddingHorizontal: Spacing.md }}>
          <Text variant="largeTitle">Agenda</Text>
        </View>

        {/* iOS search field: filled, rounded, no visible border. */}
        <View style={{ paddingHorizontal: Spacing.md }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Sessions, speakers, rooms"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Search the agenda"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
            style={{
              backgroundColor: colors.surface,
              borderRadius: Radius.md,
              paddingHorizontal: 12,
              // minHeight, not height: a fixed box clips its own text once
              // Dynamic Type grows past the default.
              minHeight: 38,
              paddingVertical: Spacing.sm,
              fontSize: 17,
              color: colors.text,
            }}
          />
        </View>

        {/* Day tabs. Equality on the denormalised `day` string — no range math. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
          {days.map((d) => (
            <FilterChip
              key={d}
              role="tab"
              label={formatDayTab(d)}
              selected={d === activeDay}
              onPress={() => setDay(d)}
            />
          ))}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
          <FilterChip
            label="All tracks"
            selected={trackId === null}
            onPress={() => setTrackId(null)}
          />
          {tracks.map((t) => (
            <FilterChip
              key={t.id}
              label={t.name}
              dotColor={t.color}
              selected={trackId === t.id}
              onPress={() => setTrackId(trackId === t.id ? null : t.id)}
            />
          ))}
        </ScrollView>

        <View style={{ height: HAIRLINE, backgroundColor: colors.border }} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{
          paddingHorizontal: Spacing.md,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.xxl,
        }}
        renderItem={({ item, index }) => (
          <SessionCard
            session={item}
            first={index === 0}
            last={index === visible.length - 1}
            onPress={() => router.push({ pathname: '/agenda/[id]', params: { id: item.id } })}
          />
        )}
        ListHeaderComponent={
          visible.length ? (
            <Text
              variant="label"
              tone="secondary"
              style={{ paddingBottom: Spacing.sm, paddingLeft: Spacing.xs }}>
              {visible.length} {visible.length === 1 ? 'SESSION' : 'SESSIONS'}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="magnifyingglass"
              title={search || trackId ? 'No matches' : 'No sessions yet'}
              message={
                search || trackId
                  ? 'Try another track, or clear the search.'
                  : 'The programme appears here once it is published.'
              }
            />
          )
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}
