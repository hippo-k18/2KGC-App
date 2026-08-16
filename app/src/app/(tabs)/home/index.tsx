import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ListRow, SectionHeader } from '@/components/list-row';
import { MessagesButton } from '@/components/messages-button';
import { ScreenHeader } from '@/components/screen-header';
import { SessionCard } from '@/components/session-card';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAnnouncements, useNowNext } from '@/lib/data/announcements';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { formatDayTab, useSessions } from '@/lib/data/sessions';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * Home — "what is happening, and where do I go next".
 *
 * Whova has no equivalent screen: its home is a grid of tiles linking to other
 * sections. This answers the actual question an attendee has when they take
 * their phone out mid-conference, which is why it earns the most polish per day
 * of anything in the app.
 *
 * At Cornell Tech the room matters more than usual — sessions sit across three
 * buildings and you walk outside between them.
 */
export default function HomeScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { sessions } = useSessions();
  const { now, next, usingFallback } = useNowNext(sessions);
  const announcements = useAnnouncements();
  const { isSaved } = useSavedSessions();

  const open = (id: string) => router.push({ pathname: '/agenda/[id]', params: { id } });
  const firstName = profile?.name?.split(' ')[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }}>
        <ScreenHeader
          trailing={<MessagesButton />}
          title={firstName ? `Hello, ${firstName}` : 'KGC 2027'}
          subtitle={
            usingFallback
              ? `Programme preview — ${sessions?.length ? formatDayTab(sessions[0].day) : ''}`
              : undefined
          }
        />

        <View style={{ paddingHorizontal: Spacing.md }}>
          {now.length ? (
            <>
              <SectionHeader>{usingFallback ? 'Opens with' : 'Happening now'}</SectionHeader>
              <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
                {now.map((s, i) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    saved={isSaved(s.id)}
                    first={i === 0}
                    last={i === now.length - 1}
                    onPress={() => open(s.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {next.length ? (
            <>
              <SectionHeader>{usingFallback ? 'Then' : 'Up next'}</SectionHeader>
              <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
                {next.map((s, i) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    saved={isSaved(s.id)}
                    first={i === 0}
                    last={i === next.length - 1}
                    onPress={() => open(s.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {announcements.length ? (
            <>
              <SectionHeader>Announcements</SectionHeader>
              <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
                {announcements.slice(0, 4).map((a, i, arr) => (
                  <ListRow
                    key={a.id}
                    title={a.title}
                    subtitle={a.body}
                    first={i === 0}
                    last={i === arr.length - 1}
                  />
                ))}
              </View>
            </>
          ) : null}

          <SectionHeader>Shortcuts</SectionHeader>
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            <ListRow
              title="My schedule"
              onPress={() => router.push('/me/schedule')}
              trailing={<Chevron />}
              first
            />
            <ListRow
              title="Attendees"
              onPress={() => router.push('/people')}
              trailing={<Chevron />}
            />
            <ListRow
              title="Community board"
              onPress={() => router.push('/community')}
              trailing={<Chevron />}
              last
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Chevron() {
  return (
    <Text variant="body" tone="tertiary" accessibilityElementsHidden>
      ›
    </Text>
  );
}
