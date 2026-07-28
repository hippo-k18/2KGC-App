import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { EVENT } from '@/config/event';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { logout, useAuth } from '@/lib/auth/auth-provider';

export default function ProfileScreen() {
  const colors = useTheme();
  const { user, profile, configured } = useAuth();

  const name = profile?.name || user?.email || 'Guest';

  return (
    <Screen grouped>
      <View style={{ alignItems: 'center', gap: Spacing.sm }}>
        <Avatar name={name} size={88} />
        <Text variant="title">{name}</Text>
        {user?.email ? <Text tone="secondary">{user.email}</Text> : null}
      </View>

      {!configured && (
        <Card style={{ borderColor: colors.tint }}>
          <Text variant="heading" tone="tint">
            Design mode
          </Text>
          <Text variant="caption" tone="secondary">
            No Firebase config found, so sign-in is disabled and every tab shows
            sample data. Copy `.env.example` to `.env.local`, fill it in, then
            restart with `npx expo start -c`.
          </Text>
        </Card>
      )}

      <Card>
        <Text variant="label" tone="secondary">
          EVENT
        </Text>
        <Text variant="heading">{EVENT.name}</Text>
        <Text variant="caption" tone="secondary">
          {EVENT.venue}
        </Text>
      </Card>

      {configured && (
        <Pressable
          onPress={() => (user ? logout() : router.push('/login'))}
          style={({ pressed }) => ({
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: Radius.md,
            paddingVertical: Spacing.md,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text variant="heading" tone={user ? 'danger' : 'tint'}>
            {user ? 'Sign out' : 'Sign in'}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}
