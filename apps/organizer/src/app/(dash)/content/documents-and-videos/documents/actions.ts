'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type DocumentDoc } from '@kgc/shared';
import { appendAudit, diff } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { getDocument } from '@/lib/planning';

/**
 * Creating and editing the documents an attendee can open from the app.
 *
 * The screen listed `documents` and offered no way to add one, so every row in
 * the collection came from `seed-demo.ts`. This is the writer.
 *
 * ── `visibleToTicketTypes` is the field to be careful with ──────────────────
 *
 * `listPublicDocuments()` in `apps/web` and `toDocumentRow()` in
 * `lib/planning.ts` both treat a **missing** array and an **empty** one as
 * different answers: absence is not permission, so a document with no field at
 * all stays off the public page, while `[]` means everybody. That distinction
 * only survives if this action always writes the array explicitly — under
 * `merge` an `undefined` writes no key at all (AGENTS.md gotcha 9), so "I
 * cleared the restriction" would leave the old restriction in place and report
 * success.
 *
 * ── The ticket names are strings, and that is the model's decision ──────────
 *
 * `DocumentDoc.visibleToTicketTypes` holds ticket type *names*, not ids, and
 * `apps/web` matches on the name. So the form offers the names that exist
 * rather than a free text box: a restriction naming a tier nobody sells hides
 * the document from everyone, silently, and looks identical to one that works.
 */

const PATH = '/content/documents-and-videos/documents';

const KINDS: DocumentDoc['kind'][] = ['pdf', 'slides', 'video', 'link'];
const STATUSES: DocumentDoc['status'][] = ['draft', 'published', 'cancelled'];

export interface DocumentState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * An `http(s)` URL, or nothing.
 *
 * The scheme check is not pedantry: the value is rendered as an anchor in the
 * app and on the public site, and a `javascript:` href typed into a dashboard
 * text box is a script injection on a page a thousand people open.
 */
function parseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function saveDocumentAction(
  _prev: DocumentState,
  formData: FormData,
): Promise<DocumentState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const rawUrl = String(formData.get('url') ?? '').trim();
  const kindRaw = String(formData.get('kind') ?? 'link').trim();
  const statusRaw = String(formData.get('status') ?? 'draft').trim();
  const orderRaw = String(formData.get('order') ?? '').trim();
  /**
   * `getAll`, because the restriction is a set of checkboxes. An unticked box
   * submits nothing, so "restricted to nobody in particular" arrives here as an
   * empty list — which is the value that means everybody, and is written as
   * such rather than left out.
   */
  const visibleToTicketTypes = formData
    .getAll('visibleToTicketTypes')
    .map((v) => String(v).trim())
    .filter(Boolean);

  const fieldErrors: Record<string, string> = {};
  if (title.length < 2) fieldErrors.title = 'Give the document a title. It is what the app shows.';

  const url = parseUrl(rawUrl);
  if (!url) {
    fieldErrors.url =
      'Paste the full address of the file, starting with https://. Nothing else is opened.';
  }

  const order = orderRaw === '' ? 0 : Number(orderRaw);
  if (!Number.isFinite(order)) fieldErrors.order = 'Order must be a number.';

  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  const kind = (KINDS as string[]).includes(kindRaw) ? (kindRaw as DocumentDoc['kind']) : 'link';
  const status = (STATUSES as string[]).includes(statusRaw)
    ? (statusRaw as DocumentDoc['status'])
    : 'draft';

  const existing = id ? await getDocument(id) : null;
  if (id && !existing) return { error: 'That document no longer exists.' };

  try {
    const ref = id
      ? db().collection(COLLECTIONS.documents).doc(id)
      : db().collection(COLLECTIONS.documents).doc();

    await ref.set(
      {
        eventId: EVENT_ID,
        title,
        // Cleared explicitly rather than by omission — see the header.
        description: description || FieldValue.delete(),
        url,
        kind,
        status,
        order,
        visibleToTicketTypes,
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const changed = diff(
      existing
        ? {
            title: existing.title,
            url: existing.url,
            kind: existing.kind,
            status: existing.status,
            visibleToTicketTypes: (existing.visibleToTicketTypes ?? []).join(', '),
          }
        : {},
      {
        title,
        url,
        kind,
        status,
        visibleToTicketTypes: visibleToTicketTypes.join(', '),
      },
    );

    await appendAudit({
      actor,
      action: existing ? 'document.update' : 'document.create',
      targetPath: `${COLLECTIONS.documents}/${ref.id}`,
      targetId: ref.id,
      before: changed.before,
      after: changed.after,
    });

    revalidatePath(PATH);

    return {
      ok: true,
      message:
        status === 'published'
          ? `Saved. “${title}” is live in the app.`
          : `Saved “${title}” as a draft. Attendees cannot see it yet.`,
    };
  } catch (err) {
    recordError('document.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the document.' };
  }
}
