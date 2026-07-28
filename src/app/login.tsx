import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { EVENT } from '@/config/event';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Sign-in screen. The input and layout are real; the submit handler is not
 * wired to Firebase yet because passwordless email links need deep-link
 * configuration on a native build — see "Auth" in README.md.
 */
export default function LoginScreen() {
  const colors = useTheme();
  const [email, setEmail] = useState('');

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Screen grouped contentStyle={{ gap: Spacing.lg, padding: Spacing.lg }}>
      <View style={{ gap: Spacing.xs }}>
        <Text variant="largeTitle">{EVENT.shortName}</Text>
        <Text tone="secondary">
          Sign in with the email address on your {EVENT.name} ticket.
        </Text>
      </View>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: Radius.md,
          padding: Spacing.md,
          fontSize: 16,
          color: colors.text,
        }}
      />

      <Pressable
        disabled={!valid}
        onPress={() => router.back()}
        style={({ pressed }) => ({
          backgroundColor: valid ? colors.accent : colors.border,
          borderRadius: Radius.md,
          paddingVertical: Spacing.md,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        })}>
        <Text variant="heading" tone={valid ? 'onAccent' : 'secondary'}>
          Send sign-in link
        </Text>
      </Pressable>

      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        Not wired to Firebase yet. Access is limited to addresses on the imported
        attendee list.
      </Text>
    </Screen>
  );
}
