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
 * Sign-in — two named choices, because there are genuinely two situations.
 *
 * ── The screen ─────────────────────────────────────────────────────────────
 *
 * A landing with two buttons, and each opens exactly one form:
 *
 *   **Sign in** — email + password, straight to `signInWithEmailAndPassword`.
 *     For an attendee who has been here before and chosen a password.
 *
 *   **Create account** — email, a six-digit code from that mailbox, then
 *     `/change-password` to choose a password. For an attendee holding a ticket
 *     who has not signed in yet.
 *
 * The previous version showed both forms stacked on one screen, with "email me
 * a code" as the primary action and a password box under an "or" rule. That
 * asked every arriving attendee to work out which of two things they were,
 * from two controls that looked like alternatives rather than answers. Naming
 * the two situations is the whole change.
 *
 * ⚠️ **"Create account" is a misnomer that is kept on purpose.** It does not
 * create anything on its own — `verifySignInCode` mints the account only after
 * the code is redeemed *and* an active `registrations` document is found for
 * the address. Somebody with no ticket can press it, receive a code, type it
 * correctly and still be refused. The button is named for what the attendee is
 * trying to do, not for what the server does, because "first time here?" is the
 * question they can actually answer about themselves.
 *
 * ── The property this screen must not break ────────────────────────────────
 *
 * The screen after "email me a code" is **the same screen for every address**.
 * `requestSignInCode` deliberately answers identically whether or not an
 * address holds a ticket, which is what stops it being a query against the
 * delegate list. Nothing here may vary on that — not the copy, not the
 * destination, not the shape of a failure. See the header of `lib/auth/otp.ts`
 * for the three ways a UI can undo it.
 *
 * Ticket status is disclosed exactly once, on a *failed verify*, and that is
 * safe: by then the caller has proved they read the mailbox.
 *
 * ── Where the code flow now runs ───────────────────────────────────────────
 *
 * Not Cloud Functions. `requestOtp` / `verifyOtp` were never deployable on this
 * project — the grant is `iam.serviceAccounts.ActAs` and only the owner can
 * give it (OWNER-ACTIONS.md §3) — so the same logic is served by `apps/web` at
 * `/api/auth/request-code` and `/api/auth/verify-code`, from one shared
 * implementation in `@kgc/scripts/src/lib/otp-core.ts`.
 *
 * ── What this screen still does not say ────────────────────────────────────
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
  /**
   * Confirmations, kept apart from `error` so a resend never has to be phrased
   * as a failure. Nothing in here may describe the *address* — see the
   * anti-enumeration note in the file header.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Which of the four panels is on screen.
   *
   * `'choose'` is the landing with the two buttons; `'password'` and `'email'`
   * are the forms they open; `'code'` is the second half of create-account.
   *
   * ⚠️ `'code'` is reached **only after `requestSignInCode` has actually
   * returned** — never optimistically, and never because the address "looked
   * known". A code box shown after a failed request is the shape of a screen
   * that says a code was sent when none was, which is the defect class
   * AGENTS.md counts fourteen instances of.
   */
  const [step, setStep] = useState<'choose' | 'password' | 'email' | 'code'>('choose');
  /**
   * The address the code was requested for, frozen at the moment of the request.
   * Read back on screen so an attendee who mistyped can see it, and used for the
   * verify call so that editing the field afterwards cannot silently redeem a
   * code against a different address.
   */
  const [codeFor, setCodeFor] = useState('');
  const [code, setCode] = useState('');

  if (loading) return null;
  if (user) return <Redirect href="/home" />;

  const emailLooksValid = EMAIL_SHAPE.test(email.trim().toLowerCase());

  /**
   * Ask for a code, and — whatever the address turns out to be — land on the
   * same screen with the same words.
   *
   * `resend` only changes which message is shown on success. It must not change
   * the request, the destination or the wording of any failure.
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
      setNotice(
        resend
          ? 'Another code has been requested. Use the most recent one.'
          : null,
      );
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
      // No navigation on success — `useAuth` flips and the redirect above fires.
    } finally {
      setBusy(false);
    }
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

        {step === 'code' ? (
          <>
            <View style={{ gap: 6 }}>
              <Text variant="heading">Enter your {CODE_LENGTH}-digit code</Text>
              {/*
                Deliberately not "we've emailed you a code". `requestOtp`
                returns `{ ok: true }` whether the send succeeded, was skipped
                for want of an API key, or bounced — it has to, because a
                response that varied with delivery would answer "is this address
                on the guest list". This screen therefore cannot know that
                anything arrived, and saying it did would be the fifteenth
                instance of the defect class AGENTS.md counts. It says what is
                true instead: a code was asked for, and here is what to do if
                none turns up.
              */}
              <Text variant="subhead" tone="secondary">
                A code was requested for {codeFor}. Codes expire after {CODE_TTL_MINUTES}{' '}
                minutes. If one does not arrive, send another.
              </Text>
            </View>

            <TextInput
              value={code}
              // Digits only, capped at six. The server rejects anything else
              // with `invalid-argument`, which is indistinguishable from a wrong
              // code, so a stray space would read as "that code is not right".
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
                onPress={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                  setNotice(null);
                }}
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
        ) : step === 'choose' ? (
          <>
            {/*
              Two buttons, no fields. The email box used to sit above them,
              which meant the screen asked for a value before it had settled
              which of two things it was going to do with it — and the address
              is typed in both branches anyway, so hoisting it saved nothing.
            */}
            <Text variant="heading">Welcome</Text>

            <Pressable
              onPress={() => {
                setStep('password');
                setError(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Sign in with email and password"
              style={({ pressed }) => ({
                backgroundColor: colors.accent,
                opacity: pressed ? 0.85 : 1,
                borderRadius: Radius.md,
                alignItems: 'center',
                height: 50,
                justifyContent: 'center',
              })}>
              <Text variant="heading" tone="onAccent">
                Sign in
              </Text>
            </Pressable>

            {/*
              Outlined rather than filled, so there is one primary action.
              Create account is the branch a first-time attendee needs and the
              *second* button on purpose: over the life of the event almost
              every press is a returning attendee, and the ordering should match
              that rather than the order one individual meets the two.
            */}
            <Pressable
              onPress={() => {
                setStep('email');
                setError(null);
                setNotice(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Create an account with a code sent to your email"
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                borderRadius: Radius.md,
                alignItems: 'center',
                height: 50,
                justifyContent: 'center',
              })}>
              <Text variant="heading" tone="tint">
                Create account
              </Text>
            </Pressable>

            <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
              First time here? Choose Create account and we will email you a code.
            </Text>
          </>
        ) : step === 'password' ? (
          <>
            <View style={{ gap: 6 }}>
              <Text variant="heading">Sign in</Text>
              <Text variant="subhead" tone="secondary">
                Use the password you chose when you first opened the app.
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
              accessibilityLabel="Email address"
              autoFocus
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
              onPress={() => {
                setStep('choose');
                setPassword('');
                setError(null);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={textLink}>
              <Text variant="subhead" tone="secondary">
                Back
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <Text variant="heading">Create your account</Text>
              <Text variant="subhead" tone="secondary">
                Enter the address you bought your ticket with. We will email you a{' '}
                {CODE_LENGTH}-digit code.
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
              accessibilityLabel="Email address"
              autoFocus
              onSubmitEditing={() => {
                if (emailLooksValid) void sendCode();
              }}
              returnKeyType="go"
            />

            {error ? (
              <Text tone="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            {/*
              Enabled on the same regex the server uses, so the button is live
              for exactly the addresses the endpoint accepts — and for every one
              of them equally, ticket or not. Anything narrower here would be
              the enumeration oracle rebuilt on the client.
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
                  Email me a code
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                setStep('choose');
                setError(null);
                setNotice(null);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={textLink}>
              <Text variant="subhead" tone="secondary">
                Back
              </Text>
            </Pressable>
          </>
        )}

        {/* The support address saved on the dashboard. Nothing is shown until one is. */}
        {branding.supportEmail ? (
          <Pressable
            onPress={() => void Linking.openURL(`mailto:${branding.supportEmail}`)}
            accessibilityRole="link"
            accessibilityLabel={`Email ${branding.supportEmail} for help`}
            style={textLink}>
            <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              Trouble signing in? Write to <Text variant="caption" tone="tint">{branding.supportEmail}</Text>
            </Text>
          </Pressable>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
