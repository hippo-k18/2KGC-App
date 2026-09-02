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
import {
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  EMAIL_SHAPE,
  requestSignInCode,
  signInWithCode,
} from '@/lib/auth/otp';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Sign-in — two routes to the same session, one of which is on its way out.
 *
 * ── The route that ships: a six-digit code ──────────────────────────────────
 *
 * `requestOtp` mails a code; `verifyOtp` redeems it, mints the account on first
 * use with the `registered` claim on it, and returns a custom token this screen
 * exchanges for a session. Both live in `functions/src/callable/`, both are
 * rate-limited per address and per IP, and `app/src/lib/auth/otp.ts` is the only
 * thing here that knows their error codes.
 *
 * ⚠️ **They are not deployed.** `firebase deploy` is refused on this project
 * with a `serviceusage` 403 and no script works around it for functions
 * (OWNER-ACTIONS.md §3). Against the live project the callable URL 404s, and
 * this screen reports that as "could not reach the sign-in service, so no code
 * was sent" rather than moving on to a code box that can never be satisfied.
 * The flow has been exercised end to end against the functions emulator; it is
 * unverified against production.
 *
 * ⚠️ **The screen after "send me a code" is the same screen for every address.**
 * `requestOtp` deliberately answers identically whether or not an address holds
 * a ticket, which is what stops it being a query against the delegate list.
 * Nothing here may vary on that — see the header of `lib/auth/otp.ts` for the
 * three ways a UI can undo it.
 *
 * ── The route that survives: email + password ───────────────────────────────
 *
 * Kept, at the owner's request, as one of exactly two demo affordances to
 * outlive the rest. It is a real Firebase credential against a real project with
 * real claims behind it, so what it exercises downstream is the shipping
 * authorization path either way.
 *
 * BUILD-PLAN 1.4 has taken everything that was *around* it: the `demo` / `123`
 * mapping onto a seeded account, the bare-local-part expansion, the prefilled
 * fields, the printed credentials, and `OPEN_SIGNIN` — a bypass that signed
 * anybody in with no input at all. What is left is two boxes that send exactly
 * what was typed to `signInWithEmailAndPassword`.
 *
 * ⚠️ **As of 2026-09-02 this is the route a buyer actually arrives on**, and the
 * sentence that used to end this block — "no account this project creates has a
 * password" — is no longer true. `provisionAttendeeAccount` now sets the shared
 * demo password on the accounts it creates and mails it in the receipt, so an
 * attendee who has just bought a ticket signs in here with their address and
 * that temporary value.
 *
 * Nothing in this file knows the password, and that has not changed — it is
 * still two boxes that forward what was typed. What is new is what happens
 * *after*: the profile carries `mustChangePassword`, and `_layout.tsx` redirects
 * to `/change-password` and refuses every other route until it is cleared. This
 * screen deliberately does not mention it. A sign-in form that explained the
 * shared password would be printing a credential hint to whoever is holding the
 * phone, which is the demo-panel mistake in a smaller box.
 */
export default function LoginScreen() {
  const colors = useTheme();
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
   * Which half of the code flow is on screen.
   *
   * `'code'` is reached only after `requestOtp` has actually returned — never
   * optimistically, and never because the address "looked known". A code box
   * shown after a failed request is the shape of a screen that says a code was
   * sent when none was.
   */
  const [step, setStep] = useState<'start' | 'code'>('start');
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
                minutes — if one does not arrive, send another.
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

            <View style={{ alignItems: 'center', gap: Spacing.sm }}>
              <Pressable
                onPress={() => sendCode(true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Send another code">
                <Text variant="subhead" tone="tint">
                  Send another code
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep('start');
                  setCode('');
                  setError(null);
                  setNotice(null);
                }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Use a different email address">
                <Text variant="subhead" tone="secondary">
                  Use a different address
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
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
              onSubmitEditing={() => {
                if (emailLooksValid) void sendCode();
              }}
              returnKeyType="next"
            />

            {error ? (
              <Text tone="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            {/*
              The primary route. Enabled on the same regex the server uses, so
              the button is live for exactly the addresses `requestOtp` accepts
              — and for every one of them equally, ticket or not.
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

            {/*
              The password route, kept beside the code route rather than under
              it — one of the two demo affordances the owner asked to survive.
              Outlined rather than filled so there is one primary action on the
              screen. BUILD-PLAN 1.4 deleted what was around it, not the field.
            */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <Text variant="caption" tone="tertiary">
                or
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>

            <View style={{ gap: 10 }}>
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

              <Pressable
                onPress={submit}
                disabled={busy || !email || !password}
                accessibilityRole="button"
                accessibilityLabel="Sign in with a password"
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                  opacity: busy || !email || !password ? 0.5 : 1,
                  borderRadius: Radius.md,
                  alignItems: 'center',
                  height: 50,
                  justifyContent: 'center',
                })}>
                <Text variant="heading" tone="tint">
                  Sign in with a password
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
