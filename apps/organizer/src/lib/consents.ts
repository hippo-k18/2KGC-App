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
  type WithId,
} from '@kgc/shared';
import {
  consentBodyHash,
  mintConsentToken,
  speakerSignatory,
} from '@kgc/scripts/src/lib/consent-token';
import {
  audienceSources,
  buildRegister,
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
   * True when the audience has no source list in this project at all — which
   * today means `volunteer`, because there is no `volunteers` collection. An
   * empty register and a register of zero outstanding signatures look identical
   * and mean opposite things, so the screen has to be told which it is.
   */
  audienceUnavailable: boolean;
}

/**
 * The register for one form: who is expected to sign, and who has.
 *
 * ── Who is expected ─────────────────────────────────────────────────────────
 *
 * For an attendee form, the union of `users` and `registrations` — the same
 * union `listAttendees()` builds, and for the same reason: somebody who bought a
 * ticket this morning has no profile yet and is still somebody whose release is
 * outstanding. For a speaker form, `speakers`.
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

  const responseSnap = await db()
    .collection(COLLECTIONS.consentForms)
    .doc(formId)
    .collection(SUBCOLLECTIONS.responses)
    .get();

  const signatures: SignatureRecord[] = responseSnap.docs.map((d) => {
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

  const sources = audienceSources(form.audience);
  const subjects: ConsentSubject[] = [];

  if (sources.includes('attendee')) {
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
        note: 'has not opened the app — needs a link',
      });
    }

    subjects.push(...byEmail.values());
  }

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
