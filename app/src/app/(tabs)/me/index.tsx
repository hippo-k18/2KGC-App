import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';

import { Avatar } from '@/components/avatar';
import { combineFailures, DataErrorBanner } from '@/components/data-error';
import { ListRow, SectionHeader } from '@/components/list-row';
import { Chevron, Icon } from '@/components/icon';
import { ScreenHeader } from '@/components/screen-header';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EVENT } from '@/config/event';
import { logout, useAuth } from '@/lib/auth/auth-provider';
import { useSavedSessions } from '@/lib/data/saved-sessions';
import { totalUnread, useThreads } from '@/lib/data/messages';
import { getDb } from '@/lib/firebase/client';

/**
 * Me — profile, the things you need in a hurry, and privacy.
 *
 * This tab replaces Whova's Messages tab. The trade is deliberate: an inbox is
 * empty for most attendees all week, whereas the badge QR, the wifi password
 * and the privacy switches are things people reach for repeatedly and currently
 * have nowhere to live.
 */
export default function MeScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user, profile, profileError, retryProfile } = useAuth();
  const { saved, error: savedError, retry: retrySaved } = useSavedSessions();
  const { threads, error: threadsError, retry: retryThreads } = useThreads(user?.uid);
  const unread = totalUnread(threads, user?.uid);

  const failure = combineFailures([
    { error: profileError, subject: 'your profile', retry: retryProfile },
    { error: savedError, subject: 'your saved sessions', retry: retrySaved },
    { error: threadsError, subject: 'your unread message count', retry: retryThreads },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Confirming a save that happened on another screen.
   *
   * `me/profile.tsx` writes the profile *and* the directory projection, both
   * silently, and then leaves. Nothing on the way out said the write landed, and
   * a name that happens to look the same afterwards is not evidence — a save
   * that failed looked exactly like one that worked. It now returns here with
   * `?saved=1` and this says so.
   *
   * The param is cleared as soon as it is read, so a reload of `/me` — or coming
   * back to the tab an hour later — does not re-announce a save from earlier;
   * and the notice retires itself, because a confirmation that stays on screen
   * stops being about the thing you just did.
   */
  const { saved: savedParam } = useLocalSearchParams<{ saved?: string }>();
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!savedParam) return;
    setSavedNotice(true);
    router.setParams({ saved: undefined });
    const timer = setTimeout(() => setSavedNotice(false), 6000);
    return () => clearTimeout(timer);
  }, [savedParam, router]);

  async function setFlag(field: 'visibleInDirectory' | 'messagingEnabled', value: boolean) {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      // `setDoc(..., merge)` rather than `updateDoc`: a real attendee arriving
      // through sign-in may not have a profile document yet, and `updateDoc`
      // fails with `not-found` on one that does not exist.
      await setDoc(
        doc(getDb(), COLLECTIONS.users, user.uid),
        { [field]: value, updatedAt: serverTimestamp() },
        { merge: true },
      );

      // Directory visibility has to move the projection itself, not just the
      // flag. The `mirrorDirectory` trigger will own this once Cloud Functions
      // exist; until then the client does it, because the alternative is a
      // switch that claims to hide you and does not.
      if (field === 'visibleInDirectory') {
        const entry = doc(getDb(), COLLECTIONS.directory, user.uid);
        if (value) {
          await setDoc(entry, {
            eventId: EVENT_ID,
            uid: user.uid,
            // `name` must be a non-empty string — the rules enforce it, because
            // an entry with no name crashes the People tab for every attendee.
            name: profile?.name?.trim() || user.email?.split('@')[0] || 'Attendee',
            ...(profile?.title ? { title: profile.title } : {}),
            ...(profile?.company ? { company: profile.company } : {}),
            interests: (profile?.interests ?? []).slice(0, 20),
            updatedAt: serverTimestamp(),
          });
        } else {
          await deleteDoc(entry);
        }
      }
    } catch (e) {
      // Surfaced rather than swallowed: a privacy control that fails silently
      // is the failure mode that matters most here.
      setError('Could not save that. Check your connection and try again.');
      console.warn('[me] privacy toggle failed:', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }}>
        <ScreenHeader title="Me" />

        {/*
          Everything below this line is a claim about the account, and with no
          profile every one of them is a default pretending to be a setting: the
          card reads "Your profile" with no name, "My schedule" reads "0
          sessions", and both privacy switches read off — so the app tells an
          attendee they are hidden from the directory when it was simply never
          allowed to look.

          `users/{uid}` is readable by its owner whether or not they are
          registered (`firestore.rules`), so on a stale token the *read* succeeds
          and returns nothing while the first-sign-in *create* is denied. Both
          arrive here as `profileError` — see `AuthProvider` — because from this
          screen they are the same failure.
        */}
        {failure ? (
          <View style={{ paddingTop: Spacing.md }}>
            <DataErrorBanner {...failure} />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: Spacing.md }}>
          {savedNotice ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.sm,
                backgroundColor: colors.tintSoft,
                borderRadius: Radius.lg,
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.sm,
                marginTop: Spacing.md,
              }}>
              <Icon name="checkmark.circle.fill" size={18} color={colors.tint} />
              {/* `flex: 1` and a shrinkable text column, so the sentence wraps
                  inside the banner rather than widening the card past the
                  gutter at 320pt or at accessibility text sizes. */}
              <Text variant="subhead" tone="tint" style={{ flex: 1 }}>
                Profile saved
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => router.push('/me/profile')}
            accessibilityRole="button"
            accessibilityLabel="Edit your profile"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.md,
              backgroundColor: pressed ? colors.surfacePressed : colors.surface,
              borderRadius: Radius.lg,
              padding: Spacing.md,
              marginTop: Spacing.md,
            })}>
            <Avatar name={profile?.name ?? 'You'} photoURL={profile?.photoURL} size={64} />
            <View style={{ flex: 1, gap: Spacing.xs }}>
              <Text variant="title3">{profile?.name ?? 'Your profile'}</Text>
              {profile?.title || profile?.company ? (
                <Text tone="secondary" numberOfLines={2}>
                  {[profile?.title, profile?.company].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {profile?.roles?.includes('organizer') ? (
                <Text variant="caption" tone="tint">
                  ORGANIZER
                </Text>
              ) : null}
            </View>
            <Chevron />
          </Pressable>

          <SectionHeader>My conference</SectionHeader>
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            {/*
              First row in the section, above the schedule, because it is the one
              thing on this tab an attendee opens while standing in a queue with
              somebody waiting. Everything else here can be found at leisure.
            */}
            <ListRow
              title="My badge"
              subtitle="Your check-in QR code"
              onPress={() => router.push('/me/badge')}
              trailing={<Chevron />}
              first
            />
            <ListRow
              title="My schedule"
              meta={`${saved.size} ${saved.size === 1 ? 'session' : 'sessions'}`}
              onPress={() => router.push('/me/schedule')}
              trailing={<Chevron />}
            />
            <ListRow
              title="Messages"
              meta={unread ? `${unread} unread` : undefined}
              onPress={() => router.push({ pathname: '/messages', params: { from: 'me' } })}
              trailing={<Chevron />}
            />
            <ListRow title="Venue" subtitle={EVENT.venue} last />
          </View>

          <SectionHeader>Privacy</SectionHeader>
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            <ListRow
              title="Show me in the directory"
              subtitle="Other attendees can find your profile"
              first
              trailing={
                <Switch
                  value={profile?.visibleInDirectory ?? false}
                  disabled={saving}
                  onValueChange={(v) => setFlag('visibleInDirectory', v)}
                  accessibilityLabel="Show me in the attendee directory"
                />
              }
            />
            <ListRow
              title="Allow direct messages"
              subtitle="Not yet enforced — see note below"
              last
              trailing={
                <Switch
                  value={profile?.messagingEnabled ?? false}
                  disabled={saving}
                  onValueChange={(v) => setFlag('messagingEnabled', v)}
                  accessibilityLabel="Allow direct messages"
                />
              }
            />
          </View>
          {error ? (
            <Text
              tone="danger"
              variant="caption"
              accessibilityLiveRegion="polite"
              style={{ paddingHorizontal: Spacing.xs, paddingTop: Spacing.sm }}>
              {error}
            </Text>
          ) : null}
          <Text
            variant="caption"
            tone="tertiary"
            style={{ paddingHorizontal: Spacing.xs, paddingTop: Spacing.sm }}>
            Turning off directory visibility deletes your entry, so your profile
            is not sent to other devices at all.{'\n\n'}
            Message blocking is not enforced yet — it is recorded but does not
            stop anyone contacting you until the server work lands.
          </Text>

          <SectionHeader>Account</SectionHeader>
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            <ListRow title={user?.email ?? 'Signed in'} first />
            <ListRow title="Sign out" destructive last onPress={() => logout()} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

