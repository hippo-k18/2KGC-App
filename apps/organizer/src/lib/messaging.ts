import 'server-only';

import {
  COLLECTIONS,
  EVENT,
  EVENT_ID,
  SUBCOLLECTIONS,
  correspondentIn,
  threadIdFor,
  type DirectoryDoc,
  type EmailLogDoc,
  type MessageDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type ThreadDoc,
  type Timestamp,
  type UserDoc,
} from '@kgc/shared';
import { listAttendees } from './data';
import { db } from './firestore';

/**
 * Bulk email to a named audience — Whova's "Message Speakers" / "Message
 * Sponsors" and their siblings.
 *
 * `gaps.ts` said these needed "an email sender. There is none anywhere in this
 * project yet." That stopped being true in August 2026, and this is what the
 * sender unblocked. The three screens differ only in which audience they
 * resolve, which is why the audience is a value here rather than three
 * near-identical modules.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 *
 * **Scheduling.** Whova lets you queue a send for later. The same argument that
 * kept it out of Announcements applies with more force to email: a queued blast
 * fires whether or not anybody is awake to stop it, and the classic failure is
 * 6am in the wrong timezone. A message goes out when a human presses the
 * button, in the room, awake.
 *
 * **Attendee mail.** Whova puts that under `tickets/ticket-marketing/email-campaign`
 * and it is a genuinely different tool — contact lists, link tracking, an
 * unsubscribe register. Forty-five speakers is a different problem from a
 * thousand attendees, and pretending otherwise is how a conference gets its
 * sending domain blocked. That screen stays a gap note until it is built
 * properly.
 *
 * **Drafts.** A draft is state that has to be owned, listed and cleaned up. The
 * form keeps what you typed across a failed send, which covers the real case.
 */

export type AudienceId = 'speakers' | 'sponsors';

export interface Recipient {
  id: string;
  name: string;
  email: string;
  /** Shown beside the name so an organizer can tell two people apart. */
  detail?: string;
}

export interface Audience {
  id: AudienceId;
  /** Whova's own label for the screen. */
  title: string;
  /** Plural noun for prose: "45 speakers". */
  noun: string;
  /** Filters an organizer can narrow the send to. */
  segments: { id: string; label: string; describe: string }[];
}

export const AUDIENCES: Record<AudienceId, Audience> = {
  speakers: {
    id: 'speakers',
    title: 'Message Speakers',
    noun: 'speakers',
    segments: [
      { id: 'all', label: 'Everyone', describe: 'Every speaker with an email address on file' },
      {
        id: 'incomplete',
        label: 'Incomplete profiles',
        // Whova's own segment, and the one that earns its keep: chasing bios and
        // headshots is most of what Message Speakers is used for.
        describe: 'Speakers missing a bio or a photo',
      },
      { id: 'no-session', label: 'Not on the agenda', describe: 'Speakers with no session yet' },
    ],
  },
  sponsors: {
    id: 'sponsors',
    title: 'Message Sponsors',
    noun: 'sponsors',
    segments: [
      { id: 'all', label: 'Everyone', describe: 'Every sponsor contact on file' },
      { id: 'no-logo', label: 'Missing a logo', describe: 'Sponsors with no logo uploaded' },
      { id: 'no-booth', label: 'No booth assigned', describe: 'Sponsors with no booth location' },
    ],
  },
};

/**
 * Resolve an audience and segment to the people who would actually be emailed.
 *
 * ⚠️ **Anyone with no email address is silently absent, and the caller must say
 * so.** A speaker record with no contact address is common — they were imported
 * from an agenda CSV — and a send that quietly reaches 38 of 45 people while
 * reporting success is the worst outcome available. `resolveAudience` therefore
 * returns the excluded count alongside the list, and both screens print it.
 */
export async function resolveAudience(
  audience: AudienceId,
  segment: string,
): Promise<{ recipients: Recipient[]; withoutEmail: number }> {
  if (audience === 'speakers') return resolveSpeakers(segment);
  return resolveSponsors(segment);
}

async function resolveSpeakers(segment: string) {
  const [speakerSnap, userSnap] = await Promise.all([
    db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
  ]);

  /**
   * Two possible addresses, in a deliberate order.
   *
   * `SpeakerDoc.contactEmail` is what the programme committee corresponds with,
   * known from the call for papers long before the speaker holds a ticket. The
   * `users` record is the fallback for speakers who signed up but whose contact
   * address was never captured. The committee's address wins because it may
   * deliberately differ from whichever one they bought a ticket with.
   */
  const emailByUid = new Map(
    userSnap.docs.map((d) => [d.id, (d.data() as UserDoc).email]),
  );

  let withoutEmail = 0;
  const recipients: Recipient[] = [];

  for (const d of speakerSnap.docs) {
    const s = d.data() as SpeakerDoc;

    if (segment === 'incomplete' && s.bio && s.photoURL) continue;
    if (segment === 'no-session' && (s.sessionIds ?? []).length > 0) continue;

    const email = s.contactEmail ?? (s.userId ? emailByUid.get(s.userId) : undefined);
    if (!email) {
      withoutEmail++;
      continue;
    }

    recipients.push({
      id: d.id,
      name: s.name,
      email,
      detail: [s.title, s.company].filter(Boolean).join(', ') || undefined,
    });
  }

  recipients.sort((a, b) => a.name.localeCompare(b.name));
  return { recipients, withoutEmail };
}

async function resolveSponsors(segment: string) {
  const snap = await db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get();

  let withoutEmail = 0;
  const recipients: Recipient[] = [];

  for (const d of snap.docs) {
    const s = d.data() as SponsorDoc;

    if (segment === 'no-logo' && s.logoURL) continue;
    if (segment === 'no-booth' && s.boothLocation) continue;

    const email = s.contactEmail;
    if (!email) {
      withoutEmail++;
      continue;
    }

    recipients.push({
      id: d.id,
      name: s.name,
      email,
      detail: s.tier ? `${s.tier} sponsor` : undefined,
    });
  }

  recipients.sort((a, b) => a.name.localeCompare(b.name));
  return { recipients, withoutEmail };
}

// ---------------------------------------------------------------------------
// Sent history
// ---------------------------------------------------------------------------

export interface CampaignRow {
  campaignId: string;
  subject: string;
  actor?: string;
  at: string;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Past sends, grouped from the per-recipient rows in `emailLog`.
 *
 * Grouped at read time rather than stored as a campaign document, because the
 * per-recipient row is the one that answers the question people actually ask —
 * "did *Ada* get it?" — and a summary derived from those rows can never
 * disagree with them. A stored counter could.
 */
export async function listCampaigns(limit = 25): Promise<CampaignRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.emailLog)
    .where('eventId', '==', EVENT_ID)
    .get();

  const byCampaign = new Map<string, CampaignRow>();

  for (const d of snap.docs) {
    const e = d.data() as EmailLogDoc;
    if (e.template !== 'bulk-message' || !e.campaignId) continue;

    let at: string;
    try {
      at = e.at.toDate().toISOString();
    } catch {
      at = new Date(0).toISOString();
    }

    const row =
      byCampaign.get(e.campaignId) ??
      ({
        campaignId: e.campaignId,
        subject: e.subject,
        actor: e.actor,
        at,
        sent: 0,
        failed: 0,
        skipped: 0,
      } satisfies CampaignRow);

    if (e.status === 'sent') row.sent++;
    else if (e.status === 'failed') row.failed++;
    else row.skipped++;

    // The campaign's timestamp is its earliest row: a send of 400 people spans
    // a minute or two, and "when did this go out" means when it started.
    if (at < row.at) row.at = at;

    byCampaign.set(e.campaignId, row);
  }

  return [...byCampaign.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Every recipient of one campaign, for the "did Ada get it?" question. */
export async function campaignRecipients(campaignId: string): Promise<
  { to: string; status: EmailLogDoc['status']; error?: string; reason?: string }[]
> {
  const snap = await db()
    .collection(COLLECTIONS.emailLog)
    .where('eventId', '==', EVENT_ID)
    .where('campaignId', '==', campaignId)
    .get();

  return snap.docs
    .map((d) => {
      const e = d.data() as EmailLogDoc;
      return { to: e.to, status: e.status, error: e.error, reason: e.reason };
    })
    .sort((a, b) => a.to.localeCompare(b.to));
}

// ---------------------------------------------------------------------------
// The conference desk — organizer↔attendee direct messages
// ---------------------------------------------------------------------------

/**
 * Direct messaging, from the organizer's side.
 *
 * Audit E's finding was that `threads` appeared zero times in this dashboard:
 * the attendee app has a full inbox, attendees message each other, and the
 * people running the conference could neither see nor join any of it. On the
 * day, "message the speaker whose flight is delayed" is a real need and email is
 * the wrong instrument for it — the speaker is on a plane with the event app
 * open, not reading a mailbox.
 *
 * ── What is deliberately NOT built: reading everyone's DMs ───────────────────
 *
 * This dashboard runs on the Admin SDK and bypasses `firestore.rules` entirely,
 * so it *could* list every thread and every message in the event. **Capability
 * is not licence.** A screen that renders a thousand attendees' private
 * conversations is a different product from one that can send a message, and
 * nothing in this product has ever asked anybody's permission for it: no
 * attendee-facing copy anywhere says an organizer can read direct messages, the
 * privacy screen offers `messagingEnabled` as a switch over *who may write to
 * you* and says nothing about who may read, and `firestore.rules` denies every
 * non-participant precisely so that the answer is "nobody". Building the
 * surveillance view would make all three of those statements quietly false, and
 * the defect class AGENTS.md counts fourteen instances of is exactly this: the
 * product claiming, or in this case silently acquiring, a capability its own
 * copy denies.
 *
 * So the read side here is scoped to threads the desk is *in*, and the refusal
 * is written down on the screen rather than left as an absence. What a genuine
 * moderation path would need is a different mechanism, not a wider query: an
 * attendee-initiated **report** on a specific message, so a moderator sees only
 * what somebody chose to escalate. There is no such document in `models.ts` and
 * inventing one is a decision, not a detail.
 *
 * ── The identity problem, and why there is exactly one desk ──────────────────
 *
 * Sending needs an identity in `participantIds`. The dashboard has none to
 * offer: its auth is an email allowlist plus a shared passphrase (`lib/auth.ts`)
 * and there is **no per-organizer Firebase uid** anywhere in the system — that
 * file states plainly that the recorded actor is "the address typed beside the
 * shared secret", which is not an authenticated person and must not be minted
 * into one. Inventing a uid per organizer would fabricate an identity the
 * authentication cannot back.
 *
 * So there is one reserved identity, `DESK_UID`, shared by every organizer. An
 * attendee sees "KGC Conference Desk" rather than which of four organizers
 * replied, which is also the better product answer: you message the desk, and
 * the desk answers, the same way a support address works. Internal
 * accountability is not lost — every send writes an audit entry naming the
 * actor email from `requireOrganizer()`, which is exactly the same strength of
 * identity the rest of the dashboard's audit trail has.
 *
 * ⚠️ **This needs no model change.** `MessageDoc` stays `{senderId, body,
 * sentAt}` and `ThreadDoc` stays as it is; the desk is just another value in
 * `participantIds`. That was worth checking before building, because a scheme
 * requiring a per-organizer field on every message would have been a schema
 * migration on a collection the app is already listening to.
 *
 * ── The thread id rule, restated because this is where it bites ──────────────
 *
 * Thread ids are the two uids sorted and joined with `_`. **Nothing here parses
 * one.** Ids are built with `threadIdFor()` (concatenation), and membership is
 * read from `participantIds` on the document. `demo_000_demo_001` splits into
 * four pieces containing neither participant, which is how every message read
 * and send in this project was once denied; `DESK_UID` contains a `_` in the
 * generated id too, and that is harmless for exactly as long as nobody splits.
 */

/**
 * The desk's uid.
 *
 * Deliberately not shaped like a Firebase uid — 28 alphanumeric characters —
 * so it cannot collide with a real account, and readable so that a `senderId`
 * of `kgc-organizer-desk` in the raw data explains itself. The hyphens are
 * safe for the same reason the underscore in `demo_000` is now safe: nothing
 * anywhere parses a uid or a thread id.
 */
export const DESK_UID = 'kgc-organizer-desk';

/**
 * The desk's `directory/{uid}` projection.
 *
 * ⚠️ This entry is what makes the desk legible in the app, and its absence is
 * not neutral. `app/src/app/messages/index.tsx` titles every inbox row from the
 * directory and falls back to the literal string `'Attendee'` when there is no
 * match, so without this a message from the organizers arrives from "Attendee"
 * — which reads as a stranger, not as the conference.
 *
 * The cost, stated because it is real: `useDirectory()` loads the whole
 * collection, so the desk also becomes a row in the app's People → Attendees
 * list. That is defensible and arguably a feature — an attendee who needs the
 * organizers can find and message them the same way they find anybody else —
 * but the desk is not an attendee, and giving it a badge or sorting it to the
 * top is an `app/` change that this task does not own.
 *
 * It is stable once written: `mirror-directory.ts` triggers on writes to
 * `users/{uid}`, and the desk deliberately has no `users` document, so the
 * trigger has nothing to fire on and will never delete this projection.
 */
const DESK_PROFILE = {
  eventId: EVENT_ID,
  uid: DESK_UID,
  name: `${EVENT.shortName} Conference Desk`,
  title: 'Event organizers',
  company: EVENT.name,
  interests: [] as string[],
} satisfies Omit<DirectoryDoc, 'updatedAt'>;

/** The name the desk appears under, for screens that need it without a read. */
export const DESK_NAME = DESK_PROFILE.name;

/**
 * Idempotent. Called before the desk's first send rather than at deploy time,
 * because there is no deploy-time hook on this project and a projection written
 * lazily is one that cannot drift out of step with the code that names it.
 */
export async function ensureDeskDirectoryEntry(): Promise<void> {
  await db()
    .collection(COLLECTIONS.directory)
    .doc(DESK_UID)
    .set({ ...DESK_PROFILE, updatedAt: new Date() }, { merge: true });
}

export interface DeskThreadRow {
  threadId: string;
  /** The other participant's uid, taken from `participantIds`. Never from the id. */
  correspondentUid: string;
  correspondentName: string;
  lastMessage?: string;
  /** ISO, or undefined for a thread nobody has spoken in. */
  lastMessageAt?: string;
  /** True when the desk sent the most recent message — i.e. we are waiting on them. */
  lastSenderWasDesk: boolean;
  unread: number;
}

/**
 * ISO, or undefined.
 *
 * A `serverTimestamp()` that has not resolved yet reads back as null, and the
 * `toDate()` on a value the emulator wrote during a partial write can throw —
 * neither of which is a reason for an inbox to fail to render.
 */
function isoOf(at: Timestamp | undefined): string | undefined {
  try {
    return at?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

/**
 * The other person in a thread.
 *
 * Two lines, and they are the whole security model of this file: membership
 * comes from the array on the document, so a thread the desk is not in has no
 * "other" participant and resolves to `undefined` rather than to a guess.
 */
function correspondentOf(participantIds: string[] | undefined): string | undefined {
  return correspondentIn(participantIds, DESK_UID);
}

/**
 * The desk's inbox.
 *
 * ⚠️ Note the filter: `participantIds array-contains DESK_UID`, not an unfiltered
 * listing narrowed afterwards. The query itself is the boundary, so no
 * conversation the desk is not part of is ever read into this process — which
 * matters more than it looks, because a filter applied after the read would put
 * every attendee's private messages into a server log the first time this threw.
 *
 * The composite index this needs (`participantIds CONTAINS` + `lastMessageAt
 * DESCENDING`) already exists in `firestore.indexes.json`: it is the same query
 * the attendee app's own inbox runs. Do not add a second one — Firestore cannot
 * add a field to an existing index, and a duplicate is a rebuild for nothing.
 */
export async function listDeskThreads(): Promise<DeskThreadRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.threads)
    .where('participantIds', 'array-contains', DESK_UID)
    .orderBy('lastMessageAt', 'desc')
    .get();

  const rows: DeskThreadRow[] = [];
  for (const d of snap.docs) {
    const t = d.data() as ThreadDoc;
    const correspondentUid = correspondentOf(t.participantIds);
    if (!correspondentUid) continue;

    rows.push({
      threadId: d.id,
      correspondentUid,
      correspondentName: correspondentUid,
      lastMessage: t.lastMessage,
      lastMessageAt: isoOf(t.lastMessageAt),
      lastSenderWasDesk: t.lastSenderId === DESK_UID,
      unread: t.unread?.[DESK_UID] ?? 0,
    });
  }

  await nameCorrespondents(rows);
  return rows;
}

/**
 * Fill in display names from `directory`.
 *
 * One read of the whole projection rather than one `getDoc` per row: it is
 * ~450 KB for a thousand attendees and the desk's inbox is the one screen that
 * would otherwise fan out to a read per conversation. A uid with no directory
 * entry keeps its uid as the name — the attendee opted out of the directory
 * after writing, and inventing "Attendee" here would hide which conversation is
 * which on the one screen that has to tell them apart.
 */
async function nameCorrespondents(rows: DeskThreadRow[]): Promise<void> {
  if (rows.length === 0) return;

  const snap = await db()
    .collection(COLLECTIONS.directory)
    .where('eventId', '==', EVENT_ID)
    .get();
  const byUid = new Map(snap.docs.map((d) => [d.id, (d.data() as DirectoryDoc).name]));

  for (const row of rows) {
    row.correspondentName = byUid.get(row.correspondentUid) ?? row.correspondentUid;
  }
}

export interface DeskMessage {
  id: string;
  fromDesk: boolean;
  body: string;
  /** ISO, or undefined while the server timestamp is still resolving. */
  sentAt?: string;
}

export interface DeskConversation {
  threadId: string;
  correspondentUid: string;
  correspondentName: string;
  correspondentDetail?: string;
  unread: number;
  messages: DeskMessage[];
}

/**
 * One conversation, **only if the desk is in it**.
 *
 * This is the line that keeps the surface honest. The Admin SDK will hand back
 * any thread in the event without complaint, so the refusal to read two
 * attendees' private conversation has to be written here explicitly — it is not
 * enforced by anything underneath, the way it would be for a client governed by
 * `firestore.rules`. Membership is checked against `participantIds` on the
 * document that came back; nothing infers it from `threadId`.
 */
export async function deskThread(threadId: string): Promise<DeskConversation | null> {
  const ref = db().collection(COLLECTIONS.threads).doc(threadId);
  const doc = await ref.get();
  if (!doc.exists) return null;

  const t = doc.data() as ThreadDoc;
  const correspondentUid = correspondentOf(t.participantIds);
  if (!correspondentUid) return null;

  const [msgSnap, person] = await Promise.all([
    // Ascending: the single-field override in `firestore.indexes.json` indexes
    // `sentAt` ascending only, so a descending order works in the emulator and
    // fails with `failed-precondition` in production. See `app/src/lib/data/messages.ts`.
    ref.collection(SUBCOLLECTIONS.messages).orderBy('sentAt', 'asc').get(),
    db().collection(COLLECTIONS.directory).doc(correspondentUid).get(),
  ]);

  const entry = person.exists ? (person.data() as DirectoryDoc) : undefined;

  return {
    threadId,
    correspondentUid,
    correspondentName: entry?.name ?? correspondentUid,
    correspondentDetail: [entry?.title, entry?.company].filter(Boolean).join(', ') || undefined,
    unread: t.unread?.[DESK_UID] ?? 0,
    messages: msgSnap.docs.map((d) => {
      const m = d.data() as MessageDoc;
      return {
        id: d.id,
        fromDesk: m.senderId === DESK_UID,
        body: m.body,
        // Undefined while a `serverTimestamp()` is still resolving, which is a
        // real state the organizer can see on the message they just sent.
        sentAt: isoOf(m.sentAt),
      };
    }),
  };
}

/** The id the desk and one attendee share. Concatenation only — never split. */
export function deskThreadIdFor(attendeeUid: string): string {
  return threadIdFor(DESK_UID, attendeeUid);
}

export interface DeskRecipient {
  uid: string;
  name: string;
  detail?: string;
  isSpeaker: boolean;
}

/**
 * Who the desk can start a conversation with, and who it cannot.
 *
 * Two filters, both of which exclude people for reasons worth showing rather
 * than hiding — the same discipline `resolveAudience` above applies to speakers
 * with no email address:
 *
 *  - **No uid.** A ticket holder who has never opened the app has no Firebase
 *    account, so there is no identity to put in `participantIds` and no inbox
 *    for the message to arrive in. Email is the only channel that reaches them.
 *  - **`messagingEnabled` is false.** ⚠️ This is the attendee's own privacy
 *    switch on their profile screen, and **nothing enforces it** —
 *    `firestore.rules` lists it as a writable field and never reads it, so the
 *    desk could write straight past it and the attendee would never know. It is
 *    honoured here by choice, because a switch labelled "let attendees message
 *    me" that the organizers silently ignore is precisely the defect AGENTS.md
 *    counts fourteen instances of. An organizer who genuinely must reach an
 *    opted-out attendee has their email address on the Attendees screen.
 *
 * Speakers are flagged rather than listed separately: a speaker who holds a
 * ticket already has a `users` document and is therefore already in this list,
 * and the flag is what makes "the speaker whose flight is delayed" findable.
 */
export async function deskRecipients(): Promise<{
  recipients: DeskRecipient[];
  notSignedIn: number;
  messagingOff: number;
}> {
  const attendees = await listAttendees();

  let notSignedIn = 0;
  let messagingOff = 0;
  const recipients: DeskRecipient[] = [];

  for (const a of attendees) {
    if (!a.uid || !a.signedIn) {
      notSignedIn++;
      continue;
    }
    if (!a.messagingEnabled) {
      messagingOff++;
      continue;
    }
    recipients.push({
      uid: a.uid,
      name: a.name,
      detail: [a.title, a.company].filter(Boolean).join(', ') || a.email || undefined,
      isSpeaker: a.roles.includes('speaker'),
    });
  }

  // Speakers first, then alphabetically. The delayed-speaker case is the one
  // this screen exists for and it should not need a search box to reach.
  recipients.sort((a, b) =>
    a.isSpeaker === b.isSpeaker ? a.name.localeCompare(b.name) : a.isSpeaker ? -1 : 1,
  );
  return { recipients, notSignedIn, messagingOff };
}
