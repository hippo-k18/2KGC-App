import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, View, type DimensionValue } from 'react-native';

import { DECORATIVE } from '@/components/a11y';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Content-shaped placeholders for a screen that has not got its data yet.
 *
 * ## Why not a blank, and why not a spinner
 *
 * The three detail screens all used to render an empty `View` while waiting, with
 * a comment arguing that a flash of loading chrome "reads as slower than a brief
 * blank". That is true of a brief blank. It stops being true the moment the wait
 * is not brief, and this app has a hard floor on how long it can be: the Firestore
 * SDK gives the backend **ten seconds** to answer before it decides it is offline
 * and serves what it has from cache (`ONLINE_STATE_TIMEOUT_MS`, and it says so in
 * the console — "Backend didn't respond within 10 seconds"). Until that timer
 * fires, a listener on a document that is not already cached delivers *nothing*.
 * So on conference wifi the blank is ten seconds long, and a person who taps a
 * session while looking for the room concludes the app has crashed and backs out.
 *
 * A spinner would be honest about "working" and silent about "what". A skeleton in
 * the shape of the real content says both, and it means the header, the title
 * block and the primary action do not jump when the data lands, because they were
 * already drawn in the right places.
 *
 * ## Why it pulses, and when it does not
 *
 * A static grey block is indistinguishable from a layout bug. A slow pulse reads
 * as "pending" without demanding attention. It is switched off outright when the
 * platform reports Reduce Motion, because a looping animation is exactly what that
 * setting exists to stop — and the placeholder still works without it, since the
 * shapes carry the meaning.
 */

/** Opacity range of the pulse. Deliberately shallow — it should not flicker. */
const PULSE_MIN = 0.45;
const PULSE_MAX = 1;
/** One direction of the pulse. 900ms each way is about one breath. */
const PULSE_MS = 900;

/**
 * How long to wait before admitting the wait is abnormal.
 *
 * Set just past the SDK's own ten-second patience so the two do not disagree: if
 * this line is on screen, the SDK has already given up and logged that the
 * backend did not answer, and "check your connection" is then a true statement
 * rather than a guess.
 */
const SLOW_NOTICE_MS = 10_000;

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (live) setReduce(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return reduce;
}

/** A single placeholder rectangle. */
export function SkeletonBlock({
  width = '100%',
  height = 16,
  radius = Radius.sm,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
}) {
  const colors = useTheme();
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(PULSE_MAX)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(PULSE_MAX);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: PULSE_MIN,
          duration: PULSE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: PULSE_MAX,
          duration: PULSE_MS,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      {...DECORATIVE}
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.separator,
        opacity: pulse,
      }}
    />
  );
}

/**
 * A paragraph's worth of placeholder lines.
 *
 * The last line is short, because a real last line is. Uniform full-width bars
 * read as a table, not as prose.
 */
export function SkeletonText({ lines = 3, height = 14 }: { lines?: number; height?: number }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBlock
          key={i}
          height={height}
          width={i === lines - 1 ? '55%' : '100%'}
        />
      ))}
    </View>
  );
}

/**
 * Wraps a screen's placeholder shape: one screen-reader announcement for the
 * whole thing, and an explanation if the wait runs past the point where the SDK
 * itself has given up.
 *
 * The announcement is on the wrapper rather than the blocks because every block
 * is `DECORATIVE`; without it VoiceOver lands on a screen with a back button and
 * nothing else, which is the audible version of the blank this replaces.
 */
export function SkeletonScreen({
  label,
  slowNotice,
  children,
}: {
  /** What is loading, in the attendee's words: `'session details'`. */
  label: string;
  /**
   * Shown once the wait passes the SDK's ten-second offline threshold. Omit only
   * where a wait that long is impossible.
   */
  slowNotice?: string;
  children: ReactNode;
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Loading ${label}`}
      style={{ gap: Spacing.md }}>
      {children}
      {slow && slowNotice ? (
        <Text variant="subhead" tone="secondary" style={{ paddingTop: Spacing.sm }}>
          {slowNotice}
        </Text>
      ) : null}
    </View>
  );
}
