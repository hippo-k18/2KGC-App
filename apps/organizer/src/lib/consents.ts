import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  consentResponseId,
  publicSiteOrigin,
  type ConsentAudience,
  type ConsentFormDoc,
  type ConsentResponseDoc,
  type RegistrationDoc,
  type SpeakerDoc,
  type UserDoc,
  type VolunteerDoc,
  type WithId,
} from '@kgc/shared';
import {
  consentBodyHash,
  mintConsentToken,
  speakerSignatory,
} from '@kgc/scripts/src/lib/consent-token';
import { sendConsentRequest } from '@kgc/scripts/src/lib/email';
import {
  audienceSources,
  buildRegister,
  outstandingByPerson,
  totalsFor,
  unmatchedSignatures,
  type ConsentSubject,
  type RegisterRow,
  type RegisterTotals,
  type SignatureRecord,
} from './consents-core';
import { appendAudit } from './audit';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * Consent forms and the register of who has signed them.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 *
 * It is a record of who agreed to which wording, when, and through which
 * channel. It is **not** an e-signature product: there is no certificate, no
 * document hash chain across a PDF, no identity verification and no notary. The
 * signature is a typed name against a body of text whose sha256 is stored
 * beside it, which is the same standard a paper release meets and is enough for
 * a conference photograph. Anything stronger belongs in DocuSign or Dropbox
 * Sign, and the speaker screen still argues for that trade rather than pretending
 * this replaces it.
 *
 * ── Everything here reads and writes with the Admin SDK ─────────────────────
 *
 * `firestore.rules` gives no client — organizer roles included — any way to
 * enumerate a form's responses or to write one on somebody else's behalf. A
 * signatory may query their own signatures and that is the whole of it. That is
 * deliberate and it is why this module exists: the register is assembled
 * server-side, and the dashboard's shared-passphrase session never touches the
 * consent subcollection directly. If this dashboard ever stops using the Admin
 * SDK, those paths need a rule of their own rather than a loosening of the one
 * that is there.
 *
 * ── The arithmetic is next door ─────────────────────────────────────────────
 *
 * `consents-core.ts` holds the matching and the three-state status, because
 * `server-only` above means Vitest cannot load this file at all.
 */

export interface ConsentFormRow {
  id: string;
  title: string;
  body: string;
  version: number;
  bodyHash: string;
  audience: ConsentAudience;
  required: boolean;
  status: ConsentFormDoc['status'];
  /** ISO 8601. Absent while the form has never been published. */
  publishedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Signatures at any version, which is not the same as signatures that count. */
  signatureCount: number;
  /** Signatures at the current version. The number the register is about. */
  currentSignatureCount: number;
}

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

const emailKey = (e: string | undefined) => (e ?? '').trim().toLowerCase();

/**
 * `vol_{volunteerId}` — a volunteer as a consent signatory.
 *
 * The same prefixed shape as `spk_`, and for the same reason: one field holds
 * Firebase uids, `reg_` ids, speaker ids and now these, and the signing page
 * decides which collection to read from the prefix alone. It lives here rather
 * than in `@kgc/scripts/src/lib/consent-token` beside `speakerSignatory` only
 * because the website resolves it by literal prefix; if a third caller ever
 * needs to mint one, move it there rather than writing the string twice.
 */
export const volunteerSignatory = (volunteerId: string) => `vol_${volunteerId}`;

/**
 * Every consent form, with both signature counts.
 *
 * One equality filter and an in-memory sort, the rule everywhere in this
 * dashboard: the emulator does not enforce composite indexes, so `where` plus
 * `orderBy` passes locally and fails in production with `failed-precondition`.
 * That has shipped twice on this project.
 *
 * The counts cost one subcollection read per form. That is affordable because
 * there are three or four forms and never three hundred — and it is a count of
 * documents this dashboard already has to be able to read, rather than a
 * denormalised counter that would need a trigger nobody can deploy on Spark.
 */
export async function listConsentForms(): Promise<ConsentFormRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.consentForms)
    .where('eventId', '==', EVENT_ID)
    .get();

  const rows = await Promise.all(
    snap.docs.map(async (d) => {
      const f = d.data() as ConsentFormDoc;
      const responses = await d.ref.collection(SUBCOLLECTIONS.responses).get();
      const signatures = responses.docs.map((r) => r.data() as ConsentResponseDoc);
      return {
        id: d.id,
        title: f.title,
        body: f.body,
        version: f.version,
        bodyHash: f.bodyHash,
        audience: f.audience,
        required: Boolean(f.required),
        status: f.status,
        publishedAt: iso(f.publishedAt),
        updatedAt: iso(f.updatedAt),
        updatedBy: f.updatedBy,
        signatureCount: signatures.length,
        currentSignatureCount: signatures.filter((s) => s.formVersion >= f.version).length,
      };
    }),
  );

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getConsentForm(id: string): Promise<WithId<ConsentFormDoc> | null> {
  const snap = await db().collection(COLLECTIONS.consentForms).doc(id).get();
  return snap.exists ? ({ id: snap.id, ...(snap.data() as ConsentFormDoc) }) : null;
}

export interface ConsentRegister {
  form: ConsentFormRow;
  rows: RegisterRow[];
  totals: RegisterTotals;
  /** Signatures matching nobody currently in the audience. See the core module. */
  orphans: SignatureRecord[];
  /**
   * True when the audience has no source list in this project at all.
   *
   * No audience is in that state today — `volunteers` closed the last one — but
   * the flag stays, because an empty register and a register of zero
   * outstanding signatures render identically and mean opposite things, and the
   * next audience somebody adds will arrive without a source list too.
   */
  audienceUnavailable: boolean;
}

/**
 * Everybody an attendee form is put to: the union of profiles and ticket
 * holders, one row per person.
 *
 * The same union `listAttendees()` builds, and for the same reason: somebody who
 * bought a ticket this morning has no profile yet and is still somebody whose
 * release is outstanding. Lifted out of `consentRegister` because the badge
 * sheet and the scan desk now ask the same question of the same people without
 * wanting a whole register built.
 */
async function attendeeSubjects(): Promise<ConsentSubject[]> {
  const [userSnap, regSnap] = await Promise.all([
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).get(),
  ]);

  const byEmail = new Map<string, ConsentSubject>();

  for (const d of userSnap.docs) {
    const u = d.data() as UserDoc;
    byEmail.set(emailKey(u.email) || d.id, {
      key: d.id,
      name: u.name || u.email || d.id,
      email: u.email,
      kind: 'attendee',
    });
  }

  for (const d of regSnap.docs) {
    const r = d.data() as RegistrationDoc;
    const k = emailKey(r.email);
    const existing = byEmail.get(k);
    if (existing) {
      // The registration id is a second key the same person may have signed
      // under, if they were sent a link before they ever opened the app.
      existing.aliases = [...(existing.aliases ?? []), d.id];
      continue;
    }
    byEmail.set(k || d.id, {
      key: d.id,
      name: r.name?.trim() || r.email,
      email: r.email,
      kind: 'attendee',
      note: 'has not opened the app. Needs a link',
    });
  }

  return [...byEmail.values()];
}

/**
 * The register for one form: who is expected to sign, and who has.
 *
 * ── Who is expected ─────────────────────────────────────────────────────────
 *
 * For an attendee form, the union of `users` and `registrations` — the same
 * union `listAttendees()` builds, and for the same reason: somebody who bought a
 * ticket this morning has no profile yet and is still somebody whose release is
 * outstanding. For a speaker form, `speakers`. For a volunteer form,
 * `volunteers` — deduplicated by address, because a roster holds one row per
 * shift and a person working three shifts signs one waiver, not three.
 *
 * A ticket holder with no account cannot sign in the app, because there is no
 * account for `firestore.rules` to check. They are not dropped from the
 * register — they are exactly the people a signing link exists for, and the
 * screen offers one per row.
 */
export async function consentRegister(formId: string): Promise<ConsentRegister | null> {
  const forms = await listConsentForms();
  const form = forms.find((f) => f.id === formId);
  if (!form) return null;

  const signatures = await signaturesFor(formId);

  const sources = audienceSources(form.audience);
  const subjects: ConsentSubject[] = [];

  if (sources.includes('attendee')) subjects.push(...(await attendeeSubjects()));

  if (sources.includes('speaker')) {
    const snap = await db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get();
    for (const d of snap.docs) {
      const s = d.data() as SpeakerDoc;
      subjects.push({
        key: speakerSignatory(d.id),
        name: s.name,
        email: s.contactEmail,
        // A speaker who also holds a ticket may have signed in the app under
        // their uid; without this alias the register would show them
        // outstanding while their signature sat in the same subcollection.
        aliases: s.userId ? [s.userId] : undefined,
        kind: 'speaker',
        note: s.contactEmail ? undefined : 'no contact address on file',
      });
    }
  }

  if (sources.includes('volunteer')) {
    const snap = await db()
      .collection(COLLECTIONS.volunteers)
      .where('eventId', '==', EVENT_ID)
      .get();

    /*
      One row per person, not per shift. The roster deliberately holds a row per
      shift — that is what makes "who is on the desk at 08:00" a filter rather
      than an unrolled array — but a waiver is signed once by a human, so three
      shifts must not become three outstanding signatures against one person.
      The first row wins the key; the rest become aliases so a signature made
      under any of them still lands on the same register line.
    */
    const byEmail = new Map<string, ConsentSubject>();
    for (const d of snap.docs) {
      const v = d.data() as VolunteerDoc;
      const k = emailKey(v.email) || d.id;
      const existing = byEmail.get(k);
      if (existing) {
        existing.aliases = [...(existing.aliases ?? []), volunteerSignatory(d.id)];
        continue;
      }
      byEmail.set(k, {
        key: volunteerSignatory(d.id),
        name: v.name || v.email || d.id,
        email: v.email,
        kind: 'volunteer',
        note: v.role || undefined,
      });
    }
    subjects.push(...byEmail.values());
  }

  subjects.sort((a, b) => a.name.localeCompare(b.name));

  const rows = buildRegister(subjects, signatures, form.version);

  return {
    form,
    rows,
    totals: totalsFor(rows),
    orphans: unmatchedSignatures(subjects, signatures),
    audienceUnavailable: sources.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Required forms, at the door
// ---------------------------------------------------------------------------

/** Every signature given to one form, flattened for the matcher. */
async function signaturesFor(formId: string): Promise<SignatureRecord[]> {
  const snap = await db()
    .collection(COLLECTIONS.consentForms)
    .doc(formId)
    .collection(SUBCOLLECTIONS.responses)
    .get();

  return snap.docs.map((d) => {
    const r = d.data() as ConsentResponseDoc;
    return {
      signatory: r.signatory,
      uid: r.uid,
      email: r.email,
      formVersion: r.formVersion,
      signedName: r.signedName,
      signedAt: iso(r.signedAt),
      channel: r.channel,
    };
  });
}

export interface RequiredConsentGaps {
  /** The published attendee forms an organizer has marked required. */
  forms: { id: string; title: string; version: number }[];
  /**
   * Registration id, uid or lower-cased address → the titles that person has
   * not signed. Absent means they owe nothing.
   */
  outstanding: Map<string, string[]>;
}

/**
 * Who still owes a required release, for the screens that meet people.
 *
 * ── Why this is a report and not a gate ────────────────────────────────────
 *
 * The badge sheet and the scan desk say "form not signed" and carry on. Nothing
 * here refuses a check-in, and that is a decision rather than an unfinished
 * half: a door volunteer holding a queue cannot adjudicate a release, and a
 * conference that turned somebody away from a session they paid for because a
 * photo waiver was outstanding would be making a much larger mistake than the
 * one it avoided. The organizer standing behind the desk is the one who decides
 * what to do about it, and this is what tells them there is something to decide.
 *
 * Returns empty and never throws when nothing is required, which is the state
 * of every event that has not published a required form.
 */
export async function requiredConsentGaps(): Promise<RequiredConsentGaps> {
  try {
    const required = (await listConsentForms()).filter(
      (f) => f.audience === 'attendee' && f.status === 'published' && f.required,
    );
    if (required.length === 0) return { forms: [], outstanding: new Map() };

    const [subjects, withSignatures] = await Promise.all([
      attendeeSubjects(),
      Promise.all(
        required.map(async (f) => ({
          id: f.id,
          title: f.title,
          version: f.version,
          signatures: await signaturesFor(f.id),
        })),
      ),
    ]);

    return {
      forms: required.map((f) => ({ id: f.id, title: f.title, version: f.version })),
      outstanding: outstandingByPerson(subjects, withSignatures),
    };
  } catch (err) {
    recordError('consent.requiredGaps', err);
    return { forms: [], outstanding: new Map() };
  }
}

// ---------------------------------------------------------------------------
// Sending the link
// ---------------------------------------------------------------------------

export interface SendLinksResult {
  sent: number;
  /** People who are outstanding and have no address on file. */
  noAddress: number;
  /** False when no signing secret is configured, so no link could be minted. */
  available: boolean;
}

/** Sent in batches, so a form with a thousand outstanding rows is not one burst. */
const SEND_BATCH = 20;

/**
 * Mail the signing link to everybody who has not signed this form.
 *
 * ── Sent on publication, not on every save ─────────────────────────────────
 *
 * The caller decides: publishing a form, or republishing wording that moved, is
 * the moment people need to be asked. Fixing a typo in a title is not, and a
 * send on every save would mail a hundred people because somebody corrected a
 * comma.
 *
 * Nobody who has already signed the current version is written to. Somebody who
 * signed an earlier version is, and gets the sentence explaining why — their
 * agreement still stands for what it said, and it does not cover the new text.
 *
 * Each send is logged whether or not it leaves the building. With no mail
 * provider configured every row lands in the log as `skipped`, which is what
 * makes "it was never sent" distinguishable from "it was sent and not read".
 */
export async function sendSigningLinks(input: {
  formId: string;
  actor: string;
}): Promise<SendLinksResult> {
  const empty: SendLinksResult = { sent: 0, noAddress: 0, available: true };

  if (!signingLinksAvailable()) return { ...empty, available: false };

  const register = await consentRegister(input.formId);
  if (!register) return empty;

  const owed = register.rows.filter((r) => r.status !== 'signed');
  const reachable = owed.filter((r) => r.email);

  for (let i = 0; i < reachable.length; i += SEND_BATCH) {
    await Promise.all(
      reachable.slice(i, i + SEND_BATCH).map((r) =>
        sendConsentRequest(db(), {
          to: r.email!,
          name: r.name,
          formTitle: register.form.title,
          version: register.form.version,
          link: signingLink(register.form.id, r.key),
          resigning: r.status === 'outdated',
          actor: input.actor,
        }),
      ),
    );
  }

  return { sent: reachable.length, noAddress: owed.length - reachable.length, available: true };
}

/**
 * Ask one person to sign every required attendee form, as they are added.
 *
 * The signatory is the registration id rather than a uid, because somebody an
 * organizer has just typed in has no account yet — that is the whole reason
 * this mail exists. If they later sign in the app and sign there instead, the
 * register still matches the two, on the address.
 */
export async function sendRequiredLinksTo(input: {
  registrationId: string;
  email: string;
  name?: string;
  actor: string;
}): Promise<number> {
  try {
    if (!signingLinksAvailable()) return 0;

    const required = (await listConsentForms()).filter(
      (f) => f.audience === 'attendee' && f.status === 'published' && f.required,
    );

    for (const form of required) {
      await sendConsentRequest(db(), {
        to: input.email,
        name: input.name,
        formTitle: form.title,
        version: form.version,
        link: signingLink(form.id, input.registrationId),
        resigning: false,
        actor: input.actor,
      });
    }

    return required.length;
  } catch (err) {
    recordError('consent.sendRequiredLinks', err);
    return 0;
  }
}

/**
 * Publish, or republish, a form.
 *
 * ── The version rule, which is the whole of this function ───────────────────
 *
 * The version increments when — and only when — the wording changes. Fixing a
 * typo in the title, flipping `required`, or moving a draft to published leaves
 * every signature already given still current, because those people agreed to
 * text that has not moved. Changing a single character of `body` makes every
 * outstanding signature `outdated`, and there is no way to suppress that: a
 * "minor edit, do not bump" switch would be a switch that changes what everybody
 * already signed, which is precisely the property the version exists to deny.
 *
 * The comparison is on the hash rather than on the string so that it is the same
 * comparison the rules make when they pin a signature to a version. Two
 * different notions of "the text changed" is one notion too many.
 */
export async function saveConsentForm(input: {
  id?: string;
  title: string;
  body: string;
  audience: ConsentAudience;
  required: boolean;
  status: ConsentFormDoc['status'];
  actor: string;
}): Promise<{ id: string; version: number; versionBumped: boolean }> {
  const ref = input.id
    ? db().collection(COLLECTIONS.consentForms).doc(input.id)
    : db().collection(COLLECTIONS.consentForms).doc();

  const existing = input.id ? await getConsentForm(input.id) : null;
  const bodyHash = consentBodyHash(input.body);
  const versionBumped = Boolean(existing) && existing!.bodyHash !== bodyHash;
  const version = existing ? existing.version + (versionBumped ? 1 : 0) : 1;

  await ref.set(
    {
      eventId: EVENT_ID,
      title: input.title,
      body: input.body,
      bodyHash,
      version,
      audience: input.audience,
      required: input.required,
      status: input.status,
      /*
       * Stamped on the first publication and never moved afterwards. A
       * re-publish that reset it would erase the date the conference started
       * asking, which is the one date on this document somebody may have to
       * state out loud later.
       */
      ...(input.status === 'published' && !existing?.publishedAt
        ? { publishedAt: new Date() }
        : {}),
      updatedBy: input.actor,
      ...(existing ? {} : { createdAt: new Date() }),
      updatedAt: new Date(),
    },
    { merge: true },
  );

  /**
   * The one editor in this dashboard whose output is a legal record about a
   * person, so it is the one that must not rely on `updatedBy` alone.
   *
   * `updatedBy` is a field on the current document: it answers "who touched
   * this last", and the next save overwrites it. The question that actually
   * gets asked — months later, about a signature somebody disputes — is "who
   * published the wording this signature names, and when", and only an
   * append-only entry can answer that after the form has been edited again.
   *
   * `publish` is distinguished from `update` because the two are different
   * events even when the write is identical: a draft edited twice is
   * housekeeping, and the moment a form becomes signable is the moment the
   * conference started collecting. `bodyHash` is recorded rather than the body
   * so the entry stays small and still pins the exact wording — it is the same
   * hash stored on every signature, so the two are joinable.
   */
  await appendAudit({
    actor: input.actor,
    action: input.status === 'published' ? 'consentForm.publish' : 'consentForm.update',
    targetPath: `${COLLECTIONS.consentForms}/${ref.id}`,
    targetId: ref.id,
    before: existing
      ? { version: existing.version, status: existing.status, bodyHash: existing.bodyHash }
      : {},
    after: { version, status: input.status, bodyHash, versionBumped },
  });

  return { id: ref.id, version, versionBumped };
}

/**
 * The public link that lets one named person sign one form without an account.
 *
 * `publicSiteOrigin()` is what `/order/{token}` links are built from too — one
 * origin for every link this dashboard mints, so a staging dashboard cannot
 * mail out links pointing at production.
 */
export function signingLink(formId: string, signatory: string): string {
  return `${publicSiteOrigin()}/consent/${mintConsentToken({ fid: formId, sub: signatory })}`;
}

/**
 * Whether a signing link can be minted at all, without throwing.
 *
 * `mintConsentToken` throws when neither secret is configured, and a screen that
 * renders a per-row link would then fail entirely rather than say what is
 * missing. Checked once, reported once, and the rows fall back to explaining it.
 */
export function signingLinksAvailable(): boolean {
  try {
    mintConsentToken({ fid: 'probe', sub: 'probe' });
    return true;
  } catch (err) {
    recordError('consent.signingLink', err);
    return false;
  }
}

/**
 * The document id a signature from this person would occupy.
 *
 * Exposed so the register can say *where* a signature is, which is the only
 * thing that makes "append-only" checkable by somebody holding the Firebase
 * console rather than merely asserted in a comment.
 */
export function responsePathFor(formId: string, signatory: string, version: number): string {
  return `${COLLECTIONS.consentForms}/${formId}/${SUBCOLLECTIONS.responses}/${consentResponseId(
    signatory,
    version,
  )}`;
}
