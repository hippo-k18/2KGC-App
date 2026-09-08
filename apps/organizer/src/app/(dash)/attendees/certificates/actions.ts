'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { attendeeAttendance } from '@/lib/attendance';
import { appendAudit } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { removeImage, uploadImage, UploadRejected, UploadUnavailable } from '@/lib/uploads';

/**
 * Issuing attendance certificates.
 *
 * ── What "issue" means here, precisely ──────────────────────────────────────
 *
 * It writes a `certificates/{registrationId}` document holding the hours, the
 * sessions, the wording and the signatory **as they stand at this moment**, and
 * the printable sheet renders from those documents. It does not email anything:
 * nothing in this dashboard sends a per-attendee PDF, and the screen says so in
 * one line rather than implying a send that never happens.
 *
 * ── Only people with session hours ──────────────────────────────────────────
 *
 * A door check-in says somebody came to the conference; a *session* check-in
 * says which room they were counted into, and that is the only thing an hours
 * claim can be built from. Issuing on the strength of a door scan alone would
 * put a number on a certificate that the data does not support, so the
 * qualifying set is `attendeeAttendance()` — everybody counted into at least
 * one session — and nobody else.
 *
 * ⚠️ The hours are *scheduled* lengths, not time in the seat: nothing records a
 * departure. That is stated on the certificate itself, not only on the screen,
 * because the certificate is the artefact that leaves the building.
 *
 * ── The logo is pinned, like everything else on the page ────────────────────
 *
 * One object at `certificates/logo` in Firebase Storage, uploaded through
 * `lib/uploads.ts` — the same writer the sponsor, exhibitor and speaker images
 * use, rather than a second uploader with its own opinion about file types.
 * Its download URL is copied onto every certificate in the run, so replacing
 * the mark next year does not silently redraw the copy already in somebody's
 * file. A run with no new file keeps whatever the previous run pinned.
 *
 * ⚠️ The bundled KGC mark (`lib/certificates.ts`' `DEFAULT_LOGO_URL`) is a
 * default and is resolved **before** this action, by `lastWording()`, arriving
 * here in `currentLogoUrl` like any other pinned value. That is deliberate and
 * not laziness about where a default belongs: the only difference this action
 * can see between "nothing has ever been issued" and "the last run deliberately
 * had no mark" is that field, so re-applying the default here would resurrect a
 * mark an organizer had removed, on every subsequent run, while telling them it
 * had saved. The default is chosen once, on the branch that can tell those two
 * apart; this action copies whatever it is handed onto the paper.
 */

const PATH = '/attendees/certificates';

/** Firestore's cap on a single batched write. Chunked rather than assumed. */
const BATCH_LIMIT = 400;

/** One object for the whole event: the mark at the head of every certificate. */
const LOGO_TARGET = { folder: 'certificates', name: 'logo' };

export interface IssueState {
  ok?: boolean;
  message?: string;
  error?: string;
}

export async function issueCertificatesAction(
  _prev: IssueState,
  formData: FormData,
): Promise<IssueState> {
  const actor = await requireOrganizer();

  const statement = String(formData.get('statement') ?? '').trim();
  const signatoryName = String(formData.get('signatoryName') ?? '').trim();
  const signatoryRole = String(formData.get('signatoryRole') ?? '').trim();

  if (!statement) return { error: 'Enter the wording the certificate states.' };
  if (!signatoryName) return { error: 'Somebody has to sign it. A name, as it should print.' };

  const picked = formData.get('logo');
  const logoFile = picked instanceof File && picked.size > 0 ? picked : null;
  const cleared = String(formData.get('logoRemoved') ?? '') === '1' && !logoFile;
  let logoUrl = String(formData.get('currentLogoUrl') ?? '').trim();

  try {
    if (logoFile) {
      logoUrl = (await uploadImage(logoFile, LOGO_TARGET)).url;
    } else if (cleared) {
      await removeImage(LOGO_TARGET);
      logoUrl = '';
    }
  } catch (err) {
    recordError('certificate.logo', err);
    if (err instanceof UploadRejected || err instanceof UploadUnavailable) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : 'Could not store that image.' };
  }

  try {
    const hours = await attendeeAttendance();
    if (hours.rows.length === 0) {
      return {
        error:
          'Nobody has been counted into a session, so there are no hours to certify. Open a room door on Check-in first.',
      };
    }

    const now = FieldValue.serverTimestamp();
    let written = 0;

    for (let i = 0; i < hours.rows.length; i += BATCH_LIMIT) {
      const batch = db().batch();
      for (const row of hours.rows.slice(i, i + BATCH_LIMIT)) {
        const ref = db().collection(COLLECTIONS.certificates).doc(row.registration.id);
        batch.set(
          ref,
          {
            eventId: EVENT_ID,
            registrationId: row.registration.id,
            name: row.registration.name,
            email: row.registration.email,
            minutes: row.minutes,
            sessionTitles: row.sessions.map((s) => s.title),
            statement,
            // An empty string clears it on a re-issue. `undefined` would be
            // dropped by `ignoreUndefinedProperties` under this merge and the
            // old logo would survive the run that was meant to remove it —
            // AGENTS.md gotcha 9, in its most literal form.
            logoUrl: logoUrl || FieldValue.delete(),
            signatoryName,
            // Blank is a real answer — plenty of signatories have no title
            // worth printing — so it is stored as an empty string rather than
            // left out, and the template simply does not print a second line.
            signatoryRole,
            issuedAt: now,
            issuedBy: actor,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        written += 1;
      }
      await batch.commit();
    }

    await appendAudit({
      actor,
      action: 'certificate.issue',
      targetPath: COLLECTIONS.certificates,
      targetId: EVENT_ID,
      before: {},
      after: {
        issued: written,
        statement,
        signatoryName,
        logoUrl: logoUrl || null,
        totalMinutes: hours.rows.reduce((n, r) => n + r.minutes, 0),
        sessionsTracked: hours.tracked,
        sessionsLive: hours.live,
      },
    });

    revalidatePath(PATH);
    return {
      ok: true,
      message: `Issued ${written} ${written === 1 ? 'certificate' : 'certificates'} on the attendance as it stands now. Print them below; nothing was emailed.`,
    };
  } catch (err) {
    recordError('certificate.issue', err);
    return { error: err instanceof Error ? err.message : 'Could not issue the certificates.' };
  }
}
