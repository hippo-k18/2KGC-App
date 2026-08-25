import type { RoomDoc, SessionDoc, SpeakerDoc } from '@kgc/shared';

/**
 * Conflict detection, as a pure function over documents.
 *
 * Deliberately separate from `conflicts.ts`, which carries `server-only` and
 * does the Firestore fetch. `server-only` throws outside a React Server
 * Component, so a module that imports it cannot be loaded by Vitest at all —
 * and the overlap arithmetic here is exactly the part worth pinning with tests.
 * Splitting the fetch from the logic costs one file and makes the logic
 * testable without mocking the module system.
 */

export type ConflictKind =
  | 'speaker-double-booked'
  | 'room-double-booked'
  | 'over-capacity'
  | 'no-room'
  | 'no-speaker';

export interface Conflict {
  kind: ConflictKind;
  /**
   * `error` stops the programme working; `warning` is a judgement call an
   * organizer may legitimately have made on purpose. Mixing them into one list
   * of "problems" is how a screen like this gets ignored.
   */
  severity: 'error' | 'warning';
  /** One sentence, naming the thing and the clash. */
  summary: string;
  day: string;
  sessions: { id: string; title: string; startsAtLocal: string; endsAtLocal: string }[];
  /** The person or room the conflict is about, when there is one. */
  subject?: string;
}

interface Row {
  id: string;
  doc: SessionDoc;
}

/** Half-open intervals: a session ending at 10:00 does not clash with one starting then. */
function overlaps(a: SessionDoc, b: SessionDoc): boolean {
  return a.startsAtLocal < b.endsAtLocal && b.startsAtLocal < a.endsAtLocal;
}

function ref(r: Row) {
  return {
    id: r.id,
    title: r.doc.title,
    startsAtLocal: r.doc.startsAtLocal,
    endsAtLocal: r.doc.endsAtLocal,
  };
}

function timeRange(r: Row): string {
  return `${r.doc.startsAtLocal.slice(11, 16)}–${r.doc.endsAtLocal.slice(11, 16)}`;
}

/**
 * Formats that legitimately have no speaker.
 *
 * A drinks reception with nobody assigned is not a mistake, and reporting it as
 * one buries the keynote that genuinely has nobody. `SessionFormat` is a closed
 * union of six — `keynote | talk | panel | workshop | poster | social` — and
 * `social` is the only member of it that routinely has no named presenter.
 *
 * ⚠️ Breaks, meals and registration are **not** formats in this model. If they
 * are ever added to `SessionFormat`, add them here too or this screen starts
 * reporting the coffee break as a problem every single time it is opened.
 */
const SPEAKERLESS_FORMATS = new Set<SessionDoc['format']>(['social']);

export interface ConflictReport {
  conflicts: Conflict[];
  errors: number;
  warnings: number;
  /** Sessions considered, so the screen can say what it actually checked. */
  sessionsChecked: number;
}


/**
 * Find every conflict in a programme.
 *
 * Takes plain arrays so it can be called from a server component with live data
 * or from a test with three hand-written sessions.
 */
export function detectConflicts(
  sessions: { id: string; doc: SessionDoc }[],
  speakers: { id: string; doc: SpeakerDoc }[],
  roomList: { id: string; doc: RoomDoc }[],
): ConflictReport {
  const rows: Row[] = sessions
    .map((r) => ({ id: r.id, doc: r.doc }))
    .filter((r) => r.doc.status !== 'cancelled' && !r.doc.deletedAt)
    .sort((a, b) => a.doc.startsAtLocal.localeCompare(b.doc.startsAtLocal));

  const speakerName = new Map(speakers.map((s) => [s.id, s.doc.name]));
  const rooms = new Map(roomList.map((r) => [r.id, r.doc]));

  const conflicts: Conflict[] = [];

  // ── Speaker double-booked ────────────────────────────────────────────────
  //
  // Keyed by speaker *id*, never by name. Two speakers genuinely can share a
  // name, and `speakerNames` on the session is a denormalised display cache
  // that the model says is never decided from.
  const bySpeaker = new Map<string, Row[]>();
  for (const r of rows) {
    for (const sid of r.doc.speakerIds ?? []) {
      const list = bySpeaker.get(sid);
      if (list) list.push(r);
      else bySpeaker.set(sid, [r]);
    }
  }

  for (const [sid, list] of bySpeaker) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].doc.day !== list[j].doc.day) continue;
        if (!overlaps(list[i].doc, list[j].doc)) continue;
        const who = speakerName.get(sid) ?? '(unknown speaker)';
        conflicts.push({
          kind: 'speaker-double-booked',
          severity: 'error',
          summary: `${who} is on two sessions at once — ${timeRange(list[i])} and ${timeRange(list[j])}.`,
          day: list[i].doc.day,
          sessions: [ref(list[i]), ref(list[j])],
          subject: who,
        });
      }
    }
  }

  // ── Room double-booked ───────────────────────────────────────────────────
  const byRoom = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.doc.roomId) continue;
    const list = byRoom.get(r.doc.roomId);
    if (list) list.push(r);
    else byRoom.set(r.doc.roomId, [r]);
  }

  for (const [rid, list] of byRoom) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].doc.day !== list[j].doc.day) continue;
        if (!overlaps(list[i].doc, list[j].doc)) continue;
        const where = rooms.get(rid)?.name ?? list[i].doc.roomName ?? '(unknown room)';
        conflicts.push({
          kind: 'room-double-booked',
          severity: 'error',
          summary: `${where} is booked twice — ${timeRange(list[i])} and ${timeRange(list[j])}.`,
          day: list[i].doc.day,
          sessions: [ref(list[i]), ref(list[j])],
          subject: where,
        });
      }
    }
  }

  // ── Capacity, missing room, missing speaker ──────────────────────────────
  for (const r of rows) {
    const room = r.doc.roomId ? rooms.get(r.doc.roomId) : undefined;

    if (room?.capacity && r.doc.capacity && r.doc.capacity > room.capacity) {
      conflicts.push({
        kind: 'over-capacity',
        severity: 'warning',
        summary: `${r.doc.title} allows ${r.doc.capacity} attendees but ${room.name} seats ${room.capacity}.`,
        day: r.doc.day,
        sessions: [ref(r)],
        subject: room.name,
      });
    }

    /**
     * Only published sessions are flagged for a missing room or speaker. A
     * draft with neither is a session someone is halfway through writing, and
     * reporting it as a conflict makes this screen useless during the weeks the
     * programme is actually being built.
     */
    if (r.doc.status !== 'published') continue;

    if (!r.doc.roomId) {
      conflicts.push({
        kind: 'no-room',
        severity: 'error',
        summary: `${r.doc.title} is published with no room, so the agenda cannot say where it is.`,
        day: r.doc.day,
        sessions: [ref(r)],
      });
    }

    if ((r.doc.speakerIds ?? []).length === 0 && !SPEAKERLESS_FORMATS.has(r.doc.format)) {
      conflicts.push({
        kind: 'no-speaker',
        severity: 'warning',
        summary: `${r.doc.title} is a published ${r.doc.format} with nobody assigned to it.`,
        day: r.doc.day,
        sessions: [ref(r)],
      });
    }
  }

  conflicts.sort(
    (a, b) =>
      Number(b.severity === 'error') - Number(a.severity === 'error') ||
      a.day.localeCompare(b.day) ||
      a.sessions[0].startsAtLocal.localeCompare(b.sessions[0].startsAtLocal),
  );

  return {
    conflicts,
    errors: conflicts.filter((c) => c.severity === 'error').length,
    warnings: conflicts.filter((c) => c.severity === 'warning').length,
    sessionsChecked: rows.length,
  };
}
