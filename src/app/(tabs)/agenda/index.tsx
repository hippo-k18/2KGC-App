import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SAMPLE_DAYS, SAMPLE_SESSIONS } from '@/lib/sample-data';

export default function AgendaScreen() {
  const colors = useTheme();
  const [day, setDay] = useState(SAMPLE_DAYS[0].id);

  const sessions = SAMPLE_SESSIONS.filter((s) => s.day === day);

  return (
    <ScrollView
      style={{ backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md }}>
      {/* Day selector. Whova's agenda is day-first, so this drives everything. */}
      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        {SAMPLE_DAYS.map((d) => {
          const active = d.id === day;
          return (
            <Pressable
              key={d.id}
              onPress={() => setDay(d.id)}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: Spacing.sm,
                borderRadius: Radius.md,
                backgroundColor: active ? colors.accent : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.border,
              }}>
              <Text variant="label" tone={active ? 'onAccent' : 'secondary'}>
                {d.label.toUpperCase()}
              </Text>
              <Text variant="heading" tone={active ? 'onAccent' : 'primary'}>
                {d.date}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {sessions.map((session) => (
        <Card key={session.id} onPress={() => router.push(`/agenda/${session.id}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="label" tone="tint">
              {session.start} – {session.end}
            </Text>
            <Text variant="label" tone="secondary">
              {session.track.toUpperCase()}
            </Text>
          </View>
          <Text variant="heading">{session.title}</Text>
          <Text variant="caption" tone="secondary">
            {session.room} · {session.speakers.join(', ')}
          </Text>
        </Card>
      ))}

      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        Sample data — replace with the `sessions` collection.
      </Text>
    </ScrollView>
  );
}
