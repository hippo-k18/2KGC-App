import type { SpeakerProfileDraft, SpeakerProfileEditStatus } from '@kgc/shared';

/**
 * The rules of speaker self-service, with no Firestore in them.
 *
 * ── Why this is here and pure ───────────────────────────────────────────────
 *
 * The speaker types into a page on the website and the organizer approves it on
 * the dashboard, and neither app can import the other, so what the two must
 * agree about lives in this package: what counts as a usable link, what a
 * submitted draft is allowed to contain, which of its values actually differ
 * from the record, and what approving it writes. `speaker-portal.ts` in each app
 * does the reads and writes; everything either of them *decides* is decided
 * here, where `npm test` can reach it without an emulator.
 *
 * No sentinels, nothing async, no store — the same posture as `review-core.ts`.
 */

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Whether a link minted at `iat` still opens.
 *
 * `speaker-token.ts` deliberately holds no revocation state, so this is the
 * other half of it: an organizer who presses "Revoke link" stamps
 * `linksValidFrom` with the current instant, and every link minted before that
 * stops working while every other speaker's link is untouched. Both are epoch
 * milliseconds, which is why `iat` is one too.
 *
 * `>=` rather than `>` because minting and stamping inside the same millisecond
 * is possible and the link that was just sent must not be dead on arrival.
 */
export function linkIsLive(iat: number, linksValidFrom?: number): boolean {
  if (linksValidFrom === undefined) return true;
  return iat >= linksValidFrom;
}

/**
 * Whether a link may act at all, as one call both apps make.
 *
 * Revocation used to be checked on the page and not in the write path, so
 * "Revoke link" stopped a speaker reading their profile and did not stop
 * anybody writing it — for the remaining 180 days of a token that carries no
 * state of its own. This is the check; `apps/web/src/lib/speaker-portal.ts`'s
 * `openPortal` is the single place that runs it, and every entry point goes
 * through that.
 */
export function portalLinkOpens(input: {
  /** When the token was minted. */
  iat: number;
  /** The organizer's revocation stamp, from `speakerProfileEdits`. */
  linksValidFrom?: number;
  /** The `eventId` on the speaker record, or undefined if there is no record. */
  speakerEventId?: string;
  eventId: string;
}): boolean {
  if (!linkIsLive(input.iat, input.linksValidFrom)) return false;
  return input.speakerEventId === input.eventId;
}

// ---------------------------------------------------------------------------
// What a speaker may send
// ---------------------------------------------------------------------------

/** Long enough for a conference bio, short enough that nothing else fits. */
export const BIO_MAX = 2000;
const SHORT_MAX = 200;
const URL_MAX = 500;

export interface DraftInput {
  title?: string;
  company?: string;
  bio?: string;
  photoURL?: string;
  linkedin?: string;
  x?: string;
  website?: string;
  /** `sessions/{id}` → the slides link typed against it. */
  slides?: Record<string, string>;
}

export interface NormalisedDraft {
  draft: SpeakerProfileDraft;
  /** One sentence per problem, addressed to the speaker. */
  errors: string[];
}

/**
 * A link somebody can actually be sent to.
 *
 * `http` and `https` only, and that is the whole check beyond parsing. Refusing
 * anything else is not fussiness: these strings are rendered as `href`s on the
 * public website and in the app, and `javascript:` in an `href` is a script on
 * the page it is rendered into. A `mailto:` or a bare `www.` is a mistake worth
 * naming rather than silently storing, because the speaker is the only person
 * who can fix it and they are looking at the form right now.
 */
function cleanUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return trimmed;
}

/**
 * Turn what was typed into what may be stored, and say what was wrong.
 *
 * ── An empty box means "clear this", and that is not the default ────────────
 *
 * AGENTS.md gotcha 9: `x || undefined` on a merge write means a field can never
 * be cleared, and the action still says "Saved". A speaker who deletes a stale
 * job title and is told it saved still has the stale job title on the website.
 * So an empty string survives normalisation as an empty string, and the
 * approval below turns it into a deletion. Only a key that is *absent* from the
 * input is left alone.
 *
 * `sessionIds` is the list of sessions this speaker is actually on. A slides
 * link against anything else is dropped rather than refused: the only way to
 * send one is to edit the form's own field names, and telling whoever did that
 * which session ids exist would be answering a question they should not be
 * asking.
 */
export function normaliseDraft(input: DraftInput, sessionIds: string[]): NormalisedDraft {
  const errors: string[] = [];
  const draft: SpeakerProfileDraft = {};

  const short = (value: string | undefined, label: string): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length > SHORT_MAX) {
      errors.push(`Your ${label} is too long. Keep it under ${SHORT_MAX} characters.`);
      return trimmed.slice(0, SHORT_MAX);
    }
    return trimmed;
  };

  /*
   * Assigned only when the key was there. `draft.title = undefined` puts the
   * key on the object, and the difference between "absent" and "present and
   * undefined" is the difference between "left alone" and "cleared" — which is
   * the distinction this whole function exists to keep.
   */
  const title = short(input.title, 'job title');
  if (title !== undefined) draft.title = title;
  const company = short(input.company, 'company');
  if (company !== undefined) draft.company = company;

  if (input.bio !== undefined) {
    const bio = input.bio.trim();
    if (bio.length > BIO_MAX) {
      errors.push(`Your bio is too long. Keep it under ${BIO_MAX} characters.`);
      draft.bio = bio.slice(0, BIO_MAX);
    } else {
      draft.bio = bio;
    }
  }

  const link = (value: string | undefined, label: string): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length > URL_MAX) {
      errors.push(`That ${label} is too long.`);
      return '';
    }
    const cleaned = cleanUrl(trimmed);
    if (!cleaned) {
      errors.push(`That ${label} does not look like a web address. It has to start with https://`);
      return '';
    }
    return cleaned;
  };

  const photoURL = link(input.photoURL, 'photo link');
  if (photoURL !== undefined) draft.photoURL = photoURL;

  const linkedin = link(input.linkedin, 'LinkedIn link');
  const x = link(input.x, 'X link');
  const website = link(input.website, 'website link');
  if (linkedin !== undefined || x !== undefined || website !== undefined) {
    draft.social = { linkedin, x, website };
  }

  if (input.slides) {
    const slides: Record<string, string> = {};
    for (const [sessionId, value] of Object.entries(input.slides)) {
      if (!sessionIds.includes(sessionId)) continue;
      const trimmed = value.trim();
      if (!trimmed) {
        slides[sessionId] = '';
        continue;
      }
      const cleaned = cleanUrl(trimmed);
      if (!cleaned) {
        errors.push('One of your slides links does not look like a web address.');
        slides[sessionId] = '';
        continue;
      }
      slides[sessionId] = cleaned;
    }
    draft.slides = slides;
  }

  return { draft, errors };
}

// ---------------------------------------------------------------------------
// What approving it actually changes
// ---------------------------------------------------------------------------

/** The speaker fields this feature may touch, as they stand on the record. */
export interface SpeakerProfileNow {
  title?: string;
  company?: string;
  bio?: string;
  photoURL?: string;
  social?: { linkedin?: string; x?: string; website?: string };
  /** `sessions/{id}` → the slides link currently on that session. */
  slides?: Record<string, string>;
}

export interface ProfileChange {
  /** `title`, `company`, `bio`, `photoURL`, `linkedin`, `x`, `website`, or `slides:{sessionId}`. */
  field: string;
  /** What the organizer reads on the approval panel. */
  label: string;
  before?: string;
  after?: string;
}

const LABELS: Record<string, string> = {
  title: 'Job title',
  company: 'Company',
  bio: 'Bio',
  photoURL: 'Photo',
  linkedin: 'LinkedIn',
  x: 'X',
  website: 'Website',
};

/**
 * Only what is genuinely different, so an organizer reads three lines instead
 * of eleven.
 *
 * A field the speaker left untouched is absent from the draft and never appears
 * here. A field they emptied appears with no `after`, which is how the panel
 * shows a deletion — and a deletion is the case that most needs to be visible
 * before it is approved.
 */
export function draftChanges(now: SpeakerProfileNow, draft: SpeakerProfileDraft): ProfileChange[] {
  const out: ProfileChange[] = [];

  const compare = (field: string, before?: string, after?: string) => {
    if (after === undefined) return;
    const b = (before ?? '').trim();
    const a = after.trim();
    if (b === a) return;
    out.push({ field, label: LABELS[field] ?? field, before: b || undefined, after: a || undefined });
  };

  compare('title', now.title, draft.title);
  compare('company', now.company, draft.company);
  compare('bio', now.bio, draft.bio);
  compare('photoURL', now.photoURL, draft.photoURL);
  compare('linkedin', now.social?.linkedin, draft.social?.linkedin);
  compare('x', now.social?.x, draft.social?.x);
  compare('website', now.social?.website, draft.social?.website);

  for (const [sessionId, url] of Object.entries(draft.slides ?? {})) {
    const before = now.slides?.[sessionId];
    const b = (before ?? '').trim();
    const a = url.trim();
    if (b === a) continue;
    out.push({
      field: `slides:${sessionId}`,
      label: 'Slides',
      before: b || undefined,
      after: a || undefined,
    });
  }

  return out;
}

/**
 * The writes an approval makes, split by the document they land on.
 *
 * `null` means "delete this field", and it is the reason this returns a plan
 * rather than a merge payload: the stores run with `ignoreUndefinedProperties`,
 * so an `undefined` on a merge write stores no key at all and the old value
 * survives while the action reports success (AGENTS.md gotcha 9). Each caller
 * turns a `null` into its own copy of `FieldValue.delete()`, because a sentinel
 * built in this package and handed to another app's store fails the whole write
 * (gotcha 8).
 *
 * `social` is rebuilt whole rather than merged key by key — nested maps merge
 * under `merge: true`, so a partial map leaves the other two links behind.
 * Only sessions that name this speaker get a slides write; the check is here
 * rather than at the call site so the two apps cannot disagree about it.
 */
export interface ApprovalPlan {
  /** Field paths on `speakers/{id}`. `null` deletes. */
  speaker: Record<string, string | null | { linkedin?: string; x?: string; website?: string }>;
  /** `sessions/{id}` → the new `slidesUrl`, or `null` to clear it. */
  sessions: Record<string, string | null>;
  /**
   * A photo link that was accepted into the draft and deliberately not
   * published. `undefined` when there was none. See `isOurOwnImage`.
   */
  heldPhotoURL?: string;
}

/**
 * Whether an image link is one of ours, by the host that serves it.
 *
 * The same test `firestore.rules`' `isFirebaseStorageUrl()` applies to an
 * attendee editing their own `photoURL`, and `mirror-directory.ts` applies
 * before a photo reaches the directory. Three copies of one string, because
 * none of the three can import the others; if this changes, all three change.
 */
export function isOurOwnImage(url: string): boolean {
  return /^https:\/\/firebasestorage\.googleapis\.com\//.test(url.trim());
}

export function approvalPlan(
  now: SpeakerProfileNow,
  draft: SpeakerProfileDraft,
  sessionIds: string[],
): ApprovalPlan {
  const speaker: ApprovalPlan['speaker'] = {};
  const sessions: ApprovalPlan['sessions'] = {};
  let heldPhotoURL: string | undefined;

  const set = (field: 'title' | 'company' | 'bio' | 'photoURL', value?: string) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed === (now[field] ?? '').trim()) return;
    speaker[field] = trimmed || null;
  };

  set('title', draft.title);
  set('company', draft.company);
  set('bio', draft.bio);

  /**
   * The photo is the one field a speaker cannot publish by typing it.
   *
   * ── Why an approval is not enough here, when it is for the bio ─────────────
   *
   * A bio is text, and once an organizer has read it, it is what it will stay.
   * A photo link is an instruction to every visitor's browser to fetch
   * something from a host we do not control: it sends them our reader's IP
   * address and the page they were on, and whatever was approved can be
   * swapped for anything at all afterwards, with no second decision to make.
   * Approving a URL approves a promise, not a picture.
   *
   * So a link to somewhere else is held. It stays on the draft where the
   * organizer can see it and open it, and the way it reaches the website is
   * the same way every other image in this product does: an organizer saves
   * the file on the speaker's own record, through the upload on Speaker
   * Manager. Clearing a photo is not held, because there is nothing to fetch.
   */
  if (draft.photoURL !== undefined) {
    const wanted = draft.photoURL.trim();
    if (wanted === '' || isOurOwnImage(wanted)) set('photoURL', draft.photoURL);
    else if (wanted !== (now.photoURL ?? '').trim()) heldPhotoURL = wanted;
  }

  if (draft.social) {
    const merged = {
      linkedin: (draft.social.linkedin ?? now.social?.linkedin ?? '').trim() || undefined,
      x: (draft.social.x ?? now.social?.x ?? '').trim() || undefined,
      website: (draft.social.website ?? now.social?.website ?? '').trim() || undefined,
    };
    const unchanged =
      merged.linkedin === (now.social?.linkedin?.trim() || undefined) &&
      merged.x === (now.social?.x?.trim() || undefined) &&
      merged.website === (now.social?.website?.trim() || undefined);
    if (!unchanged) {
      speaker.social =
        merged.linkedin || merged.x || merged.website ? merged : null;
    }
  }

  for (const [sessionId, url] of Object.entries(draft.slides ?? {})) {
    if (!sessionIds.includes(sessionId)) continue;
    const trimmed = url.trim();
    if (trimmed === (now.slides?.[sessionId] ?? '').trim()) continue;
    sessions[sessionId] = trimmed || null;
  }

  return { speaker, sessions, ...(heldPhotoURL ? { heldPhotoURL } : {}) };
}

// ---------------------------------------------------------------------------
// The completion tracker
// ---------------------------------------------------------------------------

export interface TrackerRow {
  status?: SpeakerProfileEditStatus;
  /** False for a speaker with no address, who cannot be sent a link at all. */
  canBeSent: boolean;
}

export interface TrackerCounts {
  /** Speakers who have never been sent a link and could be. */
  notSent: number;
  /** Sent, and nothing has happened since. */
  sent: number;
  /** They opened the page and have not pressed the button. */
  opened: number;
  /** Waiting for an organizer. This is the number that is somebody's to act on. */
  submitted: number;
  approved: number;
  rejected: number;
  /** No contact address, so no link can be sent. Counted apart from `notSent`. */
  noAddress: number;
}

/**
 * The tracker, counted once so the tiles and the chips cannot disagree.
 *
 * `noAddress` is deliberately not folded into `notSent`: one is a chase and the
 * other is a dead end, and an organizer looking at "42 not sent" needs to know
 * how many of those they cannot do anything about from this screen.
 */
export function trackerCounts(rows: TrackerRow[]): TrackerCounts {
  const counts: TrackerCounts = {
    notSent: 0,
    sent: 0,
    opened: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
    noAddress: 0,
  };

  for (const row of rows) {
    if (row.status) {
      counts[row.status] += 1;
      continue;
    }
    if (row.canBeSent) counts.notSent += 1;
    else counts.noAddress += 1;
  }

  return counts;
}

/** What the status column says. Here so both apps spell it the same way. */
export const STATUS_LABEL: Record<SpeakerProfileEditStatus, string> = {
  sent: 'Link sent',
  opened: 'Opened',
  submitted: 'Waiting for you',
  approved: 'Approved',
  rejected: 'Turned down',
};
