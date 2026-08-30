/**
 * The QR symbol printed on the order confirmation, as one SVG path.
 *
 * ── Which QR this is, and which it is deliberately not ──────────────────────
 *
 * This draws a **link**, not a credential. The only thing it ever encodes is a
 * public URL — where to get the app — so it is safe on a page that gets
 * forwarded, screenshotted and left open on a shared laptop.
 *
 * The attendee's *badge* QR encodes `qrSecret` and is a different symbol
 * entirely. `order/[token]/page.tsx` has never printed `qrSecret` and must not
 * start: the badge credential is fetched by the app after the attendee has
 * actually authenticated. Anything passed to `qrPath` here should be a URL you
 * would be content to see on a slide.
 *
 * ── The encoder is the app's, not a second one ──────────────────────────────
 *
 * `app/src/lib/qr/encode.ts` is a dependency-free pure function, verified
 * against the reference `qrcode` package across every version and level in
 * range (`tests/qr/encode.test.ts`). `apps/organizer/src/lib/badges.ts` reaches
 * for it the same way and for the same reason. The relative path is ugly
 * because `apps/web` is deliberately not a workspace member, so there is no
 * package specifier to reach the app by — that is the cost of the arrangement,
 * paid once here rather than avoided by adding a QR dependency to a site whose
 * whole point is that it ships no third-party runtime.
 *
 * The run-merging path builder below *is* a second copy of the one in
 * `badges.ts`, and that is the right trade: it is twenty lines of geometry with
 * no domain knowledge in it, and the alternative is one website importing a
 * `server-only` module out of the other website's `src/`.
 */

import { encodeQr } from '../../../../app/src/lib/qr/encode';

/**
 * The quiet zone, in modules, required by the spec on all four sides.
 *
 * Four is the standard minimum and it is not decoration — a symbol printed hard
 * against the edge of a card, or against a coloured panel, is a symbol many
 * phone cameras will not find at all.
 */
export const QR_QUIET_ZONE = 4;

/**
 * `text` as a single SVG path in module units, plus the symbol's side length.
 *
 * A path rather than one `<rect>` per module: even a small symbol is 29×29, and
 * runs of dark modules merge into one rectangle, which roughly halves the path
 * again on the dense rows through the middle. The caller scales with `viewBox`,
 * so the symbol stays crisp at any size and on any display.
 *
 * Level Q rather than the encoder's default M, because this symbol is read off
 * a laptop screen by a phone held at arm's length, at whatever angle the person
 * happens to be sitting — 25% recovery buys back the glare spot.
 */
export function qrPath(text: string): { d: string; size: number } {
  const m = encodeQr(text, 'Q');
  const parts: string[] = [];

  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.modules[r][c]) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < m.size && m.modules[r][c + run]) run++;
      parts.push(`M${c} ${r}h${run}v1h-${run}z`);
      c += run;
    }
  }

  return { d: parts.join(''), size: m.size };
}
