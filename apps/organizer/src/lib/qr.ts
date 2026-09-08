/**
 * QR symbols for this dashboard, as SVG paths.
 *
 * ── The encoder is the app's, not a second one ──────────────────────────────
 *
 * `app/src/lib/qr/encode.ts` is a dependency-free pure function, verified
 * against the reference `qrcode` package across every version and
 * error-correction level in range (`tests/qr/encode.test.ts`). A second
 * implementation here would be a second thing that can disagree with the phone
 * screen, and the day they disagree is the day a printed badge stops scanning
 * while somebody holds it at the desk — the same argument AGENTS.md makes
 * against a second copy of `ensureRegistration`.
 *
 * The relative path is ugly because `apps/organizer` is deliberately not a
 * workspace member, so there is no package specifier to reach the app by. That
 * is the cost of the arrangement, paid once here rather than avoided by
 * duplicating 500 lines of Reed–Solomon.
 *
 * ── Two kinds of symbol, and they must not be confused ──────────────────────
 *
 * A **badge** QR encodes `qrSecret`, which is a bearer credential for
 * attendance. A **link** QR encodes a public URL — where to get the app, where
 * the agenda is — and is safe on a slide, a table sign, or a screenshot. Both
 * come out of this module and the caller picks; `badges.ts` wraps the first so
 * that a screen printing badges cannot accidentally be handed a URL builder,
 * and nothing here ever puts a secret into a page an organizer is told to
 * publish.
 *
 * Not `server-only`: this is arithmetic on a string, with no Firestore, no
 * credential and no filesystem in it, and a print or preview surface that
 * happens to be a client component should be able to call it.
 */

import { encodeQr, type ErrorCorrectionLevel } from '../../../../app/src/lib/qr/encode';

/**
 * The quiet zone, in modules, required by the spec on all four sides.
 *
 * Four is the standard minimum and it is not decoration — a symbol printed hard
 * against the edge of a card, or against a coloured panel, is a symbol many
 * handheld readers and phone cameras will not find at all.
 */
export const QR_QUIET_ZONE = 4;

/**
 * `text` as a single SVG path in module units, plus the symbol's side length.
 *
 * A path rather than one `<rect>` per module: a version-3 symbol is 29×29, so a
 * sheet of 25 badges is ~10,000 rects of markup against 25 path strings. Runs of
 * dark modules merge into one rectangle, which roughly halves the path again on
 * the dense rows through the middle. The browser is the print pipeline here —
 * there is no image step and no server-side rasteriser — so the size of the
 * document it has to lay out is the whole performance budget.
 *
 * Coordinates are in module units and the caller scales with `viewBox`, which
 * keeps the symbol crisp at any resolution: a vector QR has no pixel grid to
 * fight with the printer's.
 */
export function qrPath(text: string, ecl: ErrorCorrectionLevel = 'M'): { d: string; size: number } {
  const m = encodeQr(text, ecl);
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

/**
 * A link QR at error-correction level Q.
 *
 * Level Q rather than the encoder's default M, because these symbols are read
 * off a printed sign under conference lighting, or off a laptop screen by a
 * phone held at arm's length — 25% recovery buys back the glare spot and the
 * coffee ring. A badge stays at M: it is scanned deliberately, close up, by a
 * reader pointed at it.
 */
export function linkQr(url: string): { d: string; size: number } {
  return qrPath(url, 'Q');
}
