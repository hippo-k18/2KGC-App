import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { PushedHeader } from '@/components/pushed-header';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { logout, useAuth } from '@/lib/auth/auth-provider';
import { deleteMyAccount } from '@/lib/auth/delete-account';

/**
 * Me › Delete account (App Store guideline 5.1.1(v)).
 *
 * Says what goes and what stays before anything happens, and asks for DELETE
 * typed out, so a stray tap cannot remove an account. The same list is on the
 * website's `/account/delete`, and both end in the same server code.
 */
const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const colors = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = typed.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function confirm() {
    if (!user || !ready) return;
    setBusy(true);
    setError('');
    const result = await deleteMyAccount(user);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    await logout().catch(() => {});
    router.replace('/login');
  }

  return (
    <>
      <PushedHeader title="Delete account" backTitle="Me" backHref="/me" />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl }}>
          <Text variant="heading">This deletes your app account</Text>

          <View style={{ gap: Spacing.xs }}>
            <Text variant="label" tone="secondary">
              DELETED
            </Text>
            <Text>Your account and sign-in, your profile and directory entry, your saved sessions and contacts, your notifications, and your reactions and upvotes.</Text>
          </View>

          <View style={{ gap: Spacing.xs }}>
            <Text variant="label" tone="secondary">
              KEPT
            </Text>
            <Text>
              Your posts, replies, questions and messages stay so other people&apos;s conversations still make sense. They show as written by &ldquo;Deleted user&rdquo;.
            </Text>
            <Text>Your ticket and payment record are kept. Your ticket still works at the door.</Text>
          </View>

          <Text tone="secondary">You cannot undo this. If you buy a ticket again later with the same email, you get a new, empty account.</Text>

          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              TYPE {CONFIRM_WORD} TO CONFIRM
            </Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
              style={{
                backgroundColor: colors.surface,
                borderRadius: Radius.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                minHeight: 46,
                fontSize: 17,
                color: colors.text,
              }}
            />
          </View>

          {error ? (
            <Text tone="danger" variant="caption" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={confirm}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityState={{ disabled: !ready }}
            style={({ pressed }) => ({
              backgroundColor: colors.dangerFill,
              opacity: !ready ? 0.4 : pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              height: 50,
              alignItems: 'center',
              justifyContent: 'center',
            })}>
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text variant="heading" tone="onAccent">
                Delete my account
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
