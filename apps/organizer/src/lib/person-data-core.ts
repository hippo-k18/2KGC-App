import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import { contactId, normaliseEmail, registrationId, reviewerId } from '@kgc/scripts/src/lib/ids';
import { memberIdFor } from './team-core';

/**
 * Everywhere one person is held, as data — and the pure rules for reading it
 * out and taking it away.
 *
 * ── Why this is a list and not thirty queries in an action ──────────────────
 *
 * A subject access request and an erasure ask the same question: *where is this
 * person?* The expensive failure is not a slow walk, it is a collection nobody
 * remembered — an export that swears it is everything while a year of direct
 * messages sits untouched, or an erasure that leaves a name on a check-in row.
 * Both are only discoverable by reading every writer in the repo, which nobody
 * does twice.
 *
 * So the walk is declared once, here, as `PLACES`. Adding a collection is one
 * entry: it is exported, it is erased, and it is counted on the screen, in the
 * same commit that starts writing it. Nothing else in the feature knows a
 * collection name. `person-data.ts` runs these against Firestore and does not
 * decide anything; this file decides everything and touches no database, which
 * is why the decisions are testable.
 *
 * ⚠️ **One thing is deliberately not walked, and it is reasoned rather than
 * forgotten.**
 *
 * `gatherings.attendees` is a list of *names typed by an organizer*, not uids —
 * `GatheringDoc` says so and gives the reason: half the people at a sponsor
 * meeting hold no ticket. There is no join key, and matching a typed name
 * against a profile would erase the wrong Chen. The attendee's own projection
 * at `users/{uid}/gatherings` is walked, because that one is keyed.
 *
 * The call for abstracts used to be the second exception, on the grounds that
 * it is a separate population reached by capability link with no account. That
 * was never a reason for the walk to miss it — a person who submitted an
 * abstract and also bought a ticket was being told their erasure was complete
 * while their name sat under a submission. `submissions`, `reviewers`,
 * `speakers`, `speakerProfileEdits` and `teamMembers` all have entries below.
 */

// ---------------------------------------------------------------------------
// Who the person is
// ---------------------------------------------------------------------------

/**
 * The eight ways this database addresses one human being.
 *
 * They are not interchangeable and no two collections agree on which to use,
 * which is the whole reason a place has to name the one it is keyed by.
 */
export interface PersonKeys {
  /** Lower-cased. The only one that is always known. */
  email: string;
  /** `reg_…`. Present for anyone who holds or held a ticket. */
  registrationId?: string;
  /** Their Firebase account. Present once they have opened the app. */
  uid?: string;
  /** `contact_…`, the marketing list's own id. Derived, so always present. */
  contactId: string;
  /** `rev_…`, the review committee's own id. Derived, so always present. */
  reviewerId: string;
  /** `team_…`, the organizer dashboard's own id. Derived, so always present. */
  teamMemberId: string;
  /**
   * `speakers/{id}`. Not derivable from the address — the id is built from a
   * name and a company — so it is looked up and passed in, and is absent for
   * everybody who is not on the programme.
   */
  speakerId?: string;
  /**
   * The value inside their badge QR. The raw scan log records the code that was
   * scanned and nothing else, so it is the only way to find their scans.
   */
  qrSecret?: string;
}

export type PersonKeyName = keyof PersonKeys;

/**
 * Thrown when the keys handed in describe two different people.
 *
 * It is an exception rather than a `null` because there is no safe way to carry
 * on: the caller is about to delete or export everything these keys match, and
 * the one thing worse than refusing is doing half of it to each person.
 */
export class PersonKeyMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonKeyMismatch';
  }
}

/** Fill in everything derivable, so a caller supplies only what it read. */
export function personKeys(input: {
  email: string;
  uid?: string;
  /**
   * A registration this caller has actually read: its id and the address that
   * is on it.
   *
   * ── Why both, and not the id on its own ─────────────────────────────────
   *
   * This used to be a bare `registrationId`, taken on trust. Nothing was
   * exploitable, because the one caller read the id off the document it had
   * just fetched — but the guarantee had moved out of this function and into
   * that call site, and `parsePersonRef('reg:<anything>')` feeds whatever is
   * in a URL into the same path. An id and an address that disagree mean the
   * walk deletes across two people, so the pair is checked here, where a
   * future caller cannot leave the check out by forgetting it exists.
   *
   * A legacy registration whose id is not `reg_` + sha256(email) is still
   * accepted, because the addresses agree: that is the case the read id exists
   * for in the first place.
   */
  registration?: { id: string; email: string };
  speakerId?: string;
  qrSecret?: string;
}): PersonKeys {
  const email = normaliseEmail(input.email);

  if (input.registration) {
    const onTheDocument = normaliseEmail(input.registration.email);
    if (!email || !onTheDocument || onTheDocument !== email) {
      throw new PersonKeyMismatch(
        'The ticket and the account given here belong to different people, so nothing was done.',
      );
    }
  }

  return {
    email,
    uid: input.uid,
    /*
      The id a caller actually read, and `reg_` + sha256(email) when it read
      none. Both are needed. The derived form is what every other writer in the
      repo computes, so it is the right guess for somebody reached by address
      alone; the read form is the only one that finds a registration written
      before ids were derived, which still exists in this database.
    */
    registrationId: input.registration?.id ?? (email ? registrationId(email) : undefined),
    contactId: contactId(email),
    reviewerId: reviewerId(email),
    teamMemberId: memberIdFor(email),
    speakerId: input.speakerId,
    qrSecret: input.qrSecret,
  };
}

/**
 * Which half of the attendee list a row came from, as one query parameter.
 *
 * The list is a union of ticket holders and app accounts, and a row can be
 * either — so a bare id in the URL would have to be guessed at. Guessing by
 * prefix works for every registration this repo writes and not for the ones
 * written before ids were derived, and the cost of guessing wrong is opening
 * somebody else's file. So the row says which it is.
 */
export function personRefParam(ref: { registrationId?: string; uid?: string }): string {
  return ref.registrationId ? `reg:${ref.registrationId}` : `uid:${ref.uid ?? ''}`;
}

/** The other half. Null for anything this function did not write. */
export function parsePersonRef(param: string): { registrationId?: string; uid?: string } | null {
  const at = param.indexOf(':');
  if (at < 1) return null;
  const kind = param.slice(0, at);
  const id = param.slice(at + 1);
  if (!id) return null;
  if (kind === 'reg') return { registrationId: id };
  if (kind === 'uid') return { uid: id };
  return null;
}

// ---------------------------------------------------------------------------
// Where to look
// ---------------------------------------------------------------------------

/** How a place is matched to a person inside a collection. */
export type PlaceMatch =
  /** The document id is the key: `surveys/{id}/responses/{uid}`. */
  | { docId: PersonKeyName }
  /**
   * A field equals the key: `communityPosts` where `authorId` is the uid.
   *
   * ⚠️ `fold` is required on every address field and is not decoration. The
   * keys are normalised to lower case, and several writers store the address
   * exactly as it was typed — `emailLog.to` is whatever the caller passed,
   * volunteers and certificates carry a roster's own spelling. A plain `==`
   * against the lower-cased key therefore *silently finds nothing* for anybody
   * who registered as `Ada.Okonkwo@Example.com`, and an erasure that finds
   * nothing reports success. So a folded match compares both sides in lower
   * case, which Firestore cannot do in a query and `person-data.ts` does in
   * memory. It costs a collection scan and it is the only correct answer that
   * does not change how addresses are stored.
   */
  | { field: string; key: PersonKeyName; fold?: true }
  /** An array field holds the key: `threads` where `participantIds` has the uid. */
  | { field: string; key: PersonKeyName; inArray: true };

export type PlaceQuery =
  /** One document at a derived id: `users/{uid}`. */
  | { at: 'doc'; collection: string; id: PersonKeyName }
  /** A top-level collection, filtered. */
  | { at: 'collection'; collection: string; match: PlaceMatch }
  /** A subcollection of the one document this person owns: `users/{uid}/fcmTokens`. */
  | { at: 'own'; parent: string; id: PersonKeyName; collection: string }
  /**
   * The same subcollection under every document of one or more ancestor
   * collections: `sessions/*​/questions/*​/upvotes/{uid}`.
   *
   * Costly by construction — it lists the ancestors — and that is accepted,
   * because the alternative is a collection-group index per nesting and an
   * index that is missing in production fails a *deletion*, which is the one
   * operation here that must not half-succeed.
   */
  | { at: 'each'; parents: readonly string[]; collection: string; match: PlaceMatch };

/** What erasure does where it arrives. */
export type EraseRule =
  /** Remove it. `recursive` also removes what is nested under it. */
  | { do: 'delete'; recursive?: true; why?: string }
  /**
   * Keep the document, take the person out of it. `clear` names top-level
   * fields; `clearIn` names fields inside the objects of an array field, which
   * a Firestore field path cannot reach.
   */
  | {
      do: 'anonymise';
      clear: readonly string[];
      clearIn?: { array: string; fields: readonly string[] };
      /**
       * Fields to date-stamp, if they are not dated already.
       *
       * One use: the marketing list. Removing somebody from it is not the same
       * as suppressing them, and the two have to happen together — see the
       * `marketingContact` entry. The stamp is applied by the caller rather
       * than by `redaction()`, because a timestamp is not a pure value.
       */
      stamp?: readonly string[];
      why: string;
    }
  /** Leave it exactly as it is. Only ever for a record about an organizer. */
  | { do: 'keep'; why: string };

export interface PersonPlace {
  /** Stable. It keys the JSON file, so renaming one breaks an old export. */
  key: string;
  /** What an organizer reads on the screen. Plain words, no collection names. */
  label: string;
  where: PlaceQuery;
  erase: EraseRule;
}

const C = COLLECTIONS;
const S = SUBCOLLECTIONS;

/**
 * The walk, in the order the file reads: who they are, what they kept, what
 * they wrote, where they went, and the records that outlive them.
 */
export const PLACES: readonly PersonPlace[] = [
  {
    key: 'registration',
    label: 'Their ticket',
    where: { at: 'doc', collection: C.registrations, id: 'registrationId' },
    erase: { do: 'delete' },
  },
  {
    key: 'profile',
    label: 'Their app profile',
    where: { at: 'doc', collection: C.users, id: 'uid' },
    erase: { do: 'delete' },
  },
  {
    key: 'directoryListing',
    label: 'Their entry in the attendee directory',
    where: { at: 'doc', collection: C.directory, id: 'uid' },
    erase: { do: 'delete' },
  },
  {
    key: 'savedSessions',
    label: 'Sessions they saved',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.savedSessions },
    erase: { do: 'delete' },
  },
  {
    key: 'savedContacts',
    label: 'People they saved',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.savedContacts },
    erase: { do: 'delete' },
  },
  {
    /**
     * The other direction, and the one that is always forgotten: everybody
     * else's saved-contacts list with this person's card in it. Leaving these
     * behind is how an erased person keeps appearing in somebody's app.
     */
    key: 'savedByOthers',
    label: 'Other people who saved their card',
    where: {
      at: 'each',
      parents: [C.users],
      collection: S.savedContacts,
      match: { field: 'contactUid', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'notifications',
    label: 'Notifications sent to them',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.notifications },
    erase: { do: 'delete' },
  },
  {
    key: 'devices',
    label: 'Devices registered for push',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.fcmTokens },
    erase: { do: 'delete' },
  },
  {
    key: 'entitlements',
    label: 'What their ticket unlocked',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.entitlements },
    erase: { do: 'delete' },
  },
  {
    key: 'gatheringSeats',
    label: 'Tables and meetings they were placed at',
    where: { at: 'own', parent: C.users, id: 'uid', collection: S.gatherings },
    erase: { do: 'delete' },
  },
  {
    key: 'messagesSent',
    label: 'Messages they wrote',
    where: {
      at: 'each',
      parents: [C.threads],
      collection: S.messages,
      match: { field: 'senderId', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'messageThreads',
    label: 'Conversations they were part of',
    where: {
      at: 'collection',
      collection: C.threads,
      match: { field: 'participantIds', key: 'uid', inArray: true },
    },
    erase: {
      do: 'delete',
      recursive: true,
      why: 'A conversation has two people in it. Once one side is gone the other side cannot be opened, so the whole thread goes.',
    },
  },
  {
    key: 'communityPosts',
    label: 'Posts on the community board',
    where: { at: 'collection', collection: C.communityPosts, match: { field: 'authorId', key: 'uid' } },
    erase: { do: 'delete', recursive: true },
  },
  {
    key: 'communityReplies',
    label: 'Replies on the community board',
    where: {
      at: 'each',
      parents: [C.communityPosts],
      collection: S.replies,
      match: { field: 'authorId', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'communityReactions',
    label: 'Reactions they left',
    where: {
      at: 'each',
      parents: [C.communityPosts],
      collection: S.reactions,
      match: { field: 'uid', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'sessionQuestions',
    label: 'Questions they asked in sessions',
    where: {
      at: 'each',
      parents: [C.sessions],
      collection: S.questions,
      match: { field: 'authorId', key: 'uid' },
    },
    erase: { do: 'delete', recursive: true },
  },
  {
    key: 'questionUpvotes',
    label: 'Questions they upvoted',
    where: {
      at: 'each',
      parents: [C.sessions, S.questions],
      collection: S.upvotes,
      match: { docId: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'pollVotes',
    label: 'Poll answers',
    where: {
      at: 'each',
      parents: [C.sessions, S.polls],
      collection: S.votes,
      match: { docId: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'surveyAnswers',
    label: 'Survey and feedback answers',
    where: { at: 'each', parents: [C.surveys], collection: S.responses, match: { docId: 'uid' } },
    erase: { do: 'delete' },
  },
  {
    key: 'sessionSeats',
    label: 'Seats they held in capped sessions',
    where: { at: 'each', parents: [C.sessionSeats], collection: S.seats, match: { docId: 'uid' } },
    erase: { do: 'delete' },
  },
  {
    key: 'sponsorLeads',
    label: 'Sponsor stands they left their details with',
    where: {
      at: 'each',
      parents: [C.sponsors],
      collection: S.leads,
      match: { field: 'uid', key: 'uid' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'checkIns',
    label: 'Times they were checked in',
    where: {
      at: 'each',
      parents: [C.checkInLists],
      collection: S.checkIns,
      match: { docId: 'registrationId' },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'scans',
    label: 'Badge scans at the door',
    where: { at: 'collection', collection: C.scanEvents, match: { field: 'qrSecret', key: 'qrSecret' } },
    erase: { do: 'delete' },
  },
  {
    key: 'certificates',
    label: 'Attendance certificates issued to them',
    where: {
      at: 'collection',
      collection: C.certificates,
      match: { field: 'email', key: 'email', fold: true },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'volunteerShifts',
    label: 'Volunteer shifts',
    where: {
      at: 'collection',
      collection: C.volunteers,
      match: { field: 'email', key: 'email', fold: true },
    },
    erase: { do: 'delete' },
  },
  {
    key: 'checkoutAnswers',
    label: 'Answers held between checkout and payment',
    where: {
      at: 'collection',
      collection: C.pendingAnswers,
      match: { field: 'email', key: 'email', fold: true },
    },
    erase: { do: 'delete' },
  },
  {
    /**
     * What a speaker sent through their own profile link, and the address the
     * link was sent to. Deleted rather than kept: nothing here is published,
     * and a draft is a person's own words about themselves waiting to be read.
     */
    key: 'speakerDraft',
    label: 'A profile they sent us as a speaker',
    where: { at: 'doc', collection: C.speakerProfileEdits, id: 'speakerId' },
    erase: { do: 'delete' },
  },
  {
    /**
     * Their contact details and their invitation to the review committee. The
     * scores they gave are next door, under the submissions, and stay — they
     * are keyed by an id derived from the address rather than by the address.
     */
    key: 'reviewerRecord',
    label: 'Their place on the review committee',
    where: { at: 'doc', collection: C.reviewers, id: 'reviewerId' },
    erase: { do: 'delete' },
  },
  {
    /**
     * The author of an abstract, held apart from the abstract so that blind
     * review is a read decision. Deleting it leaves the submission in exactly
     * the state a blind reviewer already sees: the work, and nobody attached.
     */
    key: 'submissionAuthor',
    label: 'Their name on an abstract they submitted',
    where: {
      at: 'each',
      parents: [C.submissions],
      collection: S.identity,
      match: { field: 'email', key: 'email', fold: true },
    },
    erase: { do: 'delete' },
  },
  {
    /**
     * Their sign-in to this dashboard, if they have one: roles, a hashed
     * passphrase and a session epoch. Deleting the document signs them out
     * everywhere, which is the right outcome of erasing an organizer.
     */
    key: 'dashboardAccount',
    label: 'Their sign-in to the organizer dashboard',
    where: { at: 'doc', collection: C.teamMembers, id: 'teamMemberId' },
    erase: { do: 'delete' },
  },

  // -------------------------------------------------------------------------
  // Kept, with the person taken out
  // -------------------------------------------------------------------------

  {
    /**
     * A signature is the record that somebody agreed to wording on a date. It
     * is the one thing here that could be produced against us, and destroying
     * it on request would destroy the only evidence that consent was ever
     * given — including consent the person later disputes. So the signature
     * survives and the human being is removed from it.
     */
    key: 'consentSignatures',
    label: 'Consent and release forms they signed',
    where: {
      at: 'each',
      parents: [C.consentForms],
      collection: S.responses,
      match: { field: 'email', key: 'email', fold: true },
    },
    erase: {
      do: 'anonymise',
      clear: ['email', 'signedName', 'uid', 'ip', 'userAgent'],
      why: 'The record that a form was signed, and which wording, is kept. The name and address are removed from it.',
    },
  },
  {
    key: 'orders',
    label: 'What they bought',
    where: {
      at: 'collection',
      collection: C.orders,
      match: { field: 'email', key: 'email', fold: true },
    },
    erase: {
      do: 'anonymise',
      clear: ['email', 'buyerName', 'companyName'],
      clearIn: { array: 'items', fields: ['attendeeName', 'attendeeEmail'] },
      why: 'A payment has to stay on the books. The amounts are kept, the buyer is removed.',
    },
  },
  {
    /**
     * A second way an order names this person: a company bought four seats and
     * put four different addresses on the lines. The walk dedupes by document
     * path, so an order caught by both entries is written once.
     */
    key: 'orderSeats',
    label: 'Orders that bought their seat',
    where: {
      at: 'collection',
      collection: C.orders,
      match: { field: 'registrationIds', key: 'registrationId', inArray: true },
    },
    erase: {
      do: 'anonymise',
      clear: ['email', 'buyerName', 'companyName'],
      clearIn: { array: 'items', fields: ['attendeeName', 'attendeeEmail'] },
      why: 'A payment has to stay on the books. The amounts are kept, the buyer is removed.',
    },
  },
  {
    key: 'emailsSent',
    label: 'Emails we sent them',
    where: {
      at: 'collection',
      collection: C.emailLog,
      match: { field: 'to', key: 'email', fold: true },
    },
    erase: {
      do: 'anonymise',
      clear: ['to'],
      why: 'The log of what was sent is how a missing confirmation gets traced. The address is removed from it.',
    },
  },
  {
    /**
     * Being on the mailing list, and having asked to come off it, are two
     * different facts and only one of them is personal data.
     *
     * ⚠️ This used to delete the document, and that was a hole with a specific
     * shape: `unsubscribedAt` lives here, an import never clears it, and
     * deleting the row deletes the suppression. Somebody who unsubscribed and
     * then asked to be forgotten would be mailed again by the next upload of an
     * older list — the worst recipient a conference can reach, because a
     * complaint from them takes the ticket receipts down with the newsletter.
     *
     * So the row survives with nothing personal on it. The id is a hash of the
     * address, which is what makes it still match when the same person is
     * imported again, and `unsubscribedAt` is stamped if it was not already:
     * asking to be erased is at least as strong a refusal as unsubscribing.
     */
    key: 'marketingContact',
    label: 'Their place on the mailing list',
    where: { at: 'doc', collection: C.contacts, id: 'contactId' },
    erase: {
      do: 'anonymise',
      clear: ['email', 'name', 'company', 'source'],
      stamp: ['unsubscribedAt'],
      why: 'Their name and address come off the list, and the list stays marked so a later import cannot email them again.',
    },
  },
  {
    /**
     * A speaker on the published programme, which is a fact about the
     * conference as well as about the person.
     *
     * The choice here is deliberate and it is the one place in this walk where
     * something visible to the public survives. The name, talk, bio and photo
     * stay, because they were published as the programme and the programme is
     * the record of what happened; the contact address and the link to their
     * app account go, because those were never published and are only how we
     * reached them. The screen says exactly this before the button is pressed.
     *
     * Somebody who wants the programme entry itself removed is a conversation
     * with the organizers, not a button: taking a speaker off a published
     * agenda changes what the conference says happened.
     */
    key: 'speakerProfile',
    label: 'Their entry on the published programme',
    where: { at: 'doc', collection: C.speakers, id: 'speakerId' },
    erase: {
      do: 'anonymise',
      clear: ['contactEmail', 'userId'],
      why: 'Their talk stays on the programme, which is public. Their contact address and the link to their app account are removed.',
    },
  },

  // -------------------------------------------------------------------------
  // Kept as written
  // -------------------------------------------------------------------------

  {
    /**
     * Not a record *about* the attendee: a record of what an organizer did, and
     * the only answer to "who cancelled that ticket?". It is staff-only, it is
     * never shown to an attendee, and the erasure itself is appended to it.
     */
    key: 'reviewerScores',
    label: 'Scores they gave as a reviewer',
    where: {
      at: 'each',
      parents: [C.submissions],
      collection: S.reviews,
      match: { docId: 'reviewerId' },
    },
    erase: {
      do: 'keep',
      why: 'A score is the committee’s record of a decision about somebody else’s work. It carries no name or address, only an id derived from one, and the reviewer record it points at is deleted.',
    },
  },
  {
    key: 'organizerActions',
    label: 'Organizer actions on their ticket',
    where: { at: 'collection', collection: C.auditLog, match: { field: 'targetId', key: 'registrationId' } },
    erase: {
      do: 'keep',
      why: 'This is the record of what organizers did, not what the attendee did. It is kept, and this deletion is added to it.',
    },
  },
];

/**
 * Does the value stored on a document match this person, ignoring case?
 *
 * The comparison `person-data.ts` runs in memory for every folded place, here
 * rather than there so that it is the tested one. `held` is whatever Firestore
 * returned for the field, which is why it is `unknown`: a collection scan
 * reaches documents whose shape nobody promised, and a missing or numeric field
 * is a non-match rather than a crash in the middle of an erasure.
 */
export function foldedFieldMatches(value: string, held: unknown): boolean {
  return typeof held === 'string' && value.length > 0 && normaliseEmail(held) === value;
}

/** The key a place is matched on, whichever shape it uses. */
export function keyNameOf(place: PersonPlace): PersonKeyName {
  const { where } = place;
  if (where.at === 'doc' || where.at === 'own') return where.id;
  return 'docId' in where.match ? where.match.docId : where.match.key;
}

/**
 * The places that can be looked at for this person, in walk order.
 *
 * A person who never opened the app has no uid, so two thirds of the list is
 * unreachable — and reaching it anyway would mean querying on `undefined`,
 * which Firestore answers with every document in the collection. That is the
 * failure this function exists to prevent: an erasure that deletes the whole
 * community board because the subject never signed in.
 */
export function placesFor(keys: PersonKeys): PersonPlace[] {
  return PLACES.filter((p) => {
    const value = keys[keyNameOf(p)];
    return typeof value === 'string' && value.length > 0;
  });
}

/** The places skipped, and the one word that says why. */
export function skippedPlaces(keys: PersonKeys): { place: PersonPlace; missing: PersonKeyName }[] {
  return PLACES.filter((p) => !keys[keyNameOf(p)]).map((p) => ({ place: p, missing: keyNameOf(p) }));
}

// ---------------------------------------------------------------------------
// Reading it out
// ---------------------------------------------------------------------------

/**
 * Never written into an export file, even one going to the person themselves.
 *
 * `exports.ts` made this argument for the CSVs and it holds harder here: a QR
 * secret admits its holder at the door and a claim code signs them into the app
 * as that attendee. A subject access file is emailed, forwarded and left in a
 * downloads folder, so a working credential inside it is a ticket anybody can
 * use. The hashes are here for a different reason — they are lookup keys that
 * invite joining data that should not be joined, and they tell the reader
 * nothing about themselves.
 */
export const NEVER_EXPORTED = [
  'qrSecret',
  'claimCode',
  'tempPassword',
  'token',
  'emailHash',
  'inviteTokenHash',
  'submitterTokenHash',
  'bodyHash',
] as const;

/** A value Firestore can hold, flattened to something `JSON.stringify` keeps. */
export function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    // Firestore Timestamp, and anything else that knows its own date.
    const asDate = (value as { toDate?: () => Date }).toDate;
    if (typeof asDate === 'function') return asDate.call(value).toISOString();
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/** One document as it appears in the file, with what was withheld named. */
export function exportDocument(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  omitted: string[];
} {
  const out: Record<string, unknown> = {};
  const omitted: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if ((NEVER_EXPORTED as readonly string[]).includes(k)) {
      omitted.push(k);
      continue;
    }
    out[k] = jsonSafe(v);
  }
  return { data: out, omitted: omitted.sort() };
}

/** `kgc-2027-data-for-ada-nakamura-2026-09-20.json`, or the address if unnamed. */
export function exportFilename(name: string, email: string, on: Date): string {
  const who =
    (name || email.split('@')[0] || 'attendee')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'attendee';
  return `kgc-data-for-${who}-${on.toISOString().slice(0, 10)}.json`;
}

// ---------------------------------------------------------------------------
// Taking it away
// ---------------------------------------------------------------------------

/**
 * The fields to write over a document that is kept rather than deleted.
 *
 * Returns `{}` when there is nothing left to take out, so a second erasure of
 * the same person writes nothing and the audit trail does not fill with
 * no-op entries. `erasedAt` is deliberately *not* set here: the caller stamps
 * it, because a server timestamp is not a pure value.
 */
export function redaction(
  rule: Extract<EraseRule, { do: 'anonymise' }>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const field of rule.clear) {
    if (data[field] === undefined || data[field] === null || data[field] === '') continue;
    update[field] = null;
  }

  const nested = rule.clearIn;
  if (nested && Array.isArray(data[nested.array])) {
    const rows = data[nested.array] as Record<string, unknown>[];
    let touched = false;
    const next = rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const copy = { ...row };
      for (const field of nested.fields) {
        if (copy[field] === undefined || copy[field] === null || copy[field] === '') continue;
        delete copy[field];
        touched = true;
      }
      return copy;
    });
    if (touched) update[nested.array] = next;
  }

  return update;
}

/**
 * The fields an anonymise rule wants dated, that are not dated already.
 *
 * Separate from `redaction()` because these are set rather than cleared, and
 * because the value is a server timestamp, which is not a pure value. Returning
 * the names lets the caller supply one and lets the decision stay testable.
 */
export function stampFields(
  rule: Extract<EraseRule, { do: 'anonymise' }>,
  data: Record<string, unknown>,
): string[] {
  return (rule.stamp ?? []).filter(
    (field) => data[field] === undefined || data[field] === null || data[field] === '',
  );
}

/**
 * What the audit log is told about an erasure.
 *
 * ── Why there is no name in it ──────────────────────────────────────────────
 *
 * The log survives the erasure by design — it is the record of what organizers
 * did, and this deletion is appended to it — so anything written here is
 * written for ever. The entry used to carry the person's display name, and a
 * display name falls back to their email address for anybody who registered
 * without one or signed in with a code and never filled in a profile. The
 * erasure would then leave, permanently, the one field it exists to remove.
 *
 * What remains still proves the erasure happened and is still enough to answer
 * "who did this, to which record, and how much of it went": the entry's own
 * `targetPath` and `targetId` name the record, and the counts below say what
 * the walk reached. None of it is a name or an address.
 */
export function erasureAuditBefore(input: {
  walked: number;
  signedIn: boolean;
  hasTicket: boolean;
}): Record<string, unknown> {
  return { walked: input.walked, signedIn: input.signedIn, hadTicket: input.hasTicket };
}

/** What one place did, for the screen and for the audit entry. */
export interface PlaceOutcome {
  key: string;
  label: string;
  /** How many documents were found. */
  found: number;
  /** What happened to them. `skipped` is a place this person cannot reach. */
  did: 'deleted' | 'anonymised' | 'kept' | 'skipped';
}

/** `Deleted 14 documents, kept 3, removed the name from 2.` */
export function erasureSummary(outcomes: readonly PlaceOutcome[]): string {
  const total = (did: PlaceOutcome['did']) =>
    outcomes.filter((o) => o.did === did).reduce((n, o) => n + o.found, 0);
  const deleted = total('deleted');
  const anonymised = total('anonymised');
  const kept = total('kept');

  const parts = [`Deleted ${deleted} ${deleted === 1 ? 'record' : 'records'}.`];
  if (anonymised > 0) {
    parts.push(
      anonymised === 1
        ? 'Took their name off 1 record that has to stay.'
        : `Took their name off ${anonymised} records that have to stay.`,
    );
  }
  if (kept > 0) {
    parts.push(`Left ${kept} ${kept === 1 ? 'entry' : 'entries'} in the organizer log.`);
  }
  return parts.join(' ');
}

/**
 * Is the typed confirmation right?
 *
 * The address, not a fixed word: the point of typing is that you have to read
 * which row you are on, and `delete` can be typed without looking. Case and
 * surrounding space are forgiven because neither is what is being checked.
 *
 * ⚠️ The browser disables the button on the same test. This one is the guard —
 * the action calls it, because anything enforced only in the browser is
 * enforced only for people who did not think to look.
 */
export function confirmationMatches(typed: string, email: string): boolean {
  return normaliseEmail(typed) === normaliseEmail(email) && email.length > 0;
}
