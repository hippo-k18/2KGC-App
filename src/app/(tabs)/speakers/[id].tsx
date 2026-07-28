import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { SAMPLE_SESSIONS, SAMPLE_SPEAKERS } from '@/lib/sample-data';

export default function SpeakerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const speaker = SAMPLE_SPEAKERS.find((s) => s.id === id);

  if (!speaker) {
    return (
      <Screen grouped>
        <EmptyState
          icon="questionmark.circle"
          title="Speaker not found"
          message={`No speaker matches id "${id}".`}
        />
      </Screen>
    );
  }

  const sessions = SAMPLE_SESSIONS.filter((s) => s.speakers.includes(speaker.name));

  return (
    <>
      <Stack.Screen options={{ title: speaker.name }} />
      <Screen grouped>
        <View style={{ alignItems: 'center', gap: Spacing.sm }}>
          <Avatar name={speaker.name} size={88} />
          <Text variant="title">{speaker.name}</Text>
          <Text tone="secondary" style={{ textAlign: 'center' }}>
            {speaker.title} · {speaker.company}
          </Text>
        </View>

        <Card>
          <Text>{speaker.bio}</Text>
        </Card>

        {sessions.length > 0 && (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="heading">Sessions</Text>
            {sessions.map((session) => (
              <Card key={session.id}>
                <Text variant="label" tone="tint">
                  {session.start} – {session.end}
                </Text>
                <Text variant="heading">{session.title}</Text>
              </Card>
            ))}
          </View>
        )}
      </Screen>
    </>
  );
}
