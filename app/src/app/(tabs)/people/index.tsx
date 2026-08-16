import { useMemo, useState } from 'react';
import { FlatList, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { ListRow } from '@/components/list-row';
import { MessagesButton } from '@/components/messages-button';
import { ScreenHeader } from '@/components/screen-header';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  searchAttendees,
  useDirectory,
  useInterests,
  useSpeakers,
  useSponsors,
} from '@/lib/data/directory';
import { useAuth } from '@/lib/auth/auth-provider';

type Segment = 'attendees' | 'speakers' | 'sponsors';

/**
 * People — attendees, speakers and sponsors as segments of one tab.
 *
 * Whova scatters these across three places, two of which are behind a tile grid
 * most attendees never open. They are the same question — "who is here?" — so
 * they belong behind one control.
 */
export default function PeopleScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [segment, setSegment] = useState<Segment>('attendees');
  const [search, setSearch] = useState('');
  const [interest, setInterest] = useState<string | null>(null);

  const { people, loading } = useDirectory();
  const { speakers } = useSpeakers();
  const { sponsors } = useSponsors();
  const interests = useInterests(people);

  const visiblePeople = useMemo(
    () => (people ? searchAttendees(people, search, interest) : []),
    [people, search, interest],
  );

  const visibleSpeakers = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (speakers ?? []).filter(
      (s) =>
        !n ||
        s.name.toLowerCase().includes(n) ||
        (s.company ?? '').toLowerCase().includes(n),
    );
  }, [speakers, search]);

  const visibleSponsors = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (sponsors ?? []).filter((s) => !n || s.name.toLowerCase().includes(n));
  }, [sponsors, search]);

  const count =
    segment === 'attendees'
      ? visiblePeople.length
      : segment === 'speakers'
        ? visibleSpeakers.length
        : visibleSponsors.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="People" trailing={<MessagesButton />} />

      <View style={{ gap: 12, paddingTop: 12 }}>
        <View style={{ paddingHorizontal: Spacing.md }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${segment}`}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={`Search ${segment}`}
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
            style={{
              backgroundColor: colors.surface,
              borderRadius: Radius.md,
              paddingHorizontal: 12,
              height: 38,
              fontSize: 17,
              color: colors.text,
            }}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
          {(['attendees', 'speakers', 'sponsors'] as Segment[]).map((s) => (
            <FilterChip
              key={s}
              label={s[0].toUpperCase() + s.slice(1)}
              selected={segment === s}
              onPress={() => {
                setSegment(s);
                setInterest(null);
              }}
            />
          ))}
        </ScrollView>

        {segment === 'attendees' && interests.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
            <FilterChip
              label="All interests"
              selected={interest === null}
              onPress={() => setInterest(null)}
            />
            {interests.map((i) => (
              <FilterChip
                key={i}
                label={i}
                selected={interest === i}
                onPress={() => setInterest(interest === i ? null : i)}
              />
            ))}
          </ScrollView>
        ) : null}

        <View style={{ height: HAIRLINE, backgroundColor: colors.border }} />
      </View>

      <FlatList
        data={
          segment === 'attendees'
            ? visiblePeople
            : segment === 'speakers'
              ? visibleSpeakers
              : visibleSponsors
        }
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{
          paddingHorizontal: Spacing.md,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.xxl,
        }}
        ListHeaderComponent={
          count ? (
            <Text
              variant="label"
              tone="secondary"
              style={{ paddingBottom: Spacing.sm, paddingLeft: Spacing.xs }}>
              {count} {count === 1 ? 'RESULT' : 'RESULTS'}
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          const last = index === count - 1;
          if (segment === 'sponsors') {
            const s = item as (typeof visibleSponsors)[number];
            return (
              <ListRow
                leading={<Avatar name={s.name} photoURL={s.logoURL} />}
                title={s.name}
                subtitle={s.tier[0].toUpperCase() + s.tier.slice(1)}
                meta={s.boothLocation ? `Booth ${s.boothLocation}` : undefined}
                first={index === 0}
                last={last}
              />
            );
          }
          if (segment === 'speakers') {
            const s = item as (typeof visibleSpeakers)[number];
            return (
              <ListRow
                leading={<Avatar name={s.name} photoURL={s.photoURL} />}
                title={s.name}
                subtitle={[s.title, s.company].filter(Boolean).join(' · ') || undefined}
                meta={s.sessionIds?.length ? `${s.sessionIds.length} session${s.sessionIds.length > 1 ? 's' : ''}` : undefined}
                first={index === 0}
                last={last}
              />
            );
          }
          const p = item as (typeof visiblePeople)[number];
          return (
            <ListRow
              leading={<Avatar name={p.name} photoURL={p.photoURL} />}
              title={p.name + (p.uid === user?.uid ? '  (you)' : '')}
              subtitle={[p.title, p.company].filter(Boolean).join(' · ') || undefined}
              meta={p.interests?.slice(0, 2).join(' · ')}
              first={index === 0}
              last={last}
              onPress={() => router.push({ pathname: '/people/[uid]', params: { uid: p.uid } })}
            />
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="person.2"
              title={search ? 'No matches' : 'Nobody here yet'}
              message={
                search
                  ? 'Try a different name or company.'
                  : 'Attendees appear here as they join and opt in.'
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
