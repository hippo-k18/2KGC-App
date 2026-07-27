import type { Timestamp } from "firebase/firestore";

/**
 * Firestore document shapes. Each interface is the stored document *without*
 * its id — `WithId<T>` adds the document id when a doc is read.
 */
export type WithId<T> = T & { id: string };

export type SponsorTier = "diamond" | "platinum" | "gold" | "silver" | "startup";
export type SkillLevel = "beginner" | "intermediate" | "advanced";
export type SessionFormat =
  | "keynote"
  | "talk"
  | "panel"
  | "workshop"
  | "poster"
  | "social";

/** `users/{uid}` — an attendee profile. Gated: created only for imported ticket holders. */
export interface UserDoc {
  email: string;
  name: string;
  photoURL?: string;
  title?: string;
  company?: string;
  bio?: string;
  interests: string[];
  social?: { linkedin?: string; x?: string; github?: string; website?: string };
  /** False until /onboarding is completed. */
  onboarded: boolean;
  /** Opt out of appearing in the attendee directory. */
  visibleInDirectory: boolean;
  notificationPrefs: {
    announcements: boolean;
    messages: boolean;
    sessionReminders: boolean;
  };
  role: "attendee" | "speaker" | "organizer";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * `registrations/{emailLowercase}` — the imported ticket list.
 * Presence here is what authorizes an account; see firestore.rules.
 */
export interface RegistrationDoc {
  email: string;
  name?: string;
  ticketType?: string;
  /** Set once the holder has signed in and claimed the registration. */
  claimedByUid?: string;
  importedAt: Timestamp;
}

/** `tracks/{id}` */
export interface TrackDoc {
  name: string;
  color?: string;
  description?: string;
}

/** `sessions/{id}` */
export interface SessionDoc {
  title: string;
  description?: string;
  /** Stored as UTC instants; render in EVENT.timeZone. */
  startsAt: Timestamp;
  endsAt: Timestamp;
  /** `YYYY-MM-DD` in EVENT.timeZone — lets day tabs query without range math. */
  day: string;
  room?: string;
  trackId?: string;
  format: SessionFormat;
  skillLevel?: SkillLevel;
  speakerIds: string[];
  tags: string[];
  slidesUrl?: string;
  /** Organizers toggle these per session. */
  qaEnabled: boolean;
  pollsEnabled: boolean;
}

/** `speakers/{id}` */
export interface SpeakerDoc {
  name: string;
  photoURL?: string;
  title?: string;
  company?: string;
  bio?: string;
  social?: { linkedin?: string; x?: string; website?: string };
  sessionIds: string[];
}

/** `sponsors/{id}` */
export interface SponsorDoc {
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

/** `users/{uid}/savedSessions/{sessionId}` — the personal agenda. */
export interface SavedSessionDoc {
  sessionId: string;
  savedAt: Timestamp;
  /** Local notification/FCM reminder opt-in for this session. */
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
 */
export interface ThreadDoc {
  participantIds: string[];
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  lastSenderId?: string;
  /** Unread count per participant uid. */
  unread: Record<string, number>;
}

/** `threads/{threadId}/messages/{id}` */
export interface MessageDoc {
  senderId: string;
  body: string;
  sentAt: Timestamp;
}

/** `communityPosts/{id}` */
export interface CommunityPostDoc {
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
  replyCount: number;
  reactions: Record<string, string[]>;
  createdAt: Timestamp;
}

/** `communityPosts/{postId}/replies/{id}` */
export interface CommunityReplyDoc {
  authorId: string;
  body: string;
  createdAt: Timestamp;
}

/** `sessions/{sessionId}/questions/{id}` — live Q&A. */
export interface SessionQuestionDoc {
  authorId: string;
  body: string;
  upvotes: string[];
  answered: boolean;
  createdAt: Timestamp;
}

/** `sessions/{sessionId}/polls/{id}` */
export interface PollDoc {
  question: string;
  options: string[];
  /** uid -> chosen option index. */
  votes: Record<string, number>;
  open: boolean;
  createdAt: Timestamp;
}

/** `announcements/{id}` — organizer broadcast. */
export interface AnnouncementDoc {
  title: string;
  body: string;
  authorId: string;
  /** Also delivered over FCM when true. */
  push: boolean;
  createdAt: Timestamp;
}

/** `users/{uid}/notifications/{id}` — per-attendee inbox. */
export interface NotificationDoc {
  type: "message" | "announcement" | "session-reminder" | "agenda-change";
  title: string;
  body?: string;
  href?: string;
  read: boolean;
  createdAt: Timestamp;
}

/** `users/{uid}/fcmTokens/{token}` — web push registrations. */
export interface FcmTokenDoc {
  token: string;
  userAgent?: string;
  createdAt: Timestamp;
}
