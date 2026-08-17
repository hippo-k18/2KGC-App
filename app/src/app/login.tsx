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
/**
 * The demo shortcut: type `demo` / `123` and you are in.
 *
 * Firebase Auth will not accept either value literally — it wants an address in
 * the first field and at least six characters in the second — so this maps them
 * onto the real seeded credentials. Nothing about the account is weakened: the
 * password on `demo_000` is still what `npm run claims` set, the custom claims
 * are real, and the security rules that read them are the same ones that ship.
 * The only thing that changes is what has to be typed on a stage.
 *
 * **It is deliberately confined to the emulator.** `demo` / `123` against a live
 * project would be a real credential, guessable in two attempts, on an account
 * that here happens to hold the `organizer` role. Gated this way the shortcut
 * cannot outlive the demo: point the app at production and the field reverts to
 * an ordinary email box.
 */
const USE_EMULATOR = process.env.EXPO_PUBLIC_USE_EMULATOR === '1';
const DEMO_USERNAME = 'demo';
const DEMO_PASSCODE = '123';
const DEMO_EMAIL = 'amara.okonkwo@example.test';
/** Set by `scripts/src/set-claims.ts`; changing it there means changing it here. */
const DEMO_REAL_PASSWORD = 'kgcdemo2027';

/**
 * What actually gets sent to Firebase.
 *
 * The second branch accepts a bare local part — `kwame.adeyemi` for
 * `kwame.adeyemi@example.test` — because on a stage the likeliest slip is
 * dropping the domain, and "that email and password do not match an account" is
 * a poor thing to be reading aloud to a room.
 *
 * It does **not** accept a uid like `demo_004`. The seed derives addresses from
 * the person's name, not from their uid, so `demo_004@example.test` belongs to
 * nobody. Worth stating because the uids are the visible handle everywhere else
 * in this codebase, so the mapping looks like it ought to work.
 */
function resolveCredentials(username: string, password: string) {
  const u = username.trim().toLowerCase();

  if (USE_EMULATOR && u === DEMO_USERNAME && password === DEMO_PASSCODE) {
    return { email: DEMO_EMAIL, password: DEMO_REAL_PASSWORD };
  }
  if (USE_EMULATOR && !u.includes('@') && u) {
    return { email: `${u}@example.test`, password: password || DEMO_REAL_PASSWORD };
  }
  return { email: username.trim(), password };
}

export default function LoginScreen() {
  const colors = useTheme();
  const { user, loading } = useAuth();
  // Prefilled in emulator mode. The fastest sign-in on stage is one that needs
  // no typing at all, and the credentials are printed below the form anyway.
  const [email, setEmail] = useState(USE_EMULATOR ? DEMO_USERNAME : '');
  const [password, setPassword] = useState(USE_EMULATOR ? DEMO_PASSCODE : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Redirect href="/home" />;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const creds = resolveCredentials(email, password);
      await signInWithEmailAndPassword(getFirebaseAuth(), creds.email, creds.password);
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
            placeholder={USE_EMULATOR ? 'Username' : 'Email'}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            // Not `email-address` in emulator mode: that keyboard leads with an
            // "@" key for a field whose expected value is the word "demo".
            keyboardType={USE_EMULATOR ? 'default' : 'email-address'}
            textContentType={USE_EMULATOR ? 'username' : 'emailAddress'}
            accessibilityLabel={USE_EMULATOR ? 'Username' : 'Email address'}
            onSubmitEditing={submit}
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

        {USE_EMULATOR ? (
          <View style={{ gap: 4 }}>
            {/*
              Printed rather than remembered. The fields arrive prefilled, so this
              is here for the moment someone clears them, or wants to sign in as a
              second attendee to show a message arriving.
            */}
            <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              Demo sign-in — username{' '}
              <Text variant="caption" tone="tint">
                demo
              </Text>
              , password{' '}
              <Text variant="caption" tone="tint">
                123
              </Text>
            </Text>
            <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
              Any seeded attendee also works, by name — type kwame.adeyemi, or the
              full {DEMO_EMAIL} — with the password {DEMO_REAL_PASSWORD}.
            </Text>
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
