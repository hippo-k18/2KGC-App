/**
 * Fan-out for the denormalised display caches on `SessionDoc`.
 *
 * ── What this exists to prevent ──────────────────────────────────────────────
 *
 * `SessionDoc` carries four caches so the agenda list renders without N extra
 * reads per row: `speakerNames`, `roomName`, `primaryTrackName`,
 * `primaryTrackColor`. Their source documents live in `speakers`, `rooms` and
 * `tracks`, and Firestore has no cascade, no views and no joins. Every one of
 * those caches therefore needs a writer on the *other* side of the edit, and
 * until now only one existed: `session-manager/[id]/actions.ts` maintains
 * `roomName` when an organizer moves a session to a different room.
 *
 * Nothing maintains the caches when the *source* changes, because nothing can
 * change the source — speakers, tracks and rooms are read-only in the console
 * today. Audit C calls that hazard "armed, not fired". It fires the instant the
 * speaker and track editors ship: a single rename then leaves stale names on
 * every session that references the renamed thing, with no detection and no
 * repair path. This module is the missing writer, and it lands first.
 *
 * ⚠️ `roomName` is not decorative. `firestore.rules` has no `match /rooms/{…}`
 * block at all, so rules default-deny and the attendee app *cannot read the
 * `rooms` collection*. `session.roomName` is literally the only thing telling an
 * attendee which room to walk to. A stale one sends people to the wrong door;
 * an empty one sends them nowhere. Both matter more here than anywhere else in
 * this file, which is why `reconcile` refuses to blank a room name it cannot
 * re-resolve (see "absence versus ignorance" below).
 *
 * ── Why this file lives in `apps/organizer` and must not move ────────────────
 *
 * Three copies of `firebase-admin` are installed (`apps/web`,
 * `apps/organizer`, and the root that `scripts` resolves) — deliberate, because
 * the two websites are not workspace members. `FieldValue.serverTimestamp()`
 * and `FieldValue.delete()` are **class instances validated with `instanceof`**,
 * so a sentinel built by one copy fails every write made through a store built
 * by another. That took the purchase flow down in August 2026 and the test
 * suite did not catch it. The standing rule is: never construct a Firestore
 * sentinel inside `@kgc/scripts`.
 *
 * This module lives in `apps/organizer`, which owns its own store
 * (`lib/firestore.ts`) and its own `firebase-admin`, so the sentinels used here
 * are built by the same copy that builds the `Firestore` every real call site
 * passes in. That is why `FieldValue` may be imported directly below. **Moving
 * this file into `scripts/` or `packages/shared` breaks it**, silently, at
 * commit time rather than at compile time.
 *
 * The one caller that legitimately crosses that boundary is the test suite: it
 * runs from the repo root and builds its `Firestore` from the *root* copy. That
 * is what `WriteSentinels` is for — see the interface.
 *
 * ── Everything takes an explicit `Firestore` ────────────────────────────────
 *
 * No function here calls `db()`. `lib/firestore.ts` is `server-only`, and a
 * module that imports it cannot be tested from the root Vitest suites at all —
 * the same split that `conflicts-core.ts` and `pairings-core.ts` already use.
 * A server action passes `db()`; a test passes an emulator handle.
 */
import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type RoomDoc,
  type SessionDoc,
  type SpeakerDoc,
  type TrackDoc,
} from '@kgc/shared';

/**
 * Firestore's write sentinels, taken as an interface rather than imported at
 * the call site.
 *
 * The default is the `FieldValue` above, which is correct for every caller
 * inside the dashboard and is the only thing production ever uses. The seam
 * exists for one reason: the root test harness resolves a *second* copy of
 * `firebase-admin`, so a test's store rejects a sentinel this module built —
 * verified, not assumed (`probeFieldValue === FieldValue` is `false` under
 * Vitest, and so is the `instanceof` check Firestore actually performs). A test
 * that could not pass its own sentinels in would be unable to exercise the very
 * code path production runs, which is exactly the blind spot that let the
 * August 2026 outage through.
 */
export interface WriteSentinels {
  serverTimestamp(): unknown;
  delete(): unknown;
}

const DEFAULT_SENTINELS: WriteSentinels = {
  serverTimestamp: () => FieldValue.serverTimestamp(),
  delete: () => FieldValue.delete(),
};

export interface FanOutOptions {
  /** Defaults to the single event. Present so a second event cannot be touched by accident. */
  eventId?: string;
  /** Only ever passed by tests. See `WriteSentinels`. */
  sentinels?: WriteSentinels;
  /**
   * Compute the work and report it without committing anything. The result is
   * identical to a real run except that `updated` describes what *would* have
   * been written, so an organizer can be shown the blast radius of a rename
   * before agreeing to it.
   */
  dryRun?: boolean;
}

export interface FanOutResult {
  /** Sessions that reference the changed document at all. */
  scanned: number;
  /** Session ids written (or, under `dryRun`, that would have been). */
  updated: string[];
  /**
   * Session ids whose caches were already correct.
   *
   * This is the idempotency evidence: a second identical run puts every id here
   * and issues no writes at all.
   */
  unchanged: string[];
  /** Session ids in a batch whose commit threw. Their caches are still stale. */
  failed: string[];
  /** One message per failed batch, in commit order. */
  errors: string[];
  /**
   * Sessions this refused to guess at, because their cache is already malformed
   * — `speakerNames` and `speakerIds` of different lengths, so there is no
   * position to rewrite. `reconcileSessionCaches` rebuilds these from source.
   */
  needsReconcile: string[];
  /** False if any batch failed. Callers must surface this; a half-applied rename is the failure mode. */
  ok: boolean;
}

/**
 * Firestore caps a batch at 500 writes. 400 matches `scripts/lib/firestore.ts`
 * `commitAll`, and the headroom is deliberate: a batch also has a 10 MiB
 * payload ceiling, and these patches carry an array of names.
 *
 * ── What happens at 500 sessions ────────────────────────────────────────────
 *
 * Yes, this needs chunking, and it has it. Concretely, for a 500-session
 * conference:
 *
 *  - A **speaker rename** touches the sessions that speaker actually presents —
 *    one to five. One batch, always.
 *  - A **room rename** touches every session in that room. With eight rooms
 *    across three days that is up to ~60. One batch.
 *  - A **track rename** touches every session whose *primary* track is that
 *    track. A single-track event would be all 500. Two batches.
 *  - **`reconcileSessionCaches`** reads every session, speaker, track and room —
 *    four queries, ~600 documents — and writes only the drifted ones. A full
 *    rebuild of a 500-session agenda is two batches; a healthy one is zero.
 *
 * Batches commit sequentially rather than in parallel, so a failure has a
 * defined prefix: everything before the failing batch is written, everything
 * after it is attempted anyway, and `failed` names exactly which sessions are
 * still stale. Parallel commits would make "which half applied?" unanswerable,
 * and a half-applied rename is worse than a rename that fails.
 *
 * The per-document 1 write/sec ceiling does not apply — every write in a batch
 * lands on a different session document.
 */
const BATCH_LIMIT = 400;

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

/**
 * A speaker's name changed. Rewrite `speakerNames` on every session they are on.
 *
 * ── Ordering is the whole difficulty ────────────────────────────────────────
 *
 * `speakerNames` mirrors `speakerIds` positionally. Both the seed
 * (`seed-demo.ts:153-154`, `sids.map(sid => …name)`) and the Whova importer
 * (`import-whova.ts`, `speakerIds: sids` derived from the same split list)
 * build them that way, and `agenda/[id].tsx` falls back to `speakerNames[i]`
 * when a speaker document has not loaded. So the array is not a set: it is an
 * ordered list whose index carries meaning, and the order is the programme
 * committee's billing order — first author first, not alphabetical.
 *
 * Therefore this **replaces in place** and never sorts, dedupes or rebuilds.
 * Two speakers may share a name and a session may bill the same person twice;
 * neither is this function's business.
 *
 * When the two arrays are not the same length the positional relationship is
 * already broken and there is no honest way to know which entry belongs to whom
 * — the seed's `.filter(Boolean)` produces exactly this if a speaker document
 * is ever missing. Guessing would corrupt the billing order permanently, so
 * those sessions are reported in `needsReconcile` and left untouched for
 * `reconcileSessionCaches`, which reads the source documents and can align them
 * properly.
 */
export async function fanOutSpeakerRename(
  store: Firestore,
  speakerId: string,
  name: string,
  options: FanOutOptions = {},
): Promise<FanOutResult> {
  const eventId = options.eventId ?? EVENT_ID;
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;
  const result = emptyResult();
  const patches: SessionPatch[] = [];

  const sessions = await referencingSessions(store, 'speakerIds', 'array-contains', speakerId, eventId);
  result.scanned = sessions.length;

  for (const { id, data } of sessions) {
    const ids = data.speakerIds ?? [];
    const names = data.speakerNames;

    if (!Array.isArray(names) || names.length !== ids.length) {
      result.needsReconcile.push(id);
      continue;
    }

    const next = names.map((n, i) => (ids[i] === speakerId ? name : n));
    if (sameStrings(next, names)) {
      result.unchanged.push(id);
      continue;
    }

    patches.push({ id, patch: { speakerNames: next } });
  }

  await commit(store, patches, sentinels, options.dryRun ?? false, result);
  return result;
}

/**
 * A track's name or colour changed. Rewrite `primaryTrackName` and
 * `primaryTrackColor` on every session whose *primary* track it is.
 *
 * Only the primary track is cached, and the primary track is `trackIds[0]` —
 * both the seed (`TRACKS.find(t => t.name === s.tracks[0])`) and the importer
 * (`primaryTrackName: trackNames[0]`) agree on that. Programme chairs cross-list
 * talks, so a session can sit in several tracks; a session that merely
 * cross-lists this track caches nothing about it and is correctly left alone.
 * It is still counted in `scanned` and listed in `unchanged`, because "twelve
 * sessions reference this track, two of them display it" is the honest answer
 * to give an organizer before they rename it.
 *
 * `color: undefined` means the track genuinely has no colour, and the cached
 * colour is deleted rather than left behind — see "absence versus ignorance".
 */
export async function fanOutTrackChange(
  store: Firestore,
  trackId: string,
  track: { name: string; color?: string },
  options: FanOutOptions = {},
): Promise<FanOutResult> {
  const eventId = options.eventId ?? EVENT_ID;
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;
  const result = emptyResult();
  const patches: SessionPatch[] = [];

  const sessions = await referencingSessions(store, 'trackIds', 'array-contains', trackId, eventId);
  result.scanned = sessions.length;

  for (const { id, data } of sessions) {
    if ((data.trackIds ?? [])[0] !== trackId) {
      result.unchanged.push(id);
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (data.primaryTrackName !== track.name) patch.primaryTrackName = track.name;
    if (data.primaryTrackColor !== track.color) {
      patch.primaryTrackColor = track.color ?? DELETE_MARKER;
    }

    if (Object.keys(patch).length === 0) {
      result.unchanged.push(id);
      continue;
    }
    patches.push({ id, patch });
  }

  await commit(store, patches, sentinels, options.dryRun ?? false, result);
  return result;
}

/**
 * A room's name changed. Rewrite `roomName` on every session held in it.
 *
 * This is the one fan-out with a consequence an attendee feels physically: the
 * app has no read access to `rooms`, so this cache is its only wayfinding data.
 * Note the asymmetry with the other two — the console already maintains
 * `roomName` when a *session* moves room (`saveSessionAction`); this covers the
 * other direction, when the *room* is renamed under a session that has not moved.
 */
export async function fanOutRoomRename(
  store: Firestore,
  roomId: string,
  name: string,
  options: FanOutOptions = {},
): Promise<FanOutResult> {
  const eventId = options.eventId ?? EVENT_ID;
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;
  const result = emptyResult();
  const patches: SessionPatch[] = [];

  const sessions = await referencingSessions(store, 'roomId', '==', roomId, eventId);
  result.scanned = sessions.length;

  for (const { id, data } of sessions) {
    if (data.roomName === name) {
      result.unchanged.push(id);
      continue;
    }
    patches.push({ id, patch: { roomName: name } });
  }

  await commit(store, patches, sentinels, options.dryRun ?? false, result);
  return result;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export interface ReconcileResult extends FanOutResult {
  /**
   * `speakerIds`, `trackIds` and `roomId` values with no document behind them,
   * as `"sessionId → collection/id"`. These are the reason a cache could not be
   * rebuilt from source, and they are a genuine data fault worth showing an
   * organizer rather than silently absorbing.
   */
  dangling: string[];
}

/**
 * Rebuild all four caches on every session from the current source documents.
 *
 * This is the repair tool, and it is what makes the caches trustworthy: a fan-out
 * only fixes the edit in front of it, whereas this answers "is any of this
 * stale?" for the whole agenda. Run it after an import, after a bulk edit, or
 * whenever a fan-out reports `failed` or `needsReconcile` ids.
 *
 * It is a **no-op on healthy data**: it reproduces exactly what the seed and the
 * importer write, so a freshly seeded event reports every session in `unchanged`
 * and issues zero writes. That property is the test that this and the writers
 * agree; if it ever starts rewriting a fresh seed, one of the three has drifted.
 *
 * ── Absence versus ignorance ────────────────────────────────────────────────
 *
 * The rule this applies everywhere: **a source document that exists is
 * authoritative including in what it omits; a source document that is missing is
 * unknown, not empty.**
 *
 * So a track that exists with no `color` clears `primaryTrackColor`, and a
 * session with no `roomId` clears `roomName` — the source has spoken. But a
 * `roomId` pointing at a deleted room keeps the cached `roomName` and reports
 * the dangling reference, because blanking it turns a stale room name into *no*
 * room name, and the attendee app has nothing else to fall back on. A wrong
 * answer is recoverable by a human reading the printed programme; no answer is
 * how somebody misses a talk. Same reasoning for a speaker id with no speaker
 * document, where the cached name is also the last thing that knows who they are.
 */
export async function reconcileSessionCaches(
  store: Firestore,
  options: FanOutOptions = {},
): Promise<ReconcileResult> {
  const eventId = options.eventId ?? EVENT_ID;
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;
  const result: ReconcileResult = { ...emptyResult(), dangling: [] };
  const patches: SessionPatch[] = [];

  // Four whole-collection reads instead of a per-session join. At conference
  // scale that is ~600 documents against a join that would be thousands, and it
  // is the only shape that lets a single pass see every drift at once.
  const [sessionSnap, speakerSnap, trackSnap, roomSnap] = await Promise.all([
    store.collection(COLLECTIONS.sessions).where('eventId', '==', eventId).get(),
    store.collection(COLLECTIONS.speakers).where('eventId', '==', eventId).get(),
    store.collection(COLLECTIONS.tracks).where('eventId', '==', eventId).get(),
    store.collection(COLLECTIONS.rooms).where('eventId', '==', eventId).get(),
  ]);

  const speakers = new Map(speakerSnap.docs.map((d) => [d.id, d.data() as SpeakerDoc]));
  const tracks = new Map(trackSnap.docs.map((d) => [d.id, d.data() as TrackDoc]));
  const rooms = new Map(roomSnap.docs.map((d) => [d.id, d.data() as RoomDoc]));

  result.scanned = sessionSnap.size;

  for (const doc of sessionSnap.docs) {
    const id = doc.id;
    const data = doc.data() as SessionDoc;
    const patch: Record<string, unknown> = {};

    // --- speakerNames ---
    const ids = data.speakerIds ?? [];
    const cached = data.speakerNames;
    // Only when the two are the same length does index `i` still mean the same
    // person in both, which is what makes the stale-name fallback safe.
    const aligned = Array.isArray(cached) && cached.length === ids.length;
    const names: string[] = [];
    for (const [i, sid] of ids.entries()) {
      const resolved = speakers.get(sid)?.name;
      if (!resolved) result.dangling.push(`${id} → ${COLLECTIONS.speakers}/${sid}`);
      const fallback = aligned ? cached[i] : undefined;
      const chosen = resolved ?? fallback;
      // Dropped rather than held as a hole: the seed and the importer both emit
      // a filtered array, so emitting one here is what keeps a fresh seed a no-op.
      if (chosen) names.push(chosen);
    }
    if (!sameStrings(names, cached ?? [])) {
      patch.speakerNames = names;
    }

    // --- primaryTrackName / primaryTrackColor ---
    const primaryId = (data.trackIds ?? [])[0];
    const primary = primaryId ? tracks.get(primaryId) : undefined;
    if (primaryId && !primary) result.dangling.push(`${id} → ${COLLECTIONS.tracks}/${primaryId}`);
    const wantTrackName = primary ? primary.name : primaryId ? data.primaryTrackName : undefined;
    const wantTrackColor = primary ? primary.color : primaryId ? data.primaryTrackColor : undefined;
    if (data.primaryTrackName !== wantTrackName) {
      patch.primaryTrackName = wantTrackName ?? DELETE_MARKER;
    }
    if (data.primaryTrackColor !== wantTrackColor) {
      patch.primaryTrackColor = wantTrackColor ?? DELETE_MARKER;
    }

    // --- roomName ---
    const room = data.roomId ? rooms.get(data.roomId) : undefined;
    if (data.roomId && !room) result.dangling.push(`${id} → ${COLLECTIONS.rooms}/${data.roomId}`);
    const wantRoomName = room ? room.name : data.roomId ? data.roomName : undefined;
    if (data.roomName !== wantRoomName) {
      patch.roomName = wantRoomName ?? DELETE_MARKER;
    }

    if (Object.keys(patch).length === 0) {
      result.unchanged.push(id);
      continue;
    }
    patches.push({ id, patch });
  }

  await commit(store, patches, sentinels, options.dryRun ?? false, result);
  return result;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** One line an organizer can read, for a server action's `message` or `error`. */
export function summariseFanOut(result: FanOutResult): string {
  const parts = [`${result.updated.length} of ${result.scanned} session(s) updated`];
  if (result.unchanged.length) parts.push(`${result.unchanged.length} already correct`);
  if (result.needsReconcile.length) {
    parts.push(`${result.needsReconcile.length} need a reconcile (${result.needsReconcile.join(', ')})`);
  }
  if (result.failed.length) {
    parts.push(`${result.failed.length} FAILED and are still stale (${result.failed.join(', ')})`);
  }
  return `${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface SessionPatch {
  id: string;
  /** Field values plus, for a field to clear, `DELETE_MARKER`. */
  patch: Record<string, unknown>;
}

/**
 * A stand-in for `FieldValue.delete()`, swapped for the caller's real sentinel
 * at commit time.
 *
 * The patches are built before a batch exists, and building them with a real
 * sentinel would bake in *this* module's copy of `firebase-admin` — the exact
 * mistake this file's header warns about. A unique symbol also cannot collide
 * with a legitimate field value, which a string marker could.
 */
const DELETE_MARKER = Symbol('FieldValue.delete()');

function emptyResult(): FanOutResult {
  return { scanned: 0, updated: [], unchanged: [], failed: [], errors: [], needsReconcile: [], ok: true };
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Every session referencing a changed document.
 *
 * Deliberately a **single-field query with the event filtered in memory**,
 * rather than the `eventId ==` + `array-contains` composite the rest of
 * `data.ts` uses. Firestore creates single-field indexes automatically;
 * a composite needs a deployed definition, `firestore.indexes.json` has none
 * covering `eventId` + `trackIds` without `status`, and the index file has never
 * been applied to the live project. A fan-out that dies on FAILED_PRECONDITION
 * leaves precisely the stale caches it was written to prevent, so it buys
 * reliability with a filter over one event's worth of documents.
 */
async function referencingSessions(
  store: Firestore,
  field: 'speakerIds' | 'trackIds' | 'roomId',
  op: 'array-contains' | '==',
  value: string,
  eventId: string,
): Promise<{ id: string; data: SessionDoc }[]> {
  const snap = await store.collection(COLLECTIONS.sessions).where(field, op, value).get();
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as SessionDoc }))
    .filter((s) => s.data.eventId === eventId);
}

/**
 * Commit the patches in chunks, recording rather than hiding a partial failure.
 *
 * `update()` rather than `set({ merge: true })` on purpose: a session id that no
 * longer exists must fail loudly instead of resurrecting a deleted session as a
 * fragment holding nothing but a cached speaker name.
 */
async function commit(
  store: Firestore,
  patches: SessionPatch[],
  sentinels: WriteSentinels,
  dryRun: boolean,
  result: FanOutResult,
): Promise<void> {
  if (dryRun) {
    result.updated.push(...patches.map((p) => p.id));
    return;
  }

  for (let i = 0; i < patches.length; i += BATCH_LIMIT) {
    const chunk = patches.slice(i, i + BATCH_LIMIT);

    try {
      const batch = store.batch();

      // Staging is inside the `try` on purpose. `batch.update()` validates and
      // serialises eagerly, so a rejected value — a sentinel from the wrong copy
      // of `firebase-admin` being the case that has actually happened here —
      // throws *before* any commit. Left outside, that exception would escape
      // past every chunk already written and the caller would be handed a stack
      // trace instead of the list of sessions still stale, which is precisely
      // the silence this function exists to prevent.
      for (const { id, patch } of chunk) {
        const resolved: Record<string, unknown> = { updatedAt: sentinels.serverTimestamp() };
        for (const [key, value] of Object.entries(patch)) {
          resolved[key] = value === DELETE_MARKER ? sentinels.delete() : value;
        }
        batch.update(store.collection(COLLECTIONS.sessions).doc(id), resolved);
      }

      await batch.commit();
      result.updated.push(...chunk.map((c) => c.id));
    } catch (err) {
      // Keep going. The remaining chunks are independent, and stopping here
      // would leave the caller unable to say which sessions are stale — the
      // point of the whole exercise is that a partial rename is visible.
      result.failed.push(...chunk.map((c) => c.id));
      result.errors.push(err instanceof Error ? err.message : String(err));
      result.ok = false;
    }
  }
}
