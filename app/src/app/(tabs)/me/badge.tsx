import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';

import { Text } from '@/components/text';
import { QrCode } from '@/components/qr-code';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EVENT } from '@/config/event';
import { useAuth } from '@/lib/auth/auth-provider';
import { badgeIsScannable, badgePayload, useBadge, useCheckInStatus } from '@/lib/data/badge';

/**
 * My badge — the QR the door scans.
 *
 * This is the one screen in the app that has to work standing in a queue, in a
 * basement, on a phone at 4% battery, held out at arm's length to a handheld
 * reader. Everything below is in service of that and of nothing else.
 *
 * ## What the QR contains
 *
 * The registration's `qrSecret`, alone. The reasoning, the alternatives that were
 * rejected, and the threat that decision accepts are written out in full at the
 * top of `app/src/lib/data/badge.ts` — the short version is that a photograph of
 * this screen reveals nothing about who the badge belongs to, but it *is* a
 * bearer credential for attendance, and that trade is made knowingly in exchange
 * for a badge that works with no network.
 *
 * ## Why it is laid out the way it is
 *
 *   · **The plate is white and always white**, in dark mode too. A QR is a
 *     machine-readable target, not a UI element: readers expect dark-on-light and
 *     a theme-inverted symbol does not scan. This is the one place in the app that
 *     ignores `useTheme()` for the artwork, deliberately.
 *   · **The symbol fills the width.** A version 3 symbol is 29 modules across, so
 *     a 320pt plate gives ~8.6pt per module — comfortably above the ~4pt where
 *     phone-screen QRs start failing at arm's length under hall lighting.
 *   · **Screen brightness is raised while the screen is open** and put back on
 *     leaving. Auto-brightness in a dim hall drives a phone down to a level a
 *     reader cannot see through, and no amount of white plate fixes that.
 *   · **The screen is kept awake.** An auto-lock at the front of the queue is the
 *     single most likely way this fails in practice.
 *   · **The claim code is on screen, large, in monospace.** Every part of this
 *     can fail — cracked glass, dead battery, a reader with a flat lens — and the
 *     desk can always type six characters instead. The console's scan desk
 *     accepts it as a first-class input for exactly this reason.
 */
export default function BadgeScreen() {
  const colors = useTheme();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const { badge, source, loading, error, retry } = useBadge();
  const checkIn = useCheckInStatus(badge?.registrationId ?? null);

  const brightness = useMaxBrightness(Boolean(badge));
  useKeepScreenAwake(Boolean(badge));

  // The plate spans the screen less the gutters, capped so it does not become
  // absurd on a tablet or in a desktop browser window.
  const plate = Math.min(width - Spacing.md * 2, 380);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: Spacing.md,
        paddingBottom: Spacing.xxl,
        gap: Spacing.md,
      }}>
      {loading ? (
        <View style={{ paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.md }}>
          <ActivityIndicator />
          <Text tone="secondary">Finding your ticket…</Text>
        </View>
      ) : !badge ? (
        error ? (
          <BadgeUnavailable onRetry={retry} />
        ) : (
          <NoTicket email={user?.email ?? null} />
        )
      ) : (
        <>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: Radius.lg,
              padding: Spacing.md,
              alignItems: 'center',
              gap: Spacing.md,
            }}>
            <Text variant="title3" style={{ textAlign: 'center' }}>
              {badge.name}
            </Text>
            <Text tone="secondary" style={{ textAlign: 'center' }}>
              {badge.ticketType ?? 'Ticket'} · {EVENT.name}
            </Text>

            {badgeIsScannable(badge) ? (
              <View
                // The white surround is part of the target, not decoration: it
                // is the quiet zone's backing, and a QR abutting a coloured card
                // is a QR many readers will not lock onto.
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: Radius.md,
                  padding: Spacing.sm,
                }}>
                <QrCode
                  value={badgePayload(badge)}
                  size={plate}
                  accessibilityLabel="Your check-in QR code. Show this at the door."
                />
              </View>
            ) : (
              <CancelledTicket status={badge.status} />
            )}

            {badge.claimCode ? (
              <View style={{ alignItems: 'center', gap: Spacing.xs }}>
                <Text variant="caption" tone="tertiary">
                  IF THE SCANNER FAILS, READ THIS OUT
                </Text>
                <Text
                  variant="title"
                  // Monospace and spaced out, because it is read aloud across a
                  // desk under pressure and the six characters deliberately
                  // exclude O/0 and I/1 for the same reason.
                  style={{ fontVariant: ['tabular-nums'], letterSpacing: 4 }}
                  accessibilityLabel={`Your claim code is ${badge.claimCode.split('').join(' ')}`}>
                  {badge.claimCode}
                </Text>
              </View>
            ) : null}
          </View>

          <CheckInBanner
            known={checkIn.known}
            checkedInAt={checkIn.checkedInAt}
            loading={checkIn.loading}
          />

          <Text variant="caption" tone="tertiary" style={{ paddingHorizontal: Spacing.xs }}>
            {source === 'cache'
              ? 'Showing the badge saved on this phone — it is the same code and it will scan. ' +
                'Your ticket details will refresh when there is a connection.'
              : 'This badge is saved on your phone, so it still works with no signal.'}
            {'\n\n'}
            Treat the code like a boarding pass: anyone who photographs it could be checked in as
            you. If that happens, your own scan will show the desk that you were already checked
            in — tell them and they can reissue it.
            {brightness === 'unavailable'
              ? '\n\nThis device would not let the app raise the screen brightness. Turn it up by ' +
                'hand before you reach the desk.'
              : ''}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

/**
 * The check-in state.
 *
 * Three states, not two. "Not checked in" and "we could not find out" are
 * different sentences, and the second one is said out loud rather than being
 * quietly rendered as the first — a badge that claims to know something it cannot
 * see is the failure mode this repo has a documented habit of.
 */
function CheckInBanner({
  known,
  checkedInAt,
  loading,
}: {
  known: boolean;
  checkedInAt: Date | null;
  loading: boolean;
}) {
  const colors = useTheme();

  const { fill, ink, label, detail } = !known
    ? {
        fill: colors.surface,
        ink: colors.textSecondary,
        label: loading ? 'Checking…' : 'Check-in status unavailable',
        detail: loading
          ? 'Asking the door list.'
          : 'This needs a connection. The QR above works either way — show it at the desk.',
      }
    : checkedInAt
      ? {
          fill: colors.success,
          ink: '#FFFFFF',
          label: 'Checked in',
          detail: `At ${checkedInAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${checkedInAt.toLocaleDateString([], { weekday: 'long' })}.`,
        }
      : {
          fill: colors.surface,
          ink: colors.textSecondary,
          label: 'Not checked in yet',
          detail: 'Show the QR above at the registration desk.',
        };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: fill,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        gap: Spacing.xs,
      }}>
      <Text variant="heading" style={{ color: ink }}>
        {label}
      </Text>
      <Text variant="subhead" style={{ color: ink }}>
        {detail}
      </Text>
    </View>
  );
}

function CancelledTicket({ status }: { status: string }) {
  const colors = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.tintSoft,
        borderRadius: Radius.md,
        padding: Spacing.md,
        gap: Spacing.xs,
      }}>
      <Text variant="heading">No badge for this ticket</Text>
      <Text tone="secondary">
        This registration is {status}, not active, so there is nothing for the door to scan. The
        registration desk can sort it out — bring the claim code below.
      </Text>
    </View>
  );
}

/**
 * The badge could not be loaded and there is no cached copy to fall back on.
 *
 * Deliberately does not say "you have no ticket" — that is a different state with
 * its own component below, and confusing the two would tell a paying attendee at
 * a door that their registration does not exist. It says what is true: we could
 * not read it, here is what to do instead.
 */
function BadgeUnavailable({ onRetry }: { onRetry: () => void }) {
  const colors = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        gap: Spacing.sm,
      }}>
      <Text variant="heading">Could not load your badge</Text>
      <Text tone="secondary">
        Your ticket is fine — this device could not reach it. Try again, and if you are at the door,
        the registration desk can find you by name or by the claim code on your order confirmation
        page.
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try loading your badge again"
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.surfacePressed : colors.tintSoft,
          borderRadius: Radius.md,
          minHeight: HIT_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
        })}>
        <Text tone="tint" variant="heading">
          Try again
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * No registration for this account.
 *
 * Worth its own state rather than an error: the most common cause by far is
 * signing in with a different address from the one the ticket was bought with,
 * which the website's confirmation page warns about in as many words.
 */
function NoTicket({ email }: { email: string | null }) {
  const colors = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        gap: Spacing.sm,
      }}>
      <Text variant="heading">No ticket on this account</Text>
      <Text tone="secondary">
        We could not find a registration for {email ?? 'this account'}. Tickets are matched by
        email address, so if you registered with a different one — a work address, or a colleague
        booked for you — sign in with that instead.
      </Text>
      <Text variant="caption" tone="tertiary">
        The registration desk can attach your ticket to this account using the claim code on your
        order confirmation page.
      </Text>
    </View>
  );
}

type BrightnessState = 'idle' | 'raised' | 'unavailable';

/**
 * Raise the screen to full while the badge is showing, and put it back after.
 *
 * A phone on auto-brightness in a dim hall sits far below what a handheld reader
 * can see through, and a white plate does not change how much light the backlight
 * is emitting. This is the difference between a badge that scans first time and
 * one the attendee has to apologise for.
 *
 * `expo-brightness` is an Expo SDK module, so it is present in Expo Go — but the
 * permission can be refused, the web build has no such API at all, and a future
 * SDK could move it. Every call is therefore guarded and failure is *reported to
 * the caller* rather than swallowed, so the screen can tell the attendee to turn
 * the brightness up by hand instead of silently promising something it did not do.
 */
function useMaxBrightness(active: boolean): BrightnessState {
  const [state, setState] = useState<BrightnessState>('idle');

  useEffect(() => {
    if (!active) return;
    // There is no screen brightness to set in a browser, and pretending
    // otherwise would put a false reassurance on the web preview.
    if (Platform.OS === 'web') {
      setState('unavailable');
      return;
    }

    let restore: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const Brightness = await import('expo-brightness');
        const previous = await Brightness.getBrightnessAsync();
        if (cancelled) return;
        // `setBrightnessAsync` affects this app only and is reverted by the OS
        // when the app backgrounds, which is the behaviour we want — it must not
        // leave the phone at full brightness for the rest of the day.
        await Brightness.setBrightnessAsync(1);
        if (cancelled) return;
        setState('raised');
        restore = () => {
          void Brightness.setBrightnessAsync(previous).catch(() => {
            // Nothing useful to do: the OS restores it on background anyway.
          });
        };
      } catch (e) {
        if (cancelled) return;
        console.warn('[badge] could not raise the screen brightness:', (e as Error).message);
        setState('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      restore?.();
    };
  }, [active]);

  return state;
}

/**
 * Keep the screen from locking while the badge is open.
 *
 * An auto-lock at the front of the queue is the most likely way this screen
 * fails in practice, and it fails at the exact moment it is being watched.
 * Guarded like the brightness call, and silent when unavailable: unlike
 * brightness there is nothing useful to tell the attendee, because the recovery
 * — tap the screen — is what they would do anyway.
 */
function useKeepScreenAwake(active: boolean) {
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    const tag = 'kgc-badge';
    let released = false;

    void (async () => {
      try {
        const KeepAwake = await import('expo-keep-awake');
        await KeepAwake.activateKeepAwakeAsync(tag);
        if (released) void KeepAwake.deactivateKeepAwake(tag);
      } catch (e) {
        console.warn('[badge] could not keep the screen awake:', (e as Error).message);
      }
    })();

    return () => {
      released = true;
      void import('expo-keep-awake')
        .then((KeepAwake) => KeepAwake.deactivateKeepAwake(tag))
        .catch(() => {
          // Already released, or never acquired. Either way there is nothing to
          // undo and nothing worth logging on the way off a screen.
        });
    };
  }, [active]);
}
