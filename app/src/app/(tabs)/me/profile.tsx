import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';

import { Avatar } from '@/components/avatar';
import { FilterChip } from '@/components/filter-chip';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { useTracks } from '@/lib/data/tracks';
import { getDb } from '@/lib/firebase/client';

/**
 * Editing your own profile.
 *
 * Until now nothing in the app could write a profile, so every attendee was
 * whatever the registration import said they were — the directory was frozen
 * seed data and a typo in someone's name was permanent.
 *
 * Two writes, not one. The profile is the record; `directory/{uid}` is the
 * public projection other attendees actually read, and it does not update
 * itself while the mirror trigger is unbuilt. Saving a new job title that never
 * reaches the directory looks exactly like a save that failed.
 *
 * Interests are picked from the event's tracks rather than typed. Free text
 * would give "Ontologies", "ontology" and "Ontologies & Taxonomies" as three
 * different filters, which makes the People tab's interest row useless.
 */
export default function EditProfileScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  const tracks = useTracks();

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Seed the form once the profile arrives, but never again — re-seeding on a
  // later snapshot would wipe what the user is halfway through typing.
  useEffect(() => {
    if (!profile || hydrated) return;
    setName(profile.name ?? '');
    setTitle(profile.title ?? '');
    setCompany(profile.company ?? '');
    setBio(profile.bio ?? '');
    setInterests(profile.interests ?? []);
    setHydrated(true);
  }, [profile, hydrated]);

  const toggleInterest = (t: string) =>
    setInterests((prev) =>
      prev.includes(t) ? prev.filter((i) => i !== t) : prev.length >= 20 ? prev : [...prev, t],
    );

  async function save() {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('A name is required — it is what other attendees see.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setDoc(
        doc(getDb(), COLLECTIONS.users, user.uid),
        {
          name: trimmed,
          title: title.trim(),
          company: company.trim(),
          bio: bio.trim(),
          interests,
          onboarded: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // Keep the public projection in step. The rules bound every field here,
      // so an over-long name or a 21st interest is rejected server-side too.
      const entry = doc(getDb(), COLLECTIONS.directory, user.uid);
      if (profile?.visibleInDirectory) {
        await setDoc(entry, {
          eventId: EVENT_ID,
          uid: user.uid,
          name: trimmed,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(company.trim() ? { company: company.trim() } : {}),
          interests: interests.slice(0, 20),
          updatedAt: serverTimestamp(),
        });
      } else {
        // Hidden means absent, so an edit must not quietly re-list you.
        await deleteDoc(entry).catch(() => undefined);
      }
      router.back();
    } catch (e) {
      setError('Could not save. Check your connection and try again.');
      console.warn('[profile] save failed:', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 46,
    fontSize: 17,
    color: colors.text,
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Edit profile', headerBackTitle: 'Me' }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl }}>
          <View style={{ alignItems: 'center', gap: Spacing.sm }}>
            <Avatar name={name || 'You'} photoURL={profile?.photoURL} size={88} />
            <Text variant="caption" tone="tertiary">
              Photo upload needs Storage, which is not provisioned yet
            </Text>
          </View>

          <Labelled label="NAME">
            <TextInput
              value={name}
              onChangeText={setName}
              style={field}
              placeholder="Your name"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Name"
              maxLength={120}
            />
          </Labelled>

          <Labelled label="JOB TITLE">
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={field}
              placeholder="Principal Ontologist"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Job title"
              maxLength={120}
            />
          </Labelled>

          <Labelled label="COMPANY">
            <TextInput
              value={company}
              onChangeText={setCompany}
              style={field}
              placeholder="Where you work"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Company"
              maxLength={120}
            />
          </Labelled>

          <Labelled label="ABOUT">
            <TextInput
              value={bio}
              onChangeText={setBio}
              style={[field, { minHeight: 110, textAlignVertical: 'top' }]}
              placeholder="What you work on, what you want to talk about"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="About you"
              multiline
              maxLength={600}
            />
          </Labelled>

          <Labelled label={`INTERESTS  ·  ${interests.length}/20`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              {tracks.map((t) => (
                <FilterChip
                  key={t.id}
                  label={t.name}
                  dotColor={t.color}
                  selected={interests.includes(t.name)}
                  onPress={() => toggleInterest(t.name)}
                />
              ))}
            </View>
          </Labelled>

          {error ? (
            <Text tone="danger" variant="caption" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save profile"
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              opacity: busy ? 0.5 : pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              height: 50,
              alignItems: 'center',
              justifyContent: 'center',
            })}>
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text variant="heading" tone="onAccent">
                Save
              </Text>
            )}
          </Pressable>

          <Text variant="caption" tone="tertiary">
            {profile?.visibleInDirectory
              ? 'Your name, title, company and interests are visible to other attendees.'
              : 'You are hidden from the directory, so only you can see this.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      {children}
    </View>
  );
}
