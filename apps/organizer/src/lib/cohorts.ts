import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type RoomDoc,
  type SessionDoc,
  type TicketTypeDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * The reads behind Categories, Segments, Session Cap and Ticket Session
 * Mapping — and only the ones `data.ts` and `commerce.ts` do not already do.
 *
 * Those two modules project their documents down to what their screens need,
 * and three fields these four screens are entirely about did not survive the
 * projection: `SessionDoc.capacity` and `RoomDoc.capacity` are absent from
 * `SessionRow` and `RoomOption`, and `TicketTypeDoc.includesWorkshops` /
 * `includesVideoLibrary` are absent from `TicketTypeRow`. Rather than widen
 * three row types that a dozen other screens depend on, this module fetches the
 * missing fields as thin side-tables that a page joins onto the rows it already
 * has by document id.
 *
 * ── Why every query here is one equality filter ─────────────────────────────
 *
 * `where('eventId', '==', EVENT_ID)` and nothing else. That is served by
 * Firestore's automatic single-field index, so it needs no entry in
 * `firestore.indexes.json`. Add an `orderBy` and it becomes a composite-index
 * query that this repo does not declare — and the emulator does not enforce
 * index configuration at all, so it would pass every local run and fail in
 * production with `failed-precondition`. AGENTS.md records that exact bug
 * shipping twice. Sorting happens in memory, where 72 sessions and 4 ticket
 * tiers cost nothing.
 */

/** Room capacity, by room id. `capacity` is optional in the model and often unset. */
export interface RoomCapacity {
  name: string;
  /** Absent means nobody has recorded how many the room seats — not that it is uncapped. */
  capacity?: number;
}

export interface CapacityIndex {
  /** Session id → `SessionDoc.capacity`. A session with no cap is simply absent. */
  sessionCapacity: Map<string, number>;
  roomCapacity: Map<string, RoomCapacity>;
  /** Sessions considered, so a screen can say what it actually looked at. */
  sessionsRead: number;
}

/**
 * The two capacity numbers, keyed for joining onto `listSessions()`.
 *
 * `conflicts-core.ts` already compares these two — a session capped above its
 * room is one of the five conflicts it detects — and this deliberately does not
 * import it. That module takes whole `SessionDoc`s and returns a conflict list
 * sorted for a different screen; the Session Cap page needs the underlying
 * numbers for *every* capped session, including the ones that fit. Reusing
 * `detectConflicts` would give a list of the failures with the passes thrown
 * away, which is the wrong half.
 */
export async function capacityIndex(): Promise<CapacityIndex> {
  const [sessionSnap, roomSnap] = await Promise.all([
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.rooms).where('eventId', '==', EVENT_ID).get(),
  ]);

  const sessionCapacity = new Map<string, number>();
  for (const d of sessionSnap.docs) {
    const s = d.data() as SessionDoc;
    // `capacity` is `number | undefined`, and 0 would mean "nobody may attend",
    // which no organizer means. Both are treated as uncapped.
    if (typeof s.capacity === 'number' && s.capacity > 0) sessionCapacity.set(d.id, s.capacity);
  }

  const roomCapacity = new Map<string, RoomCapacity>();
  for (const d of roomSnap.docs) {
    const r = d.data() as RoomDoc;
    roomCapacity.set(d.id, { name: r.name, capacity: r.capacity });
  }

  return { sessionCapacity, roomCapacity, sessionsRead: sessionSnap.size };
}

/**
 * What a ticket tier grants, as the model actually records it.
 *
 * Two booleans. That is the whole of it — `TicketTypeDoc` has
 * `includesWorkshops` and `includesVideoLibrary` and no third field, no
 * per-session list and no per-track list. The mapping screen is built on these
 * and says so; inventing a richer entitlement here would put a matrix on screen
 * that nothing in the purchase path, the app or the rules would honour.
 */
export interface TicketEntitlementRow {
  id: string;
  name: string;
  includesWorkshops: boolean;
  includesVideoLibrary: boolean;
  /**
   * The tickets-page display flag, carried so the mapping screen can show it
   * *and* label it as not an entitlement. `TicketTypeRow.inPerson` defaults to
   * `true` when the field is absent, which is right for a catalogue card and
   * wrong for an access decision: the seeded `Virtual` tier has no `inPerson`
   * field at all and therefore reads as in-person here.
   */
  inPersonFlag?: boolean;
}

export async function listTicketEntitlements(): Promise<TicketEntitlementRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.ticketTypes)
    .where('eventId', '==', EVENT_ID)
    .get();

  return snap.docs
    .map((d) => {
      const t = d.data() as TicketTypeDoc;
      return {
        id: d.id,
        name: t.name,
        // No `?? true` anywhere in here. An absent boolean means the tier was
        // written before the field existed, and defaulting it to "granted"
        // would hand out workshop access on the strength of a missing key.
        includesWorkshops: t.includesWorkshops === true,
        includesVideoLibrary: t.includesVideoLibrary === true,
        inPersonFlag: typeof t.inPerson === 'boolean' ? t.inPerson : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The uids that actually have a `directory/{uid}` projection.
 *
 * `UserDoc.visibleInDirectory` is a *preference*; the projection is the thing
 * another attendee's device can read. The trigger that keeps the two in step is
 * unbuilt (Spark plan), so they can disagree, and a Segments screen that
 * reported the preference as though it were the directory would be asserting a
 * capability this project does not have. Reading both lets it report the drift
 * instead.
 */
export async function directoryUids(): Promise<Set<string>> {
  const snap = await db().collection(COLLECTIONS.directory).where('eventId', '==', EVENT_ID).get();
  return new Set(snap.docs.map((d) => d.id));
}
