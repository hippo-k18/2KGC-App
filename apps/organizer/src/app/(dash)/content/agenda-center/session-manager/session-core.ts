import type { PublishStatus, SessionFormat, SkillLevel } from '@kgc/shared';
import type { Conflict } from '../../../../../lib/conflicts-core';

/**
 * Everything the session editor does that is arithmetic, parsing or ordering —
 * with no Firestore, no `server-only` and no React in it.
 *
 * The split is the one `conflicts-core.ts` and `pairings-core.ts` already use,
 * and for the same reason: `lib/firestore.ts` and `lib/time.ts` both carry
 * `server-only`, which throws the moment Vitest loads it, so anything worth
 * pinning with a test has to live beside the fetch rather than inside it.
 * `actions.ts` is the fetch; this is the part that can be wrong quietly.
 *
 * ⚠️ **Nothing here derives a time.** `startsAt`, `endsAt` and `day` come from
 * the single `deriveTimes()` in `scripts/src/lib/time.ts`, called server-side
 * inside the transaction, and this file must never grow a second opinion about
 * them. What it does check is *shape* — that the two boxes hold a
 * `YYYY-MM-DDTHH:mm` wall clock and that the end is after the start — so the
 * organizer is told which box is wrong instead of receiving `deriveTimes`'
 * (correct, but unattributed) sentence about the pair. The check below is
 * deliberately weaker than the derivation and can only ever reject a subset of
 * what `deriveTimes` rejects; the derivation stays the authority.
 */

export const SESSION_STATUSES: PublishStatus[] = ['draft', 'published', 'cancelled'];

/**
 * The closed union from `models.ts`, restated as a value so the form can render
 * it. If `SessionFormat` ever grows a member, `tsc` fails here — which is the
 * point, because a format with no option in the dropdown is a session that can
 * never be authored as one, and `conflicts-core.ts` has a matching list
 * (`SPEAKERLESS_FORMATS`) that also needs looking at.
 */
export const SESSION_FORMATS: SessionFormat[] = [
  'keynote',
  'talk',
  'panel',
  'workshop',
  'poster',
  'social',
];

export const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

/**
 * Formats that get Q&A and polls turned on at creation.
 *
 * These mirror `seed-demo.ts` exactly — Q&A on everything except a drinks
 * reception, polls only on the two formats that have a stage and an audience —
 * so a hand-created session and a seeded one behave the same on a phone. They
 * are only defaults: `session-qanda-manager` owns both flags afterwards and
 * this editor never writes them again.
 */
export function qaDefaultsFor(format: SessionFormat): { qaEnabled: boolean; pollsEnabled: boolean } {
  return {
    qaEnabled: format !== 'social',
    pollsEnabled: format === 'keynote' || format === 'panel',
  };
}

/** The `datetime-local` value format, which is also the stored wall clock. */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** What one submit of the session form means, once it has been believed. */
export interface SessionInput {
  title: string;
  description?: string;
  roomId?: string;
  startsAtLocal: string;
  endsAtLocal: string;
  status: PublishStatus;
  format: SessionFormat;
  skillLevel?: SkillLevel;
  capacity?: number;
  /** Ordered. See `speakerNamesFor`. */
  speakerIds: string[];
  /** Ordered. `trackIds[0]` is the primary track. */
  trackIds: string[];
}

export type ParsedSession =
  | { ok: true; value: SessionInput }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

/** Only the two methods this needs, so a test can pass a real `FormData`. */
export interface FormDataLike {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

function text(form: FormDataLike, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Read a repeated field, **in submission order, without sorting or deduping**.
 *
 * The order is the whole reason this is not a `<select multiple>`: that control
 * reports its selection in DOM order rather than click order and cannot express
 * "Hartmann first, then Okonkwo" at all. `speakerNames` mirrors `speakerIds`
 * positionally and the position is the programme committee's billing order, so
 * a control that loses it silently rewrites who is first author.
 *
 * Blanks are dropped because an empty picker row is a row the organizer has not
 * filled in yet, not a speaker.
 */
function orderedIds(form: FormDataLike, name: string): string[] {
  return form
    .getAll(name)
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
}

/**
 * Believe a submitted form, or say which box is wrong.
 *
 * Errors are keyed by field `name` so `FormState.fieldErrors` can put each
 * message under the control that caused it; `error` is the one-sentence summary
 * for the banner. A form with twenty controls and a single sentence at the top
 * makes the organizer guess, which is exactly what `form.tsx` added
 * `fieldErrors` to stop.
 */
export function parseSessionForm(form: FormDataLike): ParsedSession {
  const fieldErrors: Record<string, string> = {};

  const title = text(form, 'title');
  if (!title) fieldErrors.title = 'A session needs a title.';

  const startsAtLocal = text(form, 'startsAtLocal');
  const endsAtLocal = text(form, 'endsAtLocal');
  if (!WALL_CLOCK.test(startsAtLocal)) {
    fieldErrors.startsAtLocal = 'Enter a date and a time.';
  }
  if (!WALL_CLOCK.test(endsAtLocal)) {
    fieldErrors.endsAtLocal = 'Enter a date and a time.';
  }
  // Both strings are wall clock in the same zone and zero-padded, so a plain
  // string comparison is a chronological one. Comparing anything derived would
  // mean deriving it here, which is the one thing this file must not do.
  if (!fieldErrors.startsAtLocal && !fieldErrors.endsAtLocal && endsAtLocal <= startsAtLocal) {
    fieldErrors.endsAtLocal = 'A session has to end after it starts.';
  }

  const status = text(form, 'status') as PublishStatus;
  if (!SESSION_STATUSES.includes(status)) fieldErrors.status = 'Choose a status.';

  const format = text(form, 'format') as SessionFormat;
  if (!SESSION_FORMATS.includes(format)) fieldErrors.format = 'Choose a session format.';

  const skillLevelRaw = text(form, 'skillLevel');
  if (skillLevelRaw && !SKILL_LEVELS.includes(skillLevelRaw as SkillLevel)) {
    fieldErrors.skillLevel = 'That is not one of the three levels.';
  }

  const capacityRaw = text(form, 'capacity');
  let capacity: number | undefined;
  if (capacityRaw) {
    capacity = Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 1) {
      fieldErrors.capacity = 'Capacity is a whole number of seats, or blank for uncapped.';
      capacity = undefined;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.values(fieldErrors)[0];
    const n = Object.keys(fieldErrors).length;
    return {
      ok: false,
      fieldErrors,
      error: n === 1 ? first : `${n} fields need attention. ${first}`,
    };
  }

  /**
   * ⚠️ `undefined` here means **"the organizer cleared this box"**, not "leave it
   * alone" — this is a parse result, not a Firestore payload, and the two look
   * identical.
   *
   * That difference is AGENTS.md gotcha 9. The stores run with
   * `ignoreUndefinedProperties`, so an `undefined` handed to an `update()` or a
   * `set(…, { merge: true })` writes no key at all: the old value survives and
   * the action still says "Saved". `saveSessionAction` therefore translates
   * every one of these to `FieldValue.delete()` and none of them travels to
   * Firestore as `undefined`. On the create path they are correctly dropped,
   * because there is no prior value for a missing key to shadow.
   *
   * `roomId` is the one that would hurt. The attendee app cannot read the
   * `rooms` collection at all — `firestore.rules` has no block for it — so the
   * cached `roomName` is the only thing telling somebody which door to walk to,
   * and a room that cannot be un-set is a session permanently pointing at the
   * wrong hall.
   */
  return {
    ok: true,
    value: {
      title,
      description: text(form, 'description') || undefined,
      roomId: text(form, 'roomId') || undefined,
      startsAtLocal,
      endsAtLocal,
      status,
      format,
      skillLevel: (skillLevelRaw as SkillLevel) || undefined,
      capacity,
      speakerIds: orderedIds(form, 'speakerIds'),
      trackIds: orderedIds(form, 'trackIds'),
    },
  };
}

// ---------------------------------------------------------------------------
// The denormalisation contract, as pure functions
// ---------------------------------------------------------------------------

export interface Named {
  id: string;
  name: string;
}

export interface NamedTrack extends Named {
  color?: string;
}

/**
 * `speakerNames` for a given `speakerIds`, **positionally**.
 *
 * This is the write-side half of the contract `lib/denormalise.ts` documents
 * for the read side: the two arrays are one table with two columns, index `i`
 * is the same person in both, and `agenda/[id].tsx` falls back to
 * `speakerNames[i]` while a speaker document is still loading. So the mapping
 * is `map`, never `filter(Boolean)` and never a sort — a dropped entry shifts
 * every name after it onto the wrong person, which is worse than a missing one
 * because it is wrong rather than absent.
 *
 * An id with no speaker behind it is reported rather than skipped, and the
 * caller refuses the save. That is the right answer *here* even though
 * `reconcileSessionCaches` deliberately keeps a stale name for the same
 * situation: reconcile is repairing data that already exists, whereas these ids
 * were picked from a dropdown this request rendered, so an unknown one means
 * the speaker was deleted mid-edit and guessing at their name would invent one.
 */
export function speakerNamesFor(
  speakerIds: string[],
  byId: Map<string, string>,
): { names: string[]; unknown: string[] } {
  const unknown: string[] = [];
  const names = speakerIds.map((id) => {
    const name = byId.get(id);
    if (name === undefined) {
      unknown.push(id);
      return '';
    }
    return name;
  });
  return { names, unknown };
}

/**
 * The cached primary track, which is `trackIds[0]` and nothing else.
 *
 * Programme chairs cross-list talks, so a session sits in several tracks and
 * only the first is cached — the seed, the importer and `fanOutTrackChange` all
 * agree on that, and a fourth opinion here would make the fan-out rewrite
 * fields it did not write.
 *
 * A track with no colour returns `color: undefined`, and the caller deletes the
 * cached colour rather than leaving the previous track's behind. That is
 * `denormalise.ts`'s "absence versus ignorance" rule: the track document exists
 * and is authoritative including in what it omits.
 */
export function primaryTrackFor(
  trackIds: string[],
  byId: Map<string, NamedTrack>,
): { primary?: NamedTrack; unknown: string[] } {
  const unknown = trackIds.filter((id) => !byId.has(id));
  return { primary: trackIds.length ? byId.get(trackIds[0]) : undefined, unknown };
}

/**
 * Which speakers gained this session and which lost it.
 *
 * `SpeakerDoc.sessionIds` is the inverse index, and it has six readers —
 * including `people/speaker/[id].tsx`, which is how an attendee sees what
 * somebody is giving. Nothing maintained it outside the importer before this
 * editor existed, so a speaker swapped onto a session would have appeared on the
 * agenda card and been missing from their own profile.
 *
 * Set semantics, unlike `speakerIds` above: every reader uses `.length` or
 * `.includes`, so `arrayUnion`/`arrayRemove` are exactly right and order
 * carries no meaning. Billing order lives on the session, where it is displayed.
 */
export function speakerIndexDelta(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((id) => !b.has(id)),
    removed: [...b].filter((id) => !a.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/**
 * The conflicts from a whole-programme report that name this session.
 *
 * `findConflicts()` already loads the programme and `detectConflicts()` already
 * does the overlap arithmetic; re-deriving either one for a single session
 * would be a second implementation of the thing `conflicts-core.ts` exists to
 * keep singular. This only narrows the report, so a session's own page can say
 * "this clashes" without the organizer having to go and look.
 */
export function conflictsForSession(conflicts: Conflict[], sessionId: string): Conflict[] {
  return conflicts.filter((c) => c.sessions.some((s) => s.id === sessionId));
}
