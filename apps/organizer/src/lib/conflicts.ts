import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type RoomDoc,
  type SessionDoc,
  type SpeakerDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Conflict Check — the programme problems that are invisible in a list.
 *
 * Whova's version flags double-booked speakers and rooms and lets an organizer
 * define custom rules. This finds the same two classes plus three more that a
 * conference actually trips over, and it needs **no new data at all** — every
 * check is a pass over the sessions, speakers and rooms already loaded by
 * Session Manager. That is why `AGENTS.md` names it the cheapest genuinely
 * useful thing on the unbuilt list.
 *
 * ── Why overlap is computed on local wall time ──────────────────────────────
 *
 * `startsAtLocal` / `endsAtLocal` are the authoring truth (`SessionDoc` says so)
 * and every session in one event shares a timezone, so string comparison on
 * `YYYY-MM-DDTHH:mm` is both correct and total-ordering. Using the derived UTC
 * `Timestamp`s instead would be equally correct and strictly worse: they are
 * derived, so a session whose derivation is stale would be compared on a value
 * that does not match what the organizer sees on screen.
 *
 * ── Cancelled and deleted sessions are excluded ─────────────────────────────
 *
 * A cancelled session does not occupy its room, and flagging it would train
 * people to ignore this screen. Drafts *are* included: an unpublished session
 * still needs a room that is free before it goes live, and finding out after
 * publishing is the failure this screen exists to prevent.
 */

export type {
  Conflict,
  ConflictKind,
  ConflictReport,
} from './conflicts-core';

import { detectConflicts } from './conflicts-core';
import type { ConflictReport } from './conflicts-core';

/**
 * Load the programme and run the detector over it.
 *
 * The arithmetic lives in `conflicts-core.ts` so it can be tested without this
 * module's `server-only` import, which throws outside a Server Component.
 */
export async function findConflicts(): Promise<ConflictReport> {
  const [sessionSnap, speakerSnap, roomSnap] = await Promise.all([
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.rooms).where('eventId', '==', EVENT_ID).get(),
  ]);

  return detectConflicts(
    sessionSnap.docs.map((d) => ({ id: d.id, doc: d.data() as SessionDoc })),
    speakerSnap.docs.map((d) => ({ id: d.id, doc: d.data() as SpeakerDoc })),
    roomSnap.docs.map((d) => ({ id: d.id, doc: d.data() as RoomDoc })),
  );
}
