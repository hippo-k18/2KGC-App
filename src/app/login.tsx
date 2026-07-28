import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/text';
import { DEMO_CREDENTIALS } from '@/config/demo';
import { EVENT } from '@/config/event';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDemoAuth } from '@/lib/auth/demo-auth';

export default function LoginScreen() {
  const colors = useTheme();
  const { signIn } = useDemoAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    const message = await signIn(username, password);
    setBusy(false);

    if (message) {
      setError(message);
      return;
    }
    router.replace('/home');
  }

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 16,
    color: colors.text,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: Spacing.lg,
          gap: Spacing.lg,
        }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: Spacing.xs }}>
          <Text variant="largeTitle">{EVENT.shortName}</Text>
          <Text tone="secondary">{EVENT.name}</Text>
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text variant="label" tone="secondary">
            USERNAME
          </Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder={DEMO_CREDENTIALS.username}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            style={inputStyle}
          />

          <Text variant="label" tone="secondary" style={{ marginTop: Spacing.sm }}>
            PASSWORD
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            onSubmitEditing={() => {
              if (canSubmit) handleSubmit();
            }}
            returnKeyType="go"
            style={inputStyle}
          />
        </View>

        {error ? (
          <Text tone="danger" variant="caption">
            {error}
          </Text>
        ) : null}

        <Pressable
          disabled={!canSubmit}
          onPress={handleSubmit}
          style={({ pressed }) => ({
            backgroundColor: canSubmit ? colors.accent : colors.border,
            borderRadius: Radius.md,
            paddingVertical: Spacing.md,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}>
          <Text variant="heading" tone={canSubmit ? 'onAccent' : 'secondary'}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Text>
        </Pressable>

        {/* Demo build only — remove along with src/config/demo.ts. */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.tint,
            borderRadius: Radius.md,
            padding: Spacing.md,
            gap: Spacing.xs,
          }}>
          <Text variant="label" tone="tint">
            DEMO ACCOUNT
          </Text>
          <Text variant="caption" tone="secondary">
            Username: {DEMO_CREDENTIALS.username}
          </Text>
          <Text variant="caption" tone="secondary">
            Password: {DEMO_CREDENTIALS.password}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
