import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SAMPLE_SESSIONS } from '@/lib/sample-data';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const [saved, setSaved] = useState(false);

  const session = SAMPLE_SESSIONS.find((s) => s.id === id);

  if (!session) {
    return (
      <Screen grouped>
        <EmptyState
          icon="questionmark.circle"
          title="Session not found"
          message={`No session matches id "${id}".`}
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: session.track }} />
      <Screen grouped>
        <Text variant="title">{session.title}</Text>

        <Card>
          <Text variant="label" tone="secondary">
            TIME
          </Text>
          <Text>
            {session.start} – {session.end}
          </Text>
          <Text variant="label" tone="secondary" style={{ marginTop: Spacing.sm }}>
            LOCATION
          </Text>
          <Text>{session.room}</Text>
          <Text variant="label" tone="secondary" style={{ marginTop: Spacing.sm }}>
            SPEAKERS
          </Text>
          <Text>{session.speakers.join(', ')}</Text>
        </Card>

        {/* Saving to a personal agenda is the core Whova interaction. */}
        <Pressable
          onPress={() => setSaved((s) => !s)}
          style={({ pressed }) => ({
            backgroundColor: saved ? colors.surface : colors.accent,
            borderWidth: 1,
            borderColor: saved ? colors.border : colors.accent,
            borderRadius: Radius.md,
            paddingVertical: Spacing.md,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text variant="heading" tone={saved ? 'primary' : 'onAccent'}>
            {saved ? 'Saved to My Agenda' : 'Save to My Agenda'}
          </Text>
        </Pressable>

        <View style={{ gap: Spacing.xs }}>
          <Text variant="heading">About this session</Text>
          <Text tone="secondary">
            Description, slides, live Q&amp;A and polls attach here. They come from
            the `sessions` document and its `questions` / `polls` subcollections.
          </Text>
        </View>
      </Screen>
    </>
  );
}
