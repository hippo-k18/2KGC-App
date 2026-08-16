import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';

import { EVENT } from '@/config/event';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Sign-in.
 *
 * Email + password is a local development affordance, not the shipping design:
 * production is a six-digit code delivered by email, which needs a Cloud
 * Function to verify and mint a token (WP-02). Password sign-in works against
 * the Auth emulator today, which is what lets the whole app be built and
 * demoed before the project moves to Blaze.
 *
 * What is *not* a stand-in is everything downstream — the account, the
 * `registered` custom claim and the security rules that read it are all real, so
 * this screen exercises the same authorization path that ships.
 */
export default function LoginScreen() {
  const colors = useTheme();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Redirect href="/home" />;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      // No navigation here — `useAuth` flips and the redirect above fires.
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setError(
        code.includes('invalid-credential') || code.includes('wrong-password')
          ? 'That email and password do not match an account.'
          : code.includes('network')
            ? 'Cannot reach the server. Is the emulator running?'
            : 'Could not sign in. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  // Filled, borderless, 17pt — the iOS form field. A stroked box with a label
  // floating above it is a web pattern and reads as one.
  const field = {
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 17,
    color: colors.text,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen grouped contentStyle={{ flexGrow: 1, justifyContent: 'center', gap: Spacing.lg }}>
        <View style={{ alignItems: 'center', gap: 6, marginBottom: Spacing.md }}>
          {/*
            The square mark rather than the full lockup: the lockup bakes in
            "The Knowledge Graph Conference" as dark navy artwork, which is
            invisible on a black background. Setting the wordmark as live text
            fixes that, and lets it scale with the reader's type size.
          */}
          <Image
            source={require('@/assets/images/kgc-mark.png')}
            style={{ width: 132, height: 132 }}
            resizeMode="contain"
            accessible
            accessibilityLabel="KGC"
          />
          <Text variant="title3">The Knowledge Graph Conference</Text>
          <Text variant="subhead" tone="secondary">
            {EVENT.venue}
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={field}
            placeholder="Email"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel="Email address"
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            style={field}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.textTertiary}
            textContentType="password"
            accessibilityLabel="Password"
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </View>

        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy || !email || !password}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          style={({ pressed }) => ({
            backgroundColor: colors.accent,
            opacity: busy || !email || !password ? 0.5 : pressed ? 0.85 : 1,
            borderRadius: Radius.md,
            alignItems: 'center',
            height: 50,
            justifyContent: 'center',
          })}>
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text variant="heading" tone="onAccent">
              Sign in
            </Text>
          )}
        </Pressable>

        {process.env.EXPO_PUBLIC_USE_EMULATOR === '1' ? (
          <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            Emulator mode. Seeded accounts use the password kgcdemo2027 —
            try amara.okonkwo@example.test
          </Text>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
