/**
 * A form posted from a page that a deploy has since replaced (T379).
 *
 * Server action ids change with every build. A speaker who opened their link
 * before a deploy and pressed Send after it posts an id the new server does not
 * know: it answers 404 with the text below, and Next's client throws it. On
 * 2026-11-07 that left a speaker pressing Send four times on a page that did
 * nothing. The guard in `components/stale-guard.tsx` keeps what was typed,
 * reloads once, and puts it back. This file is the part with no browser in it.
 */

/**
 * An unknown action id, as the client sees it. Next 15.5 answers 404 with
 * `x-nextjs-action-not-found: 1`, and its router throws an
 * `UnrecognizedActionError` ("Server Action "…" was not found on the
 * server"). The older wordings are kept in case a Next upgrade goes back to
 * a plain-text 404 ("Server action not found.").
 */
export function isStaleActionError(err: unknown): boolean {
  if ((err as { name?: unknown } | null)?.name === 'UnrecognizedActionError') return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /Server action not found|Server Action "[^"]*" was not found on the server|Failed to find Server Action|older or newer deployment/i.test(
    message,
  );
}

/** How long a saved draft is worth putting back, and how soon a second reload counts as a loop. */
export const DRAFT_MAX_AGE_MS = 60 * 60_000;
export const RELOAD_LOOP_MS = 2 * 60_000;

export interface SavedDraft {
  at: number;
  /** Field name to its values in document order. Checkboxes and radios list the checked values only. */
  values: Record<string, string[]>;
  /** Set when the guard reloaded the page to get the new build. */
  reloadedAt?: number;
}

/** One per form, so two forms on one page (a submission and its Withdraw) keep apart. */
export function draftKey(pathname: string, form = 'form'): string {
  return `kgc-draft:${pathname}#${form}`;
}

/** Parses what was stored, or null for anything stale, foreign or broken. */
export function readDraft(raw: string | null, now: number): SavedDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SavedDraft;
    if (typeof d?.at !== 'number' || now - d.at > DRAFT_MAX_AGE_MS) return null;
    if (!d.values || typeof d.values !== 'object') return null;
    const values: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(d.values)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) values[k] = v;
    }
    return { at: d.at, values, reloadedAt: typeof d.reloadedAt === 'number' ? d.reloadedAt : undefined };
  } catch {
    return null;
  }
}

/** True when this page already reloaded for a stale action a moment ago, so a second reload would loop. */
export function reloadedRecently(previous: SavedDraft | null, now: number): boolean {
  return Boolean(previous?.reloadedAt && now - previous.reloadedAt < RELOAD_LOOP_MS);
}

/**
 * What a stale action does next (T388). The first time, reload by itself.
 * Within `RELOAD_LOOP_MS` of that reload (a second deploy, or a fast
 * rollback) it asks instead: the page still holds the old build's action
 * ids, so pressing Send again would fail the same way, and only a reload
 * the person chooses gets the new ones without risking a loop.
 */
export function staleNextStep(previous: SavedDraft | null, now: number): 'reload' | 'ask-reload' {
  return reloadedRecently(previous, now) ? 'ask-reload' : 'reload';
}

/**
 * Which fields are kept. Never the capability token or Next's own `$ACTION_`
 * fields (a new build has new ids), never a file, never a button.
 */
export function keepsField(input: { name: string; type: string; keep?: boolean }): boolean {
  if (!input.name || input.name.startsWith('$ACTION')) return false;
  if (['file', 'submit', 'button', 'reset', 'image', 'password'].includes(input.type)) return false;
  if (input.type === 'hidden') return Boolean(input.keep);
  return true;
}
