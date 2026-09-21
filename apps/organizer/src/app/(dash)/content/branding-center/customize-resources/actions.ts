'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  PAGE_BODY_MAX,
  normaliseSlug,
  slugProblem,
} from '@kgc/shared';
import { appendAudit, diff } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { getPage, listPages } from '@/lib/planning';

/**
 * Writing the custom content pages — the venue note, travel, the FAQ.
 *
 * ── The slug is the risky field, not the body ───────────────────────────────
 *
 * The body is prose and the renderer refuses to interpret markup, so the worst
 * a bad one does is read badly. The slug is an address: the website serves it
 * at `/{slug}`, Next resolves static segments first, and a page claiming
 * `agenda` would be published, linked and permanently unreachable with nothing
 * anywhere saying so. `slugProblem()` in `@kgc/shared` holds the reserved list
 * and the uniqueness check, shared with the seed so a fixture cannot be written
 * to an address the form would refuse.
 *
 * Uniqueness is checked by reading the other pages here rather than by keying
 * the document on the slug. The id has to survive a rename — an organizer who
 * changes `/wifi` to `/wi-fi` should not orphan the document — so the slug is a
 * field, and a field's uniqueness is a read-then-write. There is one author on
 * one screen, so the race that opens is a second organizer choosing the same
 * address in the same few seconds; it costs one duplicate address rather than
 * anything irreversible, and a transaction over a whole collection would be a
 * much worse trade.
 */

const PATH = '/content/branding-center/customize-resources';

export interface PageFormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function savePageAction(
  _prev: PageFormState,
  formData: FormData,
): Promise<PageFormState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  const body = String(formData.get('body') ?? '').replace(/\r\n?/g, '\n').trim();
  const orderRaw = String(formData.get('order') ?? '').trim();
  const published = formData.get('published') === 'on';

  // An empty address falls back to the title, which is what an organizer means
  // when they leave it blank and is the only way to get a sensible default
  // without JavaScript in the form.
  const slugRaw = String(formData.get('slug') ?? '').trim();
  const slug = normaliseSlug(slugRaw === '' ? title : slugRaw);

  const fieldErrors: Record<string, string> = {};
  if (title.length < 2) fieldErrors.title = 'Give the page a title. It is the heading people read.';
  if (body.length === 0) fieldErrors.body = 'Write something for the page to show.';
  if (body.length > PAGE_BODY_MAX) {
    fieldErrors.body = `That is longer than a page should be. Keep it under ${PAGE_BODY_MAX.toLocaleString('en-US')} characters.`;
  }

  const order = orderRaw === '' ? 0 : Number(orderRaw);
  if (!Number.isFinite(order)) fieldErrors.order = 'Order must be a number.';

  const existing = id ? await getPage(id) : null;
  if (id && !existing) return { error: 'That page no longer exists.' };

  const taken = (await listPages()).filter((p) => p.id !== id).map((p) => p.slug);
  const slugError = slugProblem(slug, taken);
  if (slugError) fieldErrors.slug = slugError;

  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  try {
    const ref = id
      ? db().collection(COLLECTIONS.pages).doc(id)
      : db().collection(COLLECTIONS.pages).doc();

    await ref.set(
      {
        eventId: EVENT_ID,
        title,
        slug,
        body,
        // Cleared explicitly rather than by omission: under `merge` an
        // `undefined` writes no key at all, so a summary somebody deleted would
        // stay on the page and the save would report success.
        summary: summary || FieldValue.delete(),
        published,
        order,
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const changed = diff(
      existing
        ? {
            title: existing.title,
            slug: existing.slug,
            published: String(existing.published === true),
            length: String((existing.body ?? '').length),
          }
        : {},
      {
        title,
        slug,
        published: String(published),
        length: String(body.length),
      },
    );

    await appendAudit({
      actor,
      action: existing ? 'page.update' : 'page.create',
      targetPath: `${COLLECTIONS.pages}/${ref.id}`,
      targetId: ref.id,
      before: changed.before,
      after: changed.after,
    });

    revalidatePath(PATH);

    return {
      ok: true,
      message: published
        ? `Saved. “${title}” is live at /${slug} and in the app.`
        : `Saved “${title}”. It is not published, so nobody else can see it yet.`,
    };
  } catch (err) {
    recordError('page.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the page.' };
  }
}
