import { QR_QUIET_ZONE, qrPath } from '@/lib/qr';

/**
 * A QR symbol, drawn as vector, rendered on the server.
 *
 * No `'use client'` and no state: `qrPath` is a pure function of its input, so
 * the whole symbol is computed during the render that produces the page and
 * arrives as markup. Nothing is fetched, no image is generated, and the symbol
 * is present in the HTML — which means it survives a screenshot, a print, and a
 * browser with JavaScript turned off.
 *
 * `shapeRendering="crispEdges"` matters more than it looks. Antialiasing a
 * module boundary softens the black/white transition a scanner is thresholding
 * on; at small sizes that is the difference between a symbol that reads
 * instantly and one the reader hunts for.
 */
export function QrCode({
  value,
  size = 168,
  title,
  className,
}: {
  /** The payload. A public URL — see the header of `lib/qr.ts`. */
  value: string;
  /** Rendered side length in CSS pixels, quiet zone included. */
  size?: number;
  /**
   * The accessible name. A QR is an image of a link, and a screen reader user
   * cannot point a camera at it — so this should say where it goes, and the
   * page should carry the same destination as real text nearby.
   */
  title: string;
  className?: string;
}) {
  const { d, size: modules } = qrPath(value);
  const span = modules + QR_QUIET_ZONE * 2;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
    >
      {/*
        The quiet zone is painted white rather than left transparent. This
        symbol sits on a dark navy panel, and a transparent quiet zone is a navy
        quiet zone, which is no quiet zone at all.
      */}
      <rect width={span} height={span} fill="#fff" rx={1} />
      <path d={d} fill="#10243a" transform={`translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})`} />
    </svg>
  );
}
