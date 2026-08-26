'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { importContacts, setContactSubscribed } from '@/lib/campaigns';
import { buildPreview, CONTACT_FIELDS, parseCsv, type RowError } from '@/lib/csv-import';

/**
 * Importing a contact list, in two steps.
 *
 * Preview first, commit second — the same split the attendee importer uses, and
 * for the same reason: a file whose columns are in an unexpected order imports
 * every name into the company field, and nothing about the result looks wrong
 * until an email goes out addressed to "Acme Corp".
 */

const PATH = '/tickets/ticket-marketing/campaign-contact-list';

export interface ContactImportState {
  stage: 'idle' | 'preview' | 'done';
  message?: string;
  error?: string;
  /** Carried between the two steps so the file is uploaded once. */
  csv?: string;
  list?: string;
  header?: string[];
  sample?: Record<string, string>[];
  validCount?: number;
  totalRows?: number;
  errors?: RowError[];
  created?: number;
  updated?: number;
  suppressedKept?: number;
}

/** Guard against somebody pasting a whole CRM export into a textarea. */
const MAX_BYTES = 2_000_000;

async function readCsv(form: FormData): Promise<string | { error: string }> {
  const file = form.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return { error: 'That file is over 2 MB. Split it, or trim the columns you do not need.' };
    }
    return await file.text();
  }
  const pasted = String(form.get('pasted') ?? '').trim();
  if (pasted) {
    if (pasted.length > MAX_BYTES) {
      return { error: 'That is more text than the importer takes. Upload it as a file instead.' };
    }
    return pasted;
  }
  return { error: 'Choose a CSV file, or paste one in.' };
}

export async function previewContactsAction(
  _prev: ContactImportState,
  form: FormData,
): Promise<ContactImportState> {
  await requireOrganizer();

  const list = String(form.get('list') ?? '').trim();
  if (!list) {
    return {
      stage: 'idle',
      error:
        'Name the list first. An unnamed import cannot be segmented later, and "everyone we have ever met" is not a list you can email.',
    };
  }

  const csv = await readCsv(form);
  if (typeof csv !== 'string') return { stage: 'idle', error: csv.error };

  const preview = buildPreview<Record<string, string>>(parseCsv(csv), CONTACT_FIELDS);

  if (preview.valid.length === 0) {
    return {
      stage: 'idle',
      error:
        preview.errors[0]?.message ??
        'Nothing in that file has a usable email address. Check that the header row names the columns.',
      errors: preview.errors.slice(0, 20),
    };
  }

  return {
    stage: 'preview',
    csv,
    list,
    header: preview.header,
    sample: preview.valid.slice(0, 5),
    validCount: preview.valid.length,
    totalRows: preview.totalRows,
    errors: preview.errors.slice(0, 20),
  };
}

export async function commitContactsAction(
  _prev: ContactImportState,
  form: FormData,
): Promise<ContactImportState> {
  const actor = await requireOrganizer();

  const csv = String(form.get('csv') ?? '');
  const list = String(form.get('list') ?? '').trim();
  if (!csv || !list) return { stage: 'idle', error: 'The upload was lost. Start again.' };

  const preview = buildPreview<Record<string, string>>(parseCsv(csv), CONTACT_FIELDS);

  const outcome = await importContacts({
    rows: preview.valid.map((r) => ({
      email: r.email,
      name: r.name,
      company: r.company,
      source: r.source,
    })),
    list,
    actor,
  });

  revalidatePath(PATH);
  revalidatePath('/tickets/ticket-marketing/email-campaign');

  return {
    stage: 'done',
    created: outcome.created,
    updated: outcome.updated,
    suppressedKept: outcome.suppressedKept,
    errors: outcome.skipped.slice(0, 20).map((s) => ({ line: s.row, message: `${s.email}: ${s.why}` })),
    message:
      `${outcome.created} added, ${outcome.updated} updated on "${list}".` +
      (outcome.suppressedKept > 0
        ? ` ${outcome.suppressedKept} of them had previously unsubscribed — that was left in place and they will not be emailed.`
        : ''),
  };
}

/**
 * Record an unsubscribe, or lift one.
 *
 * A `POST`, not a link. A GET that unsubscribes somebody is one prefetch away
 * from removing a contact nobody touched — and the same shape, on the public
 * side, is how a mail client's link scanner unsubscribes an entire list.
 */
export async function toggleSubscribedAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const contactId = String(form.get('contactId') ?? '').trim();
  const subscribed = form.get('subscribed') === '1';
  if (contactId) await setContactSubscribed({ contactId, subscribed, actor });
  revalidatePath(PATH);
}
