'use server';

import { revalidatePath } from 'next/cache';
import {
  PAGE_CONTENT_KEYS,
  type CallPageContent,
  type CodeOfConductContent,
  type PageContentKey,
  type PageContentValues,
} from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import {
  parseMilestones,
  readPageContent,
  savePageContent,
  type MilestoneParse,
} from '@/lib/page-content';
import type { FormState } from '../../../form';

/**
 * The writer `pageContent` never had.
 *
 * ── An empty box means "use the page's own copy" ────────────────────────────
 *
 * Every field here is optional, and clearing one is a real edit rather than a
 * no-op: the value is dropped from `values` and the page falls back to the
 * constant compiled beside it. That asymmetry is why the whole bag is written
 * rather than merged — see `lib/page-content.ts`.
 *
 * It also means this dashboard cannot show an organizer what a field currently
 * says when they have never overridden it. The fallback copy lives in
 * `apps/web`, in the file that renders the page, and `page-content.ts` argues at
 * length that it belongs there: it is presentation, and making it importable
 * from here would mean two installs holding the same prose. So the screen shows
 * what has been overridden and says plainly what an empty box does, rather than
 * inventing a placeholder that would read as the live text.
 *
 * ── The save is visible immediately ─────────────────────────────────────────
 *
 * All three public pages are `export const dynamic = 'force-dynamic'`, so they
 * read Firestore on every request and there is no cache to bust and no deploy to
 * wait for. `revalidatePath` below is for *this* screen, so the form remounts
 * against the document that was just written.
 */

export interface PageCopyState extends FormState {
  /** Bumped on every save so the uncontrolled fields remount with new values. */
  version?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Absolute `https://`. A submission link is printed for strangers to click. */
function badSubmitUrl(url: string): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'That is not a URL. Include the scheme, e.g. https://easychair.org/…';
  }
  if (parsed.protocol !== 'https:') return 'Use an https:// address — this link is public.';
  return undefined;
}

async function saveCodeOfConduct(formData: FormData, actor: string): Promise<PageCopyState> {
  const reportEmail = String(formData.get('reportEmail') ?? '').trim().toLowerCase();
  const committee = String(formData.get('committee') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (reportEmail && !EMAIL.test(reportEmail)) {
    return { error: 'Some fields need attention.', fieldErrors: { reportEmail: 'That is not a valid email address.' } };
  }

  const values: Partial<CodeOfConductContent> = {};
  if (reportEmail) values.reportEmail = reportEmail;
  if (committee.length > 0) values.committee = committee;

  return commit(PAGE_CONTENT_KEYS.codeOfConduct, values, actor);
}

async function saveCallPage(
  key: typeof PAGE_CONTENT_KEYS.callForPosters | typeof PAGE_CONTENT_KEYS.startupPitch,
  formData: FormData,
  actor: string,
): Promise<PageCopyState> {
  const submitUrl = String(formData.get('submitUrl') ?? '').trim();
  const submitLabel = String(formData.get('submitLabel') ?? '').trim();
  const rawDates = String(formData.get('dates') ?? '');
  /*
   * `datesConfirmed` is only meaningful alongside a calendar. An unchecked box
   * on a page with no stored dates would write `false` over nothing and turn an
   * empty bag into one that claims the (compiled-in) dates are provisional —
   * so the flag is stored only when this form also supplies the dates it is
   * about.
   */
  const datesConfirmed = formData.get('datesConfirmed') === 'on';

  const urlError = badSubmitUrl(submitUrl);
  if (urlError) {
    return { error: 'Some fields need attention.', fieldErrors: { submitUrl: urlError } };
  }
  if (submitLabel && !submitUrl) {
    return {
      error: 'Some fields need attention.',
      fieldErrors: { submitLabel: 'A button label with no URL renders nothing. Add the link or clear the label.' },
    };
  }

  const parsed: MilestoneParse = parseMilestones(rawDates);
  if (!parsed.ok) {
    return { error: 'Some fields need attention.', fieldErrors: { dates: parsed.error } };
  }

  const values: Partial<CallPageContent> = {};
  if (submitUrl) values.submitUrl = submitUrl;
  if (submitLabel) values.submitLabel = submitLabel;
  if (parsed.dates.length > 0) {
    values.dates = parsed.dates;
    values.datesConfirmed = datesConfirmed;
  }

  return commit(key, values, actor);
}

async function commit<K extends PageContentKey>(
  key: K,
  values: Partial<PageContentValues[K]>,
  actor: string,
): Promise<PageCopyState> {
  // Read before writing so the audit entry carries the diff and not just the
  // result. This is the one editor whose output includes the address a
  // code-of-conduct incident is reported to; "changed from what" is the half
  // that answers a complaint.
  const before = await readPageContent(key);
  try {
    await savePageContent(key, values, actor);
  } catch (err) {
    recordError('pageContent.save', err);
    return { error: 'The save did not land. Nothing was changed.' };
  }

  await appendAudit({
    actor,
    action: 'pageContent.update',
    targetPath: `pageContent/${key}`,
    targetId: key,
    before: before as Record<string, unknown>,
    after: values as Record<string, unknown>,
  });

  revalidatePath('/content/basics/website-copy');

  const overridden = Object.keys(values).length;
  return {
    ok: true,
    version: Date.now(),
    message:
      overridden === 0
        ? 'Cleared. The page is back to the copy compiled into it.'
        : `Saved. The page is live with ${overridden === 1 ? 'this override' : `these ${overridden} overrides`} on the next request — no deploy.`,
  };
}

export async function savePageCopyAction(
  _prev: PageCopyState,
  formData: FormData,
): Promise<PageCopyState> {
  const actor = await requireOrganizer();
  const page = String(formData.get('page') ?? '');

  switch (page) {
    case PAGE_CONTENT_KEYS.codeOfConduct:
      return saveCodeOfConduct(formData, actor);
    case PAGE_CONTENT_KEYS.callForPosters:
    case PAGE_CONTENT_KEYS.startupPitch:
      return saveCallPage(page, formData, actor);
    default:
      return { error: 'That page is not editable from here.' };
  }
}
