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
  kind: 'attendee' | 'speaker' | 'volunteer';
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

/** A required form, with every signature anybody has given it. */
export interface RequiredForm {
  id: string;
  title: string;
  version: number;
  signatures: SignatureRecord[];
}

/**
 * Which required forms each person still owes, keyed by every name they answer
 * to.
 *
 * ── Why the map holds more than one key per person ─────────────────────────
 *
 * The screens that ask this question hold different halves of a person. The
 * badge sheet has a registration id and no address; the scan desk has both; a
 * signature may have been made under a uid. So every key a subject answers to —
 * its own, its aliases, and its lower-cased address — points at the same list,
 * and a caller looks up whichever one it happens to be holding.
 *
 * ⚠️ `outdated` counts as outstanding here, and that is the point rather than a
 * rounding decision. Somebody who signed version 2 of a release has agreed to
 * text that no longer stands; telling a door volunteer they are covered would
 * be the one answer nobody can take back.
 *
 * A person who owes nothing is absent from the map rather than present with an
 * empty array, so a caller's `?? []` and a `.has()` agree.
 */
export function outstandingByPerson(
  subjects: ConsentSubject[],
  forms: RequiredForm[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (forms.length === 0) return out;

  // One array per person, filled form by form, then pointed at by every key
  // that person answers to — so a caller holding any of them reads one list.
  const owed = subjects.map<string[]>(() => []);

  for (const form of forms) {
    buildRegister(subjects, form.signatures, form.version).forEach((row, i) => {
      if (row.status !== 'signed') owed[i].push(form.title);
    });
  }

  subjects.forEach((subject, i) => {
    if (owed[i].length === 0) return;
    for (const key of [subject.key, ...(subject.aliases ?? []), emailKey(subject.email)]) {
      if (key) out.set(key, owed[i]);
    }
  });

  return out;
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
 * ⚠️ An audience with no source list must return an empty array rather than a
 * plausible-looking substitute, and this function existed for a while returning
 * one for `volunteer` because there was no roster to build it from. That is no
 * longer true — `volunteers` is a real collection — but the reason the empty
 * array mattered has not changed and applies to the next audience somebody
 * adds: a register of nobody and a register with nobody outstanding render
 * identically and mean opposite things, so the screen has to be able to tell
 * that the *source* is missing rather than the people.
 */
export function audienceSources(
  audience: ConsentAudience,
): ('attendee' | 'speaker' | 'volunteer')[] {
  if (audience === 'attendee') return ['attendee'];
  if (audience === 'speaker') return ['speaker'];
  if (audience === 'volunteer') return ['volunteer'];
  return [];
}

// ---------------------------------------------------------------------------
// Sending the signing links
// ---------------------------------------------------------------------------

/**
 * One id per form *and version*, so the rows already in `emailLog` are the
 * record of who has been asked to sign this wording.
 *
 * The version belongs in the id. Rewording a form makes every signature
 * outstanding again and those people genuinely do have to be asked again, so a
 * new version starts a new run rather than being told everybody already had it.
 */
export function signingCampaignId(formId: string, version: number): string {
  return `consent_${formId}_v${version}`;
}

/**
 * How long a send may hold its campaign before another press may take it over.
 *
 * A server action is killed at 26 seconds and the send stops itself at 18, so a
 * lock older than this belongs to a process that is not running any more. It is
 * a ceiling on how long one crash can block a campaign, not a timeout on the
 * work.
 */
export const SEND_LOCK_STALE_MS = 30_000;

/**
 * Whether a send may take the campaign, given when the last one took it.
 *
 * ⚠️ `emailLog` cannot answer this. It is the guard on the NEXT press: two
 * organizers pressing in the same second both read the log before either has
 * written to it, both see nobody, and both mail the same people a link that
 * signs a legal release in their name. So a send holds the campaign while it
 * runs, and this is the one decision in that mechanism worth testing on its
 * own.
 *
 * Abandoned rather than held for ever: a process that died holding the lock
 * must not take the campaign down with it, and after `SEND_LOCK_STALE_MS` it
 * cannot still be sending.
 */
export function sendLockIsFree(
  heldAtMs: number | undefined,
  nowMs: number,
  staleMs: number = SEND_LOCK_STALE_MS,
): boolean {
  return heldAtMs === undefined || nowMs - heldAtMs >= staleMs;
}

export interface SigningSplit {
  /** Outstanding, has an address, and has not been written to for this version. */
  todo: RegisterRow[];
  /** Outstanding and already written to for this version. */
  alreadySent: number;
  /** Outstanding with no address on file. Nothing can reach them. */
  noAddress: number;
  /** Outstanding altogether, which is the three above added up. */
  outstanding: number;
}

/**
 * Who a send would actually write to, given who has been written to already.
 *
 * ── Why this is a pure function and not three filters in the sender ─────────
 *
 * ⚠️ It is the whole of "a retry does not send twice". The sender used to mail
 * every outstanding row on every call, which on a request that timed out
 * halfway meant the next press sent a second copy of a legal release to
 * everybody the first press had already reached. The set of addresses comes
 * from `emailLog`, written per recipient as each one goes out, and the
 * comparison is folded because `emailLog.to` holds the address as it was typed
 * while a register row may hold a different spelling of the same one.
 *
 * The screen and the sender both call this, so the number somebody is asked to
 * confirm is the number that is then attempted. Two code paths answering "how
 * many?" is how a confirmation stops meaning anything.
 */
export function signingSendSplit(
  rows: readonly RegisterRow[],
  alreadyMailed: ReadonlySet<string>,
): SigningSplit {
  const fold = (e: string | undefined) => (e ?? '').trim().toLowerCase();
  const outstanding = rows.filter((r) => r.status !== 'signed');
  const reachable = outstanding.filter((r) => Boolean(r.email));
  const todo = reachable.filter((r) => !alreadyMailed.has(fold(r.email)));

  return {
    todo,
    alreadySent: reachable.length - todo.length,
    noAddress: outstanding.length - reachable.length,
    outstanding: outstanding.length,
  };
}
