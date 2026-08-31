'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { speakerId as mintSpeakerId } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getSpeaker } from '@/lib/data';
import { fanOutSpeakerRename, summariseFanOut } from '@/lib/denormalise';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { removeImage, uploadImage, UploadRejected, UploadUnavailable } from '@/lib/uploads';
import { readCsvUpload, type ProgrammeImportState } from '@/lib/csv-import';
import { commitSpeakerImport, previewSpeakerCsv, type SpeakerImportOutcome } from './import';

/**
 * Create or edit one speaker.
 *
 * Shaped on `exhibitor-manager/actions.ts`, which is the house pattern for an
 * entity editor here: validate, resolve the file before the document, merge,
 * audit, revalidate, and no delete. Three things are specific to speakers.
 *
 * ── 1. `userId` is never written by this form ───────────────────────────────
 *
 * A speaker who also holds a ticket has both a `speakers` document and a
 * `users` document, joined by `SpeakerDoc.userId`. That join is what makes the
 * app's speaker page resolve to a real profile, and nothing in this dashboard
 * mints it — it is set when a speaker's ticket is provisioned. So the field is
 * absent from the form, absent from the payload, and `{ merge: true }` leaves
 * whatever is on the document untouched. It is *shown* on the form, read-only,
 * because an organizer editing a name needs to know they are editing somebody
 * with an account rather than a bare programme entry.
 *
 * Writing `userId: undefined` would be just as bad as writing a wrong one:
 * `ignoreUndefinedProperties` drops it, so the field would survive by accident
 * rather than by intent, and the next person to add a field to this payload
 * would have no way to tell the two apart.
 *
 * ── 2. `sessionIds` belongs to the session editor, not here ─────────────────
 *
 * `SpeakerDoc.sessionIds` and `SessionDoc.speakerIds` are two halves of one
 * relationship. The half that an organizer actually edits is "who is on this
 * session", on Session Manager. Writing the other half from here would give the
 * pair two owners and no arbiter, so this form does not offer it: a new speaker
 * is created with an empty list, and an edit never touches it.
 *
 * ── 3. A rename fans out, and the fan-out is reported ───────────────────────
 *
 * `SessionDoc.speakerNames` is a positional cache of the names on every session
 * this speaker presents. Renaming without rewriting it leaves the agenda — in
 * the app, on the website, and in the printed programme export — showing the
 * old name with nothing to detect it. `fanOutSpeakerRename` is called after the
 * speaker document is written, and its result is returned to the screen rather
 * than swallowed: a rename that updated the speaker and failed on two sessions
 * is a half-applied rename, and the only thing worse than that happening is it
 * happening silently.
 */
export interface SpeakerState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** `summariseFanOut` for the session caches this save rewrote. */
  fanOut?: string;
  /** False when a fan-out batch failed and some sessions are still stale. */
  fanOutOk?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `speakers/{id}/photo.{ext}` — the layout `uploads.ts` documents. */
function photoTarget(docId: string) {
  return { folder: `${COLLECTIONS.speakers}/${docId}`, name: 'photo' };
}

/**
 * A pasted profile link, made into something that will actually open.
 *
 * People paste `linkedin.com/in/someone` far more often than they paste the
 * scheme, and a stored value without one renders as a relative link — which on
 * the website navigates to `kgc.example/linkedin.com/in/someone` and 404s. The
 * scheme is added rather than the value rejected, because rejecting it teaches
 * an organizer to paste it into a text editor first and paste it back.
 */
function normaliseUrl(raw: string): string | null {
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    // A bare word ("linkedin") parses as a hostname and is not a profile.
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function saveSpeakerAction(
  _prev: SpeakerState,
  formData: FormData,
): Promise<SpeakerState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const company = String(formData.get('company') ?? '').trim();
  const bio = String(formData.get('bio') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = 'Enter the speaker’s name as it should appear on the agenda.';
  if (contactEmail && !EMAIL.test(contactEmail)) {
    fieldErrors.contactEmail = 'That email address is not valid.';
  }

  /**
   * All three keys are always present in the payload — each is either a URL or
   * a delete.
   *
   * `{ merge: true }` merges a nested map **key by key**, so writing
   * `social: { linkedin }` would leave a previously stored `x` untouched and an
   * organizer clearing a link would be told it saved while it did not. Naming
   * every key on every write is what makes "clear this one" mean it.
   */
  const social: Record<string, string | FieldValue> = {};
  let anySocial = false;
  for (const key of ['linkedin', 'x', 'website'] as const) {
    const raw = String(formData.get(key) ?? '').trim();
    const url = normaliseUrl(raw);
    if (url === null) {
      fieldErrors[key] = 'That does not look like a link. Paste the full profile address.';
      continue;
    }
    social[key] = url || FieldValue.delete();
    if (url) anySocial = true;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  /**
   * The id is minted once and never re-derived.
   *
   * `speakerId(name, company)` is the importer's own function, so a speaker
   * added here and later re-imported from the agenda sheet lands on the *same*
   * document instead of a near-duplicate. But it is derived from the name, and
   * a rename must not move the document: `sessions.speakerIds` points at this
   * id, and so does every saved session on somebody's phone.
   */
  const existing = id ? await getSpeaker(id) : null;
  if (id && !existing) return { error: 'That speaker no longer exists.' };

  const docId = id || mintSpeakerId(name, company || undefined);
  if (!id) {
    const clash = await getSpeaker(docId);
    if (clash) {
      return {
        error: `“${clash.name}” already uses the id “${docId}”. If this is a different person, add their company to tell the two apart.`,
      };
    }
  }

  // Resolved before the document is written: a save that landed and an upload
  // that then failed leaves an organizer unable to tell which half happened.
  let photoURL: string | FieldValue | undefined;
  const picked = formData.get('photo');
  const photoFile = picked instanceof File && picked.size > 0 ? picked : null;
  const clearPhoto = String(formData.get('photoRemoved') ?? '') === '1' && !photoFile;

  try {
    if (photoFile) {
      photoURL = (await uploadImage(photoFile, photoTarget(docId))).url;
    } else if (clearPhoto) {
      await removeImage(photoTarget(docId));
      // `undefined` is dropped by `ignoreUndefinedProperties`, so the old
      // headshot would survive the save that was meant to remove it.
      photoURL = FieldValue.delete();
    }
  } catch (err) {
    recordError('speaker.photo', err);
    if (err instanceof UploadRejected || err instanceof UploadUnavailable) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : 'Could not store that image.' };
  }

  try {
    await db()
      .collection(COLLECTIONS.speakers)
      .doc(docId)
      .set(
        {
          eventId: EVENT_ID,
          name,
          /*
            Emptied fields are deleted, not omitted. The store runs with
            `ignoreUndefinedProperties`, so `x || undefined` silently drops the
            key and `{ merge: true }` then leaves the old value in place — an
            organizer who clears a wrong bio would be told it saved and would
            still be looking at the wrong bio. Chasing and correcting bios is
            most of what this screen is for, so this is the one place that
            matters most.
          */
          title: title || FieldValue.delete(),
          company: company || FieldValue.delete(),
          bio: bio || FieldValue.delete(),
          contactEmail: contactEmail || FieldValue.delete(),
          social: anySocial ? social : FieldValue.delete(),
          ...(photoURL === undefined ? {} : { photoURL }),
          // Never on an update — see the header. `userId` is absent for the
          // same reason and deliberately does not appear in this object at all.
          ...(existing ? {} : { sessionIds: [] }),
          ...(existing ? {} : { createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true },
      );
  } catch (err) {
    recordError('speaker.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the speaker.' };
  }

  /**
   * The fan-out runs after the speaker is saved and outside its try/catch.
   *
   * After, because a cache must never be rewritten to a name the source
   * document does not yet hold. Outside, because a failure here is a different
   * failure: the speaker *is* saved, and telling the organizer otherwise would
   * have them retype an edit that already landed.
   */
  let fanOut: string | undefined;
  let fanOutOk = true;
  if (existing && existing.name !== name) {
    const result = await fanOutSpeakerRename(db(), docId, name);
    fanOut = summariseFanOut(result);
    fanOutOk = result.ok;
    if (!result.ok) recordError('speaker.fanOut', new Error(result.errors.join('; ')));
  }

  await appendAudit({
    actor,
    action: existing ? 'speaker.update' : 'speaker.create',
    targetPath: `${COLLECTIONS.speakers}/${docId}`,
    targetId: docId,
    before: existing
      ? {
          name: existing.name,
          title: existing.title ?? null,
          company: existing.company ?? null,
          contactEmail: existing.contactEmail ?? null,
          hasBio: Boolean(existing.bio),
          photoURL: existing.photoURL ?? null,
        }
      : {},
    after: {
      name,
      title: title || null,
      company: company || null,
      contactEmail: contactEmail || null,
      hasBio: Boolean(bio),
      // Only when it moved. A row claiming the photo changed on every bio edit
      // makes the trail useless on the one occasion it matters.
      ...(typeof photoURL === 'string' ? { photoURL } : clearPhoto ? { photoURL: null } : {}),
      ...(fanOut ? { sessionCaches: fanOut } : {}),
    },
  });

  revalidatePath(ROUTES.speakerManager);
  // The rename rewrote `speakerNames` on sessions, so the agenda screens are
  // stale too. Cheap, and the alternative is an organizer seeing the old name
  // on the next screen and saving again.
  if (fanOut) {
    revalidatePath(ROUTES.sessionManager);
    revalidatePath(ROUTES.conflictCheck);
  }

  return {
    ok: true,
    message: existing ? `Saved ${name}.` : `Added ${name} as ${docId}.`,
    fanOut,
    fanOutOk,
  };
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/**
 * Preview a speaker CSV. Writes nothing.
 *
 * The pair below is thin on purpose — `requireOrganizer()`, read the upload,
 * hand it to `import.ts`, shape the result for the form. Everything that can be
 * wrong quietly is in the module they call, which is testable; a server action
 * is not.
 */
export async function previewSpeakerImportAction(
  _prev: ProgrammeImportState,
  formData: FormData,
): Promise<ProgrammeImportState> {
  await requireOrganizer();

  const csv = await readCsvUpload(formData);
  if (typeof csv !== 'string') return { stage: 'idle', error: csv.error };

  const preview = previewSpeakerCsv(csv);
  return {
    stage: 'preview',
    csv,
    header: preview.header,
    // Three rows is enough to see the columns landed where they should, which
    // is the only question a preview has to answer.
    sample: preview.valid.slice(0, 3),
    validCount: preview.valid.length,
    totalRows: preview.totalRows,
    errors: preview.errors,
  };
}

export async function commitSpeakerImportAction(
  _prev: ProgrammeImportState,
  formData: FormData,
): Promise<ProgrammeImportState> {
  const actor = await requireOrganizer();

  const csv = String(formData.get('csv') ?? '');
  if (!csv) return { stage: 'idle', error: 'The file was lost between steps. Upload it again.' };

  let outcome: SpeakerImportOutcome;
  try {
    outcome = await commitSpeakerImport({
      text: csv,
      actor,
      allowPartial: formData.get('allowPartial') === 'on',
    });
  } catch (err) {
    recordError('speaker.import', err);
    return { stage: 'preview', csv, error: err instanceof Error ? err.message : 'The import failed.' };
  }

  if (outcome.created === 0 && outcome.updated === 0) {
    return {
      stage: 'preview',
      csv,
      error:
        outcome.errors.length > 0 || outcome.failed.length > 0
          ? 'Nothing was imported — the file still has problems. Fix them, or tick “import the good rows anyway”.'
          : 'Nothing was imported.',
      errors: outcome.errors,
      failed: outcome.failed,
      totalRows: outcome.totalRows,
    };
  }

  revalidatePath(ROUTES.speakerManager);
  // A new speaker changes who the session editor can pick and who Message
  // Speakers resolves to, and both read the collection this just wrote.
  revalidatePath(ROUTES.sessionManager);
  revalidatePath(ROUTES.messageSpeakers);

  return {
    stage: 'done',
    errors: outcome.errors,
    failed: outcome.failed,
    totalRows: outcome.totalRows,
    message:
      `Imported ${outcome.created} new ${outcome.created === 1 ? 'speaker' : 'speakers'}` +
      (outcome.updated ? `, updated ${outcome.updated} already on the list` : '') +
      '.',
  };
}
