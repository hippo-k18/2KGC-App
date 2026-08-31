import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * `auditLog/{id}` — who changed what, before and after, and when.
 *
 * Not in `packages/shared/src/models.ts` yet (that file belongs to another work
 * package in flight); this is the shape the console writes, and it should move
 * to `@kgc/shared` as `AuditLogDoc` when the two can be edited together.
 *
 * Cheap now, and the only way to answer "who moved that session?" at 09:05 on
 * day two with an angry speaker standing in front of you. `firestore.rules`
 * gives no client any access to this collection — only the Admin SDK writes it.
 */
export interface AuditEntry {
  eventId: string;
  /** Allowlisted organizer email. Replaced by the SSO subject when SSO lands. */
  actor: string;
  action:
    | 'session.create'
    | 'session.update'
    | 'announcement.create'
    /**
     * Only the check-ins that actually wrote a document. A duplicate scan, an
     * unknown code and a cancelled ticket all changed nothing, so they are
     * recorded in `scanEvents` — the raw log — and not here. An audit trail
     * that logs non-events is one nobody reads on the morning it matters.
     */
    | 'checkin.create'
    /**
     * A check-in typed at the desk rather than scanned, and its reversal. Both
     * are here rather than in `scanEvents` because nothing was scanned — and
     * both matter more than a scan does, precisely because a human decided
     * them. `checkin.undo` is the only action in this list that *removes* a
     * document, which is the other reason it cannot be silent.
     */
    | 'checkin.manual'
    | 'checkin.undo'
    | 'checkinList.create'
    /**
     * The money actions. These are the entries that matter most in this log —
     * `order.refund` moves real money out of the account and cannot be undone
     * from anywhere in this product, and `invoice.markPaid` issues tickets
     * against an invoice nobody has paid. Both are decisions a person made, and
     * the only record of *which* person is here.
     */
    | 'order.refund'
    | 'invoice.markPaid'
    | 'ticketType.create'
    | 'ticketType.update'
    /**
     * A hand correction to `quantitySold`, and the reconcile job that does the
     * same thing across the catalogue.
     *
     * Separate from `ticketType.update` because it is a different kind of act:
     * every other edit on that screen changes what will be sold, and this one
     * changes the record of what *has* been. The counter is never decremented
     * on refund, so it ratchets — and the correction for that ratchet moves the
     * line between "still selling" and "sold out". "Who decided we had four
     * seats left?" needs an answer, and it needs to be findable without reading
     * every tagline edit in the log.
     */
    | 'ticketType.adjustSold'
    /**
     * A bulk email. Recorded because it is the one action here that cannot be
     * undone *at all* — a refund can at least be explained, an email in a
     * thousand inboxes cannot be recalled.
     */
    | 'message.send'
    /** Discount codes live in Stripe, so this records a write we made there. */
    | 'discountCode.create'
    | 'discountCode.update'
    /**
     * Hiding or restoring community content and Q&A questions. Recorded because
     * moderation is contested by definition — "who hid my post, and when?" has
     * to have an answer that is not a shrug.
     */
    | 'moderation.setStatus'
    | 'session.qaSettings'
    /** Organizer settings bags — branding, the event website, access rules. */
    | 'settings.update'
    /** The entities the later dashboard screens author. */
    | 'exhibitor.create'
    | 'exhibitor.update'
    /**
     * Sponsors. Recorded with the weight of a commercial record rather than a
     * content one: `tier` is what a sponsor paid for, and it decides their logo
     * size on the public site and their position in the app's directory. "Who
     * moved Bloomberg from Platinum to Gold, and when?" is a question with a
     * contract behind it.
     */
    | 'sponsor.create'
    | 'sponsor.update'
    /** A sponsor list imported from the sales spreadsheet, one entry per run. */
    | 'sponsor.import'
    /**
     * The three programme imports, each one entry per run rather than per row.
     *
     * Four hundred audit rows for one button press is a log nobody reads, and
     * the per-row outcome is on screen at the time. What the run entry has to
     * carry instead is the shape of the blast: how many rows the file held, how
     * many were created against updated, and whether the organizer chose to
     * import a file that had problems. `track.import` also records
     * `sessionsRecoloured`, because a colour change fans out onto documents the
     * import did not name and that number is the one nobody expects.
     */
    | 'speaker.import'
    | 'track.import'
    | 'session.import'
    | 'task.create'
    | 'task.update'
    | 'survey.create'
    | 'survey.update'
    | 'document.create'
    | 'document.update'
    /**
     * Floor-plan allocation. `booth.assign` is here for the same reason
     * `order.refund` is: two exhibitors sent to one space is discovered on the
     * morning of day one, when the only useful question is who moved whom and
     * when. `booth.hold` matters separately because a hold is a promise made
     * before any money arrived.
     */
    | 'booth.create'
    | 'booth.update'
    | 'booth.assign'
    | 'booth.hold'
    | 'booth.release'
    | 'booth.block'
    | 'booth.unblock'
    /**
     * A payment recorded by an organizer rather than taken by Stripe — a
     * cheque, a wire, a comped package. It issues a ticket against money this
     * system never saw, so the person who decided it is the only record there
     * is.
     */
    | 'order.manual'
    /**
     * Registration questions. Recorded because the field id is what answers are
     * stored under — an edit that changed it would orphan every answer already
     * given, and this is the trail that shows an edit did not.
     */
    | 'questionForm.create'
    | 'questionForm.update'
    /** Round tables and bookable meeting slots. */
    | 'gathering.create'
    | 'gathering.update'
    /**
     * The programme's own vocabulary — the people, the taxonomy and the doors.
     *
     * Recorded with the same weight as a session edit, because a rename here
     * does not stop at one document: `SessionDoc` caches `speakerNames`,
     * `primaryTrackName`, `primaryTrackColor` and `roomName`, so one edit fans
     * out across the agenda. The `after` map therefore carries the fan-out's
     * own count — "renamed, and 14 sessions rewritten" is the entry worth
     * having at 09:05 on day two, and "renamed, 2 sessions FAILED" is the one
     * that has to be findable.
     */
    | 'speaker.create'
    | 'speaker.update'
    | 'track.create'
    | 'track.update'
    | 'room.create'
    | 'room.update'
    /** A manual rebuild of every cached name on every session. */
    | 'agenda.reconcile'
    /** Campaign contacts, tracked links and the sends that use them. */
    | 'campaign.create'
    | 'campaign.update'
    | 'contact.import'
    /**
     * A bulk attendee import. One entry for the whole run rather than one per
     * row — four hundred audit entries for one action is a log nobody reads,
     * and the per-row outcome is reported on screen at the time.
     */
    | 'attendee.import'
    /**
     * One attendee added by hand from the Attendees screen.
     *
     * Per-row here, unlike `attendee.import`, because the whole point of the
     * single-row path is that a person decided on this person — a comped guest,
     * a late speaker's colleague, someone whose payment went astray. That
     * decision is the thing worth being able to find later, and there is one of
     * it rather than four hundred.
     */
    | 'attendee.add'
    /**
     * One in-app message sent from the organizer desk.
     *
     * This is the only per-person accountability the desk has. The dashboard
     * signs in with a shared passphrase and there is no per-organizer Firebase
     * uid, so every desk message carries the same `senderId` and an attendee
     * sees one identity; the actor recorded here is the address typed beside
     * that shared secret, and it is the only record of which organizer wrote
     * the words.
     */
    | 'desk.message.send';
  /** Firestore path of the document that changed, e.g. `sessions/abc123`. */
  targetPath: string;
  targetId: string;
  /** Only the fields that actually changed, so a diff is readable at a glance. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  at: FirebaseFirestore.FieldValue;
}

export async function appendAudit(entry: Omit<AuditEntry, 'eventId' | 'at'>): Promise<void> {
  try {
    await db()
      .collection(COLLECTIONS.auditLog)
      .add({ ...entry, eventId: EVENT_ID, at: FieldValue.serverTimestamp() });
  } catch (err) {
    // An audit write must never be the reason an organizer cannot fix a room
    // five minutes before a talk. Losing the trail is bad; blocking the edit
    // during the event is worse. It surfaces on the war-room page instead.
    recordError('auditLog write failed', err);
  }
}

/**
 * The subset of a document that changed, as two flat maps. Firestore stores no
 * `undefined`, so a removed field is recorded as `null`.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};

  for (const key of Object.keys(after)) {
    const was = before[key];
    const now = after[key];
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
    changed.push(key);
    b[key] = was ?? null;
    a[key] = now ?? null;
  }
  return { before: b, after: a, changed };
}
