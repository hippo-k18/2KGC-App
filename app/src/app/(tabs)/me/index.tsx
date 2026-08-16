import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';

import { Avatar } from '@/components/avatar';
import { ListRow, SectionHeader } from '@/components/list-row';
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
  const { user, profile } = useAuth();
  const { saved } = useSavedSessions();
  const { threads } = useThreads(user?.uid);
  const unread = totalUnread(threads, user?.uid);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        <View style={{ paddingHorizontal: Spacing.md }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.md,
              backgroundColor: colors.surface,
              borderRadius: Radius.lg,
              padding: Spacing.md,
              marginTop: Spacing.md,
            }}>
            <Avatar name={profile?.name ?? 'You'} photoURL={profile?.photoURL} size={64} />
            <View style={{ flex: 1, gap: 2 }}>
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
          </View>

          <SectionHeader>My conference</SectionHeader>
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            <ListRow
              title="My schedule"
              meta={`${saved.size} ${saved.size === 1 ? 'session' : 'sessions'}`}
              onPress={() => router.push('/me/schedule')}
              trailing={<Chevron />}
              first
            />
            <ListRow
              title="Messages"
              meta={unread ? `${unread} unread` : undefined}
              onPress={() => router.push('/messages')}
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

function Chevron() {
  return (
    <Text variant="body" tone="tertiary" accessibilityElementsHidden>
      ›
    </Text>
  );
}
