/**
 * Naming the record an audit entry is about, in words an organizer recognises.
 *
 * Tools › Report is the only screen the audit log has, and the row is useless
 * unless it says *which* record changed. There are four places to get that
 * from, and the row uses the first that answers:
 *
 *   1. the entry's own `subject`, written by the action that made it;
 *   2. a name in the entry's before/after diff, which most creates carry;
 *   3. the record itself, read back by `recentAudit`;
 *   4. what kind of record it was, from the path.
 *
 * Steps 1 and 2 covered six of thirteen rows. Every cancel and every reinstate
 * fell through both — their diff is `status` and nothing else — and the row
 * read "not named", which is less than the Firestore path it replaced. 3 and 4
 * are here so that no row can say nothing.
 *
 * No step ever prints a document id or a collection path. That was the defect
 * the `subject` field was added to fix, and a fallback that reintroduces
 * `registrations/reg_01e1621469460b03d253854f` would undo it.
 *
 * Pure, and kept out of `data.ts` so it can be tested without the Admin SDK.
 */

/**
 * The fields an audit entry, or the record itself, may carry a human-readable
 * name under, best first.
 *
 * Order matters: a session edit has both `title` and `roomName`, and the title
 * is what the row is about. An email address is last, because it is the one
 * that identifies a person without naming them.
 */
export const AUDIT_NAME_FIELDS = [
  'name',
  'title',
  'question',
  'prompt',
  'label',
  'buyerName',
  'sessionTitle',
  'code',
  'slug',
  'email',
];

export function auditSubject(...maps: (Record<string, unknown> | undefined)[]): string | null {
  for (const key of AUDIT_NAME_FIELDS) {
    for (const map of maps) {
      const v = map?.[key];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80);
    }
  }
  return null;
}

/**
 * What kind of record a path points at, in a noun phrase.
 *
 * The last resort, for a record that holds no name at all — a settings
 * document, a seat, a check-in. "The access settings" is not as good as a
 * person's name, and it is far better than "not named": an organizer reading
 * "Changed the settings · The access settings" knows what happened, and an
 * organizer reading "not named" does not.
 */
const AUDIT_PLACES: Record<string, string> = {
  announcements: 'An announcement',
  booths: 'A booth',
  calls: 'The call for abstracts',
  campaignLinks: 'A tracked link',
  certificates: 'A certificate',
  checkInLists: 'A check-in list',
  compPasses: 'A complimentary pass',
  consentForms: 'A consent form',
  contacts: 'A marketing contact',
  documents: 'A handout',
  emailLog: 'An email campaign',
  exhibitors: 'An exhibitor',
  gatherings: 'A meeting slot',
  orders: 'An order',
  pageContent: 'The website copy',
  pages: 'A resource page',
  questionForms: 'A registration form',
  registrations: 'A ticket holder',
  reviewers: 'A reviewer',
  rooms: 'A room',
  sessionSeats: 'A seat',
  sessions: 'A session',
  settings: 'The settings',
  speakerProfileEdits: 'What a speaker sent in',
  speakers: 'A speaker',
  sponsors: 'A sponsor',
  stripe: 'A discount code',
  submissions: 'An abstract',
  surveys: 'A survey',
  tasks: 'A task',
  teamMembers: 'A team member',
  threads: 'A conversation',
  ticketTypes: 'A ticket type',
  tracks: 'A track',
  users: 'An attendee',
  volunteers: 'A volunteer',
};

/**
 * The settings live in one collection under keys that are already words, so
 * "The settings" can be sharpened to the page an organizer would go to. The
 * keys are readable by construction — `access`, `event`, `attendeeCategories` —
 * unlike every other id in the log, which is a hash or an auto-id.
 */
const READABLE_KEY = /^[a-z][a-zA-Z]*$/;

export function auditPlace(targetPath: string): string {
  const segments = targetPath.split('/').filter(Boolean);
  const collection = segments[0] ?? '';
  const place = AUDIT_PLACES[collection];
  if (!place) return 'A record';
  if (collection === 'settings' && segments.length === 2 && READABLE_KEY.test(segments[1])) {
    const words = segments[1].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return `The ${words} settings`;
  }
  return place;
}

/**
 * Whether the record behind this entry is worth reading back for a name.
 *
 * A path with an even number of segments addresses a document. An odd one is a
 * whole collection — `sessions`, written by a bulk import — and there is no one
 * record to name.
 *
 * `attendee.erase` is excluded on purpose and must stay excluded. That entry
 * outlives the erasure by design and deliberately carries no name and no
 * address; reading the record back would put one of them into a permanent log,
 * which is the single thing the operation exists to prevent. The record is
 * anonymised rather than deleted, so the read would succeed.
 */
export function namesARecord(action: string, targetPath: string): boolean {
  if (action === 'attendee.erase') return false;
  const segments = targetPath.split('/').filter(Boolean);
  return segments.length > 0 && segments.length % 2 === 0 && collectionIsReadable(segments[0]);
}

/** `stripe/promotionCodes/{id}` is a Stripe object, not a Firestore document. */
function collectionIsReadable(collection: string): boolean {
  return collection !== 'stripe';
}
