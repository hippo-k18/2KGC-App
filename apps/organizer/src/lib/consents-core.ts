import type { ConsentAudience, ConsentResponseDoc } from '@kgc/shared';

/**
 * Building a consent register, as a pure function over documents.
 *
 * Deliberately separate from `consents.ts`, which carries `server-only` and
 * does the Firestore fetch — `server-only` throws outside a React Server
 * Component, so a module that imports it cannot be loaded by Vitest at all, and
 * the matching below is the part worth pinning. Same split as
 * `conflicts-core.ts` against `conflicts.ts`, for the same reason.
 *
 * ── The only interesting question here is "signed *what*" ───────────────────
 *
 * A register that answers "has this person signed?" with yes or no is wrong on
 * the case that matters. Wording changes: an organizer's lawyer adds a sentence
 * about streaming, the form is republished at version 3, and everybody who
 * signed version 2 is now — correctly and uncomfortably — outstanding against
 * the new wording. Their version-2 signature is not void; it is a signature to
 * something else. So there are three states and not two, and `outdated` is the
 * one this exists for.
 *
 * ── Matching a signature to a person ────────────────────────────────────────
 *
 * `signatory` is the primary key: a Firebase uid for a signature made in the
 * app, `spk_{speakerId}` for one made through a capability link. Neither alone
 * covers the real join. A speaker who also holds a ticket may sign in the app
 * under their uid, and the speaker row would show them outstanding while their
 * signature sat in the same subcollection.
 *
 * So the address is a fallback key, folded to lower case — the same join every
 * other cross-collection read in this dashboard uses, and for the same reason:
 * `speakers`, `users` and `registrations` are keyed three different ways and
 * email is the only thing all three share. ⚠️ Fallback, not primary: two people
 * sharing an assistant's address would otherwise be credited with each other's
 * signatures, so an explicit key match always wins and the email match is only
 * consulted when there is no key match at all.
 */

export type ConsentStatus = 'signed' | 'outdated' | 'unsigned';

/** Somebody the register expects a signature from. */
export interface ConsentSubject {
  /** The `signatory` value a signature from this person would carry. */
  key: string;
  name: string;
  email?: string;
  /** Other `signatory` values that are also this person — usually their uid. */
  aliases?: string[];
  /** Which list they came from, so the register can be read by audience. */
  kind: 'attendee' | 'speaker';
  /** True for a ticket holder who has never opened the app. Display only. */
  note?: string;
}

export interface RegisterRow extends ConsentSubject {
  status: ConsentStatus;
  /** The version they actually signed, when they signed anything. */
  signedVersion?: number;
  /** ISO 8601, or undefined when the stored timestamp was unreadable. */
  signedAt?: string;
  signedName?: string;
  channel?: ConsentResponseDoc['channel'];
}

/** A signature, flattened out of Firestore so this module imports nothing. */
export interface SignatureRecord {
  signatory: string;
  uid?: string;
  email?: string;
  formVersion: number;
  signedName: string;
  signedAt?: string;
  channel: ConsentResponseDoc['channel'];
}

const emailKey = (e: string | undefined) => (e ?? '').trim().toLowerCase();

/**
 * The newest signature per person, by whichever key matches.
 *
 * "Newest" is by `formVersion` rather than by `signedAt`, because the version is
 * what the status is decided against and clocks are not to be trusted across a
 * client write and a server write. A person with signatures at v1 and v3 is
 * current if the form is at v3, whatever order they arrived in.
 */
export function buildRegister(
  subjects: ConsentSubject[],
  signatures: SignatureRecord[],
  currentVersion: number,
): RegisterRow[] {
  const byKey = new Map<string, SignatureRecord>();
  const byEmail = new Map<string, SignatureRecord>();

  const keep = (map: Map<string, SignatureRecord>, k: string, s: SignatureRecord) => {
    if (!k) return;
    const held = map.get(k);
    if (!held || s.formVersion > held.formVersion) map.set(k, s);
  };

  for (const s of signatures) {
    keep(byKey, s.signatory, s);
    if (s.uid) keep(byKey, s.uid, s);
    keep(byEmail, emailKey(s.email), s);
  }

  return subjects.map((subject) => {
    const keys = [subject.key, ...(subject.aliases ?? [])];
    // An explicit key match always wins; the address is consulted only when no
    // key matched, so a shared mailbox cannot credit one person with another's
    // signature while a real key match exists.
    const found =
      keys.map((k) => byKey.get(k)).find(Boolean) ?? byEmail.get(emailKey(subject.email));

    if (!found) return { ...subject, status: 'unsigned' as const };

    return {
      ...subject,
      status: found.formVersion >= currentVersion ? ('signed' as const) : ('outdated' as const),
      signedVersion: found.formVersion,
      signedAt: found.signedAt,
      signedName: found.signedName,
      channel: found.channel,
    };
  });
}

/**
 * Signatures that match nobody in the expected audience.
 *
 * Not a rounding error, and not something to hide: a speaker who was removed
 * from the programme after signing, or somebody who signed under an address the
 * organizer later corrected, leaves a real signature with no row to sit on. A
 * register that silently dropped them would understate what has been collected,
 * and the organizer needs to know the row exists before they decide it does not
 * matter.
 */
export function unmatchedSignatures(
  subjects: ConsentSubject[],
  signatures: SignatureRecord[],
): SignatureRecord[] {
  const known = new Set<string>();
  const knownEmails = new Set<string>();
  for (const s of subjects) {
    known.add(s.key);
    for (const a of s.aliases ?? []) known.add(a);
    if (s.email) knownEmails.add(emailKey(s.email));
  }
  return signatures.filter(
    (sig) =>
      !known.has(sig.signatory) &&
      !(sig.uid && known.has(sig.uid)) &&
      !knownEmails.has(emailKey(sig.email)),
  );
}

export interface RegisterTotals {
  expected: number;
  signed: number;
  outdated: number;
  unsigned: number;
}

export function totalsFor(rows: RegisterRow[]): RegisterTotals {
  return {
    expected: rows.length,
    signed: rows.filter((r) => r.status === 'signed').length,
    outdated: rows.filter((r) => r.status === 'outdated').length,
    unsigned: rows.filter((r) => r.status === 'unsigned').length,
  };
}

/**
 * Which audiences a form's register should be built from.
 *
 * `volunteer` returns an empty list on purpose. There is no `volunteers`
 * collection and no volunteer role in this project, so a volunteer waiver can
 * be published and cannot yet be put to anybody — and the screen says exactly
 * that rather than showing a register of nobody as though it were a register of
 * zero outstanding signatures. The two look identical and mean opposite things.
 */
export function audienceSources(audience: ConsentAudience): ('attendee' | 'speaker')[] {
  if (audience === 'attendee') return ['attendee'];
  if (audience === 'speaker') return ['speaker'];
  return [];
}
