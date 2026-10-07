/**
 * CSV generation for the dashboard's exports.
 *
 * ── The formatting moved to `@kgc/shared/csv-core` ──────────────────────────
 *
 * `toCsv`, its escaping and `exportFilename` used to live here, and the
 * escaping is the only part of a CSV writer where being wrong is a security
 * fault rather than a cosmetic one — see the formula-injection note in
 * `csv-core.ts`. Exhibitor lead export is on the **website**, which cannot
 * import this package, so the choice was a second copy of that guard or one
 * home for it. It is re-exported rather than moved-and-updated-everywhere so
 * that the thirty-odd `from './csv'` imports in `exports.ts` and its neighbours
 * keep working unchanged.
 *
 * ── Deliberately NOT `server-only` ──────────────────────────────────────────
 *
 * Every other lib/ module here carries it. This one must not: it holds no
 * Firestore handle, no credential and no secret, and `server-only` throws
 * outside a React Server Component. `exports.ts`, which actually reads
 * Firestore, keeps it.
 */

export { exportFilename, toCsv, type Column } from '@kgc/shared';

/** A downloadable response. `text/csv` plus a filename Excel will honour. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // These contain attendee PII. Nothing may cache them — not the browser,
      // not a proxy, not Netlify's edge.
      'Cache-Control': 'no-store, private',
    },
  });
}
