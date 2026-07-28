import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { SAMPLE_SPEAKERS } from '@/lib/sample-data';

export default function SpeakersScreen() {
  return (
    <Screen grouped>
      {SAMPLE_SPEAKERS.map((speaker) => (
        <Card key={speaker.id} onPress={() => router.push(`/speakers/${speaker.id}`)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
            <Avatar name={speaker.name} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{speaker.name}</Text>
              <Text variant="caption" tone="secondary">
                {speaker.title} · {speaker.company}
              </Text>
            </View>
          </View>
        </Card>
      ))}

      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        Sample data — replace with the `speakers` collection.
      </Text>
    </Screen>
  );
}
