import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { COLLECTIONS } from '@kgc/shared';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { getDb, getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Replace the temporary password, before the app will show anything else.
 *
 * ── Why this screen exists at all ───────────────────────────────────────────
 *
 * A ticket purchase provisions an Auth account holding six random digits, shown
 * on the confirmation page and mailed in the receipt
 * (`@kgc/scripts/src/lib/temporary-password.ts`). One million combinations is
 * not a credential anybody should keep, and the only thing that stops it being
 * one for the rest of the event is this screen. `mustChangePassword` on the profile is
 * the flag, the root navigator refuses to render any other route while it is
 * true, and this is the single place that lowers it.
 *
 * So the interesting requirement is not the form. It is that there is **no way
 * past it** except changing the password or signing out — no skip, no "later",
 * and no back gesture, because a prompt that can be dismissed is a prompt that
 * leaves a six-digit password live on an account that has read access to the
 * attendee's own messages.
 *
 * ── The order of the two writes, which is not arbitrary ─────────────────────
 *
 * Firebase Auth first, Firestore second, and the flag is cleared only after
 * `updatePassword` has actually resolved.
 *
 * Reversed, a failed password change would leave the flag down and the
 * temporary password live — the exact state this screen exists to prevent, reached by the
 * screen meant to prevent it. In the order below the bad case is the harmless
 * one: the password is changed, the flag write fails, and the attendee is asked
 * once more on next launch. Annoying, and safe. The copy on a flag-write
 * failure says the password *was* changed, because it was, and telling somebody
 * their new password did not take when it did is how they end up locked out
 * typing the old one.
 *
 * ── Re-authentication ───────────────────────────────────────────────────────
 *
 * `updatePassword` refuses on a session older than a few minutes with
 * `auth/requires-recent-login`. Anybody arriving here has just signed in, so the
 * common path never sees it — but "just signed in" stops being true if the app
 * is backgrounded on this screen overnight, which is exactly the kind of thing
 * that happens. Rather than dead-ending, the catch re-authenticates with the
 * current password, which the attendee has to hand because they typed it a
 * moment ago, and retries once.
 */
export default function ChangePasswordScreen() {
  const colors = useTheme();
  const { user, profile, loading } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  // Reachable by deep link after the flag is already down. Nothing to do here
  // then, and a form offering to change a password nobody asked about is worse
  // than a redirect.
  if (profile && profile.mustChangePassword !== true) return <Redirect href="/home" />;

  /**
   * Firebase's own floor, stated here rather than imported from the web app.
   * The number is a property of Auth, and the app must not depend on a module
   * whose whole subject is the temporary password — the app never needs to know
   * the value, only that six characters is the minimum.
   */
  const MIN_LENGTH = 6;

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const unchanged = next.length > 0 && current.length > 0 && next === current;
  const canSubmit =
    !busy &&
    current.length > 0 &&
    next.length >= MIN_LENGTH &&
    next === confirm &&
    next !== current;

  async function submit() {
    if (!canSubmit) return;
    const auth = getFirebaseAuth();
    const me = auth.currentUser;
    if (!me || !me.email) {
      setError('You are signed out. Sign in again and the app will ask once more.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      try {
        await updatePassword(me, next);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'auth/requires-recent-login') throw err;
        // The session went stale while this screen was open. The attendee has
        // the current password in the box above, so this is recoverable
        // without sending them back to sign in.
        await reauthenticateWithCredential(me, EmailAuthProvider.credential(me.email, current));
        await updatePassword(me, next);
      }

      // Only now, and deliberately after the line above. See the header.
      try {
        await updateDoc(doc(getDb(), COLLECTIONS.users, me.uid), {
          mustChangePassword: false,
          updatedAt: serverTimestamp(),
        });
      } catch {
        setBusy(false);
        setError(
          'Your password was changed — use the new one from now on. The app could not record ' +
            'that, so it may ask you once more next time it opens.',
        );
        return;
      }

      // No explicit navigation. The flag is live through `useDocument`, so
      // clearing it re-renders the navigator and the app moves on by itself —
      // one source of truth for "is this done", rather than a redirect here
      // that could disagree with the gate.
    } catch (err) {
      const code = (err as { code?: string }).code;
      setBusy(false);
      setError(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'That current password is not right. It is the one from your ticket email.'
          : code === 'auth/weak-password'
            ? `Pick something longer — at least ${MIN_LENGTH} characters.`
            : code === 'auth/too-many-requests'
              ? 'Too many attempts. Wait a minute and try again.'
              : 'Could not change the password. Check your connection and try again.',
      );
    }
  }

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
        <View style={{ gap: 6 }}>
          <Text variant="title3">Choose your password</Text>
          <Text variant="subhead" tone="secondary">
            The six digits in your ticket email are temporary. Pick your own password before you
            go any further — it is what protects your messages and your badge.
          </Text>
        </View>

        <View style={{ gap: Spacing.sm }}>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            style={field}
            placeholder="Temporary password (6 digits)"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            accessibilityLabel="Temporary password from your ticket email"
          />
          <TextInput
            value={next}
            onChangeText={setNext}
            style={field}
            placeholder="New password"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel="New password"
          />
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            style={field}
            placeholder="New password again"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel="Repeat the new password"
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </View>

        {/*
          One message at a time, and only once the attendee has typed enough for
          it to be a statement about their input rather than about an empty box.
        */}
        {tooShort ? (
          <Text variant="subhead" tone="secondary" accessibilityLiveRegion="polite">
            At least {MIN_LENGTH} characters — that is Firebase&rsquo;s minimum, not ours.
          </Text>
        ) : unchanged ? (
          <Text variant="subhead" tone="secondary" accessibilityLiveRegion="polite">
            That is the temporary password. Pick a different one.
          </Text>
        ) : mismatch ? (
          <Text variant="subhead" tone="secondary" accessibilityLiveRegion="polite">
            The two new passwords do not match.
          </Text>
        ) : null}

        {error ? (
          <Text variant="subhead" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Save my new password"
          style={({ pressed }) => ({
            backgroundColor: colors.accent,
            opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
            borderRadius: Radius.md,
            alignItems: 'center',
            height: 50,
            justifyContent: 'center',
          })}>
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text variant="heading" tone="onAccent">
              Save my new password
            </Text>
          )}
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
