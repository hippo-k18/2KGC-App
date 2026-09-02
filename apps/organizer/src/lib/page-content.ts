import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type CallMilestone,
  type PageContentDoc,
  type PageContentKey,
  type PageContentValues,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * The write half of `pageContent/{pageId}` — the editor the contract promised.
 *
 * `packages/shared/src/page-content.ts` has described a store of "copy edited
 * without a deploy" since it was written, and `apps/web` has read it from three
 * pages since the same day. Nothing anywhere wrote it: a repo-wide grep found
 * readers in the website and not one writer in this dashboard, in `functions/`
 * or in `scripts/`. So the promise was unreachable, and the three pages had
 * been quietly rendering their compiled-in constants forever — including the
 * code of conduct's reporting address, which is the one string on the public
 * site that fails a person at the exact moment they need it.
 *
 * ── Why the Admin SDK, and why that is not a shortcut ───────────────────────
 *
 * `pageContent` has no `match` block in `firestore.rules` at all, deliberately:
 * `collections.ts` records it as server-only, and the website renders it with
 * the Admin SDK. This dashboard is the same kind of caller, so a write from
 * here needs no rule and no rules deploy. That is the whole reason this was
 * cheap to build and worth building now rather than filing.
 *
 * ── The document is owned whole, not merged ─────────────────────────────────
 *
 * `savePageContent` replaces `values` outright rather than merging into it. One
 * screen owns one document, and a merge cannot express the edit that *removes*
 * an override — clearing the submission URL would silently keep the old one and
 * report "Saved", which is the failure the fields are most likely to be used
 * for. An omitted field is the page falling back to its own constant, and that
 * is exactly what the store's partial-bag contract means.
 */

/**
 * What an organizer has actually overridden for one page.
 *
 * An absent document, or one stamped with another year's `eventId`, reads as
 * "nothing overridden" — the same answer `apps/web`'s reader gives, because a
 * form that showed 2026's deadlines as though they were this edition's would be
 * worse than an empty one.
 */
export async function readPageContent<K extends PageContentKey>(
  key: K,
): Promise<Partial<PageContentValues[K]>> {
  const snap = await db().collection(COLLECTIONS.pageContent).doc(key).get();
  const data = snap.data() as PageContentDoc<K> | undefined;
  if (!snap.exists || data?.eventId !== EVENT_ID) return {};
  return data.values ?? {};
}

/** Who last touched a page's copy, for the screen to print. */
export interface PageContentMeta {
  updatedBy?: string;
  /** ISO 8601, or undefined when nothing has ever been saved. */
  updatedAt?: string;
}

export async function readPageContentMeta(key: PageContentKey): Promise<PageContentMeta> {
  const snap = await db().collection(COLLECTIONS.pageContent).doc(key).get();
  const data = snap.data() as PageContentDoc | undefined;
  if (!snap.exists || data?.eventId !== EVENT_ID) return {};
  const at = data.updatedAt as { toDate?: () => Date } | undefined;
  return {
    updatedBy: data.updatedBy,
    updatedAt: at?.toDate ? at.toDate().toISOString() : undefined,
  };
}

export async function savePageContent<K extends PageContentKey>(
  key: K,
  values: Partial<PageContentValues[K]>,
  actor: string,
): Promise<void> {
  await db()
    .collection(COLLECTIONS.pageContent)
    .doc(key)
    .set({
      eventId: EVENT_ID,
      values,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    });
}

// ---------------------------------------------------------------------------
// Milestones as text
// ---------------------------------------------------------------------------

/**
 * The deadline calendar, as one line per milestone.
 *
 * A textarea rather than an add/remove row editor, and that is a choice rather
 * than a corner cut. A call for posters has four or five dates that are rewritten
 * as a block once a year — the entire list is retyped when the edition moves —
 * and a row editor optimises for the edit nobody makes while costing a client
 * component with its own state, its own reordering and its own empty row.
 *
 * `when` is free text on purpose (`CallMilestone` says so: it is printed exactly
 * as written, "March 25, 2027"), so the separator has to be a character no date
 * and no sentence contains. A pipe is that character; an em dash and a hyphen
 * both appear inside real deadline lines.
 */
export const MILESTONE_SEPARATOR = '|';

export function formatMilestones(dates: readonly CallMilestone[] | undefined): string {
  return (dates ?? []).map((d) => `${d.when} ${MILESTONE_SEPARATOR} ${d.what}`).join('\n');
}

export type MilestoneParse =
  | { ok: true; dates: CallMilestone[] }
  | { ok: false; error: string };

export function parseMilestones(raw: string): MilestoneParse {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const dates: CallMilestone[] = [];
  for (const [i, line] of lines.entries()) {
    const at = line.indexOf(MILESTONE_SEPARATOR);
    if (at < 0) {
      return {
        ok: false,
        error: `Line ${i + 1} has no “${MILESTONE_SEPARATOR}”. Each line is “March 25, 2027 ${MILESTONE_SEPARATOR} Submissions close”.`,
      };
    }
    const when = line.slice(0, at).trim();
    const what = line.slice(at + 1).trim();
    if (!when || !what) {
      return { ok: false, error: `Line ${i + 1} is missing the date or what falls due on it.` };
    }
    dates.push({ when, what });
  }
  return { ok: true, dates };
}
