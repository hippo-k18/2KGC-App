import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';

import { EVENT } from '@/config/event';
import { useEventSettings } from '@/lib/data/event-settings';
import { contactAddress, PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Sign-in: email and password, straight to `signInWithEmailAndPassword`.
 *
 * There is no "Create account" here (owner decision, 2026-10-12): an app
 * account comes with a ticket, so nobody sets one up from this screen. The
 * code flow that used to sit behind that button (`lib/auth/otp.ts`, served by
 * `apps/web` at `/api/auth/request-code` and `/api/auth/verify-code`) is left in
 * place on the server; this screen no longer calls it.
 *
 * Nothing about passwords, and no printed credential. A sign-in form that
 * explains a temporary password is printing a hint to whoever is holding the
 * phone, which is the demo-panel mistake in a smaller box. `/change-password`
 * is where that conversation belongs, after the attendee has proved who
 * they are.
 */
export default function LoginScreen() {
  const colors = useTheme();
  const { event, branding } = useEventSettings();
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
      // Exactly what was typed. There is no mapping layer here any more — the
      // one that existed turned `demo` / `123` into a real credential on a live
      // project, which is a guessable password behind two characters of UI.
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      // No navigation here — `useAuth` flips and the redirect above fires.
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setError(
        code.includes('invalid-credential') || code.includes('wrong-password')
          ? 'That email and password do not match an account.'
          : code.includes('network')
            ? 'Cannot reach the server. Check your connection.'
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

  // A bare text link is a 20pt line box. The box is grown rather than given
  // `hitSlop`, which the web build ignores.
  const textLink = {
    minHeight: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;

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
          {/* The logo, name and tagline saved on the dashboard, once there are any. */}
          <Image
            source={
              branding.logoUrl ? { uri: branding.logoUrl } : require('@/assets/images/kgc-mark.png')
            }
            style={{ width: branding.logoUrl ? 220 : 132, height: 132 }}
            resizeMode="contain"
            accessible
            accessibilityLabel={event.shortName}
          />
          <Text variant="title3" style={{ textAlign: 'center' }}>
            {event.name === EVENT.name ? 'The Knowledge Graph Conference' : event.name}
          </Text>
          {branding.tagline ? (
            <Text variant="subhead" style={{ textAlign: 'center' }}>
              {branding.tagline}
            </Text>
          ) : null}
          <Text variant="subhead" tone="secondary" style={{ textAlign: 'center' }}>
            {event.datesLong} · {event.venue}
          </Text>
        </View>

        <Text variant="heading">Sign in</Text>

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
          returnKeyType="next"
        />

        <TextInput
          value={password}
          onChangeText={setPassword}
          style={field}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          textContentType="password"
          accessibilityLabel="Password"
          onSubmitEditing={submit}
          returnKeyType="go"
        />

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



        {/*
          The support address saved on the dashboard, or the conference's own
          when none is set, and the privacy policy and terms (T212). Both stores
          want these reachable before signing in.
        */}
        <Pressable
          onPress={() => void Linking.openURL(`mailto:${contactAddress(branding.supportEmail)}`)}
          accessibilityRole="link"
          accessibilityLabel={`Email ${contactAddress(branding.supportEmail)} for help`}
          style={textLink}>
          <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            Trouble signing in? Write to{' '}
            <Text variant="caption" tone="tint">
              {contactAddress(branding.supportEmail)}
            </Text>
          </Text>
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg }}>
          <Pressable
            onPress={() => void Linking.openURL(PRIVACY_URL)}
            accessibilityRole="link"
            style={textLink}>
            <Text variant="caption" tone="tint">
              Privacy policy
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(TERMS_URL)}
            accessibilityRole="link"
            style={textLink}>
            <Text variant="caption" tone="tint">
              Terms
            </Text>
          </Pressable>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
