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
 * Cohorts — the four Attendees screens that derive rather than store.
 *
 * ── Everything here is computed, and every screen says so ───────────────────
 *
 * Whova's Categories and Segments are *authored*: an organizer defines a
 * segment from registration answers and it becomes a real thing that comms and
 * badges target. We have no registration answers — Question Forms is unbuilt —
 * so nothing here can be authored, and pretending otherwise would be the
 * fifteenth instance of this codebase's recurring defect (AGENTS.md: "the app
 * claims capabilities it does not have", fourteen known cases).
 *
 * What we can do honestly is derive the cohorts the data already supports, and
 * label them as derived. That is genuinely useful — "who has not opened the
 * app" is a list an organizer acts on — and it is not the same product.
 */

/**
 * ── One API, not two ────────────────────────────────────────────────────────
 *
 * An earlier draft of this file exported a parallel set of readers
 * (`readCategories`, `readSegments`, `readSessionCaps`, `readTicketAccess`)
 * that computed the same things in a slightly different shape. Nothing called
 * them: the four screens use the three functions below plus `listAttendees()`.
 *
 * They are deleted rather than left in place. Two functions that answer the
 * same question are two answers that eventually disagree, and the one nobody
 * calls is the one nobody notices drifting — which is the exact failure this
 * codebase has already had with `ensureRegistration` and with the sponsor tier
 * list.
 */

export interface RoomCapacity {
  name: string;
  capacity?: number;
}

export interface CapacityIndex {
  /** Session id → `SessionDoc.capacity`. An uncapped session is simply absent. */
  sessionCapacity: Map<string, number>;
  roomCapacity: Map<string, RoomCapacity>;
  /** Sessions read, so a screen can say what it actually looked at. */
  sessionsRead: number;
}

/**
 * The two capacity numbers, keyed for joining onto `listSessions()`.
 *
 * Deliberately not `detectConflicts()` from `conflicts-core.ts`, which makes the
 * same comparison: that returns only the sessions that fail, and the question
 * on the Session Cap screen — how tight is every cap we have set — needs the
 * ones that pass as well.
 */
export async function capacityIndex(): Promise<CapacityIndex> {
  const [sessionSnap, roomSnap] = await Promise.all([
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.rooms).where('eventId', '==', EVENT_ID).get(),
  ]);

  const sessionCapacity = new Map<string, number>();
  for (const d of sessionSnap.docs) {
    const s = d.data() as SessionDoc;
    // 0 would mean "nobody may attend", which no organizer means. Treated as
    // uncapped alongside undefined.
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
 * What a ticket tier grants, as the model records it rather than as the
 * marketing copy describes it.
 *
 * Read from `includesWorkshops` / `includesVideoLibrary` and not from the
 * `includes` bullet list, which is prose an organizer types: a tier whose
 * bullets happen to mention the word "workshop" in another sentence would grant
 * workshop access, and a tier that grants it without saying so would not.
 */
export interface TicketEntitlementRow {
  id: string;
  name: string;
  includesWorkshops: boolean;
  includesVideoLibrary: boolean;
  /**
   * Carried so a screen can show the flag *and* label it as not an entitlement.
   * `TicketTypeRow.inPerson` reads it as `t.inPerson ?? true`, which is right
   * for a catalogue card and wrong for an access decision — the seeded
   * `virtual` tier has no such field and would read as in-person.
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
        // No `?? true` anywhere here. An absent boolean means the tier predates
        // the field, and defaulting it to "granted" hands out workshop access on
        // the strength of a missing key.
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
 * `UserDoc.visibleInDirectory` is a preference; the projection is the thing
 * another attendee's device can read. The trigger that keeps them in step is
 * unbuilt (Spark), so they drift — and reporting the preference as though it
 * were the directory would assert a capability this project does not have.
 * Reading both lets a screen report the drift instead.
 */
export async function directoryUids(): Promise<Set<string>> {
  const snap = await db().collection(COLLECTIONS.directory).where('eventId', '==', EVENT_ID).get();
  return new Set(snap.docs.map((d) => d.id));
}
