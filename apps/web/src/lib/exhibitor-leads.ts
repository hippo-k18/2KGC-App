import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  leadConsentWording,
  normaliseLeadNote,
  readScannedCode,
  type ExhibitorDoc,
  type ExhibitorLeadDoc,
  type LeadRow,
  type RegistrationDoc,
} from '@kgc/shared';
import {
  exhibitorLinkOpens,
  readExhibitorToken,
} from '@kgc/scripts/src/lib/exhibitor-token';
import { db } from '@/lib/firestore';

/**
 * One exhibitor's lead desk: what their link opens, and what it may write.
 *
 * ── Why this is on the website and uses the Admin SDK ───────────────────────
 *
 * The same reason `speaker-portal.ts` and `consent/store.ts` are. Booth staff
 * have no Firebase account — they are whoever the exhibiting company put on the
 * stand that morning — so there is no uid, no `registered` claim and nothing
 * for `firestore.rules` to check. The capability link is the whole of the
 * authentication, and `exhibitor-token.ts` says what that is worth.
 *
 * ── The three things this file will not do ──────────────────────────────────
 *
 * **It never takes the exhibitor from the request.** Whose desk this is comes
 * out of the HMAC-verified token and nowhere else, so a field naming another
 * company changes nothing about whose leads are read or written. Every function
 * below takes the raw token rather than an exhibitor id, for the reason
 * `openPortal` gives: a future action cannot forget a step it has no way to
 * skip, and "Revoke link" has to stop the writes as well as the page.
 *
 * **It never looks anybody up by name or address.** The only way into this
 * file's read of `registrations` is a code that came off a badge held in front
 * of the camera, matched on `qrSecret` or on the six-character `claimCode`
 * printed under it. There is no search box and there is no endpoint for one. An
 * exhibitor list that could be queried by address would be the delegate list.
 *
 * **It never writes a lead without an agreement.** The scan resolves the badge
 * and returns what would be shared; nothing is stored until the attendee taps
 * agree, and the sentence they saw is stored with the record. A scan on its own
 * leaves nothing behind.
 */

export interface DeskExhibitor {
  exhibitorId: string;
  name: string;
  boothNumber?: string;
}

/** What a link buys, once it has been checked. */
export interface DeskGrant {
  exhibitorId: string;
  exhibitor: ExhibitorDoc;
}

const millis = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

/**
 * The one door. Every read and every write on this feature comes through here.
 *
 * Returns null for a bad token, an expired one, a revoked one, an exhibitor who
 * has been cancelled and one belonging to another event — deliberately without
 * distinguishing them, because three of those would otherwise answer "is this
 * company still exhibiting?" to anybody holding an old URL.
 */
export async function openLeadDesk(rawToken: string): Promise<DeskGrant | null> {
  const payload = readExhibitorToken(rawToken);
  if (!payload) return null;

  const snap = await db().collection(COLLECTIONS.exhibitors).doc(payload.xid).get();
  if (!snap.exists) return null;

  const exhibitor = snap.data() as ExhibitorDoc;
  const opens = exhibitorLinkOpens({
    iat: payload.iat,
    leadLinksValidFrom: exhibitor.leadLinksValidFrom,
    exhibitorEventId: exhibitor.eventId,
    eventId: EVENT_ID,
    status: exhibitor.status,
  });
  if (!opens) return null;

  return { exhibitorId: payload.xid, exhibitor };
}

/**
 * Every lead this exhibitor has taken, newest first.
 *
 * The query is the whole access control: it is a read of
 * `exhibitors/{their id}/leads` and there is no filter to get wrong. An
 * exhibitor cannot see somebody they did not scan because nobody they did not
 * scan is in this collection.
 */
export async function listLeads(rawToken: string): Promise<LeadRow[] | null> {
  const grant = await openLeadDesk(rawToken);
  if (!grant) return null;

  const snap = await db()
    .collection(COLLECTIONS.exhibitors)
    .doc(grant.exhibitorId)
    .collection(SUBCOLLECTIONS.leads)
    .get();

  return snap.docs
    .map((d) => {
      const lead = d.data() as ExhibitorLeadDoc;
      return {
        registrationId: d.id,
        name: lead.name,
        email: lead.email,
        company: lead.company,
        title: lead.title,
        note: lead.note,
        scannedAtMs: millis(lead.scannedAt),
      } satisfies LeadRow;
    })
    .sort((a, b) => (b.scannedAtMs ?? 0) - (a.scannedAtMs ?? 0));
}

export type ScanOutcome =
  /** A badge we recognise, not yet on this exhibitor's list. Awaiting agreement. */
  | { outcome: 'found'; attendee: ScannedAttendee; wording: string }
  /** Already on the list. Shown with what was recorded, not re-asked. */
  | { outcome: 'already'; attendee: ScannedAttendee; scannedAtMs?: number; note?: string }
  /** Nothing matches that code. */
  | { outcome: 'unknown' }
  /** A ticket that is no longer active — refunded, cancelled or transferred. */
  | { outcome: 'not-active' }
  /** The code is not the shape of a badge or a claim code at all. */
  | { outcome: 'unreadable' }
  /** The link has stopped working. */
  | { outcome: 'closed' }
  | { outcome: 'error' };

export interface ScannedAttendee {
  registrationId: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
}

/**
 * Resolve a scanned code to the person standing in front of the stand.
 *
 * ⚠️ **This writes nothing.** It is the half that says who it was and what
 * would be shared, so the attendee can read it before deciding. Storing on
 * sight would make the consent line a notice rather than a choice.
 *
 * The lookup is a single-field equality query, not a scan of the collection:
 * `qrSecret` has no `fieldOverrides` entry, so it is singly indexed by default
 * and this works in production as well as on the emulator. The check-in desk
 * reads the whole collection instead because it also renders it; nothing here
 * ever holds more than one registration.
 */
export async function scanBadge(rawToken: string, rawCode: string): Promise<ScanOutcome> {
  try {
    const grant = await openLeadDesk(rawToken);
    if (!grant) return { outcome: 'closed' };

    const parsed = readScannedCode(rawCode);
    if (!parsed) return { outcome: 'unreadable' };

    const field = parsed.kind === 'badge' ? 'qrSecret' : 'claimCode';
    const snap = await db()
      .collection(COLLECTIONS.registrations)
      .where(field, '==', parsed.code)
      .limit(2)
      .get();

    const doc = snap.docs.find((d) => (d.data() as RegistrationDoc).eventId === EVENT_ID);
    if (!doc) return { outcome: 'unknown' };

    const reg = doc.data() as RegistrationDoc;
    /*
     * A refunded or transferred badge resolves to a document — it is kept so
     * the check-in desk has an answer — but it is not somebody who may be added
     * to a mailing list on the strength of it.
     */
    if (reg.status !== 'active') return { outcome: 'not-active' };

    /*
     * Company and job title come from the attendee's own profile where they
     * have one, and from the registration otherwise.
     *
     * That is the order `RegistrationDoc.title` already states for the name
     * badge — "the attendee's own profile wins wherever both exist" — and it is
     * the right one here for a stronger reason: the consent sentence says "your
     * company and job title", and the version the attendee typed themselves is
     * the one they mean. A registration's copy is what an organizer typed to
     * print a badge, which is often a purchase-order company rather than the
     * one on their card.
     *
     * ⚠️ No other field of the profile is read, and the privacy switches on it
     * are deliberately not consulted. `visibleInDirectory` is about being
     * listed to a thousand attendees; this is one person, standing at a stand,
     * agreeing on screen. Reading anything else here — the bio, the interests,
     * the photo — would be sharing something nobody was asked about.
     */
    let company = reg.company?.trim() || undefined;
    let title = reg.title?.trim() || undefined;
    if (reg.claimedByUid) {
      try {
        const profile = await db().collection(COLLECTIONS.users).doc(reg.claimedByUid).get();
        const u = profile.data() as { company?: string; title?: string } | undefined;
        company = u?.company?.trim() || company;
        title = u?.title?.trim() || title;
      } catch (err) {
        // The registration is enough to record a lead. A profile that cannot be
        // read costs two optional columns, not the scan.
        console.error('[exhibitor-leads] could not read the profile for a scan', err);
      }
    }

    const attendee: ScannedAttendee = {
      registrationId: doc.id,
      name: reg.name?.trim() || reg.email,
      email: reg.email,
      company,
      title,
    };

    const existing = await db()
      .collection(COLLECTIONS.exhibitors)
      .doc(grant.exhibitorId)
      .collection(SUBCOLLECTIONS.leads)
      .doc(doc.id)
      .get();

    if (existing.exists) {
      const lead = existing.data() as ExhibitorLeadDoc;
      return {
        outcome: 'already',
        attendee,
        scannedAtMs: millis(lead.scannedAt),
        note: lead.note,
      };
    }

    return { outcome: 'found', attendee, wording: leadConsentWording(grant.exhibitor.name) };
  } catch (err) {
    console.error('[exhibitor-leads] could not resolve that badge', err);
    return { outcome: 'error' };
  }
}

export type SaveOutcome =
  | { outcome: 'saved'; name: string }
  | { outcome: 'already'; name: string }
  | { outcome: 'unknown' }
  | { outcome: 'not-active' }
  | { outcome: 'unreadable' }
  | { outcome: 'closed' }
  | { outcome: 'error' };

/**
 * Record the lead, because the attendee agreed.
 *
 * ⚠️ It re-scans rather than trusting anything the form sends. The browser
 * posts back the **code**, not a name or an address, so the record is built
 * from the registration the badge resolves to at this instant and the form
 * cannot name anybody. Without that, "agree" would be an endpoint for writing
 * an arbitrary person into an exhibitor's list.
 *
 * `create()` rather than `set()`, for the reason `checkIns` uses it: the id is
 * the registration, so a second agreement from the same badge fails with
 * `already-exists` and *that failure is the duplicate check*. There is no
 * read-then-write race to lose, and a lead's `scannedAt` cannot be moved by a
 * later scan to a day the conversation did not happen on.
 */
export async function recordLead(input: {
  rawToken: string;
  code: string;
  note: string;
}): Promise<SaveOutcome> {
  try {
    const grant = await openLeadDesk(input.rawToken);
    if (!grant) return { outcome: 'closed' };

    const scan = await scanBadge(input.rawToken, input.code);
    if (scan.outcome === 'already') return { outcome: 'already', name: scan.attendee.name };
    if (scan.outcome !== 'found') {
      return { outcome: scan.outcome === 'error' ? 'error' : scan.outcome } as SaveOutcome;
    }

    const note = normaliseLeadNote(input.note);
    const now = new Date();

    const lead: ExhibitorLeadDoc = {
      eventId: EVENT_ID,
      exhibitorId: grant.exhibitorId,
      registrationId: scan.attendee.registrationId,
      name: scan.attendee.name,
      email: scan.attendee.email,
      ...(scan.attendee.company ? { company: scan.attendee.company } : {}),
      ...(scan.attendee.title ? { title: scan.attendee.title } : {}),
      ...(note ? { note } : {}),
      // A native `Date`, never a sentinel built in `@kgc/scripts` — but this
      // store is `apps/web`'s own, so `serverTimestamp` would be legal here.
      // `Date` anyway, because `scannedAt` is the moment of the conversation
      // and the two must agree with `consent.grantedAt` to the second.
      scannedAt: now as unknown as ExhibitorLeadDoc['scannedAt'],
      consent: {
        grantedAt: now as unknown as ExhibitorLeadDoc['consent']['grantedAt'],
        wording: scan.wording,
        source: 'badge-scan',
      },
    };

    try {
      await db()
        .collection(COLLECTIONS.exhibitors)
        .doc(grant.exhibitorId)
        .collection(SUBCOLLECTIONS.leads)
        .doc(scan.attendee.registrationId)
        .create(lead);
    } catch (err) {
      // `already-exists` is the mechanism, not a fault: two taps on one badge.
      if ((err as { code?: number }).code === 6) {
        return { outcome: 'already', name: scan.attendee.name };
      }
      throw err;
    }

    return { outcome: 'saved', name: scan.attendee.name };
  } catch (err) {
    console.error('[exhibitor-leads] could not record the lead', err);
    return { outcome: 'error' };
  }
}

/**
 * Change the note on a lead this exhibitor already holds.
 *
 * `update()` on a document addressed by registration id, which cannot create
 * one: a note is not a way in. Everything else on the record — who, when, and
 * the wording they agreed to — is untouched, because none of it is the booth's
 * to revise afterwards.
 */
export async function setLeadNote(input: {
  rawToken: string;
  registrationId: string;
  note: string;
}): Promise<boolean> {
  try {
    const grant = await openLeadDesk(input.rawToken);
    if (!grant) return false;

    const note = normaliseLeadNote(input.note);
    await db()
      .collection(COLLECTIONS.exhibitors)
      .doc(grant.exhibitorId)
      .collection(SUBCOLLECTIONS.leads)
      .doc(input.registrationId)
      .update({
        // Deleted rather than set to `undefined`: under `ignoreUndefinedProperties`
        // an `undefined` writes no key, so a cleared note would silently keep
        // the old text and the screen would say it saved (AGENTS.md gotcha 9).
        note: note ?? FieldValue.delete(),
      });
    return true;
  } catch (err) {
    console.error('[exhibitor-leads] could not change that note', err);
    return false;
  }
}
