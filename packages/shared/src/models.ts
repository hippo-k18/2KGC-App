import type { CommunityCategory } from "./community.js";
import type { SettingsKey, SettingsValues } from "./settings.js";

/**
 * A structural stand-in for `firebase/firestore`'s `Timestamp` (and the
 * Admin SDK's `firebase-admin/firestore` `Timestamp`, which has the same
 * shape). This package is consumed by the Expo app *and*, from WP-02 on, by
 * Cloud Functions — those load the client SDK and the Admin SDK
 * respectively, and the two are different classes that must never both end
 * up in one bundle. Depending on either here would force that choice on
 * every consumer. Both real classes have only public members (verified
 * against `@firebase/firestore-types`), so TypeScript's structural typing
 * accepts a real `Timestamp` wherever this alias is expected — this is a
 * type-only shape, not a runtime implementation.
 */
export interface Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
  isEqual(other: Timestamp): boolean;
}

/**
 * Firestore document shapes. Each interface is the stored document *without*
 * its id — `WithId<T>` adds the document id when a doc is read.
 */
export type WithId<T> = T & { id: string };

/**
 * Carried by every top-level document.
 *
 * `eventId` costs about fifteen bytes today and cannot be added cheaply later:
 * Firestore has no way to add a field to an existing composite index, so
 * introducing it in 2028 means rebuilding every index and backfilling every
 * collection. It is here so that KGC 2028 can ship without last year's app
 * breaking, and so a one-day satellite event is a data question rather than a
 * second Firebase project.
 */
export interface BaseDoc {
  eventId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * The four tiers the real conference actually sells, in descending order.
 *
 * This was `diamond | platinum | gold | silver | startup`, which was invented.
 * The live site's sponsor strip is a Whova widget, and its public design payload
 * (`event_webpage/sponsor/public/get_sponsor_design`) names exactly four tiers
 * with a size weight each — Platinum 3, Gold 2, Silver 1, Bronze 1. There is no
 * Diamond tier and no startup tier. Read in that order, this union is also the
 * sort order, so nothing needs a separate ranking table beyond `TIER_ORDER`.
 */
export type SponsorTier = "platinum" | "gold" | "silver" | "bronze";
export type SkillLevel = "beginner" | "intermediate" | "advanced";
export type SessionFormat =
  | "keynote"
  | "talk"
  | "panel"
  | "workshop"
  | "poster"
  | "social";

/**
 * A person may hold several of these at once, which is why this is a list and
 * not a scalar. With 150+ speakers among ~1,000 attendees, roughly one in seven
 * users needs two, and an organizer who also gives a talk should not have to
 * pick. Mirrored into the `roles` custom claim, which is what `firestore.rules`
 * actually reads.
 */
export type Role =
  | "attendee"
  | "speaker"
  | "organizer"
  | "reviewer"
  | "exhibitor"
  | "checkin";

/** Published state. Nothing an attendee may have saved is ever hard-deleted. */
export type PublishStatus = "draft" | "published" | "cancelled";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** `users/{uid}` — the full profile. Readable only by its owner and organizers. */
export interface UserDoc extends BaseDoc {
  email: string;
  name: string;
  photoURL?: string;
  title?: string;
  company?: string;
  bio?: string;
  interests: string[];
  social?: { linkedin?: string; x?: string; github?: string; website?: string };
  /** False until onboarding is completed. */
  onboarded: boolean;
  /**
   * Opting out does not filter this profile out of the directory — it causes
   * `directory/{uid}` to be deleted outright, so the record never reaches
   * another device. Rules can hide documents but not fields, which is why the
   * directory is a separate projection at all.
   */
  visibleInDirectory: boolean;
  /** Separate from directory visibility: you may be findable but not messageable. */
  messagingEnabled: boolean;
  notificationPrefs: {
    announcements: boolean;
    messages: boolean;
    sessionReminders: boolean;
  };
  /** Written only by Cloud Functions; mirrored into the custom claim. */
  roles: Role[];
}

/**
 * `directory/{uid}` — the slim projection every attendee may read.
 *
 * Deliberately small: ~450 bytes, so all 1,000 load in one fetch (~450 KB) and
 * search happens in memory. That is faster and better than any Firestore query
 * could be, works offline, and needs no search service. Written only by the
 * `mirrorDirectory` trigger, which deletes the document when the owner opts out.
 */
export interface DirectoryDoc {
  eventId: string;
  uid: string;
  name: string;
  title?: string;
  company?: string;
  photoURL?: string;
  interests: string[];
  updatedAt: Timestamp;
}

/**
 * `registrations/{opaqueId}` — the imported ticket list.
 *
 * Keyed by an opaque server-minted id rather than the email address, for three
 * reasons: addresses change; `"a/b@example.com"` is a legal address and an
 * illegal Firestore path segment; and an email-keyed collection is a membership
 * oracle — anyone who can attempt a read learns who holds a ticket.
 */
export interface RegistrationDoc extends BaseDoc {
  email: string;
  /** Lowercased-and-hashed, so lookup never requires the plaintext as a key. */
  emailHash: string;
  /** Addresses an attendee may also sign in with — assistants, forwards, aliases. */
  altEmails: string[];
  name?: string;
  ticketType?: string;
  status: "active" | "cancelled" | "transferred";
  /** Set once the holder has signed in and claimed the registration. */
  claimedByUid?: string;
  /** Printed on the badge as a fallback sign-in door for a wrong-address attendee. */
  claimCode?: string;
  /**
   * Random and opaque, and the only thing that goes into a badge QR. A uid in a
   * QR payload would let anyone who photographs a badge learn an identity.
   */
  qrSecret: string;

  /**
   * Answers to the registration question form, keyed by `QuestionFieldDef.id`.
   *
   * ── Why these live on the registration and not on the order ────────────────
   *
   * A dietary requirement belongs to the *person*. It survives a transferred
   * ticket, it is still true if the order is refunded and re-bought, and it must
   * not be readable by anything querying orders — an `orders` list is the entire
   * buyer database in one query. Putting answers on the order because that is
   * where the form posted is the mistake this comment exists to prevent.
   *
   * Keyed by field id rather than by prompt text, so rewording a question does
   * not orphan every answer already given to it.
   */
  answers?: Record<string, string | string[] | boolean>;
}

/**
 * One question on a registration form.
 *
 * A closed set of kinds, deliberately. An open builder with conditional logic
 * is the project Whova has been iterating on for years; a fixed set covers
 * dietary requirements, t-shirt size, job function and a consent box, which is
 * what a conference actually asks.
 */
export interface QuestionFieldDef {
  /**
   * Stable for the life of the question, and the key answers are stored under.
   * Generated once from the prompt; never regenerated, because rewording a
   * question must not orphan the answers already given to it.
   */
  id: string;
  prompt: string;
  kind:
    | "short-text"
    | "long-text"
    /** One of `options`. */
    | "choice"
    /** Any of `options`. Stored as an array. */
    | "multi-choice"
    /** A plain yes/no. Stored as a boolean. */
    | "checkbox"
    /**
     * A consent box, which is a checkbox with a different meaning: it records a
     * decision rather than a preference, so it may not be pre-ticked and a
     * "required" consent is a contradiction the editor refuses.
     */
    | "consent";
  /** For `choice` and `multi-choice`. Ignored otherwise. */
  options?: string[];
  required: boolean;
  helpText?: string;
  /**
   * Ask only on these tiers. Empty or absent means every tier for the
   * form's audience — which is what most questions want.
   */
  ticketTypeIds?: string[];
  order: number;
}

/**
 * `questionForms/{audience}` — the registration questions for one audience.
 *
 * One document per audience rather than per ticket type, because the questions
 * a conference asks are overwhelmingly the same across its tiers and
 * `QuestionFieldDef.ticketTypeIds` handles the exceptions. A form per tier
 * would mean editing the dietary question four times and getting it wrong once.
 *
 * ── Answers are collected before Checkout, never during it ─────────────────
 *
 * Stripe's hosted Checkout supports at most three custom fields, text/numeric/
 * dropdown only — enough for a t-shirt size, not for a consent flow. So the
 * form is rendered on our own page before the redirect, and the answers are
 * held in `pendingAnswers` until the webhook confirms the payment.
 */
export interface QuestionFormDoc extends BaseDoc {
  audience: TicketAudience;
  fields: QuestionFieldDef[];
  /** Off means the questions are not asked. Editing a live form is not a draft. */
  active: boolean;
  /**
   * Who last changed the questions, and when.
   *
   * On the document rather than only in the audit log, because the question an
   * organizer asks about a form is "is this current?" — and that is answered by
   * a date on the screen they are already looking at.
   */
  updatedBy?: string;
}

/**
 * `pendingAnswers/{checkoutRef}` — answers waiting for a payment to confirm.
 *
 * ── Why this collection has to exist ───────────────────────────────────────
 *
 * The buyer answers the questions on our page, then leaves for Stripe. The
 * registration they belong to does not exist yet and will not until the webhook
 * fires — which may be seconds later, or after a retry, or never if they
 * abandon. The answers cannot ride in Stripe metadata (500 characters per
 * value) and cannot be held in a session (there isn't one).
 *
 * So they are written here first, keyed by a reference the checkout carries,
 * and copied onto the registration at fulfilment.
 *
 * ── It is server-only and it holds personal data ───────────────────────────
 *
 * Dietary requirements and accessibility needs are among the most sensitive
 * things a conference collects. This has no `firestore.rules` match block and
 * must not get one: it is written by the website's server action and read by
 * its webhook, both with the Admin SDK.
 *
 * A row for an abandoned checkout is orphaned by design. `expiresAt` marks it
 * for deletion — nothing prunes it yet, and that is recorded as a gap rather
 * than pretended away.
 */
export interface PendingAnswersDoc extends BaseDoc {
  answers: Record<string, string | string[] | boolean>;
  email: string;
  ticketTypeId: string;
  /** After this, the row is junk. Nothing deletes it yet — see the docblock. */
  expiresAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------

/** `tracks/{id}` */
export interface TrackDoc extends BaseDoc {
  name: string;
  color?: string;
  description?: string;
}

/** `rooms/{id}` — replaces the free-text `SessionDoc.room`, so a room rename is one write. */
export interface RoomDoc extends BaseDoc {
  name: string;
  building?: string;
  floor?: string;
  capacity?: number;
  /** Where the pin sits on the floorplan image, as a 0–1 fraction of each axis. */
  mapX?: number;
  mapY?: number;
}

/** `sessions/{id}` */
export interface SessionDoc extends BaseDoc {
  title: string;
  description?: string;
  /**
   * Local wall time is the authoring truth; the UTC instants and `day` below are
   * derived from it. This is the way round that survives a tzdata change — an
   * organizer says "Tuesday at 09:00 in New York", not "13:00 UTC", and if the
   * offset rules change it is the instant that should move, not the programme.
   */
  timeZone: string;
  /** `YYYY-MM-DDTHH:mm` wall clock in `timeZone`. */
  startsAtLocal: string;
  endsAtLocal: string;
  /** Derived UTC instants. Never authored directly. */
  startsAt: Timestamp;
  endsAt: Timestamp;
  /**
   * `YYYY-MM-DD` in `timeZone` — lets day tabs query by equality instead of
   * timezone-aware ranges. **Derived server-side on write, never on the client:**
   * a 21:00 reception is 01:00 UTC the next day, and a client computing this in
   * the device zone puts it on the wrong tab.
   */
  day: string;
  roomId?: string;
  /** Cached from `RoomDoc.name` for the agenda list. Never decided from. */
  roomName?: string;
  /** Programme chairs cross-list talks, so a session can sit in several tracks. */
  trackIds: string[];
  /** Cached for the agenda card. */
  primaryTrackName?: string;
  primaryTrackColor?: string;
  format: SessionFormat;
  skillLevel?: SkillLevel;
  speakerIds: string[];
  /** Cached for the agenda list, so it renders without N speaker reads. */
  speakerNames?: string[];
  tags: string[];
  slidesUrl?: string;
  status: PublishStatus;
  /** Soft delete. Attendees have this saved and Firestore has no cascade. */
  deletedAt?: Timestamp;
  /** Groups repeated runs of the same workshop. */
  seriesId?: string;
  /**
   * Bumped on every reschedule. With `stableGuid` this lets an exported calendar
   * event update in place instead of appearing twice (RFC 5545 SEQUENCE).
   */
  sequence: number;
  stableGuid: string;
  /** Organizers toggle these per session. */
  qaEnabled: boolean;
  pollsEnabled: boolean;
  /**
   * Absent means uncapped.
   *
   * ⚠️ **Nothing enforces this.** This comment used to read "enforced in a
   * transaction, not by rules"; there is no such transaction. Nothing in
   * `app/`, `apps/web/`, `apps/organizer/` or `functions/` reads this field
   * except `conflicts-core.ts`, which only warns when a cap exceeds what the
   * room seats. Adding a session to a schedule writes a private
   * `savedSessions` bookmark with no count and no ceiling, so an attendee can
   * save a full workshop and nothing objects.
   *
   * It is therefore a **stated intent**, useful for planning and for the
   * over-capacity warning, and it is not a limit. `attendees/session-cap` says
   * so on screen. Making it real needs a counter and a transaction that does
   * not exist yet — and a decision about what happens at the door when somebody
   * turns up to a session they were never counted into.
   */
  capacity?: number;
}

/** `speakers/{id}` */
export interface SpeakerDoc extends BaseDoc {
  name: string;
  photoURL?: string;
  /**
   * Intrinsic pixel size of `photoURL`, when it is known.
   *
   * The public speakers page reserves the portrait box before the image loads,
   * because 137 circular portraits reflowing on arrival is the whole reason the
   * grid was measured in the first place. A portrait uploaded through the
   * console has no dimensions until something measures it, so both are optional
   * and the card falls back to a 200x200 box — the same fallback it used when
   * the roster was a checked-in constant.
   */
  photoWidth?: number;
  photoHeight?: number;
  /**
   * Lifts this speaker into the "Our First Speakers" block at the top of the
   * public page.
   *
   * This is an editorial choice, and until now it was one we could not express:
   * Whova stored it as `design.highlight_speakers` inside a widget we do not
   * run, so the roster carried it and `SpeakerDoc` did not. That asymmetry is
   * what forced the public page to choose between a checked-in roster and a
   * live one. It is a field now, so the organizer picks the highlights in
   * Speaker Manager and the page follows.
   */
  featured?: boolean;
  /**
   * Where this speaker sits in the published order, ascending.
   *
   * Absent for every speaker means "no editorial order", and the page falls
   * back to the surname sort it has always used. It exists because the imported
   * 2026 roster arrived in Whova's own `display_dict` order — nominally by last
   * name, with quirks that a re-sort would silently correct, including the
   * `(Phil) (Meredith)` row that sorts first. Preserving the order the roster
   * was published in is the difference between the page not changing and the
   * page nearly not changing.
   */
  displayOrder?: number;
  title?: string;
  company?: string;
  bio?: string;
  social?: { linkedin?: string; x?: string; website?: string };
  sessionIds: string[];
  /** Set when the speaker also holds a ticket, so the two identities join up. */
  userId?: string;
  /**
   * How to reach them before they hold a ticket.
   *
   * Contact details otherwise live only on `users`, joined by `userId` — which
   * is correct for an attendee and backwards for a speaker. You have a
   * speaker's address from the call for papers, months before they ever sign
   * in, and chasing a bio or a slide deck is precisely the thing you need it
   * for. Requiring them to claim a ticket first would mean the organizer cannot
   * email the people they most need to email.
   *
   * Read in preference to the `users` record: this is the address the programme
   * committee actually corresponds with, and it may deliberately differ from
   * whichever address they later bought a ticket with.
   */
  contactEmail?: string;
}

/** `sessions/{sessionId}/materials/{id}` */
export interface SessionMaterialDoc {
  label: string;
  url: string;
  kind: "slides" | "paper" | "video" | "link" | "other";
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

/** `users/{uid}/savedSessions/{sessionId}` — the personal agenda. */
export interface SavedSessionDoc {
  sessionId: string;
  savedAt: Timestamp;
  /** Local notification / push reminder opt-in for this session. */
  remind: boolean;
}

/** `users/{uid}/savedContacts/{contactUid}` */
export interface SavedContactDoc {
  contactUid: string;
  note?: string;
  savedAt: Timestamp;
}

/**
 * `threads/{threadId}` — 1:1 conversation. `threadId` is the two uids sorted
 * and joined with `_`, so a pair maps to exactly one thread.
 *
 * ⚠️ **That is all the id guarantees. Membership is NOT derivable from it and
 * nothing may parse one.** `participantIds` below is the only answer to "who is
 * in this conversation", and the `messages` rules read it through a `get()` on
 * this document — one of only four `get()`s in `firestore.rules`, and
 * deliberate. This docblock previously claimed the opposite, that membership was
 * provable from the path and that the rules therefore avoided that `get()`;
 * both halves were false. `threadIdFor()` in `collections.ts` carries the full
 * history and the reason it is the worst bug this repo has had.
 */
export interface ThreadDoc {
  eventId: string;
  participantIds: string[];
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  lastSenderId?: string;
  /** Unread count per participant uid. */
  unread: Record<string, number>;
}

/** `threads/{threadId}/messages/{id}` — immutable once sent. */
export interface MessageDoc {
  senderId: string;
  body: string;
  sentAt: Timestamp;
}

/** `communityPosts/{id}` */
export interface CommunityPostDoc extends BaseDoc {
  authorId: string;
  /**
   * One of `COMMUNITY_CATEGORIES`, which also carries the name each id is
   * printed under. The union used to be spelled out here and the labels lived
   * in three separate consts; see `community.ts` for why they are one list now.
   */
  category: CommunityCategory;
  title: string;
  body: string;
  editedAt?: Timestamp;
  status: "visible" | "hidden" | "removed";
  /** Maintained by a Cloud Function trigger; never client-writable. */
  replyCount: number;
  /** Maintained by a Cloud Function trigger; never client-writable. */
  reactionCount: number;
}

/**
 * `communityPosts/{postId}/reactions/{uid}` — one document per reacting user.
 *
 * A subcollection rather than a map on the post, because security rules cannot
 * verify that a writer only touched their own entry inside an array or nested
 * map. Keying by uid makes "you may only write your own reaction" trivially
 * enforceable.
 */
export interface PostReactionDoc {
  uid: string;
  emoji: string;
  createdAt: Timestamp;
}

/**
 * `communityPosts/{postId}/replies/{id}`
 *
 * `status` exists so an organizer can moderate. Without it a reply can only be
 * edited by its own author and never removed, which means an abusive reply on a
 * board read by 1,000 attendees has no remedy at all — posts and questions both
 * have a moderation path and replies were the gap.
 *
 * Soft, like everything else here: hiding a reply must not orphan the counter a
 * trigger derives from it.
 */
export interface CommunityReplyDoc {
  authorId: string;
  body: string;
  editedAt?: Timestamp;
  status: 'visible' | 'hidden' | 'removed';
  createdAt: Timestamp;
}

/** `sessions/{sessionId}/questions/{id}` — live Q&A. */
export interface SessionQuestionDoc {
  eventId: string;
  authorId: string;
  body: string;
  editedAt?: Timestamp;
  /** Maintained by a Cloud Function trigger; never client-writable. */
  upvoteCount: number;
  state: "pending" | "approved" | "answered" | "hidden";
  answered: boolean;
  createdAt: Timestamp;
}

/**
 * `sessions/{sessionId}/questions/{questionId}/upvotes/{uid}` — one document
 * per upvoter. A subcollection for the same reason as post reactions: an array
 * of uids cannot be safely written by many users at once.
 */
export interface QuestionUpvoteDoc {
  uid: string;
  createdAt: Timestamp;
}

/**
 * `sessions/{sessionId}/qaBoard/current` — the ranked board, materialised.
 *
 * Every client watching a keynote Q&A would otherwise hold a live listener on
 * the whole question collection and re-render on every upvote. At ~1,000
 * concurrent that is roughly 40M reads per keynote and ten snapshot callbacks a
 * second into a thousand React Native clients. One debounced document is ~1.35M
 * reads and 50× fewer re-renders. Rewritten at most once every five seconds.
 */
export interface QaBoardDoc {
  questions: {
    id: string;
    body: string;
    authorId: string;
    upvoteCount: number;
    state: SessionQuestionDoc["state"];
  }[];
  rebuiltAt: Timestamp;
}

/** `sessions/{sessionId}/polls/{id}` */
export interface PollDoc {
  eventId: string;
  question: string;
  /** Ids rather than bare strings so a tally survives an option being relabelled. */
  options: { id: string; label: string }[];
  /**
   * Keyed by option id, written only by the `tallyPoll` task.
   *
   * The votes themselves live in the `votes` subcollection, one document per
   * voter. An earlier design held them in a `Record<uid, number>` map on this
   * document: 1,000 voters against Firestore's ~1 write/sec/document limit
   * drained in 16 minutes 40 seconds, so under 10% of votes had landed when the
   * organizer read the result off the screen. One document per voter makes the
   * limit per-voter and irrelevant.
   */
  tallies: Record<string, number>;
  totalVotes: number;
  talliesUpdatedAt?: Timestamp;
  open: boolean;
  createdAt: Timestamp;
}

/** `sessions/{sessionId}/polls/{pollId}/votes/{uid}` — one writer per document. */
export interface PollVoteDoc {
  uid: string;
  optionIds: string[];
  createdAt: Timestamp;
}

/** `announcements/{id}` — organizer broadcast. */
export interface AnnouncementDoc extends BaseDoc {
  title: string;
  body: string;
  authorId: string;
  /** Also delivered over FCM, as a topic broadcast rather than per-device writes. */
  push: boolean;
}

/** `users/{uid}/notifications/{id}` — per-attendee inbox. Written by functions. */
export interface NotificationDoc {
  type: "message" | "announcement" | "session-reminder" | "agenda-change";
  title: string;
  body?: string;
  href?: string;
  read: boolean;
  createdAt: Timestamp;
}

/**
 * `users/{uid}/fcmTokens/{token}` — one document per device the attendee has
 * installed the app on.
 */
export interface PushTokenDoc {
  token: string;
  platform: "ios" | "android" | "web";
  /** Human-readable device name, so a user can revoke the right one. */
  deviceName?: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Sponsors
// ---------------------------------------------------------------------------

/** `sponsors/{id}` */
export interface SponsorDoc extends BaseDoc {
  name: string;
  tier: SponsorTier;
  logoURL?: string;
  description?: string;
  website?: string;
  boothLocation?: string;
  offers?: string[];
  downloads?: { label: string; url: string }[];

  /**
   * The person the organizer actually deals with.
   *
   * Whova's Sponsor Manager renders a "Main Contact" caption on every row and
   * its Message Sponsors screen mails exactly this address. Both were missing
   * here, which meant a sponsor record described a *logo* rather than a
   * relationship — and chasing a missing logo is the single commonest reason to
   * contact a sponsor at all.
   *
   * Optional because the sponsor list is imported from the sales spreadsheet and
   * arrives incomplete. `resolveAudience` counts anyone without an address as
   * excluded and the screen says so, rather than quietly mailing fewer people
   * than it claims.
   */
  contactName?: string;
  contactEmail?: string;
}

/** `sponsors/{sponsorId}/leads/{uid}` — attendee requested info. */
export interface SponsorLeadDoc {
  uid: string;
  name: string;
  email: string;
  message?: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// On-site operations
//
// Modelled now, built later (WP Phase 3). These carry no data and no UI, but
// their *paths* encode the idempotency the on-site flows depend on, and that is
// the part which is expensive to retrofit.
// ---------------------------------------------------------------------------

/** `checkInLists/{id}` — the door, or a session door, or a workshop. */
export interface CheckInListDoc extends BaseDoc {
  name: string;
  kind: "event" | "session" | "meal" | "workshop";
  sessionId?: string;
  opensAt?: Timestamp;
  closesAt?: Timestamp;
}

/**
 * `checkInLists/{listId}/checkIns/{registrationId}` — deliberately keyed by
 * registration, so a second scan at a different station is a `create` that fails
 * with `already-exists`. That failure *is* the duplicate check; there is no
 * read-then-write race to lose.
 */
export interface CheckInDoc {
  registrationId: string;
  checkedInAt: Timestamp;
  stationId: string;
  operatorUid?: string;
}

/**
 * `scanEvents/{deviceId}_{clientScanId}` — the raw append-only scan log.
 *
 * The composite id makes an offline queue safe to replay: a station that loses
 * the network keeps scanning locally and re-sends everything on reconnect, and
 * the duplicates land on the same ids.
 */
export interface ScanEventDoc {
  eventId: string;
  deviceId: string;
  clientScanId: string;
  qrSecret: string;
  listId: string;
  scannedAt: Timestamp;
  syncedAt?: Timestamp;
  result: "ok" | "duplicate" | "unknown" | "cancelled";
}

/** `checkInStations/{id}` */
export interface CheckInStationDoc extends BaseDoc {
  label: string;
  deviceId: string;
  lastSeenAt?: Timestamp;
}

/** `badgeTemplates/{id}` — the renderer's input. No visual designer is planned. */
export interface BadgeTemplateDoc extends BaseDoc {
  name: string;
  widthMm: number;
  heightMm: number;
  /** Raw ZPL with `{{field}}` placeholders, sent to the printer over TCP:9100. */
  zplTemplate: string;
  fields: string[];
}

/** `badgePrintJobs/{id}` */
export interface BadgePrintJobDoc {
  eventId: string;
  registrationId: string;
  templateId: string;
  stationId: string;
  status: "queued" | "printed" | "failed" | "reprint";
  requestedAt: Timestamp;
  printedAt?: Timestamp;
  error?: string;
}

// ---------------------------------------------------------------------------
// Commerce — ours now. Ticketing came in-house in August 2026.
//
// This block used to be headed "modelled, not built — ticketing stays external
// for 2027", and every shape below was sized for *mirroring* someone else's
// records. It is now the authoring model: the website sells against
// `ticketTypes`, Stripe Checkout and Stripe Invoicing both write `orders`, and
// the organizer dashboard reads and refunds them. Two consequences follow, and
// both are load-bearing.
//
// **Money is integer minor units, everywhere, with no exceptions.** Not one
// field below is a float. `119900` is unambiguous; `1199.00` is a rounding bug
// waiting for its first currency conversion.
//
// **Fields added in the in-house move are optional.** Orders written by the
// external-mirror era are still in Firestore and have none of them, so a
// required field here would be a type that lies about documents that exist.
// Readers default (`refundedCents ?? 0`); they do not assume.
// ---------------------------------------------------------------------------

/** Whova sells three parallel catalogues. Only `attendee` is wired today. */
export type TicketAudience = "attendee" | "exhibitor" | "sponsor";

/**
 * `ticketTypes/{id}` — the catalogue the website renders and Checkout charges.
 *
 * The document id **is** the tier slug (`all-access`, `main-conference`), not a
 * generated id. That is deliberate: the id travels in a URL (`/tickets?tier=…`),
 * in Checkout metadata and in `OrderLine.ticketTypeId`, and a human-readable
 * one makes a Stripe dashboard row legible a year later. It also makes the
 * seeder idempotent for free — re-seeding rewrites the same four documents.
 */
export interface TicketTypeDoc extends BaseDoc {
  name: string;
  /** Minor units. Never a float — this is money. */
  priceCents: number;
  currency: string;
  includesVideoLibrary: boolean;
  includesWorkshops: boolean;

  /** One line under the price on the tickets page. */
  tagline: string;
  /** Flat bullet list, used wherever `groups` is absent. */
  includes: string[];
  /** The same contents grouped as the live site's two headline panels group them. */
  groups?: { heading: string; items?: string[] }[];
  inPerson: boolean;
  /** Rendered with more emphasis on the tickets page. */
  featured?: boolean;
  /**
   * Hidden tiers stay purchasable by direct link but do not render in the
   * catalogue — which is how a comp tier or a late speaker rate works without
   * a separate code path.
   */
  visible: boolean;
  sortOrder: number;
  audience: TicketAudience;

  /**
   * Capacity. `quantityTotal` absent means unlimited, which is the honest
   * default — a conference that has not decided its cap should not have this
   * file inventing one.
   */
  quantityTotal?: number;
  /**
   * Incremented on fulfilment, never decremented on refund.
   *
   * ⚠️ This is a **sold counter, not an inventory lock.** Firestore gives no
   * way to reserve a seat across the Checkout redirect, so two buyers can pass
   * the capacity check and both pay. At KGC's volumes the correct response to
   * that is a refund and an apology, not a distributed lock; if a tier ever
   * genuinely sells out, close it in the dashboard rather than trusting this
   * number to do it.
   */
  quantitySold: number;

  /**
   * The sales window, as instants. These are what the website evaluates.
   *
   * ⚠️ Derived, exactly as `SessionDoc.startsAt` is. The authoring truth is
   * `salesOpenAtLocal` / `salesCloseAtLocal` below, and the derivation happens
   * server-side in `salesTimeZone`. An early-bird deadline typed as 23:59 and
   * parsed with a bare `new Date()` closes at 19:59 Eastern on a UTC host —
   * four hours of sales gone, with nothing on any screen saying so.
   */
  salesOpenAt?: Timestamp;
  salesCloseAt?: Timestamp;
  /** `YYYY-MM-DDTHH:mm` wall clock in `salesTimeZone`. What was typed. */
  salesOpenAtLocal?: string;
  salesCloseAtLocal?: string;
  /**
   * Absent on tiers written before the window carried a zone. Read it as
   * `TIME_ZONE` — that is what the machine that wrote them was set to, and it
   * is the only zone this event has ever sold in.
   */
  salesTimeZone?: string;

  /**
   * Stripe's tax code. `txcd_20030000` ("General – Services") is what Stripe's
   * own ticketing guide specifies for admission. Stored per tier rather than
   * hard-coded at the call site because a workshop and a video-library add-on
   * are not necessarily the same product for tax purposes.
   */
  taxCode: string;
}

/**
 * One line on an order. A quantity of seats at one price, from one tier.
 *
 * `attendeeEmail` is per line rather than per order because a company buying
 * four seats names four different people, and each of those becomes its own
 * registration keyed on its own address.
 */
export interface OrderLine {
  ticketTypeId: string;
  /** Denormalised: the tier may be renamed or deleted after the sale. */
  ticketTypeName: string;
  quantity: number;
  unitPriceCents: number;
  attendeeName?: string;
  attendeeEmail?: string;
}

/**
 * `orders/{id}` — one purchase, however it was paid.
 *
 * The id is a hash of the Stripe object that caused it (Checkout Session, or
 * invoice-plus-seat-index), so a webhook replay rewrites one document instead
 * of creating a second. See `orderIdFor()` in `apps/web/src/lib/registrations.ts`.
 */
export interface OrderDoc extends BaseDoc {
  externalId: string;
  provider: "cvent" | "stripe" | "tito" | "manual";
  /**
   * How the money was taken. `demo` is the no-Stripe-account fallback and is
   * the reason this field exists at all: a demo order must be impossible to
   * mistake for a real one in an export, and `status: 'pending'` alone does not
   * say *why* it is pending.
   */
  channel?: "checkout" | "invoice" | "manual" | "demo";
  email: string;
  buyerName?: string;
  /** Set when finance, not the attendee, is the counterparty. */
  companyName?: string;
  /**
   * `partially_refunded` is separate from `refunded` because they mean
   * different things at the door: a partial refund (one seat of four) leaves a
   * valid ticket, a full one does not.
   */
  status: "paid" | "refunded" | "partially_refunded" | "pending" | "cancelled";

  items?: OrderLine[];
  subtotalCents?: number;
  taxCents?: number;
  discountCents?: number;
  totalCents: number;
  /** Cumulative. Absent on legacy documents; read as `?? 0`. */
  refundedCents?: number;
  currency: string;

  purchasedAt: Timestamp;
  refundedAt?: Timestamp;

  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeInvoiceId?: string;
  /** The page finance pays on. Kept so the dashboard can re-send a link. */
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
  /** Printed on the invoice; the commonest reason finance rejects one. */
  poNumber?: string;
  dueAt?: Timestamp;

  /** Stripe's code, if the buyer used one. The coupon table lives in Stripe. */
  promotionCode?: string;

  /**
   * The tracked link this purchase came through, if any.
   *
   * Carried from `/r/{code}` into Checkout metadata and back out in the
   * webhook, because there is no other way across the Stripe redirect — the
   * buyer leaves our origin entirely, which is what keeps this project in PCI
   * SAQ A. Absent on every purchase that arrived directly, which is most of
   * them, and absent is *not* zero: it means unattributed, not organic.
   */
  campaignCode?: string;

  /** Every registration this order paid for, so refunds know what to withdraw. */
  registrationIds?: string[];

  /**
   * An organizer accepting a purchase order as payment, out of band.
   *
   * This is the deliberate escape hatch for "the PO is good enough" — and it is
   * an *organizer's* recorded decision, with a name attached, rather than the
   * code quietly treating unpaid as paid. Nothing else in the money path may
   * promote an invoice to `paid`.
   */
  markedPaidBy?: string;
  markedPaidAt?: Timestamp;
}

/**
 * `emailLog/{id}` — every transactional email attempted, sent or not.
 *
 * Exists because the commonest support question a conference gets is "I never
 * got my confirmation", and the only useful answers are "we sent it at 14:02,
 * check spam" or "we tried and the provider rejected it". Without a log the
 * answer is a shrug.
 *
 * Failures are recorded, not thrown. A send that fails must never fail the
 * webhook that triggered it — a non-2xx makes Stripe retry the event for ever
 * and eventually disable the endpoint, taking fulfilment down with it.
 */
export interface EmailLogDoc {
  eventId: string;
  to: string;
  template:
    | "purchase-confirmation"
    | "invoice-raised"
    | "refund-confirmation"
    /**
     * The six-digit sign-in code from `requestOtp`. The only row in this log
     * that records the delivery of a **credential**, which is why nothing about
     * it — not the subject, not `reason`, not `error` — may ever carry the code
     * itself: `emailLog` is readable by anyone who can read the collection, and
     * a sign-in code sitting in a diagnostic record is the same hole as one
     * sitting in a console log.
     *
     * It is also the only row whose *absence* breaks a user-facing flow rather
     * than a courtesy. A skipped receipt is an annoyance; a skipped sign-in
     * code is an attendee who cannot get in.
     */
    | "sign-in-code"
    /**
     * One recipient of an organizer's bulk message. Written once **per person**,
     * not once per campaign — "did Ada get it?" is the question this log exists
     * to answer, and a single row saying "sent to 45 speakers" cannot.
     */
    | "bulk-message";
  subject: string;
  status: "sent" | "failed" | "skipped";
  /** Resend's message id, for correlating with their dashboard. */
  providerId?: string;
  /** Present only on `failed`. The provider's message, not a stack trace. */
  error?: string;
  /** Why a send was skipped — usually "no RESEND_API_KEY configured". */
  reason?: string;
  orderId?: string;
  registrationId?: string;
  /** Groups every row of one bulk send, so a campaign can be counted. */
  campaignId?: string;
  /** Who pressed send. Absent on automated transactional mail. */
  actor?: string;
  at: Timestamp;
}

/**
 * `users/{uid}/entitlements/{id}` — what a ticket actually unlocks.
 *
 * Separate from the order so that a comp, a speaker grant and a purchase all
 * express the same thing, and so the video library can be gated without the app
 * knowing anything about money.
 */
export interface EntitlementDoc {
  eventId: string;
  kind: "video-library" | "workshop" | "session" | "meal";
  refId?: string;
  source: "order" | "comp" | "speaker" | "staff";
  grantedAt: Timestamp;
  expiresAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Auth — server-only. Written and read by requestOtp/verifyOtp (functions/SPEC.md
// #9-#10) with the Admin SDK; no client ever reads or writes these, and
// firestore.rules has no match block for either collection, so the default-closed
// posture denies every client path without needing an explicit `false` rule.
// ---------------------------------------------------------------------------

/**
 * `otpCodes/{id}` — id is a hash of the normalised email, computed the same
 * way by both functions so a request and its matching verify land on the
 * same document.
 */
export interface OtpCodeDoc {
  eventId: string;
  email: string;
  code: string;
  expiresAt: Timestamp;
  attempts: number;
  createdAt: Timestamp;
}

/** `rateLimits/{id}` — same id scheme as `otpCodes`, a fixed window per email. */
export interface RateLimitDoc {
  eventId: string;
  email: string;
  count: number;
  windowStart: Timestamp;
  updatedAt: Timestamp;
  /**
   * When a TTL policy may reap this document.
   *
   * Not decoration: without it the collection grows by one document per distinct
   * email address, forever, and the address space is the attacker's to choose.
   * The IP-keyed counters carry the same field under their own type in
   * `functions/src/lib/rate-limit.ts`.
   */
  expiresAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Settings, and the entities the remaining organizer screens need
//
// Added August 2026 while building out the dashboard. Everything here is
// authored by organizers through the console and read by the app or the public
// website — none of it is imported from anywhere.
// ---------------------------------------------------------------------------

/**
 * `settings/{key}` — a namespaced bag of organizer preferences.
 *
 * ── Why one collection and not a field on each feature ──────────────────────
 *
 * A third of Whova's remaining screens are settings forms: branding, post-event
 * access, code access, the emergency card. Each holds a handful of values that
 * only an organizer writes. Modelling each as its own collection would be a
 * dozen collections with one document in them; modelling them as fields on
 * `EVENT` would make every read of the event fetch all of it.
 *
 * So: one collection, keyed by a stable string, each holding a flat `values`
 * map.
 *
 * ── What changed, and why the shape is now typed ────────────────────────────
 *
 * This type used to say `values: Record<string, string | number | boolean |
 * null>` and argue that describing every key would produce a union edited on
 * every screen and therefore always slightly wrong. That was right while the
 * authoring screen was also the only reader. It stopped being right when the
 * website and the app were declared readers: a bag whose keys are known only to
 * the screen that wrote them is a bag no other install can read without
 * guessing, and guessing is what "the Branding Center saves and nothing
 * changes" actually was.
 *
 * The keys, shapes, defaults and — importantly — the register of which install
 * reads which field now live in `settings.ts` in this package, next to
 * `COLLECTIONS` and `EVENT_ID` and for the same reason.
 *
 * ⚠️ `values` is `Partial` because a cleared field is **deleted**, not stored as
 * `null`. Readers must apply `SETTINGS_DEFAULTS`, which is what
 * `readSettings()` does for them.
 */
export interface SettingsDoc<K extends SettingsKey = SettingsKey> extends BaseDoc {
  /** Matches the document id. Duplicated so a query result is self-describing. */
  key: K;
  values: Partial<SettingsValues[K]>;
  /** Who last changed it, for the same reason the audit log exists. */
  updatedBy?: string;
}

/**
 * `exhibitors/{id}` — a booth in the exhibition hall.
 *
 * Distinct from `SponsorDoc` even though the two overlap, because Whova treats
 * them as separate products with separate ticket catalogues and separate
 * messaging, and because they genuinely differ: a sponsor buys visibility, an
 * exhibitor buys floor space. An exhibitor has a booth number, staff passes and
 * a lead-scanning entitlement; a sponsor has a tier and a logo placement.
 */
export interface ExhibitorDoc extends BaseDoc {
  name: string;
  boothNumber?: string;
  logoURL?: string;
  description?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  /** How many staff passes the package includes. */
  passesAllocated?: number;
  passesUsed?: number;
  status: "confirmed" | "provisional" | "cancelled";
}

/**
 * `exhibitorListings/{exhibitorId}` — the exhibitor hall as an attendee sees it.
 *
 * ── Why this is a projection and not a filtered read of `exhibitors/{id}` ────
 *
 * Firestore rules decide whether a whole document may be read; they cannot
 * withhold a field. `ExhibitorDoc` above carries four things that must not
 * reach a thousand phones:
 *
 *   · `contactName` / `contactEmail` — the named individual who booked the
 *     booth. A readable exhibitor list is then a harvestable address list, which
 *     is the same threat `badge.ts` refuses to put in a QR code.
 *   · `passesAllocated` / `passesUsed` — the size of the package each exhibitor
 *     bought, and how much of it they have burned. Commercial terms.
 *   · `status` — `provisional` is a space promised in a sales conversation that
 *     nobody has paid for. Publishing the pipeline is not the app's business.
 *
 * So the app reads this instead, exactly as it reads `directory/{uid}` rather
 * than `users/{uid}`. The document id is the exhibitor id, so a listing and its
 * source cannot drift apart.
 *
 * ── Absent rather than filtered ─────────────────────────────────────────────
 *
 * A cancelled or provisional exhibitor has **no listing document at all**,
 * mirroring what opting out of the directory does. Nothing about them leaves
 * the server, which is a stronger guarantee than any client-side filter — and
 * it is why this type carries no `status` field to filter on.
 *
 * ⚠️ Nothing in this repo writes these documents on the live project yet except
 * `seed-demo.ts`. The production writer is a trigger on `exhibitors/{id}`,
 * shaped like `mirrorDirectory`; until it exists the hall is as fresh as the
 * last seed. The app renders what is here and claims nothing more.
 */
export interface ExhibitorListingDoc extends BaseDoc {
  /** Matches the document id and the `exhibitors/{id}` this was projected from. */
  exhibitorId: string;
  name: string;
  /**
   * Denormalised from the exhibitor record, which denormalises it from
   * `booths`. The number is all the app needs; the floor plan itself stays
   * server-only, because a booth document carries an order id, a ticket type
   * and a `held`-but-unpaid state.
   */
  boothNumber?: string;
  logoURL?: string;
  description?: string;
  website?: string;
}

/**
 * `gatherings/{id}` — a table, a room or a slot that people are placed into.
 *
 * ── Why round tables and meeting slots are one document ────────────────────
 *
 * A round table is a topic, a host, a cap and a time. A bookable meeting slot
 * is a room, an owner, a cap of two and a time. They differ in what they are
 * called and in nothing else, and Whova ships them as separate products only
 * because it grew them separately. Two collections here would mean two capacity
 * checks, two clash checks and two screens that drift.
 *
 * `kind` separates them for display and for nothing else.
 *
 * ── This is an organizer's plan, not an attendee-facing feature ────────────
 *
 * ⚠️ Nothing in the mobile app reads this. An attendee cannot see a table, join
 * one, or request a meeting — those need an app surface that does not exist.
 * What this *is* is the artefact an organizer actually produces: the table
 * cards that get printed, the room grid that goes on the wall, the list the
 * front desk works from. That is genuinely useful without an app, and claiming
 * more than that would be the defect class `AGENTS.md` records fourteen
 * instances of.
 *
 * `attendees` is therefore a list of names typed or picked by an organizer, not
 * a set of uids that signed up. Names rather than uids because half the people
 * at a sponsor meeting are not attendees at all.
 */
export interface GatheringDoc extends BaseDoc {
  kind: "round-table" | "meeting-slot";
  /** The topic, or what the meeting is about. */
  title: string;
  /** Whoever runs the table, or holds the booking. Free text — often not a user. */
  host?: string;
  /** `rooms/{id}`, when it is in a room the programme knows about. */
  roomId?: string;
  roomName?: string;
  /** Day key and local wall time, matching `SessionDoc` so the two can be compared. */
  day?: string;
  startsAtLocal?: string;
  endsAtLocal?: string;
  /**
   * Seats. Enforced when people are added — this is the one cap in the product
   * that a person, not a race, could exceed, so refusing is cheap and correct.
   */
  capacity: number;
  /** Placed by an organizer. Names, not uids — see the docblock. */
  attendees: string[];
  notes?: string;
  status: "planned" | "confirmed" | "cancelled";
}

/**
 * `users/{uid}/gatherings/{gatheringId}` — one attendee's own seat.
 *
 * ── Why a projection rather than letting a phone read `gatherings` ──────────
 *
 * The paragraph above says nothing in the app reads `gatherings`, and the
 * reason is not that nobody wanted it: an attendee genuinely needs to know
 * which table they were placed at. It is that the plan document cannot be
 * handed over. It carries `attendees` — every other name at that table, half of
 * them people with no ticket and no account — and `notes`, which is where the
 * reason somebody was seated away from somebody else gets written, and
 * `status: 'planned'`, a table that has been sketched and not agreed. Rules
 * filter documents and not fields, so there is no version of "read your own
 * seat" that does not also read the eleven names beside it. This is the same
 * answer `directory` gives for `users` and `exhibitorListings` gives for
 * `exhibitors`.
 *
 * ── ⚠️ Nothing writes this, and the reason is a real modelling gap ─────────
 *
 * `GatheringDoc.attendees` is a list of **names typed by an organizer**, not
 * uids — deliberately, because half the people at a sponsor meeting are not
 * attendees. That leaves a mirror with no join key. Matching a typed name
 * against `UserDoc.name` would seat the wrong Chen at the wrong table, and a
 * confidently wrong seat is worse than no seat: somebody walks to a room where
 * they are not expected while the person who was placed there is told nothing.
 *
 * So the writer is a follow-up and it needs the plan to carry a uid first —
 * an organizer picking an attendee from the directory rather than typing a
 * name, with free text kept for the guests who have no account. Until then the
 * app's reader returns nothing and the screen renders nothing, which is absence
 * rather than a claim.
 *
 * Written server-side when it exists, like every other projection here.
 */
export interface GatheringPlacementDoc {
  eventId: string;
  /** `gatherings/{id}` this came from, so the plan and the seat stay joinable. */
  gatheringId: string;
  kind: GatheringDoc["kind"];
  title: string;
  host?: string;
  roomName?: string;
  day?: string;
  startsAtLocal?: string;
  endsAtLocal?: string;
  /**
   * The name the organizer actually typed into the plan. Carried so the
   * attendee can tell "that is me, spelled the way the table card spells it"
   * from "somebody with my name" — the placement is a mirror of a hand-typed
   * list, and printing the source string is what makes a mismatch visible
   * rather than mysterious.
   */
  seatName?: string;
  /**
   * Mirrored rather than filtered on the way out. A cancelled table is the one
   * status an attendee most needs, and dropping the document would tell them
   * only that their seat had stopped existing.
   */
  status: GatheringDoc["status"];
}

/**
 * `contacts/{id}` — somebody an organizer wants to email who is not an attendee.
 *
 * ── Why this is not `users` or `registrations` ──────────────────────────────
 *
 * A contact has not bought anything and may never sign in. Last year's
 * delegates, a partner association's list, everyone who filled in the "notify
 * me" form: these are prospects, and folding them into `registrations` would
 * put people who hold no ticket into the collection that decides who gets
 * through the door. It would also make "how many attendees do we have?"
 * unanswerable.
 *
 * The id is `contact_` + sha256 of the lower-cased address, the same derivation
 * `registrations` uses. Importing the same CSV twice therefore converges on one
 * document per person rather than doubling the list, and re-importing an
 * updated file is the normal way to correct a name.
 *
 * ── `unsubscribedAt` is the field that keeps the sending domain alive ───────
 *
 * ⚠️ A conference that mails people who asked it to stop gets its domain
 * blocked, and the damage lands on the transactional mail — the receipts and
 * claim codes — not on the newsletter. So this is checked before every bulk
 * send, and an unsubscribed contact is excluded rather than merely hidden.
 * Nothing anywhere may clear it except an explicit re-subscribe.
 */
export interface ContactDoc extends BaseDoc {
  email: string;
  name?: string;
  company?: string;
  /** Where the address came from. Free text, because provenance always is. */
  source?: string;
  /**
   * Named lists this contact belongs to. An array rather than one list id
   * because the same person is legitimately on "KGC 2026 attendees" and
   * "workshop waitlist", and duplicating them to express that is how a person
   * receives the same email twice.
   */
  lists: string[];
  /** Set once, never cleared except by a deliberate re-subscribe. */
  unsubscribedAt?: Timestamp;
  /**
   * A hard bounce. Kept separate from an unsubscribe because they mean
   * different things: one is a person's decision, the other is a dead mailbox,
   * and only the first is permanent from the recipient's side.
   */
  bouncedAt?: Timestamp;
  /** True once this address appears in `registrations` — computed at import. */
  converted?: boolean;
}

/**
 * `campaignLinks/{code}` — one tracked link.
 *
 * A short code that redirects to a page on the marketing site, counting the
 * click on the way through. Whova splits this across three screens — Campaign
 * Link Tracking, Referral Contest, Social Sharing — and they are one mechanism
 * with three reasons for existing, so they are one document with an `owner`.
 *
 * ── The code is the id ──────────────────────────────────────────────────────
 *
 * `campaignLinks/spring-mail` rather than a generated id, so the public URL is
 * `/r/spring-mail` — readable in an email, and idempotent to re-create.
 *
 * ── Counting happens without a Cloud Function ───────────────────────────────
 *
 * The redirect route runs on the server with the Admin SDK, so it increments
 * the counter itself. That matters: the project is on the Spark plan and this
 * would otherwise be one more thing waiting on Blaze.
 *
 * `clicks` is raw hits, not unique visitors. Deduplicating would mean storing
 * something per visitor, which is a tracking cookie with a retention question
 * attached — and for deciding whether an email worked, the raw number compared
 * against other links is enough.
 */
export interface CampaignLinkDoc extends BaseDoc {
  /** The short code. Matches the document id. */
  code: string;
  /** Path on the marketing site, always relative — never an absolute URL. */
  destination: string;
  /** What this link is for, in an organizer's words. */
  label: string;
  /**
   * Who gets credit. A speaker's name for a referral contest, a partner's for
   * co-marketing, absent for a plain campaign link. This is the only thing
   * separating Campaign Link Tracking from Referral Contest.
   */
  owner?: string;
  /** Which surface it was made for: "email", "linkedin", "partner". */
  channel?: string;
  clicks: number;
  lastClickedAt?: Timestamp;
  /** Set to stop counting without deleting the history. A dead link 404s. */
  active: boolean;
}

/**
 * `booths/{id}` — one sellable space on the exhibition floor.
 *
 * Whova prices an exhibitor package *per booth size* and then allocates a
 * specific space afterwards, and those really are two decisions: the catalogue
 * is priced months before the venue confirms a floor plan. So a `ticketTypes`
 * entry sells "a 3m × 2m booth" and this document is the particular one an
 * exhibitor ends up standing in.
 *
 * ── Why the assignment lives here and not on the exhibitor ──────────────────
 *
 * A booth has exactly one occupant and an exhibitor may hold several (a premium
 * booth plus an overflow table is normal). Storing `boothNumber` on the
 * exhibitor — which `ExhibitorDoc` also does, for display — cannot express the
 * second case and cannot answer "which spaces are still free?" without reading
 * every exhibitor. Occupancy is a property of the space.
 *
 * `ExhibitorDoc.boothNumber` stays as a denormalised label for the app's
 * exhibitor list, written when an assignment is made. Nothing is ever decided
 * from it.
 *
 * ── The number is the id ────────────────────────────────────────────────────
 *
 * `booths/A12` rather than a generated id. Booth numbers are printed on floor
 * plans, spoken over radios and written on packing crates, so an opaque id
 * would need translating at every one of those moments. It also makes seeding
 * idempotent and makes a double-assignment a failed `create` rather than a
 * race.
 */
export interface BoothDoc extends BaseDoc {
  /** As printed on the floor plan: "A12". Matches the document id. */
  number: string;
  /** Free text, matching the package that sells it: "3m × 2m". */
  size: string;
  /** Which aisle or zone, for grouping a long list into something walkable. */
  zone?: string;
  /**
   * The package this space is sold as. Optional because a venue floor plan
   * arrives before the catalogue is finalised, and a booth with no package yet
   * is a real state rather than an error.
   */
  ticketTypeId?: string;
  /**
   * Occupancy. All three are absent on a free booth, and all three are written
   * together — a booth with an exhibitor but no order is how an allocation made
   * by hand becomes indistinguishable from one made by a purchase.
   */
  exhibitorId?: string;
  exhibitorName?: string;
  orderId?: string;
  assignedAt?: Timestamp;
  assignedBy?: string;
  /**
   * `held` is neither free nor sold: a space promised in a sales conversation
   * that has not been paid for. Without it an organizer either double-sells the
   * booth or marks it occupied and loses track of the fact that no money has
   * arrived.
   */
  status: "available" | "held" | "assigned" | "blocked";
  /** Why a booth is blocked — a pillar, a fire exit, the AV desk. */
  note?: string;
}

/**
 * `tasks/{id}` — the organizing team's own checklist.
 *
 * Whova calls this Projects & Checklists. It is the one feature in the console
 * that is not about attendees at all — it is about the six people running the
 * event remembering to book the AV company.
 *
 * `assignee` is a free-text name rather than a uid on purpose: half the people
 * on a conference checklist are volunteers and suppliers who will never hold an
 * account, and requiring one would mean the tasks that matter most cannot be
 * assigned to anybody.
 */
export interface TaskDoc extends BaseDoc {
  title: string;
  notes?: string;
  /** Groups tasks into Whova's project buckets. */
  project: string;
  assignee?: string;
  dueOn?: string;
  status: "todo" | "doing" | "done" | "blocked";
  /** Lower sorts first within a project. */
  order: number;
  completedAt?: Timestamp;
  completedBy?: string;
}

/**
 * `surveys/{id}` — session feedback and post-event surveys.
 *
 * One shape for both, because they differ only in what they are attached to:
 * a survey with a `sessionId` is session feedback, one without is an event
 * survey. Whova has them as separate screens and they share this document.
 */
export interface SurveyDoc extends BaseDoc {
  title: string;
  description?: string;
  /** Present for session feedback, absent for an event-wide survey. */
  sessionId?: string;
  questions: {
    id: string;
    prompt: string;
    kind: "rating" | "single" | "multi" | "text";
    /** Absent for `rating` and `text`. */
    options?: string[];
    required: boolean;
  }[];
  status: PublishStatus;
  opensAt?: Timestamp;
  closesAt?: Timestamp;
  /** Maintained by a trigger; unbuilt on Spark, so it may lag. */
  responseCount: number;
}

/** `surveys/{surveyId}/responses/{uid}` — one per respondent, keyed by uid. */
export interface SurveyResponseDoc {
  uid: string;
  /** Question id → answer. A rating is a number; multi is a joined string. */
  answers: Record<string, string | number>;
  submittedAt: Timestamp;
}

/**
 * `documents/{id}` — a file or link offered to attendees.
 *
 * ⚠️ `url` is a link, not an upload. Storage rules exist but no upload UI does,
 * so today an organizer pastes a URL to something hosted elsewhere. That is a
 * real limitation and the screen says so rather than implying a file picker
 * that is not there.
 */
export interface DocumentDoc extends BaseDoc {
  title: string;
  description?: string;
  url: string;
  kind: "pdf" | "slides" | "video" | "link";
  /** Restricts visibility to holders of a ticket type, by name. Empty = all. */
  visibleToTicketTypes: string[];
  sessionId?: string;
  status: PublishStatus;
  order: number;
}


// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Who a consent form is put to.
 *
 * Three audiences rather than one form for everybody, because the three
 * documents genuinely differ. An attendee agrees to appear in photographs of
 * the room. A speaker agrees to their talk being recorded and published, which
 * is a licence rather than a permission and is the one with money attached. A
 * volunteer agrees to a liability waiver.
 *
 * ⚠️ `volunteer` is modelled and **cannot currently be collected**: there is no
 * `volunteers` collection and no volunteer role anywhere in this project, so
 * there is no list of people to put the form to. The value exists so that
 * publishing a volunteer waiver does not require a schema change on the day
 * somebody builds the roster, and the volunteer screen says plainly that the
 * roster is what is missing.
 */
export type ConsentAudience = "attendee" | "speaker" | "volunteer";

/**
 * `consentForms/{id}` — a release, as published.
 *
 * ── Why the version is a field and not a guess ─────────────────────────────
 *
 * "Jane consented" is worth nothing without the wording Jane saw. A consent
 * store whose text can change after the fact records only that somebody once
 * pressed a button, which is why `version` and `bodyHash` are on both halves of
 * this pair: the form carries what is being asked *now*, and every response
 * carries what was asked *then*. Republishing changed wording increments
 * `version` and leaves every signature already given pointing at the version it
 * was actually given to — those people are then unsigned against the new one,
 * which is the correct and uncomfortable answer rather than a convenient one.
 *
 * `bodyHash` is sha256 of the exact body text. It is belt-and-braces beside the
 * version number and it is not redundant: the version is an organizer-visible
 * label that a bug or a hand-edit in the Firebase console could reuse, and the
 * hash is derived from the bytes. If the two ever disagree about what version 3
 * said, the hash is the one that was computed from the text somebody read.
 *
 * ── Server-authored, client-readable ───────────────────────────────────────
 *
 * Written only by the dashboard with the Admin SDK. `firestore.rules` gives
 * clients `get` on a published form and nothing else — an attendee has to be
 * able to read the wording in order to agree to it, and a draft is wording an
 * organizer is still arguing about.
 */
export interface ConsentFormDoc extends BaseDoc {
  title: string;
  /**
   * The agreement itself, as plain text. Blank lines separate paragraphs.
   *
   * Not HTML and not a Storage reference. HTML from a textarea into a page that
   * renders it is an injection into a page people are asked to trust, and the
   * Storage bucket for this project has never been created (`OWNER-ACTIONS.md`
   * §1) — a consent flow that depends on an upload path nobody can use is a
   * consent flow that collects nothing. Plain text is legible, hashable, and
   * diffable between versions.
   */
  body: string;
  /** 1 on first publication, then +1 on every change to `title` or `body`. */
  version: number;
  /** Lower-case hex sha256 of `body`, computed at publication. */
  bodyHash: string;
  audience: ConsentAudience;
  /**
   * Whether the conference expects everybody in the audience to sign.
   *
   * Advisory, deliberately: nothing in this project *blocks* on an unsigned
   * form — a ticket still scans, a session still runs. It sets what the
   * register counts as outstanding, and marking a release "required" while the
   * check-in desk ignores it would be the reassuring-microcopy failure
   * AGENTS.md names as this codebase's recurring defect.
   */
  required: boolean;
  status: PublishStatus;
  /** Set the first time it reaches `published`; never moved by a re-publish. */
  publishedAt?: Timestamp;
  /** Allowlisted organizer address, as `auditLog.actor` records it. */
  updatedBy?: string;
}

/**
 * `consentForms/{formId}/responses/{responseId}` — one signature.
 *
 * The id is `consentResponseId(signatory, formVersion)`; read its docblock in
 * `collections.ts` before changing anything here, because the append-only
 * guarantee is carried by the id, not by this shape.
 *
 * ── Nothing on this document may ever be updated ───────────────────────────
 *
 * `update` and `delete` are closed to every client in `firestore.rules`,
 * organizers included, and the dashboard has no write path either. A consent
 * record that can be edited afterwards is a consent record that proves nothing;
 * a withdrawal is therefore **not** an edit to this document and is not built —
 * see the note on the attendee screen, which says so rather than implying a
 * revocation flow that does not exist.
 */
export interface ConsentResponseDoc {
  formId: string;
  /** The version signed. Pinned to the form's current version by the rules. */
  formVersion: number;
  /** The hash of the text as it stood when signed. */
  bodyHash: string;
  audience: ConsentAudience;
  /**
   * The signatory in the vocabulary the id was built from: a Firebase uid for
   * somebody signing in the app, `spk_{speakerId}` for a speaker signing
   * through a capability link. Kept as a field as well as in the id because a
   * document that has to be parsed out of its own path to be understood is the
   * mistake `threadIdFor` made.
   */
  signatory: string;
  /** Present only when the signatory is a signed-in account. */
  uid?: string;
  /**
   * The address the link was sent to, or the account's own. The join key
   * everything else in this project uses — `registrations` to `users`,
   * `speakers` to both — so a register can say who has signed without a
   * membership table.
   */
  email: string;
  /**
   * The typed name. This *is* the signature, in the sense a scrawl on paper is:
   * evidence of a deliberate act by somebody who was shown the wording, not a
   * cryptographic proof of identity. Nothing here pretends otherwise.
   */
  signedName: string;
  /** Always true. A refusal is a form that was never submitted, not a `false`. */
  agreed: boolean;
  signedAt: Timestamp;
  /**
   * `app` — a signed-in client wrote it under `firestore.rules`.
   * `link` — the website wrote it with the Admin SDK after verifying an HMAC
   * capability token, for somebody with no account at all.
   *
   * On the record because the two carry different evidence, and a register that
   * showed them identically would overstate the weaker one.
   */
  channel: "app" | "link";
  /**
   * The first hop of `x-forwarded-for`, recorded for the `link` channel only.
   *
   * ⚠️ It is corroboration, not identification. It is the address of whatever
   * proxy or phone network the browser came through, it is trivially not the
   * signatory's if they used a VPN, and on the `app` channel it is absent
   * entirely — a client cannot be asked to report its own IP address, since a
   * client that can write the field can write any value into it. Present for a
   * link signature because there is no account there to corroborate anything
   * else, and absent where the uid already does that job better.
   */
  ip?: string;
  /** Truncated to 300 characters. Same standing as `ip`: corroboration only. */
  userAgent?: string;
}


// ---------------------------------------------------------------------------
// Call for abstracts
// ---------------------------------------------------------------------------

/**
 * The five shapes below are the call for abstracts (`CFA-PLAN.md` §2), and all
 * five are server-owned: `calls`, `submissions`, `submissions/{id}/identity`,
 * `submissions/{id}/reviews/{reviewerId}` and `reviewers` have **no `match`
 * block in `firestore.rules`** and must not get one. Every write is Admin-SDK,
 * through a server action, the same posture `orders` and `ticketTypes` have.
 *
 * That is not a precaution, it is the only arrangement that works. `CFA-PLAN.md`
 * §3: the gate for everything in the rules file is `isRegistered()`, the
 * `registered` custom claim, and it is minted only for ticket holders. A
 * prospective speaker holds no ticket and must not be given the claim — a call
 * for papers that requires a ticket is not a call for papers — and an external
 * reviewer who will sign in twice in their life is in the same position. Both
 * reach their own work through an HMAC capability token and a server action, the
 * scheme `scripts/src/lib/order-token.ts` and `consent-token.ts` already prove.
 * So there is no client identity here for a rule to evaluate, and a rule that
 * admitted anybody would be admitting *everybody*.
 *
 * `tests/rules/firestore.test.ts` asserts the absence, on both verbs, because
 * "secure because nobody wrote a rule" is a property a later edit can remove
 * without anyone noticing.
 */

/**
 * How much of an author a reviewer may see.
 *
 * `CFA-PLAN.md` §1.1: **build for double-blind, run single-blind by default.**
 * KGC is an applied-industry conference where affiliation is often load-bearing,
 * so hiding it by default would make the reviewing worse — but anonymity is not
 * a UI preference. It decides what the document a reviewer reads may contain,
 * and retrofitting that onto a flat submission is the rewrite this schema exists
 * to avoid. Hence `submissions/{id}/identity`: turning the blind up is then a
 * decision about which document the review screen loads.
 *
 * `open` is here because it is a real editorial choice for an industry track and
 * not a fourth state of "off"; it means the reviewer sees the identity document
 * and knows the author sees their name too.
 */
export type BlindReviewMode = "open" | "single-blind" | "double-blind";

/**
 * `CFA-PLAN.md` §2. Two fields carry the whole state machine and this is the
 * first of them.
 *
 * `draft` is not optional, and it is the one people leave out. Whova has an
 * Incomplete Submissions tab because most of the work of running a call is
 * chasing the people who started and stopped — a submission that only exists
 * once it is finished cannot be chased, and phase 2 of the plan is entirely
 * about chasing them.
 *
 * `withdrawn` is an author's own retraction and `rejected` is a decision; they
 * are separate values because a call's acceptance rate is a number somebody
 * will quote, and folding the two would quietly flatter it.
 */
export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "under-review"
  | "accepted"
  | "rejected"
  | "withdrawn";

/** Where a reviewer is in the invitation, before any submission is assigned. */
export type ReviewerStatus = "invited" | "accepted" | "declined" | "removed";

/**
 * A review exists from the moment of assignment, which is what makes
 * "who has not reviewed yet" answerable by a query rather than by subtraction.
 * `declined` is the conflict-of-interest exit: the assignment happened, the
 * reviewer said no, and the record of that has to survive so the same person is
 * not assigned the same submission again by the next run of the matcher.
 */
export type ReviewStatus = "assigned" | "submitted" | "declined";

/**
 * One question on a call's submission form.
 *
 * Structurally `QuestionFieldDef` with two differences, and the plan (§4, phase
 * 1) is explicit that the *builder and the validator* are shared with Question
 * Forms — "building them separately is how a codebase ends up with two". This is
 * the stored shape, not a second builder.
 *
 * The two differences each have a reason:
 *
 * · No `ticketTypeIds`. That field asks a question only of certain ticket tiers.
 *   A call has no tiers, and a conditional that can never be true is a field
 *   somebody eventually reads as if it worked.
 *
 * · A `description` kind — a block of prose that collects no answer, which a
 *   call needs ("your abstract will be read by three reviewers; 300 words") and
 *   a checkout form does not. It is added *here* rather than widened onto
 *   `QuestionFieldDef` deliberately: `apps/web`'s checkout renderer switches on
 *   `kind` with a text-input fallback, so widening the shared union would render
 *   an explanatory paragraph as an empty box on the payment page, and typecheck
 *   cleanly while doing it.
 */
export interface CallFormFieldDef extends Omit<QuestionFieldDef, "ticketTypeIds" | "kind"> {
  kind: QuestionFieldDef["kind"] | "description";
}

/**
 * A superseded version of a call's form, kept so an old submission can still be
 * read back.
 *
 * `CFA-PLAN.md` §1.2 versions the form rather than freezing it, which is the
 * whole reason this type exists: a submission stores the `formVersion` its
 * answers were given against, and rendering those answers needs the questions as
 * they stood *then*. Without the archive, `formVersion` is a number that names
 * nothing.
 *
 * An array on the call document rather than a subcollection, because a call
 * accumulates a handful of versions over its life and the portal reads the form
 * on every page load. If one ever approaches the 1 MB document ceiling the fix
 * is to move the archive underneath the call — never to drop the oldest entries,
 * because the entry that gets dropped is the one an early submission points at.
 */
export interface CallFormVersion {
  version: number;
  fields: CallFormFieldDef[];
  /** When this version stopped being the current one. */
  supersededAt: Timestamp;
}

/**
 * One line of the review rubric (`CFA-PLAN.md` §4, phase 3).
 *
 * `id` is stable for the life of the criterion and is the key scores are stored
 * under — the same rule `QuestionFieldDef.id` has, for the same reason:
 * rewording "Novelty" must not orphan every score already given to it.
 */
export interface RubricCriterionDef {
  id: string;
  label: string;
  /** What a reviewer is being asked to judge. Shown beside the scale. */
  description?: string;
  /** Inclusive. A 1–5 scale is `min: 1, max: 5`. */
  min: number;
  max: number;
  order: number;
}

/**
 * `calls/{slug}` — one call for abstracts.
 *
 * Keyed by a slug because the id is in a public URL (`/submit/{callId}`) that
 * goes on a poster and into a mailing. Nothing else is derived from it and
 * nothing parses it.
 */
export interface CallDoc extends BaseDoc {
  title: string;
  /**
   * What the call asks for, as plain text. Blank lines separate paragraphs.
   *
   * Not HTML, for the reason `ConsentFormDoc.body` gives: text typed into a
   * textarea and rendered into a public page is an injection into a page people
   * are asked to trust.
   */
  instructions: string;
  status: PublishStatus;

  /**
   * Local wall time is the authoring truth and the UTC instants are derived from
   * it, exactly as on `SessionDoc`. An organizer decides "30 September, 23:59 in
   * New York", not an instant, and if the offset rules change it is the instant
   * that should move rather than the deadline — a call that closes an hour early
   * because the clocks went back closes on somebody mid-abstract.
   */
  timeZone: string;
  /** `YYYY-MM-DDTHH:mm` wall clock in `timeZone`. */
  opensAtLocal: string;
  closesAtLocal: string;
  /** Derived UTC instants. Never authored directly. */
  opensAt: Timestamp;
  /**
   * ⚠️ **The deadline is enforced by the server action that accepts a
   * submission, or it is not enforced at all** (`CFA-PLAN.md` §4). There is no
   * rule to fall back on here — the collection has no `match` block — so a
   * closed call that only hides the button is a call anybody can still submit to
   * with a `curl`.
   */
  closesAt: Timestamp;

  /**
   * What a submitter may offer the work as.
   *
   * `SessionFormat` rather than free text, so an accepted submission carries a
   * format the agenda already understands. Phase 4 promotes accepted work into
   * `sessions/{id}`, and a translation table between two vocabularies is a
   * translation table that will one day be missing a row.
   */
  sessionTypes: SessionFormat[];
  /**
   * `tracks/{id}` ids, not names. Renaming a track then leaves every submission
   * still pointing at it, which is the same choice `SessionDoc.trackIds` makes.
   */
  trackIds: string[];

  /** The questions as they stand now. */
  form: CallFormFieldDef[];
  /**
   * The version `form` is at. Stamped onto every submission.
   *
   * §1.2: adding a question is allowed and leaves old submissions simply without
   * an answer for it; *changing or removing* one mints a new version and pushes
   * the old fields into `priorVersions`. Whova freezes the form outright once
   * one submission exists, which its own research notes call a known pain point
   * — brutal for a call that runs for months.
   */
  formVersion: number;
  /** Every superseded version, oldest first. Never pruned — see `CallFormVersion`. */
  priorVersions: CallFormVersion[];

  /** How the author is shown to a reviewer. See `BlindReviewMode`. */
  blindReview: BlindReviewMode;
  /** The criteria every review of this call is scored against. */
  rubric: RubricCriterionDef[];
  /** How many reviews each submission should collect. Three is the usual answer. */
  reviewsPerSubmission: number;

  /**
   * Days before `closesAt` at which incomplete submitters should be nudged —
   * `[14, 7, 3]` is the plan's suggestion (§4, phase 2).
   *
   * ⚠️ **Nothing sends these on a schedule.** Scheduled reminders want Cloud
   * Tasks, and everything in `functions/` is blocked on one IAM grant
   * (`OWNER-ACTIONS.md` §3). Until that lands this is the list of dates a
   * dashboard button is offered on, and the screen has to say so rather than
   * imply an automation that is not running.
   */
  reminderDaysBefore: number[];
  /** Addresses told about each new submission. Empty means nobody is told. */
  notifyEmails: string[];

  /** Allowlisted organizer address, as `auditLog.actor` records it. */
  updatedBy?: string;
}

/**
 * The decision on a submission — `CFA-PLAN.md` §2's second state-carrying field.
 *
 * **Absent until it is made**, which is the point of it being a map rather than
 * a pair of booleans: "undo this decision" is then a field delete, and there is
 * no way to represent the contradiction of an accepted-and-rejected submission.
 */
export interface SubmissionDecision {
  /** The organizer address that decided, as `auditLog.actor` records it. */
  by: string;
  at: Timestamp;
  /**
   * Which round of decisions this was. A committee that accepts twenty, waits
   * for confirmations and then goes back to the waiting list has made two
   * rounds, and the second one is not a correction of the first.
   */
  round: number;
}

/**
 * `submissions/{id}` — one abstract, minus its author.
 *
 * ── Nothing that identifies the author belongs on this document ─────────────
 *
 * Author name, affiliation, email and co-authors live in
 * `submissions/{id}/identity` (`CFA-PLAN.md` §1.1). That split *is* the blind
 * review: with it, showing or hiding an author is a decision about which
 * document the review screen loads, and without it the same feature is a
 * migration of every submission ever written.
 *
 * So the guarantee here is carried by the fields not existing, not by anything
 * filtering them — and the way it breaks is somebody adding
 * `authorName` "just for the list screen". That screen can read the identity
 * document; it already runs on the Admin SDK.
 *
 * ⚠️ The same trap has a subtler form: any field *derived* from a name is a name.
 * `speakerId` is `slug(name)` plus a hash, so it would hand a double-blind
 * reviewer the author in a field that does not look like one. It is on the
 * identity document for exactly that reason.
 *
 * ── Minted id ──────────────────────────────────────────────────────────────
 *
 * Server-minted and opaque, like `registrations`. The id is what a mailed
 * capability link resolves to, so an id anybody can compute is a link anybody
 * can forge.
 */
export interface SubmissionDoc extends BaseDoc {
  /** `calls/{callId}`. On every submission, so the schema supports two calls at once. */
  callId: string;
  title: string;
  /** Plain text, for the reason `CallDoc.instructions` gives. */
  abstract: string;
  /** One of the call's `trackIds`. Absent while the submission is still a draft. */
  trackId?: string;
  /** One of the call's `sessionTypes`. Absent while still a draft. */
  sessionType?: SessionFormat;
  /** Answers to the call's form, keyed by `CallFormFieldDef.id`. */
  answers: Record<string, string | string[] | boolean>;
  /**
   * The version of the call's form these answers were given against.
   *
   * `consentForms` already does exactly this and for the same reason: a record
   * that names no version records nothing that can be relied on later. There, a
   * `get()` in `firestore.rules` pins the version to what the form actually
   * published, because the signer is a client writing the document directly.
   * Here the reasoning is identical and the mechanism cannot be, because there
   * is no client write and no rules evaluation to hang it on — the submitter
   * holds a capability token, not an identity. **The server action that accepts
   * the write stamps this from the call it just read**, and it must never copy a
   * number the request supplied, or a submission can claim to have been asked
   * questions nobody ever published.
   */
  formVersion: number;

  status: SubmissionStatus;
  /**
   * Set the first time the submission leaves `draft`, and never restamped.
   *
   * An editor who fixes a typo after the deadline has not resubmitted, and a
   * `submittedAt` that moved would put them outside the call. This is the same
   * mistake the Stripe webhook must not make with `purchasedAt`.
   *
   * ⚠️ It is **absent on a draft**, and Firestore drops documents that lack the
   * ordering field from a query entirely. So the incomplete-submissions tab —
   * the whole of phase 2 — cannot order by this one: it orders by `updatedAt`,
   * which is also the more useful question there ("who touched this last, and
   * how long ago"). Both orderings have their own entry in
   * `firestore.indexes.json`, because JSON cannot hold this comment and the
   * emulator enforces neither.
   */
  submittedAt?: Timestamp;
  /** Absent until a decision is made. See `SubmissionDecision`. */
  decision?: SubmissionDecision;

  /**
   * Lower-case hex sha256 of the nonce inside the submitter's capability link.
   *
   * The token itself is an HMAC and verifies without a lookup, exactly as
   * `order-token.ts` does; what the stored hash buys is **revocation**. A link
   * mailed to the wrong address, or forwarded into a mailing list archive, can
   * be killed by rotating this field — where a pure HMAC over the submission id
   * can only be invalidated by rotating the secret for every submitter at once.
   * The plaintext token never reaches Firestore, so a database read is not a
   * set of working links into every draft in the call.
   */
  submitterTokenHash: string;

  /**
   * Review progress, maintained by the same server action that writes a review,
   * in the same transaction.
   *
   * Unlike `replyCount` and the other counters in this project these do **not**
   * wait on the IAM grant that blocks `functions/`: those exist because a
   * *client* writes the thing being counted and a trigger has to react to it.
   * Nothing here is client-written, so the writer can simply keep the count.
   */
  reviewsAssigned: number;
  reviewsSubmitted: number;
  /**
   * The mean of the submitted reviews' `overall` scores, absent until there is
   * one. Stored rather than computed because the ranking screen sorts on it and
   * Firestore cannot order by a value it does not hold.
   */
  scoreAverage?: number;

  /**
   * `sessions/{id}`, set when accepted work is promoted onto the agenda.
   *
   * Promotion is a deliberate step in Session Manager and not a side effect of
   * acceptance — Whova's marketing claims the opposite and its own help centre
   * corrects it (`CFA-PLAN.md` §4, phase 4), because scheduling is a decision
   * about rooms and times that acceptance does not make. This field is what
   * makes pressing the button twice harmless.
   */
  sessionId?: string;
}

/** A co-author, as typed by the submitter. Nothing here is verified. */
export interface SubmissionCoAuthor {
  name: string;
  affiliation?: string;
  /** Often absent — most submitters know a colleague's name and not their address. */
  email?: string;
}

/**
 * `submissions/{id}/identity/author` — who wrote it.
 *
 * A subcollection document rather than fields on the submission, and the id is
 * the constant `SUBMISSION_IDENTITY_DOC`, so the whole of blind review is which
 * of two documents a screen fetches. `CFA-PLAN.md` §1.1 is the argument; the
 * short form is that field-level redaction does not exist here — in the rules
 * because rules filter documents and not fields, and in the dashboard because a
 * projection somebody forgets to use is a projection that leaked.
 *
 * ⚠️ Firestore does not cascade deletes. Deleting a submission leaves this
 * document behind — an orphaned name, affiliation and address under a path
 * nothing lists. Withdrawal is a `status`, not a delete, for that reason among
 * others; anything that ever does hard-delete a submission must delete this
 * first.
 *
 * `eventId` is here, on a subcollection document that does not extend `BaseDoc`,
 * because this is one of the two paths in the call queried as a **collection
 * group** — "has this person submitted before?", asked across every submission —
 * and a collection-group query with no `eventId` to lead on is a query that
 * silently spans KGC 2027 and KGC 2028.
 */
export interface SubmissionIdentityDoc {
  eventId: string;
  /** The parent's id, so this document is legible without being parsed out of its path. */
  submissionId: string;
  callId: string;
  name: string;
  /**
   * Lower case, always. The join key everything in this project already uses —
   * `registrations` to `users`, `speakers` to both — so an accepted author can
   * be matched to a ticket without a membership table, and so the phase-2
   * incompletes screen can search on it.
   */
  email: string;
  affiliation?: string;
  coAuthors: SubmissionCoAuthor[];
  /** Offered to the programme committee, and reused as the speaker bio on acceptance. */
  bio?: string;

  /**
   * `speakers/{id}`, once this author has been promoted onto the agenda.
   *
   * Written by the phase-4 promotion step, which computes it with the existing
   * `speakerId(name, company)` so an author who is already a speaker updates
   * that document rather than appearing twice on the public page.
   *
   * On *this* document rather than on the submission because `speakerId` is
   * `slug(name)` plus a hash of name and company — it is the author's name in a
   * field that does not look like one, and a double-blind reviewer reading the
   * submission must not be handed it.
   */
  speakerId?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * `submissions/{id}/reviews/{reviewerId}` — one reviewer's verdict.
 *
 * Keyed by the `reviewers/{id}` document id, so one reviewer holds at most one
 * review of a submission and a double assignment is a `create` that fails with
 * `already-exists` — the mechanism `checkIns`, `scanEvents` and the consent
 * register all use, rather than a read-then-write race to lose.
 *
 * The document is created **at assignment**, carrying `status: 'assigned'` and
 * no scores. That is what makes reviewer progress a query rather than a
 * subtraction, and it is what "hide other reviewers' scores until yours is
 * entered" (`CFA-PLAN.md` §4, phase 3) is decided from: the server action reads
 * the caller's own review first and refuses to send the others until it says
 * `submitted`. That rule is server-side or it is decoration.
 *
 * `eventId` is present for the same reason it is on the identity document: a
 * reviewer's queue is a collection-group query across every submission.
 */
export interface ReviewDoc {
  eventId: string;
  submissionId: string;
  callId: string;
  /** `reviewers/{id}` — also this document's id, kept as a field so it reads on its own. */
  reviewerId: string;
  status: ReviewStatus;

  /**
   * Score per `RubricCriterionDef.id`. Keyed by criterion id rather than by
   * label, so renaming a criterion does not orphan the scores given to it.
   * Absent while `status` is `assigned`.
   */
  scores?: Record<string, number>;
  /**
   * The mean of `scores`, stored because the ranking screen sorts on it and
   * Firestore cannot order by a value it does not hold. Written when the review
   * is submitted, from the rubric in force at that moment.
   */
  overall?: number;
  /**
   * Confidence in the assessment, 1–5. A reviewer who says "outside my field"
   * is telling the committee something a low score does not.
   */
  confidence?: number;

  /**
   * Comments for the committee only. These are never shown to an author, which
   * is why they are a separate field from the ones that are — one textarea
   * doing both jobs is how a private remark about a submitter ends up in the
   * rejection mail.
   */
  commentsToCommittee?: string;
  /** Comments the committee may forward to the author with the decision. */
  commentsToAuthors?: string;

  /**
   * Declared conflict of interest — same institution, a co-author, a former
   * student. The assignment is then excluded from the averages rather than
   * deleted, so the matcher does not hand the same submission back tomorrow.
   */
  conflict: boolean;
  conflictNote?: string;

  /**
   * How this assignment was made. Recorded because "random" is the one an
   * organizer will be asked to justify, and a draw nobody can reconstruct is a
   * draw somebody will suspect.
   */
  assignedBy?: "manual" | "topic" | "random";
  assignedAt: Timestamp;
  submittedAt?: Timestamp;
  updatedAt: Timestamp;
}

/**
 * `reviewers/{id}` — somebody who scores submissions.
 *
 * Deliberately **not** a `users` document (`CFA-PLAN.md` §2): a reviewer need
 * not hold a ticket, and most external academics on a programme committee never
 * buy one. Making them a user would mean either minting the `registered` claim
 * for somebody who is not registered — the claim's whole meaning is that it is
 * not given away — or a second kind of user document that half the app's queries
 * would then have to know about.
 *
 * They reach their queue through a capability link, the same scheme the
 * submitter uses. If reviewers ever do need a real session they become a
 * `roles: ['reviewer']` claim, which `Role` already carries and
 * `scripts/src/set-claims.ts` already mints; `uid` below is where that would
 * land, and nothing yet writes it.
 */
export interface ReviewerDoc extends BaseDoc {
  name: string;
  /** Lower case. The join key, and the address the invitation went to. */
  email: string;
  affiliation?: string;
  /**
   * The tracks this reviewer covers, as `tracks/{id}` ids rather than free text.
   *
   * Assignment "by topic" matches on these, and free-text topics make that
   * matcher silently return nothing for a reviewer who typed "Knowledge Graphs"
   * where the call says "Knowledge Graph Engineering" — a mismatch that looks
   * exactly like a reviewer with no expertise.
   */
  trackIds: string[];
  status: ReviewerStatus;

  invitedAt?: Timestamp;
  respondedAt?: Timestamp;
  /**
   * Lower-case hex sha256 of the nonce in the reviewer's capability link. Same
   * shape and the same revocation argument as `SubmissionDoc.submitterTokenHash`
   * — and it matters more here, because this link opens somebody else's
   * unpublished work.
   */
  inviteTokenHash: string;

  /**
   * The most submissions this reviewer is willing to take.
   *
   * ⚠️ **Nothing enforces this.** No assignment action exists yet, so it is a
   * stated intent that the assignment screen should respect — the same standing
   * `SessionDoc.capacity` has, and recorded here in the same words so that
   * nobody later reads it as a limit that is already being applied.
   */
  maxAssignments: number;
  /** Assignments actually made, kept by the assignment action in the same write. */
  assignedCount: number;
  /** Set only if this reviewer is ever given a real account. See the docblock. */
  uid?: string;
}
