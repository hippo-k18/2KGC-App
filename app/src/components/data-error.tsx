import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { logout } from '@/lib/auth/auth-provider';
import { failureCode, failureKind, isRetryable } from '@/lib/data/errors';

/**
 * The counterpart to `EmptyState`, for the case it was standing in for.
 *
 * Every list in this app used to render a refused read and a genuinely empty
 * collection with the same component and the same words — "No sessions yet",
 * "Nobody here yet", "No messages". An attendee whose `registered` claim had not
 * reached their ID token therefore saw a complete, plausible, empty conference
 * app. They do not file a bug against that; they queue at the registration desk,
 * and the organizer never learns anything went wrong.
 *
 * So this component's whole job is to say which failure it is and what to do
 * about it, and it takes that from the Firestore error code rather than from the
 * calling screen — see `lib/data/errors.ts`. The three that matter lead to three
 * different actions:
 *
 * - **`permission-denied`** is almost always a stale ID token: custom claims are
 *   written into the token when it is minted, so someone who signed in before
 *   their ticket was registered keeps being refused for up to an hour. "Try
 *   again" forces a token refresh, which genuinely fixes it; signing out and back
 *   in mints a new one outright.
 * - **`unavailable`** is the network. It fixes itself, and sending someone to the
 *   help desk over a wifi blip is the same defect with the sign flipped.
 * - **`failed-precondition`** is a missing composite index — the app's fault, not
 *   the attendee's, and not something retrying can change. It gets no retry
 *   button, because a button that cannot work is how the rest of this codebase
 *   accumulated its list of claims it could not back up.
 *
 * The API mirrors `EmptyState` — drop it in the same places — except that the
 * copy is derived rather than passed. `subject` is the only wording the screen
 * supplies, and it is a noun phrase in the attendee's words ("the agenda", "your
 * messages"), never a collection name.
 */
export interface DataErrorProps {
  /** The `error` returned by `useCollection` / `useDocument`. */
  error: unknown;
  /** What failed, as the attendee would name it: `'the agenda'`, `'your messages'`. */
  subject: string;
  /** `retry` from the hook. Ignored for failures where retrying cannot help. */
  onRetry?: () => void;
}

interface Copy {
  icon: IconName;
  title: string;
  /** The full explanation, for the full-space variant. */
  message: string;
  /**
   * The same thing in two sentences, for the banner.
   *
   * A banner appears beside content that still works, and often beside another
   * banner — a missing `registered` claim denies every query on a screen at once,
   * so Home can show three. Three copies of a sixty-word paragraph is not a more
   * honest screen than one, it is an unreadable one.
   */
  short: string;
  /** Label for the retry button, when one is offered. */
  retryLabel: string;
  /** True where signing in again is the reliable fix. */
  offerSignOut: boolean;
}

/**
 * Note the sentence shapes: the subject is never the grammatical subject of a
 * clause. "The server refused to send your saved sessions" works for a plural
 * noun phrase and for a singular one; "Your saved sessions was refused" does not,
 * and picking the verb per call site is how a screen ends up with copy nobody
 * proofread.
 */
function copyFor(error: unknown, subject: string): Copy {
  switch (failureKind(error)) {
    case 'denied':
      return {
        icon: 'lock',
        title: 'Your pass has not reached this device',
        message:
          `The server refused to send ${subject} — it is there, and this device was ` +
          'not allowed to read it. Access is carried in the token this device ' +
          'received when you signed in, and that can be up to an hour behind your ' +
          'registration. Trying again fetches a new one. If that does not help, ' +
          'sign out and sign in again; if it still fails, the registration desk can ' +
          'check your ticket.',
        short:
          `The server refused to send ${subject}. This device's sign-in token is ` +
          'older than your registration — try again to fetch a new one, or sign out ' +
          'and sign in again.',
        retryLabel: 'Refresh access and try again',
        offerSignOut: true,
      };
    case 'signed-out':
      return {
        icon: 'person.slash',
        title: 'You are signed out',
        message:
          `Loading ${subject} needs a signed-in account, and this device no longer ` +
          'has one. Sign in again to carry on.',
        short: `Loading ${subject} needs a signed-in account. Sign in again to carry on.`,
        retryLabel: 'Try again',
        offerSignOut: true,
      };
    case 'offline':
      return {
        icon: 'wifi.slash',
        title: 'No connection',
        message:
          `Could not reach the server to load ${subject}. This is the network, not ` +
          'your ticket — nothing is wrong with your registration, and it will load ' +
          'on its own once you are back online.',
        short:
          `Could not reach the server to load ${subject}. Nothing is wrong with your ` +
          'registration; it will load once you are back online.',
        retryLabel: 'Try again',
        offerSignOut: false,
      };
    case 'misconfigured':
      return {
        icon: 'exclamationmark.triangle',
        title: `Could not query ${subject}`,
        message:
          'The server rejected the query itself, which means this build of the app ' +
          'is missing a database index for it. Nothing you can do from here changes ' +
          'that, so please tell someone at the registration desk.',
        short:
          'The server rejected the query itself — a database index is missing. ' +
          'Please tell someone at the registration desk.',
        retryLabel: 'Try again',
        offerSignOut: false,
      };
    default:
      return {
        icon: 'exclamationmark.triangle',
        title: `Could not load ${subject}`,
        message:
          'The reason is not one this screen recognises, so it is quoted below ' +
          'exactly as it arrived. Try again, and tell the registration desk if it ' +
          'keeps happening.',
        short:
          'The reason is not one this screen recognises; the code is below. Try ' +
          'again, and tell the registration desk if it keeps happening.',
        retryLabel: 'Try again',
        offerSignOut: false,
      };
  }
}

/** One listener's failure, for `combineFailures`. */
export interface DataFailure {
  error: unknown;
  /** As the attendee would name it: `'the agenda'`, `'your saved sessions'`. */
  subject: string;
  retry?: () => void;
}

/**
 * Folds several failed listeners on one screen into a single banner's worth of
 * props, or `null` when they all succeeded.
 *
 * A missing `registered` claim denies *every* query a screen holds at the same
 * moment, so Home and Me each had three banners saying the same paragraph three
 * times over — which is not three times as honest, it is a screen nobody reads.
 * This names all the affected content in one sentence and retries all of it from
 * one button.
 *
 * Only failures that share the *kind* of the first one are folded together, so
 * the copy is never wrong about one of the subjects it lists. A mixed screen
 * reports the first kind and leaves the rest for the next render, which cannot
 * happen in the case this exists for and is honest if it ever does.
 */
export function combineFailures(failures: DataFailure[]): DataErrorProps | null {
  const failed = failures.filter((f) => f.error);
  if (!failed.length) return null;

  const kind = failureKind(failed[0].error);
  const same = failed.filter((f) => failureKind(f.error) === kind);
  const retries = same.map((f) => f.retry).filter((r): r is () => void => Boolean(r));

  return {
    error: same[0].error,
    subject: listPhrase(same.map((f) => f.subject)),
    onRetry: retries.length ? () => retries.forEach((r) => r()) : undefined,
  };
}

/** `['a', 'b', 'c']` → `'a, b and c'`. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A comfortable measure for the four or five lines this copy needs. */
const MESSAGE_WIDTH = 340;

/**
 * The full-space version, for a screen or list whose entire content failed.
 *
 * Centres itself in whatever space it is given, for the same reason
 * `EmptyState` does: top-anchored, it reads as a half-loaded screen rather than
 * an answer.
 */
export function DataError({ error, subject, onRetry }: DataErrorProps) {
  const colors = useTheme();
  const copy = copyFor(error, subject);
  const code = failureCode(error);
  const canRetry = Boolean(onRetry) && isRetryable(error);

  return (
    <View
      style={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xl,
      }}>
      <Icon name={copy.icon} size={Spacing.xxl} color={colors.textSecondary} weight="regular" />

      <Text variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>
        {copy.title}
      </Text>

      <Text tone="secondary" style={{ textAlign: 'center', maxWidth: MESSAGE_WIDTH }}>
        {copy.message}
      </Text>

      {canRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={copy.retryLabel}
          style={({ pressed }) => ({
            marginTop: Spacing.sm,
            minHeight: HIT_TARGET,
            justifyContent: 'center',
            paddingHorizontal: Spacing.lg,
            borderRadius: Radius.md,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.85 : 1,
          })}>
          <Text variant="heading" tone="onAccent">
            {copy.retryLabel}
          </Text>
        </Pressable>
      ) : null}

      {copy.offerSignOut ? (
        <Pressable
          onPress={() => void logout()}
          accessibilityRole="button"
          accessibilityLabel="Sign out and sign in again"
          hitSlop={Spacing.sm}
          style={({ pressed }) => ({
            minHeight: HIT_TARGET,
            justifyContent: 'center',
            opacity: pressed ? 0.4 : 1,
          })}>
          <Text variant="heading" tone="tint">
            Sign out
          </Text>
        </Pressable>
      ) : null}

      {/* The raw code, quoted rather than paraphrased. An attendee will not read
          it; the organizer standing next to them at the desk will, and it is the
          difference between "the app is broken" and "this account has no
          registered claim". */}
      {code ? (
        <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
          {code}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The strip version, for a screen that still has real content to show.
 *
 * Home is the case this exists for: its hero, resource grid and event
 * description all render from constants, so replacing the whole screen with an
 * error would destroy working navigation to say that one query failed. The
 * amber fill and near-black text are the app's existing "read this, something is
 * off" treatment — the same pair the inbox's delivery notice and the agenda's
 * meet-up banner use (see `theme.ts` on why it is not white on amber).
 */
export function DataErrorBanner({ error, subject, onRetry }: DataErrorProps) {
  const colors = useTheme();
  const copy = copyFor(error, subject);
  const code = failureCode(error);
  const canRetry = Boolean(onRetry) && isRetryable(error);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        padding: Spacing.md,
        backgroundColor: colors.banner,
      }}>
      <Icon name={copy.icon} size={20} color={colors.onBanner} style={{ marginTop: 2 }} />

      <View style={{ flex: 1, gap: Spacing.xs }}>
        <Text variant="heading" style={{ color: colors.onBanner }}>
          {copy.title}
        </Text>
        <Text variant="subhead" style={{ color: colors.onBanner }}>
          {copy.short}
        </Text>

        {/* Wraps, because "Refresh access and try again" is 218pt of unbreakable
            17pt semibold and "Sign out" is another 62 — 304pt of buttons in the
            260pt this banner has left at 320pt of screen. A row does not shrink
            its children in Yoga, so at iPhone SE width "Sign out" was drawn 28pt
            past the right edge of the window, where nothing can reach it: the
            one control that reliably fixes a stale token was unavailable to
            exactly the attendee being told to use it. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: Spacing.lg,
            rowGap: Spacing.xs,
          }}>
          {canRetry ? (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={copy.retryLabel}
              hitSlop={Spacing.sm}
              style={({ pressed }) => ({
                justifyContent: 'center',
                minHeight: HIT_TARGET - Spacing.sm,
                opacity: pressed ? 0.5 : 1,
              })}>
              <Text variant="heading" style={{ color: colors.onBanner }}>
                {copy.retryLabel}
              </Text>
            </Pressable>
          ) : null}

          {copy.offerSignOut ? (
            <Pressable
              onPress={() => void logout()}
              accessibilityRole="button"
              accessibilityLabel="Sign out and sign in again"
              hitSlop={Spacing.sm}
              style={({ pressed }) => ({
                justifyContent: 'center',
                minHeight: HIT_TARGET - Spacing.sm,
                opacity: pressed ? 0.5 : 1,
              })}>
              <Text variant="heading" style={{ color: colors.onBanner }}>
                Sign out
              </Text>
            </Pressable>
          ) : null}
        </View>

        {code ? (
          <Text variant="caption" style={{ color: colors.onBanner }}>
            {code}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
