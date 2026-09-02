/**
 * Keep only the stored fields whose shape matches the fallback's.
 *
 * ⚠️ Not defensive programming for its own sake. Settings and page-content
 * documents written before 2026-08-31 hold `null` for a cleared field, and a
 * raw spread over the defaults puts `null` where the type says `string` —
 * which is how a page ends up printing the word "null" to the public. The type
 * signature would otherwise be a claim about data written by an older version
 * of the writer, which it cannot be.
 *
 * ── Why it lives here and not in either app ─────────────────────────────────
 *
 * It lived twice: in `apps/web/src/lib/data.ts` and in
 * `apps/organizer/src/lib/settings.ts`, both guarding the same defect, both
 * carrying a comment saying the copy was necessary because "the two apps are
 * separate installs and neither may import the other". That premise was false —
 * both already depend on this package, which is how the document types and
 * `SPEAKERS_PAGE_SOURCE` already cross the same boundary. The copies had also
 * already drifted: the website's handled arrays and the dashboard's did not, so
 * a stored object would pass through an array field on one side and not the
 * other.
 *
 * The richer of the two is what survived. It is a superset: `SETTINGS_DEFAULTS`
 * has no array field today, so the dashboard sees no behaviour change, and the
 * day one is added it gets the checked version rather than the hole.
 *
 * `typeof` alone would let any object through an array field, so arrays are
 * checked structurally: an array field keeps the stored value only if every
 * element matches the first element of the fallback. A page whose deadline list
 * arrives half-malformed shows the constant, not a row reading "undefined".
 */
export function usable<T extends object>(fallback: T, stored: unknown): Partial<T> {
  if (!stored || typeof stored !== "object") return {};
  const shape = fallback as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!(k in shape)) continue;
    const want = shape[k];

    if (Array.isArray(want)) {
      if (!Array.isArray(v)) continue;
      /*
       * An empty stored list falls back to the constant rather than emptying
       * the page. Every array these stores hold is one where emptiness is a
       * regression and not a statement: a code of conduct that names nobody to
       * report to, a call page with the heading "Important dates" and nothing
       * under it. An organizer who wants a section gone needs a control that
       * says so, not a list they happened to clear.
       */
      if (v.length === 0) continue;
      const template = want[0] as unknown;
      if (template !== undefined && !v.every((el) => sameShape(template, el))) continue;
      out[k] = v;
      continue;
    }

    if (typeof v !== typeof want || v === null) continue;
    out[k] = v;
  }

  return out as Partial<T>;
}

/** Whether `value` carries every key of `template`, at the same primitive types. */
function sameShape(template: unknown, value: unknown): boolean {
  if (typeof template !== "object" || template === null) return typeof value === typeof template;
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(template as Record<string, unknown>).every(
    ([k, t]) => typeof (value as Record<string, unknown>)[k] === typeof t,
  );
}
