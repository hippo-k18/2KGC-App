import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
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
import {
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  EMAIL_SHAPE,
  requestSignInCode,
  signInWithCode,
} from '@/lib/auth/otp';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Sign-in. Two ways in, and the emailed code comes first.
 *
 * ── The two paths ──────────────────────────────────────────────────────────
 *
 *   **Email me a sign-in code** (the default panel). Every real ticket holder
 *   signs in this way: accounts made from a purchase have no password. The
 *   code is requested from `apps/web` at `/api/auth/request-code` and redeemed
 *   at `/api/auth/verify-code`, one implementation in
 *   `@kgc/scripts/src/lib/otp-core.ts`.
 *
 *   **Sign in with a password** (a link under it). For an account somebody gave
 *   a password to, such as the shared demo login, or an attendee who chose one
 *   on `/change-password`.
 *
 * There is no "Create account" (owner decision, 2026-10-12): no app account
 * without a ticket. The code path already holds to that. `verifySignInCode`
 * mints an account only after the code is redeemed *and* an active
 * `registrations` document is found for the address, so somebody with no
 * ticket who types a correct code is refused and gets nothing.
 *
 * ── The property this screen must not break ────────────────────────────────
 *
 * The screen after "Email me a sign-in code" is **the same screen for every
 * address**. `requestSignInCode` deliberately answers identically whether or
 * not an address holds a ticket, which is what stops it being a query against
 * the delegate list. Nothing here may vary on that: not the copy, not the
 * destination, not the shape of a failure. See the header of `lib/auth/otp.ts`
 * for the three ways a UI can undo it.
 *
 * Ticket status is disclosed exactly once, on a *failed verify*, and that is
 * safe: by then the caller has proved they read the mailbox.
 *
 * ── The keyboard ───────────────────────────────────────────────────────────
 *
 * On an iPhone SE the keyboard covered the Sign in button (T208), and it still
 * covered "Email me a sign-in code" with the scroll view inset by the keyboard:
 * the column is centred in the full screen height, so an inset does not move
 * it. On iOS the column is now padded by the keyboard's height, so it centres
 * in the space above the keys, and the logo block steps aside while the
 * keyboard is up so the field, the button and the other-path link all fit.
 * Android resizes the window for the keyboard itself.
 *
 * Nothing about passwords, and no printed credential. A sign-in form that
 * explains a temporary password is printing a hint to whoever is holding the
 * phone, which is the demo-panel mistake in a smaller box.
 */
/**
 * The shared Expo Go preview (`scripts/expo-go-share.sh`) signs straight in to
 * the read-only demo login, so somebody who scans the QR lands on Home. The two
 * values are compiled in only by that script; every other build leaves them
 * empty and this screen behaves exactly as described above. The account is
 * read-only by claim and rules (T224/T227), and its password is already printed
 * on the handout that carries the QR, so the bundle discloses nothing new.
 */
const PREVIEW_DEMO_EMAIL = process.env.EXPO_PUBLIC_PREVIEW_DEMO_EMAIL ?? '';
const PREVIEW_DEMO_PASSWORD = process.env.EXPO_PUBLIC_PREVIEW_DEMO_PASSWORD ?? '';
const PREVIEW_DEMO = PREVIEW_DEMO_EMAIL !== '' && PREVIEW_DEMO_PASSWORD !== '';
/** Once per launch, so signing out of the preview stays signed out. */
let previewAutoTried = false;

export default function LoginScreen() {
  const colors = useTheme();
  const { event, branding } = useEventSettings();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /**
   * Confirmations, kept apart from `error` so a resend never has to be phrased
   * as a failure. Nothing in here may describe the *address*; see the
   * anti-enumeration note in the file header.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Which panel is on screen: `'email'` asks for the address, `'code'` takes
   * the six digits, `'password'` is the secondary path.
   *
   * ⚠️ `'code'` is reached **only after `requestSignInCode` has actually
   * returned**, never optimistically and never because the address "looked
   * known". A code box shown after a failed request is a screen that says a
   * code was sent when none was.
   */
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  /**
   * The address the code was requested for, frozen at the moment of the
   * request. Read back on screen so an attendee who mistyped can see it, and
   * used for the verify call so that editing the field afterwards cannot
   * silently redeem a code against a different address.
   */
  const [codeFor, setCodeFor] = useState('');
  const [code, setCode] = useState('');

  const keyboardHeight = useIosKeyboardHeight();
  // With the keyboard up, the logo block steps aside so the form, its button
  // and the link to the other way in all sit above the keys. On an iPhone 17
  // Pro the logo still left the link under the keyboard; on an SE it left the
  // button there.
  const compact = keyboardHeight > 0;

  useEffect(() => {
    if (!PREVIEW_DEMO || loading || user || previewAutoTried) return;
    previewAutoTried = true;
    void signInPreviewDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  async function signInPreviewDemo() {
    setError(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), PREVIEW_DEMO_EMAIL, PREVIEW_DEMO_PASSWORD);
    } catch {
      setError('Could not open the demo. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (user) return <Redirect href="/home" />;

  const emailLooksValid = EMAIL_SHAPE.test(email.trim().toLowerCase());

  /**
   * Ask for a code, and, whatever the address turns out to be, land on the
   * same screen with the same words. `resend` only changes which message is
   * shown on success.
   */
  async function sendCode(resend = false) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const address = email.trim().toLowerCase();
      const result = await requestSignInCode(address);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCodeFor(address);
      setCode('');
      setStep('code');
      setNotice(resend ? 'Another code has been requested. Use the most recent one.' : null);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);
    setBusy(true);
    try {
      const result = await signInWithCode(codeFor, code);
      if (!result.ok) setError(result.message);
      // No navigation on success: `useAuth` flips and the redirect above fires.
    } finally {
      setBusy(false);
    }
  }

  function show(next: 'email' | 'password') {
    setStep(next);
    setCode('');
    setPassword('');
    setError(null);
    setNotice(null);
  }

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
    <Screen
      grouped
      persistTaps
      contentStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        gap: Spacing.lg,
        paddingBottom: Spacing.md + keyboardHeight,
      }}>
      {compact ? null : (
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
      )}

      {PREVIEW_DEMO ? (
        <Pressable
          onPress={signInPreviewDemo}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="View the demo"
          style={({ pressed }) => ({
            backgroundColor: colors.accent,
            opacity: busy ? 0.5 : pressed ? 0.85 : 1,
            borderRadius: Radius.md,
            alignItems: 'center',
            height: 50,
            justifyContent: 'center',
          })}>
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text variant="heading" tone="onAccent">
              View the demo
            </Text>
          )}
        </Pressable>
      ) : null}

      {step === 'code' ? (
        <>
          <View style={{ gap: 6 }}>
            <Text variant="heading">Enter your {CODE_LENGTH}-digit code</Text>
            {/*
              Deliberately not "we've emailed you a code". The request answers
              the same whether the send succeeded or the address holds no
              ticket, so this screen cannot know that anything arrived. It says
              what is true instead.
            */}
            <Text variant="subhead" tone="secondary">
              A code was requested for {codeFor}. Codes expire after {CODE_TTL_MINUTES} minutes. If
              one does not arrive, send another.
            </Text>
          </View>

          <TextInput
            value={code}
            // Digits only, capped at six. The server rejects anything else with
            // `invalid-argument`, which reads the same as a wrong code.
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            style={{ ...field, fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
            placeholder="······"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            accessibilityLabel={`${CODE_LENGTH}-digit sign-in code`}
            onSubmitEditing={submitCode}
            returnKeyType="go"
          />

          {notice ? (
            <Text variant="subhead" tone="secondary" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={submitCode}
            disabled={busy || code.length !== CODE_LENGTH}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              opacity: busy || code.length !== CODE_LENGTH ? 0.5 : pressed ? 0.85 : 1,
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

          <View style={{ alignItems: 'center' }}>
            <Pressable
              onPress={() => sendCode(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Send another code"
              style={textLink}>
              <Text variant="subhead" tone="tint">
                Send another code
              </Text>
            </Pressable>
            <Pressable
              onPress={() => show('email')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Use a different email address"
              style={textLink}>
              <Text variant="subhead" tone="secondary">
                Use a different address
              </Text>
            </Pressable>
          </View>
        </>
      ) : step === 'password' ? (
        <>
          <Text variant="heading">Sign in with a password</Text>

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

          <Pressable
            onPress={() => show('email')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Email me a sign-in code instead"
            style={textLink}>
            <Text variant="subhead" tone="tint">
              Email me a code instead
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Text variant="heading">Sign in</Text>
            <Text variant="subhead" tone="secondary">
              Use the email you bought your ticket with. We will email you a {CODE_LENGTH}-digit
              code.
            </Text>
          </View>

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
            autoComplete="email"
            accessibilityLabel="Email address"
            onSubmitEditing={() => {
              if (emailLooksValid) void sendCode();
            }}
            returnKeyType="send"
          />

          {error ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          {/*
            Enabled on the same regex the server uses, so the button is live for
            exactly the addresses the endpoint accepts, and for every one of them
            equally, ticket or not. Anything narrower here would be the
            enumeration oracle rebuilt on the client.
          */}
          <Pressable
            onPress={() => sendCode()}
            disabled={busy || !emailLooksValid}
            accessibilityRole="button"
            accessibilityLabel="Email me a sign-in code"
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              opacity: busy || !emailLooksValid ? 0.5 : pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              alignItems: 'center',
              height: 50,
              justifyContent: 'center',
            })}>
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text variant="heading" tone="onAccent">
                Email me a sign-in code
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => show('password')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sign in with a password"
            style={textLink}>
            <Text variant="subhead" tone="tint">
              Sign in with a password
            </Text>
          </Pressable>
        </>
      )}

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
  );
}

/**
 * The on-screen keyboard's height on iOS, 0 while it is hidden and always 0
 * elsewhere (Android resizes the window instead, and web has no keyboard).
 * `keyboardWillShow` rather than `Did` so the layout moves with the keys.
 */
function useIosKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
