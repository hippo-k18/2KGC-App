import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { COLLECTIONS, joinCodeMatches } from '@kgc/shared';

import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { logout } from '@/lib/auth/auth-provider';
import { useAppAccess } from '@/lib/data/app-access';
import { useEventSettings } from '@/lib/data/event-settings';
import { getDb } from '@/lib/firebase/client';
import { runWrite } from '@/lib/data/write';

/**
 * The two screens that stand in front of the app, and nothing else.
 *
 * Both are rendered by the root navigator in place of the whole stack rather
 * than pushed on top of it, for the same reason `/change-password` is: a gate
 * that can be dismissed with a back gesture is not a gate, and a route reached
 * by a notification deep link would otherwise walk straight past it.
 */

/**
 * The event is over.
 *
 * Nothing loads here and nothing is meant to: `firestore.rules` refuses every
 * read past the same cutoff, so a screen that tried to show the agenda would
 * show an error instead of a sentence. One plain paragraph and a way out.
 *
 * Sign out is the only control. It is not a back door — the window is enforced
 * on the server for every account — it is there because an attendee on a shared
 * or handed-down phone has no other way to get their own account off it.
 */
export function EventClosedScreen() {
  const { event, branding } = useEventSettings();

  return (
    <Screen grouped contentStyle={{ flexGrow: 1, justifyContent: 'center', gap: Spacing.lg }}>
      <View style={{ gap: 8 }}>
        <Text variant="title3">{event.name} has ended</Text>
        <Text variant="body" tone="secondary">
          The app is closed now. Thank you for coming.
        </Text>
        {/*
          The support address, where there is one. Somebody who needs a receipt
          or a certificate after the event has nowhere else to ask from here.
        */}
        <Text variant="subhead" tone="secondary">
          {branding.supportEmail
            ? `If you need anything, write to ${branding.supportEmail}.`
            : 'If you need anything, contact the organizers.'}
        </Text>
      </View>

      <Pressable
        onPress={() => void logout()}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          opacity: pressed ? 0.4 : 1,
          paddingVertical: Spacing.sm,
        })}>
        <Text variant="subhead" tone="tint" style={{ fontWeight: '600' }}>
          Sign out
        </Text>
      </Pressable>
    </Screen>
  );
}

/**
 * The event code, asked once.
 *
 * ── What this is and is not ─────────────────────────────────────────────────
 *
 * It is a welcome step, not a lock. The gate that decides what this account can
 * read is the ticket claim on the token, checked by `firestore.rules` on every
 * request; a string a thousand people can hear from a stage is weaker than that
 * and is not enforced anywhere. The organizer sets it, reads it out, and it is
 * the moment an attendee feels they have arrived — which is the entire reason
 * the product has one.
 *
 * So the write it makes is a note to itself: `joinedAt` on the attendee's own
 * profile, which the rules let the owner set once and never move. The prompt is
 * asked again if it never lands, which is the right direction for a formality.
 *
 * Somebody already using the app when the code is switched on is asked the next
 * time they open it. That is deliberate: an organizer who turns it on mid-event
 * is asking the room, not only the people who arrive afterwards.
 */
export function JoinCodeScreen({ uid }: { uid: string }) {
  const colors = useTheme();
  const { access } = useAppAccess();
  const { event } = useEventSettings();

  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || typed.trim().length === 0) return;
    setError(null);

    if (!joinCodeMatches(access.joinCode, typed)) {
      setError('That is not the code for this event. Check with the organizers.');
      return;
    }

    setBusy(true);
    const result = await runWrite('record join code', () =>
      updateDoc(doc(getDb(), COLLECTIONS.users, uid), { joinedAt: serverTimestamp() }),
    );
    if (!result.ok) {
      setBusy(false);
      setError('Could not save that. Check your connection and try again.');
      return;
    }
    // No navigation. `joinedAt` is live through the profile listener, so the
    // navigator moves on by itself — one source of truth for "has this been
    // asked", rather than a redirect here that could disagree with the gate.
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
          <Text variant="title3">Welcome to {event.shortName}</Text>
          <Text variant="subhead" tone="secondary">
            Enter the event code to join. The organizers give it out at the event.
          </Text>
        </View>

        <TextInput
          value={typed}
          onChangeText={(v) => {
            setTyped(v);
            setError(null);
          }}
          style={field}
          placeholder="Event code"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Event code"
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {/* Spaces and hyphens are dropped before the comparison, so somebody
            reading a hyphen off a slide and typing it is not refused. */}
        {error ? (
          <Text variant="subhead" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy || typed.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Join the event"
          style={({ pressed }) => ({
            backgroundColor: colors.accent,
            opacity: busy || typed.trim().length === 0 ? 0.5 : pressed ? 0.85 : 1,
            borderRadius: Radius.md,
            alignItems: 'center',
            height: 50,
            justifyContent: 'center',
          })}>
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text variant="heading" tone="onAccent">
              Join
            </Text>
          )}
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
