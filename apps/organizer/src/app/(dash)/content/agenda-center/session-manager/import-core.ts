import { deriveTimes, toWallClock } from '@kgc/scripts/src/lib/time';
import { sessionId as deriveSessionId, stableGuid } from '@kgc/scripts/src/lib/ids';
import type { PublishStatus, SessionFormat, SkillLevel } from '@kgc/shared';
import { primaryTrackFor, speakerNamesFor, SESSION_FORMATS, SESSION_STATUSES, SKILL_LEVELS } from './session-core';

/**
 * Turning agenda rows into session documents — the half that has no Firestore
 * in it.
 *
 * The split is `session-core.ts`'s, for `session-core.ts`'s reason: `import.ts`
 * is the fetch and this is the part that can be wrong quietly. Two things on
 * this path have already caused real bugs in this repo and both are pinned by
 * `tests/programme/session-import-core.test.ts`:
 *
 *  1. **The timezone derivation.** A 21:00 reception is 01:00 UTC the next day.
 *     `startsAt`, `endsAt` and `day` are derived *here* from the sheet's date
 *     and time columns plus the event's zone, through the single
 *     `deriveTimes()` in `scripts/src/lib/time.ts` that the seed, the CLI
 *     importer and `saveSessionAction` all call. There is no second opinion
 *     about time anywhere in this file and there must never be one: a `day`
 *     computed slightly differently here would file that reception under
 *     Tuesday on the importer's tab and Monday on the editor's, and nobody
 *     finds out until they walk to an empty room.
 *
 *  2. **`speakerNames` mirrors `speakerIds` positionally.** It is not a set. The
 *     index carries meaning — it is the programme committee's billing order,
 *     first author first — and `agenda/[id].tsx` falls back to
 *     `speakerNames[i]` while a speaker document is still loading. So this file
 *     maps, and never sorts, dedupes or filters. A dropped entry does not lose
 *     a name; it moves every later name onto the wrong person, and the symptom
 *     is a printed programme crediting the wrong lead author.
 *
 * ── Why this returns `Date` and not `Timestamp` ─────────────────────────────
 *
 * Three copies of `firebase-admin` are installed (`apps/web`, `apps/organizer`,
 * and the root that `scripts` and the test suites resolve). `Timestamp` and the
 * `FieldValue` sentinels are class instances checked with `instanceof`, so one
 * built by the wrong copy fails every write — see the header of
 * `lib/denormalise.ts`, which records the August 2026 outage that taught this.
 * A `Date` has no such identity, so the plan carries plain `Date`s and
 * `import.ts` wraps them with *its own* `Timestamp`. That is also what makes
 * this module loadable by Vitest at the repo root, where the copy differs.
 *
 * For the same reason the plan carries a `clearPrimaryTrackColor` **flag**
 * rather than a `FieldValue.delete()`: a sentinel constructed here would be the
 * wrong one.
 */

// ---------------------------------------------------------------------------
// What the planner is given
// ---------------------------------------------------------------------------

export interface RoomRef {
  id: string;
  name: string;
}

export interface TrackRef {
  id: string;
  name: string;
  color?: string;
}

export interface SpeakerRef {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface ExistingSession {
  id: string;
  title: string;
  startsAtLocal: string;
  speakerIds: string[];
}

/**
 * Everything already in the programme, read once before the rows are walked.
 *
 * A catalogue rather than per-row lookups because the resolution is
 * name-to-id — sixty rows naming the same eight tracks would otherwise be sixty
 * reads of the same eight documents, and because a duplicate name has to be
 * detected across the whole collection before any row can be believed.
 */
export interface SessionCatalog {
  rooms: RoomRef[];
  tracks: TrackRef[];
  speakers: SpeakerRef[];
  sessions: ExistingSession[];
}

/** The raw cells for one row, keyed by `SESSION_FIELDS`. */
export type SessionCsvRow = Record<string, string>;

// ---------------------------------------------------------------------------
// What it produces
// ---------------------------------------------------------------------------

/**
 * The fields one row would write.
 *
 * ⚠️ **`undefined` here means "the column was blank, leave the stored value
 * alone"** — the opposite of what it means in `session-core.ts`'s
 * `parseSessionForm`, where an emptied box means "clear this field" and
 * `saveSessionAction` translates it to `FieldValue.delete()`.
 *
 * That difference is deliberate, and it is the sponsor importer's stated rule
 * (`sponsor-center/sponsor-manager/import.ts`) applied to the programme. On a
 * form, a person looked at that box and emptied it. In a spreadsheet a blank
 * cell almost never means that — it means the column was not filled in, or the
 * export dropped it. Clearing on blank would let an agenda exported without the
 * Room column silently unassign every room, and `roomName` is the only thing
 * telling an attendee which door to walk to, because `firestore.rules` has no
 * `rooms` block and the app cannot read that collection at all. So a blank
 * import cell leaves the stored value alone, and clearing a field is something
 * you do on the form, one session at a time.
 */
export interface PlannedSessionFields {
  title: string;
  description?: string;
  /** Derived, never taken from the sheet. */
  startsAt: Date;
  endsAt: Date;
  startsAtLocal: string;
  endsAtLocal: string;
  timeZone: string;
  day: string;
  format?: SessionFormat;
  status?: PublishStatus;
  skillLevel?: SkillLevel;
  capacity?: number;
  roomId?: string;
  roomName?: string;
  /**
   * Written together with `trackIds`, or not at all. See `planRow` — the caches
   * and the ids they mirror never travel separately.
   */
  trackIds?: string[];
  primaryTrackName?: string;
  primaryTrackColor?: string;
  /**
   * True when the row named a primary track that genuinely has no colour, so
   * the cached colour must be removed rather than left showing the previous
   * track's. This is `denormalise.ts`'s "absence versus ignorance" rule and it
   * is **not** in tension with the blank-cell rule above: the cell was filled
   * in, and the track document is authoritative including in what it omits.
   */
  clearPrimaryTrackColor: boolean;
  /** Written together with `speakerNames`, positionally, or not at all. */
  speakerIds?: string[];
  speakerNames?: string[];
}

export interface PlannedSession {
  /** 1-based and counting the header, so it matches what the spreadsheet shows. */
  line: number;
  docId: string;
  /** False when this row creates a session, which is also when the defaults apply. */
  exists: boolean;
  fields: PlannedSessionFields;
  /** For the `speakers/{id}.sessionIds` inverse index. Empty when the column was blank. */
  speakerIdsBefore: string[];
  stableGuid: string;
}

export interface PlanFailure {
  line: number;
  title: string;
  message: string;
}

export interface SessionImportPlan {
  planned: PlannedSession[];
  failed: PlanFailure[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * A new session arrives as a draft unless the sheet says otherwise.
 *
 * The CLI importer publishes, and that is right for it — it is run once, by
 * hand, against an empty database, with `--dry-run` in front of it. This one is
 * a button in a dashboard, and an import is a bulk write nobody reviews row by
 * row. Publishing sixty sessions to a thousand phones because a Status column
 * was missing is not something an organizer can undo by editing: the agenda has
 * already been read, and `deletedAt` is written by nothing anywhere. A draft is
 * one bulk publish away from being right; a premature publish is not.
 *
 * An *existing* session keeps whatever status it has, because a blank cell
 * means "not filled in" — see `PlannedSessionFields`.
 */
const DEFAULT_STATUS: PublishStatus = 'draft';

/** Whova emits an empty End cell for lightning items; see `SESSION_FIELDS`. */
const DEFAULT_MINUTES = 45;

/**
 * The spellings a programme spreadsheet actually uses for a format.
 *
 * `SessionFormat` is a closed union in `@kgc/shared` and `conflicts-core.ts`
 * reads it (`SPEAKERLESS_FORMATS`), so an unrecognised value cannot be passed
 * through. It is not an error either — "Lightning Talk" is a talk, and refusing
 * a row over it would make an organizer edit the sheet to satisfy a vocabulary
 * they never agreed to.
 */
const FORMAT_ALIASES: Record<string, SessionFormat> = {
  keynote: 'keynote',
  plenary: 'keynote',
  talk: 'talk',
  presentation: 'talk',
  lightningtalk: 'talk',
  lightning: 'talk',
  paper: 'talk',
  tutorial: 'workshop',
  workshop: 'workshop',
  training: 'workshop',
  panel: 'panel',
  paneldiscussion: 'panel',
  poster: 'poster',
  demo: 'poster',
  social: 'social',
  reception: 'social',
  break: 'social',
  networking: 'social',
  lunch: 'social',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lower case, punctuation-insensitive, whitespace-collapsed. For matching names only. */
function key(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A multi-value cell into its parts.
 *
 * ⚠️ **Comma is not a separator here**, although it is the obvious choice and
 * the one the CSV format itself uses. "Okonkwo, Ada" is one speaker written the
 * way half the world writes a name, and splitting on a comma turns her into
 * two people — who then fail to resolve, or worse, resolve to somebody else
 * with a matching surname. `lib/exports.ts` joins these cells with `'; '` for
 * exactly this reason, so semicolon leads; pipe and newline are accepted
 * because a hand-made sheet uses both.
 */
export function splitCell(raw: string): string[] {
  return raw
    .split(/[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `HH:mm` plus a number of minutes, staying in wall clock.
 *
 * Deliberately arithmetic on the string's own calendar rather than through a
 * `Date`: a `Date` built from a wall clock resolves in whatever zone the
 * process runs in, which on Netlify's UTC builders is not the event's. This
 * only ever moves an end time forward from a start time on the same clock, and
 * `deriveTimes` converts the pair afterwards.
 */
function addMinutes(wall: string, minutes: number): string {
  const [date, time] = [wall.slice(0, 10), wall.slice(11, 16)];
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const inDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);

  // A session that runs past midnight ends on the next calendar date. `Date.UTC`
  // is safe for this one job because both sides are plain calendar arithmetic
  // with no zone in them — no instant is being named.
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + dayShift));
  const nextDate = shifted.toISOString().slice(0, 10);
  const hh = String(Math.floor(inDay / 60)).padStart(2, '0');
  const mm = String(inDay % 60).padStart(2, '0');
  return `${nextDate}T${hh}:${mm}`;
}

/** Names that appear twice in a collection, so a row naming one cannot be resolved. */
function ambiguous(names: string[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const n of names) {
    const k = key(n);
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  return dupes;
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/**
 * Believe a sheet of agenda rows against the programme that already exists, or
 * say which line is wrong and why.
 *
 * ── Nothing here creates a speaker, a track or a room ───────────────────────
 *
 * The CLI importer stubs a missing speaker rather than dropping the link, which
 * is right for a one-shot migration where the alternative is losing data. It is
 * wrong for a dashboard button pressed repeatedly as the programme firms up:
 * "J. Smith" on one sheet and "John Smith" on the next are two stub records
 * that nothing will ever merge, and `speakerId()` hashes the name, so the
 * duplicate is permanent. Here an unknown name fails its row and names the
 * import that fixes it. The order is speakers and tracks first, then the
 * agenda — which is also the order the three screens are listed in.
 *
 * ── A row that would duplicate a session fails instead ──────────────────────
 *
 * The document id is `sessionId(title, startsAtLocal)`, the same function the
 * seed, the CLI importer and `saveSessionAction` use, so a re-import of an
 * unchanged sheet updates in place. But it also means a session whose *time*
 * changed hashes to a different id, and writing it would leave the original
 * sitting on every attendee's saved agenda with nothing to remove it —
 * `firestore.rules` is `allow delete: if false` and nothing writes `deletedAt`.
 * So a row whose title already exists at a different time is reported rather
 * than written, and the message says to move it in Session Manager.
 */
export function planSessionImport(
  rows: SessionCsvRow[],
  catalog: SessionCatalog,
  timeZone: string,
): SessionImportPlan {
  const planned: PlannedSession[] = [];
  const failed: PlanFailure[] = [];

  const roomByName = new Map(catalog.rooms.map((r) => [key(r.name), r]));
  const trackByName = new Map(catalog.tracks.map((t) => [key(t.name), t]));
  const speakerByName = new Map(catalog.speakers.map((s) => [key(s.name), s]));
  const sessionById = new Map(catalog.sessions.map((s) => [s.id, s]));
  const sessionIdsByTitle = new Map<string, ExistingSession[]>();
  for (const s of catalog.sessions) {
    const k = key(s.title);
    sessionIdsByTitle.set(k, [...(sessionIdsByTitle.get(k) ?? []), s]);
  }

  const ambiguousSpeakers = ambiguous(catalog.speakers.map((s) => s.name));
  const ambiguousTracks = ambiguous(catalog.tracks.map((t) => t.name));
  const ambiguousRooms = ambiguous(catalog.rooms.map((r) => r.name));

  /** Ids this file has already claimed, so two rows cannot land on one document. */
  const claimed = new Map<string, number>();

  rows.forEach((row, i) => {
    const line = i + 2;
    const title = (row.title ?? '').trim();
    const fail = (message: string) => failed.push({ line, title, message });

    // ── Times, through the one derivation ─────────────────────────────────
    let times;
    try {
      const startsAtLocal = toWallClock(row.day ?? '', row.startTime ?? '');
      const endCell = (row.endTime ?? '').trim();
      const endsAtLocal = endCell
        ? toWallClock((row.endDate ?? '').trim() || (row.day ?? ''), endCell)
        : addMinutes(startsAtLocal, DEFAULT_MINUTES);
      times = deriveTimes(startsAtLocal, endsAtLocal, timeZone);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'The date and time could not be read.');
      return;
    }

    const docId = deriveSessionId(title, times.startsAtLocal);

    const alreadyClaimed = claimed.get(docId);
    if (alreadyClaimed !== undefined) {
      fail(`This is the same session as line ${alreadyClaimed} — same title, same start time.`);
      return;
    }

    const existing = sessionById.get(docId);
    if (!existing) {
      // The title exists but at a different time: a reschedule, not a new
      // session. Writing it would create a twin nothing can remove.
      const sameTitle = sessionIdsByTitle.get(key(title)) ?? [];
      if (sameTitle.length > 0) {
        const when = sameTitle.map((s) => s.startsAtLocal.replace('T', ' ')).join(', ');
        fail(
          `“${title}” is already on the programme at ${when}, and this row would add a second ` +
            `one at ${times.startsAtLocal.replace('T', ' ')}. Move the existing session in ` +
            'Session Manager instead — an import cannot remove the original.',
        );
        return;
      }
    }

    // ── Room ──────────────────────────────────────────────────────────────
    const roomCell = (row.room ?? '').trim();
    let room: RoomRef | undefined;
    if (roomCell) {
      if (ambiguousRooms.has(key(roomCell))) {
        return void fail(`Two rooms are called “${roomCell}”, so this row cannot say which.`);
      }
      room = roomByName.get(key(roomCell));
      if (!room) {
        return void fail(`No room called “${roomCell}”. Add it in Room Manager before importing.`);
      }
    }

    // ── Tracks, and the two caches that mirror `trackIds[0]` ──────────────
    const trackCells = splitCell(row.track ?? '');
    let trackIds: string[] | undefined;
    let primary: TrackRef | undefined;
    if (trackCells.length > 0) {
      const resolved: TrackRef[] = [];
      for (const name of trackCells) {
        if (ambiguousTracks.has(key(name))) {
          return void fail(`Two tracks are called “${name}”, so this row cannot say which.`);
        }
        const track = trackByName.get(key(name));
        if (!track) {
          return void fail(`No track called “${name}”. Import the track list first.`);
        }
        resolved.push(track);
      }
      trackIds = resolved.map((t) => t.id);
      // Through the same function the editor uses, so there is one opinion
      // about which track is primary: `trackIds[0]`, and nothing else.
      primary = primaryTrackFor(trackIds, new Map(resolved.map((t) => [t.id, t]))).primary;
    }

    // ── Speakers, positionally ────────────────────────────────────────────
    const speakerCells = splitCell(row.speakers ?? '');
    let speakerIds: string[] | undefined;
    let speakerNames: string[] | undefined;
    if (speakerCells.length > 0) {
      const resolved: SpeakerRef[] = [];
      for (const name of speakerCells) {
        if (ambiguousSpeakers.has(key(name))) {
          return void fail(
            `Two speakers are called “${name}”. Import cannot tell them apart — put this ` +
              'session together on the session page instead.',
          );
        }
        const speaker = speakerByName.get(key(name));
        if (!speaker) {
          return void fail(`No speaker called “${name}”. Import the speaker list first.`);
        }
        resolved.push(speaker);
      }
      speakerIds = resolved.map((s) => s.id);
      /*
       * The names come from the speaker *documents*, not from the sheet's
       * spelling, and they go through `speakerNamesFor` — the same function
       * `saveSessionAction` uses — so the cache agrees with its source and
       * `fanOutSpeakerRename` can rewrite it in place later. A sheet spelling
       * "A. Okonkwo" against a record reading "Ada Okonkwo" would otherwise
       * cache a name that no rename would ever correct.
       */
      const { names, unknown } = speakerNamesFor(
        speakerIds,
        new Map(resolved.map((s) => [s.id, s.name])),
      );
      // Unreachable — every id here came from a resolved document — but the
      // contract is "report, never skip", and a silent skip is the exact
      // mistake that shifts every later name onto the wrong person.
      if (unknown.length > 0) {
        return void fail(`Speaker records changed while the file was being read. Try again.`);
      }
      speakerNames = names;
    }

    // ── The rest ──────────────────────────────────────────────────────────
    const formatCell = key(row.format ?? '').replace(/ /g, '');
    const format = formatCell ? (FORMAT_ALIASES[formatCell] ?? 'talk') : undefined;

    const statusCell = (row.status ?? '').trim().toLowerCase();
    let status: PublishStatus | undefined;
    if (statusCell) {
      if (!(SESSION_STATUSES as string[]).includes(statusCell)) {
        return void fail(`“${row.status}” is not a status. Use draft, published or cancelled.`);
      }
      status = statusCell as PublishStatus;
    } else if (!existing) {
      status = DEFAULT_STATUS;
    }

    const skillCell = (row.skillLevel ?? '').trim().toLowerCase();
    let skillLevel: SkillLevel | undefined;
    if (skillCell) {
      if (!(SKILL_LEVELS as string[]).includes(skillCell)) {
        return void fail(`“${row.skillLevel}” is not a skill level. Use beginner, intermediate or advanced.`);
      }
      skillLevel = skillCell as SkillLevel;
    }

    const capacityCell = (row.capacity ?? '').trim();
    const capacity = capacityCell ? Number(capacityCell) : undefined;

    if (format && !SESSION_FORMATS.includes(format)) {
      return void fail(`“${row.format}” is not a session format.`);
    }

    claimed.set(docId, line);
    planned.push({
      line,
      docId,
      exists: Boolean(existing),
      speakerIdsBefore: existing?.speakerIds ?? [],
      stableGuid: stableGuid(docId),
      fields: {
        title,
        description: (row.description ?? '').trim() || undefined,
        startsAt: times.startsAt.toDate(),
        endsAt: times.endsAt.toDate(),
        startsAtLocal: times.startsAtLocal,
        endsAtLocal: times.endsAtLocal,
        timeZone: times.timeZone,
        day: times.day,
        format,
        status,
        skillLevel,
        capacity,
        roomId: room?.id,
        roomName: room?.name,
        trackIds,
        primaryTrackName: primary?.name,
        primaryTrackColor: primary?.color,
        clearPrimaryTrackColor: Boolean(trackIds) && primary !== undefined && primary.color === undefined,
        speakerIds,
        speakerNames,
      },
    });
  });

  return { planned, failed };
}
