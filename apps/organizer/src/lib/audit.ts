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
     * A tier destroyed rather than hidden.
     *
     * There is no button for this and there should not be one — orders
     * reference a tier by id, so hiding is the safe act and deleting is not.
     * The verb exists because the unsafe act still happens by hand, through the
     * Admin SDK, for a tier created by mistake: `ticketTypes/12134` on
     * 2026-09-09, priced at $14,134 with nothing sold against it. When that is
     * done, `before` carries the whole tier, for the same reason
     * `moderation.delete` does — a hidden tier is its own evidence and a
     * deleted one is not.
     */
    | 'ticketType.delete'
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
    /**
     * A community post or reply destroyed, not hidden.
     *
     * The one moderation action that is irreversible, and the reason the entry
     * carries the whole document in `before` rather than a status pair: hiding
     * keeps the post, so the post is its own evidence, and a delete removes
     * that. If the text is worth destroying it is worth having a record that it
     * existed and who decided — a takedown demand, a personal-data erasure, a
     * doxxing post that must not survive in any readable collection. This log
     * is that record, and it is why `Delete` is offered at all rather than
     * leaving an organizer to go into the console with the Admin SDK.
     */
    | 'moderation.delete'
    | 'session.qaSettings'
    /** Organizer settings bags — branding, the event website, access rules. */
    | 'settings.update'
    /**
     * Copy on a public page of the website, overridden without a deploy.
     *
     * Audited rather than left to `updatedBy`, because this is the one editor
     * whose output is read by people who are not attendees and hold no ticket,
     * and one of its fields is the address a code-of-conduct incident is
     * reported to. A wrong value there is discovered by the person it fails,
     * and "who changed it, from what, and when" is the only way back.
     */
    | 'pageContent.update'
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
    | 'poll.create'
    | 'poll.update'
    /**
     * An organizer counting the votes and writing the result into the fields
     * the app reads. It is the only entry here that writes a field the trigger
     * spec calls server-owned, so it is recorded by name rather than folded
     * into `poll.update`: when `tallyPoll` is deployed, this is the action that
     * should stop appearing.
     */
    | 'poll.publishTally'
    | 'document.create'
    | 'document.update'
    | 'page.create'
    | 'page.update'
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
     * Complimentary passes: the number a package includes, and each pass named
     * against a sponsorship.
     *
     * `compPass.issue` is the entry that matters. It mints a full attendee
     * registration — badge, claim code, admission — against money that was paid
     * for a sponsorship rather than for that seat, so "who let this person in,
     * and on whose allocation?" has to have an answer. It is recorded per pass
     * rather than per sponsorship, because the seats are named weeks apart by
     * different people. `ticketType.complimentaryPasses` is separate from
     * `ticketType.update` for the same reason `ticketType.adjustSold` is: it
     * changes what has already been sold, not what will be.
     */
    | 'ticketType.complimentaryPasses'
    | 'compPass.issue'
    | 'compPass.rename'
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
    /**
     * Speaker self-service: the link, and what an organizer did with what came
     * back.
     *
     * `speaker.portalApprove` is the one that matters, and it is separate from
     * `speaker.update` on purpose. Every other edit to a speaker was typed by
     * the organizer whose address is in `actor`; this one is text a speaker
     * wrote, published by an organizer who pressed a button, and "who agreed
     * this bio could go on the website" is a different question from "who typed
     * it". `after` carries which fields and which sessions moved rather than
     * the text, because the draft it came from is overwritten by the speaker's
     * next submission and the field list is what makes the entry findable.
     *
     * `portalRevoke` is here because it takes something away from a person
     * outside the organization with no notice to them, and `portalSend` because
     * it puts a bearer link to a named person's profile into an inbox.
     */
    | 'speaker.portalSend'
    | 'speaker.portalApprove'
    | 'speaker.portalReject'
    | 'speaker.portalRevoke'
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
     * Publishing or revising a consent or release form.
     *
     * Audited more carefully than the other editors here, because this is the
     * only thing in the dashboard whose output is a legal record about a
     * person. `consentForm.publish` is the moment wording becomes signable, and
     * the version it names is the version stored on every signature that
     * follows — so "who published v3, and when" is the question that gets asked
     * if a signature is ever disputed, and `updatedBy` alone cannot answer it.
     *
     * There is deliberately no `consentResponse.*` action. A signature is
     * written by the signatory, not by an organizer, and `consentResponses` is
     * append-only in `firestore.rules` — the document *is* the record, and an
     * audit entry mirroring it would be a second, weaker copy that could drift.
     */
    | 'consentForm.publish'
    | 'consentForm.update'
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
     * Everything an organizer does to one registration afterwards. `update`
     * covers a corrected address too, which moves the registration to a new id:
     * `targetId` is the old one and `after.registrationId` the new. `cancel`
     * records whether a paid seat went back on sale and what happened to the
     * holder's app access, because those are the two questions asked later.
     */
    | 'attendee.update'
    | 'attendee.cancel'
    | 'attendee.reinstate'
    | 'attendee.transfer'
    | 'attendee.ticketType'
    | 'attendee.confirmation'
    /**
     * Everything held about one person, destroyed on request.
     *
     * The most consequential entry in this list, and the only one whose subject
     * no longer exists when it is read. `attendee.cancel` can be reinstated and
     * `order.refund` can at least be explained; this removes the documents that
     * would evidence either. So the entry carries the walk's own outcome — how
     * many records each part of the walk deleted, anonymised or kept — because
     * afterwards there is nothing else left to count.
     *
     * ⚠️ It carries no email address, deliberately. This log survives the
     * erasure, so an entry naming the person would restore the field the
     * operation existed to remove.
     */
    | 'attendee.erase'
    /** A category set or cleared, for one person or a selection. */
    | 'attendee.category'
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
    | 'desk.message.send'
    /**
     * The volunteer roster.
     *
     * Audited per row rather than per run, because a roster edit is a decision
     * about one named person's shift: "who moved Ada off the 07:00 desk" is the
     * question asked at 07:05, and it is unanswerable from the document alone
     * once the row has been rewritten.
     */
    | 'volunteer.create'
    | 'volunteer.update'
    | 'volunteer.delete'
    /**
     * Issuing an attendance certificate.
     *
     * The certificate document holds the hours it was issued for; this holds
     * who issued it and against which count. A certificate is the one artefact
     * here that leaves the event and gets shown to an accrediting body, so
     * "these hours were issued on the evidence as it stood at 18:40, by this
     * organizer" has to survive a later recount that changes the number.
     */
    | 'certificate.issue'
    /**
     * The call for abstracts.
     *
     * `call.update` is here for the deadline above everything else: moving a
     * closing date is the one edit on that screen that changes who is allowed
     * to submit, and it is enforced only server-side, because `calls` and
     * `submissions` have no `match` block in `firestore.rules` and there is no
     * rule underneath to catch what a screen lets through. "Who extended it,
     * and to when" has to be answerable.
     *
     * `call.form` records a change to the questions, carrying the form version
     * before and after rather than the prompt text — the version is what every
     * submission is pinned to, and a bumped number with no archived definition
     * behind it names wording nobody kept.
     */
    | 'call.create'
    | 'call.update'
    | 'call.form'
    /**
     * Accepting or rejecting an abstract, and taking it back.
     *
     * The nearest thing this feature has to `order.refund`: a decision a person
     * made about somebody else's work, mailed out, and an email in an author's
     * inbox cannot be recalled. `submission.undoDecision` matters separately
     * because it *deletes* a field — `SubmissionDoc.decision` is absent until it
     * is made, so there is no second boolean recording that one was reversed and
     * this entry is the only trace.
     */
    | 'submission.decide'
    | 'submission.undoDecision'
    /**
     * An accepted abstract promoted onto the agenda — one session written, and
     * one speaker created or updated.
     *
     * Deliberately not a side effect of acceptance (`CFA-PLAN.md` §4): Whova's
     * marketing claims it is automatic and its own help centre corrects it,
     * because scheduling is a decision about rooms and times that acceptance
     * does not make. This is the entry for that second decision.
     */
    | 'submission.promote'
    /** Reviewers: who was invited, and who was given whose work to read. */
    | 'reviewer.invite'
    | 'reviewer.update'
    | 'reviewer.assign'
    /** A reviewer kept away from one submission, and the invitation mail. */
    | 'reviewer.exclude'
    | 'reviewer.sendInvitation'
    /** The scoring criteria reviewers mark against. */
    | 'call.rubric'
    /**
     * Who may open this dashboard, and how much of it.
     *
     * Every one of these changes what somebody else can do with the Admin SDK
     * behind them, so each is its own verb rather than a `settings.update`.
     * `team.setPassphrase` is the only one whose actor is the member rather
     * than an owner: it is written when a set-passphrase link is used, and it
     * never carries the passphrase or its hash, only that one was set.
     */
    | 'team.invite'
    | 'team.roles'
    | 'team.newLink'
    | 'team.remove'
    | 'team.setPassphrase'
    /** An organizer took somebody out of a capped session, from Session Cap. */
    | 'sessionSeat.remove';
  /** Firestore path of the document that changed, e.g. `sessions/abc123`. */
  targetPath: string;
  targetId: string;
  /**
   * Who or what the entry is about, in words. "Ada Silva", not `reg_01e162…`.
   *
   * Optional, and it is the only field here written purely to be read. Tools ›
   * Report is the one screen this collection has, and it printed `targetPath`
   * — so a cancelled ticket read `registrations/reg_01e1621469460b03d253854f`
   * and an organizer asking who had been cancelled could not tell. The name
   * cannot go in `after`, because that map is a diff and a name appearing there
   * says the name changed.
   *
   * ⚠️ Never set it on `attendee.erase`. That entry survives the erasure by
   * design and carries no address for the same reason it would carry no name:
   * the record would restore what the operation existed to remove.
   */
  subject?: string;
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
