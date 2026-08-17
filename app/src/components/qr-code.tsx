import { useMemo } from 'react';
import { View } from 'react-native';

import { encodeQr, type ErrorCorrectionLevel } from '@/lib/qr/encode';

/**
 * A QR code drawn with plain `View`s.
 *
 * No SVG, no canvas, no native module — which is the whole reason it exists.
 * Expo Go ships a fixed set of native modules and the badge has to render inside
 * it on SDK 54, so every npm QR component (all of which draw through
 * `react-native-svg`) is off the table. Views also render under
 * `react-native-web`, which is what makes the badge screenshottable and the QR
 * decodable from that screenshot during verification.
 *
 * ## Why runs and not a grid of squares
 *
 * A version 3 symbol is 29×29 = 841 modules, and a naive one-View-per-module
 * grid means 841 views for a decoration. Each row is instead emitted as a
 * sequence of *runs* — consecutive modules of the same colour become one View
 * with a proportional width — which typically lands around ten views per row.
 * The rendered pixels are identical; only the view count changes.
 *
 * ## Why the quiet zone is not optional
 *
 * The specification requires four modules of light margin on every side, and
 * readers genuinely need it: without the quiet zone the finder patterns run into
 * whatever is behind them and many scanners simply never lock on. It is drawn
 * here, as padding inside the white plate, rather than left to the caller to
 * remember.
 *
 * ## Why the colours are hard-coded
 *
 * The rest of this app takes every colour from `useTheme()`, and this component
 * deliberately does not. A QR is not a UI element, it is a machine-readable
 * target: it needs maximum luminance contrast in one fixed polarity, because
 * most readers expect dark-on-light and a theme-inverted QR is a QR that does
 * not scan. Rendering the badge "correctly" in dark mode would break it.
 */
export function QrCode({
  value,
  size,
  ecl = 'M',
  accessibilityLabel,
}: {
  value: string;
  /** Edge length in points, quiet zone included. */
  size: number;
  ecl?: ErrorCorrectionLevel;
  accessibilityLabel?: string;
}) {
  const matrix = useMemo(() => {
    try {
      return encodeQr(value, ecl);
    } catch (e) {
      // A payload the encoder refuses is a bug upstream, not something to crash
      // the badge screen over. The caller renders its own fallback when this is
      // null, and the human-readable code is on screen regardless.
      console.warn('[qr] could not encode the badge payload:', (e as Error).message);
      return null;
    }
  }, [value, ecl]);

  if (!matrix) return null;

  const QUIET = 4;
  // Rounded down so the drawn symbol never overflows the plate by a subpixel,
  // which on Android shows as a clipped final column.
  const module = Math.floor(size / (matrix.size + QUIET * 2));
  const inner = module * matrix.size;
  const margin = module * QUIET;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: inner + margin * 2,
        height: inner + margin * 2,
        padding: margin,
        backgroundColor: '#FFFFFF',
      }}>
      {matrix.modules.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: module }}>
          {runs(row).map(({ on, from, width }) => (
            <View
              key={from}
              style={{
                width: width * module,
                height: module,
                backgroundColor: on ? '#000000' : '#FFFFFF',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Collapse a row of modules into same-coloured spans. */
function runs(row: boolean[]): { on: boolean; from: number; width: number }[] {
  const out: { on: boolean; from: number; width: number }[] = [];
  let from = 0;
  for (let i = 1; i <= row.length; i++) {
    if (i === row.length || row[i] !== row[from]) {
      out.push({ on: row[from], from, width: i - from });
      from = i;
    }
  }
  return out;
}
