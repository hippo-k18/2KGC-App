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

export type SponsorTier = "diamond" | "platinum" | "gold" | "silver" | "startup";
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
  /** Absent means uncapped; enforced in a transaction, not by rules. */
  capacity?: number;
}

/** `speakers/{id}` */
export interface SpeakerDoc extends BaseDoc {
  name: string;
  photoURL?: string;
  title?: string;
  company?: string;
  bio?: string;
  social?: { linkedin?: string; x?: string; website?: string };
  sessionIds: string[];
  /** Set when the speaker also holds a ticket, so the two identities join up. */
  userId?: string;
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
 * and joined with `_`, so a pair maps to exactly one thread. That also makes
 * membership provable from the path alone, which is what lets the `messages`
 * rules avoid a `get()` on this document on every read.
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
  category:
    | "meetup"
    | "ride-share"
    | "jobs"
    | "questions"
    | "lost-and-found"
    | "ice-breakers";
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
// Commerce — modelled, not built. Ticketing stays external for 2027.
// ---------------------------------------------------------------------------

/** `ticketTypes/{id}` */
export interface TicketTypeDoc extends BaseDoc {
  name: string;
  /** Minor units. Never a float — this is money. */
  priceCents: number;
  currency: string;
  includesVideoLibrary: boolean;
  includesWorkshops: boolean;
}

/** `orders/{id}` — mirrored from the external ticketing provider, not authored here. */
export interface OrderDoc extends BaseDoc {
  externalId: string;
  provider: "cvent" | "stripe" | "tito" | "manual";
  email: string;
  status: "paid" | "refunded" | "pending" | "cancelled";
  totalCents: number;
  currency: string;
  purchasedAt: Timestamp;
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
