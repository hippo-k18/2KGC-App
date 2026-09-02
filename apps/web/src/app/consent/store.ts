import 'server-only';

import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  consentResponseId,
  type ConsentFormDoc,
  type ConsentResponseDoc,
  type RegistrationDoc,
  type SpeakerDoc,
  type UserDoc,
} from '@kgc/shared';
import { db } from '@/lib/firestore';

/**
 * Reading a consent form and recording a signature, for somebody with no
 * account.
 *
 * ── Why this file exists on the website at all ──────────────────────────────
 *
 * A speaker has no Firebase account. `SpeakerDoc` is authored by the programme
 * committee from a CSV; most speakers never buy a ticket, so there is no
 * `registrations` row, no uid and nothing for `firestore.rules` to check. The
 * rules can only ever permit a signature the *caller's own uid* owns, which
 * covers attendees signing in the app and covers nobody else.
 *
 * So this is the second channel, and it is the Admin SDK — which bypasses rules
 * entirely, and is therefore the part of the consent store that has to be
 * careful on its own. Two things it does not do, deliberately:
 *
 * **It never takes a subject from the request body.** The signatory comes out
 * of the HMAC-verified token and nowhere else. A form field naming who is
 * signing would be a way to record a release in anybody's name.
 *
 * **It never updates.** Every write is `create()`, so a second signature at the
 * same version fails with `already-exists` rather than overwriting the first —
 * the same mechanism `checkIns` uses, and the reason a double-submitted form is
 * a failed write rather than a race to lose. There is no code path in this
 * project that updates or deletes a `ConsentResponseDoc`, and there must not be
 * one.
 */

export interface SigningSubject {
  /** The value stored as `signatory`, straight from the token. */
  key: string;
  name: string;
  email: string;
  kind: 'speaker' | 'attendee';
  /**
   * Set only when the token named a Firebase uid.
   *
   * Recorded on the signature so the signer can read it back in the app — the
   * rules let you read a response whose `uid` is yours. A speaker's `spk_` key
   * and a ticket holder's `reg_` id are not uids and must not be written into
   * this field, or the rules would hand that document to whoever held an
   * account with a colliding id.
   */
  uid?: string;
}

export interface SigningContext {
  formId: string;
  title: string;
  body: string;
  version: number;
  bodyHash: string;
  audience: ConsentFormDoc['audience'];
  required: boolean;
  subject: SigningSubject;
  /** Their signature at the current version, if they have already given one. */
  existing?: { signedName: string; signedAt?: string; version: number };
  /** A signature at an older version — they agreed to wording since replaced. */
  supersededVersion?: number;
}

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Resolve the token's `sub` to a real person.
 *
 * Three prefixes, and they are the three ways somebody can be named in this
 * project: `spk_` a speaker, `reg_` a ticket holder who has not opened the app,
 * and anything else a Firebase uid. Returning null for an unknown one rather
 * than inventing a placeholder — a consent record against "unknown person" is
 * worse than no consent record, because it looks like one.
 */
async function resolveSubject(sub: string): Promise<SigningSubject | null> {
  if (sub.startsWith('spk_')) {
    const id = sub.slice('spk_'.length);
    const snap = await db().collection(COLLECTIONS.speakers).doc(id).get();
    if (!snap.exists) return null;
    const s = snap.data() as SpeakerDoc;
    return { key: sub, name: s.name, email: s.contactEmail ?? '', kind: 'speaker' };
  }

  if (sub.startsWith('reg_')) {
    const snap = await db().collection(COLLECTIONS.registrations).doc(sub).get();
    if (!snap.exists) return null;
    const r = snap.data() as RegistrationDoc;
    return { key: sub, name: r.name?.trim() || r.email, email: r.email, kind: 'attendee' };
  }

  const snap = await db().collection(COLLECTIONS.users).doc(sub).get();
  if (!snap.exists) return null;
  const u = snap.data() as UserDoc;
  return { key: sub, name: u.name || u.email, email: u.email, kind: 'attendee', uid: sub };
}

/**
 * Everything the signing page needs, or null if there is nothing to sign.
 *
 * Null for a missing form, a missing person, or a form that is not published.
 * A draft is wording an organizer is still arguing about, and a link that
 * reached somebody early must not let them agree to it — the same condition
 * `firestore.rules` enforces on the in-app path, spelled here because the Admin
 * SDK does not consult those rules.
 */
export async function loadSigningContext(
  formId: string,
  sub: string,
): Promise<SigningContext | null> {
  const formSnap = await db().collection(COLLECTIONS.consentForms).doc(formId).get();
  if (!formSnap.exists) return null;

  const form = formSnap.data() as ConsentFormDoc;
  if (form.status !== 'published') return null;

  const subject = await resolveSubject(sub);
  if (!subject) return null;

  /*
   * Two reads rather than one listing of the subcollection: this is a public
   * page, and "fetch every signature on this form" is not a query a public page
   * should be able to cause, whatever the Admin SDK would permit. The ids are
   * derivable, so the current version and the one before it are two `get`s.
   */
  const [current, previous] = await Promise.all([
    formSnap.ref
      .collection(SUBCOLLECTIONS.responses)
      .doc(consentResponseId(sub, form.version))
      .get(),
    form.version > 1
      ? formSnap.ref
          .collection(SUBCOLLECTIONS.responses)
          .doc(consentResponseId(sub, form.version - 1))
          .get()
      : Promise.resolve(null),
  ]);

  const existingDoc = current.exists ? (current.data() as ConsentResponseDoc) : undefined;

  return {
    formId,
    title: form.title,
    body: form.body,
    version: form.version,
    bodyHash: form.bodyHash,
    audience: form.audience,
    required: Boolean(form.required),
    subject,
    existing: existingDoc
      ? {
          signedName: existingDoc.signedName,
          signedAt: iso(existingDoc.signedAt),
          version: existingDoc.formVersion,
        }
      : undefined,
    supersededVersion: !existingDoc && previous?.exists ? form.version - 1 : undefined,
  };
}

export type SignOutcome = 'signed' | 'already-signed' | 'gone' | 'name-required';

/**
 * Record the signature.
 *
 * The version and the hash are read from the form *here*, at the moment of
 * writing, rather than carried through the form post. A hidden field naming the
 * version would be a value the browser could change, and the whole point of
 * storing a version beside a signature is that it is the version that was
 * actually published. This is the Admin SDK equivalent of the `get()` the rules
 * make on the in-app path — the same guarantee, enforced twice because there
 * are two writers.
 *
 * ⚠️ There is a genuine race here and it is left open on purpose: a form
 * republished between the page render and the submit records a signature
 * against the *new* wording, which the signer did not read. It is narrow —
 * seconds — and the alternative is worse in both directions. Carrying the
 * rendered version through the post lets a stale tab sign superseded wording
 * silently; rejecting the submit outright loses a signature somebody just gave
 * and offers them nothing to do about it. What closes it properly is comparing
 * the rendered hash and re-showing the changed text, which is a screen this does
 * not have, and the organizer screen says so rather than implying it is handled.
 */
export async function recordSignature(input: {
  formId: string;
  sub: string;
  signedName: string;
  ip?: string;
  userAgent?: string;
}): Promise<SignOutcome> {
  const name = input.signedName.trim();
  if (name.length < 2 || name.length > 120) return 'name-required';

  const formSnap = await db().collection(COLLECTIONS.consentForms).doc(input.formId).get();
  if (!formSnap.exists) return 'gone';
  const form = formSnap.data() as ConsentFormDoc;
  if (form.status !== 'published') return 'gone';

  const subject = await resolveSubject(input.sub);
  if (!subject) return 'gone';

  const doc: Omit<ConsentResponseDoc, 'signedAt'> & { signedAt: Date } = {
    formId: input.formId,
    formVersion: form.version,
    bodyHash: form.bodyHash,
    audience: form.audience,
    signatory: subject.key,
    uid: subject.uid,
    email: subject.email,
    signedName: name,
    agreed: true,
    // A native `Date`, never a sentinel. Three copies of `firebase-admin` exist
    // in this repo and `FieldValue.serverTimestamp()` is validated with
    // `instanceof`, so one built in a different copy fails the whole write —
    // see gotcha 8 in AGENTS.md.
    signedAt: new Date(),
    channel: 'link',
    ip: input.ip,
    userAgent: input.userAgent?.slice(0, 300),
  };

  try {
    await formSnap.ref
      .collection(SUBCOLLECTIONS.responses)
      .doc(consentResponseId(subject.key, form.version))
      // `create`, never `set`. The second signature at a version is refused by
      // Firestore itself, and that refusal is the append-only guarantee rather
      // than a check somebody has to remember to write.
      .create(doc);
    return 'signed';
  } catch (err) {
    if ((err as { code?: number }).code === 6) return 'already-signed'; // ALREADY_EXISTS
    throw err;
  }
}
