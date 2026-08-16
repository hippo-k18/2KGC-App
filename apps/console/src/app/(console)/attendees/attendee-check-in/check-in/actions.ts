'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  scanEventIdFor,
  type CheckInDoc,
  type CheckInListDoc,
} from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import {
  listRegistrations,
  matchCode,
  touchStation,
  type ScanOutcome,
} from '@/lib/checkin';

/**
 * Firestore's `ALREADY_EXISTS`. gRPC status 6.
 *
 * This is load-bearing, not defensive coding. `checkInLists/{listId}/checkIns`
 * is keyed by `registrationId` precisely so that the second scan of a badge is
 * a `create` that fails — **the failure is the duplicate check**. There is no
 * read-then-write, so there is no window between the read and the write for two
 * stations to both decide the person is not yet checked in. Turning this into a
 * `set({ merge: true })` would silently overwrite the first check-in's
 * timestamp and station and destroy the only evidence of the double scan.
 */
function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: number | string; message?: string };
  return e?.code === 6 || String(e?.message ?? '').includes('ALREADY_EXISTS');
}

export interface ScanInput {
  listId: string;
  /** A `qrSecret` from a badge QR, or a six-character `claimCode` typed by hand. */
  code: string;
  /** Stable per browser, from `localStorage`. Also the `checkInStations` doc id. */
  deviceId: string;
  /** This device's own scan counter. With `deviceId` it makes the scan id. */
  clientScanId: string;
  stationLabel: string;
  /** 'camera' or 'typed' — recorded for the operator, not stored. */
  source: 'camera' | 'typed';
}

export interface ScanResult {
  outcome: ScanOutcome;
  /** Which of the two scannable fields matched, so staff can see the fallback worked. */
  matchedOn?: 'qrSecret' | 'claimCode';
  source: ScanInput['source'];
  registrationId?: string;
  name?: string;
  email?: string;
  ticketType?: string;
  /** Present when `outcome === 'cancelled'` — the registration's actual status. */
  registrationStatus?: string;
  /** ISO. For `ok` this is now; for `duplicate` it is the *first* check-in. */
  checkedInAt?: string;
  stationLabel?: string;
  /** `scanEvents/{deviceId}_{clientScanId}` — pasteable straight into the emulator UI. */
  scanEventId: string;
  checkInPath?: string;
  /**
   * True when the scan log already held this exact `{deviceId}_{clientScanId}`,
   * i.e. an offline queue replayed. The original entry is kept untouched.
   */
  scanEventReplayed: boolean;
  error?: string;
  at: string;
}

/**
 * One scan, start to finish.
 *
 * Order matters and is not arbitrary:
 *
 *   1. resolve the code to a registration (in memory — see `lib/checkin.ts`);
 *   2. attempt the `create` on the check-in, which is what decides ok vs
 *      duplicate;
 *   3. only then append to `scanEvents`, because the raw log records the
 *      outcome and cannot know it any earlier.
 *
 * Every one of the four outcomes is written to `scanEvents`, including the ones
 * that changed nothing. A code that matches nobody is exactly the event an
 * organizer wants to be able to count at 09:30 on day one.
 */
export async function submitScanAction(input: ScanInput): Promise<ScanResult> {
  const actor = await requireOrganizer();
  const at = new Date().toISOString();
  const scanEventId = scanEventIdFor(input.deviceId, input.clientScanId);

  const base: ScanResult = {
    outcome: 'unknown',
    source: input.source,
    scanEventId,
    scanEventReplayed: false,
    at,
  };

  const code = input.code.trim();
  if (!code) return { ...base, error: 'No code. Scan a badge or type the code.' };
  if (!input.listId) return { ...base, error: 'Pick a check-in list first.' };

  try {
    const [registrations] = await Promise.all([
      listRegistrations(),
      touchStation(input.deviceId, input.stationLabel),
    ]);

    const match = matchCode(registrations, code);

    let outcome: ScanOutcome;
    let result: ScanResult;

    if (!match) {
      outcome = 'unknown';
      result = { ...base, outcome };
    } else if (match.row.status !== 'active') {
      // The ticket exists but is cancelled or transferred. Deliberately not
      // checked in and deliberately not "not found" — the person at the desk
      // is real and the answer they need is "talk to registration", not "who
      // are you". No document is written to `checkIns`.
      outcome = 'cancelled';
      result = {
        ...base,
        outcome,
        matchedOn: match.matchedOn,
        registrationId: match.row.id,
        name: match.row.name,
        email: match.row.email,
        ticketType: match.row.ticketType,
        registrationStatus: match.row.status,
      };
    } else {
      const ref = db()
        .collection(COLLECTIONS.checkInLists)
        .doc(input.listId)
        .collection(SUBCOLLECTIONS.checkIns)
        .doc(match.row.id);

      try {
        await ref.create({
          registrationId: match.row.id,
          checkedInAt: FieldValue.serverTimestamp(),
          stationId: input.deviceId,
          // The allowlisted organizer email stands in for a uid until console
          // SSO lands and there is a real Firebase Auth subject to record —
          // the same stand-in `announcement.create` makes.
          operatorUid: actor,
        });
        outcome = 'ok';
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
        outcome = 'duplicate';
      }

      const snap = await ref.get();
      const existing = snap.data() as CheckInDoc | undefined;
      const stationId = existing?.stationId ?? input.deviceId;
      const stationLabel =
        stationId === input.deviceId
          ? input.stationLabel
          : ((
              await db().collection(COLLECTIONS.checkInStations).doc(stationId).get()
            ).data()?.label as string | undefined) ?? stationId;

      result = {
        ...base,
        outcome,
        matchedOn: match.matchedOn,
        registrationId: match.row.id,
        name: match.row.name,
        email: match.row.email,
        ticketType: match.row.ticketType,
        checkedInAt: existing?.checkedInAt
          ? (existing.checkedInAt as unknown as { toDate(): Date }).toDate().toISOString()
          : at,
        stationLabel,
        checkInPath: `${COLLECTIONS.checkInLists}/${input.listId}/${SUBCOLLECTIONS.checkIns}/${match.row.id}`,
      };

      if (outcome === 'ok') {
        await appendAudit({
          actor,
          action: 'checkin.create',
          targetPath: result.checkInPath!,
          targetId: match.row.id,
          before: {},
          after: { registrationId: match.row.id, listId: input.listId, stationId: input.deviceId },
        });
      }
    }

    // The raw, append-only log. `create()` rather than `set()` for the same
    // reason as the check-in: a station that lost the network and is replaying
    // its queue writes the same `{deviceId}_{clientScanId}` twice, and the
    // second attempt must not overwrite the first record's outcome or its
    // timestamp. `already-exists` here means "we already have this scan", which
    // is success, not failure.
    const scanRef = db().collection(COLLECTIONS.scanEvents).doc(scanEventId);
    try {
      await scanRef.create({
        eventId: EVENT_ID,
        deviceId: input.deviceId,
        clientScanId: input.clientScanId,
        // Named `qrSecret` by the model. It holds whatever was scanned, which
        // is a `claimCode` when the fallback was used.
        qrSecret: code,
        listId: input.listId,
        scannedAt: FieldValue.serverTimestamp(),
        syncedAt: FieldValue.serverTimestamp(),
        result: outcome,
      });
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      result.scanEventReplayed = true;
    }

    revalidatePath(ROUTES.checkIn);
    revalidatePath(ROUTES.warRoom);
    return result;
  } catch (err) {
    recordError('checkin.scan', err);
    return {
      ...base,
      error: err instanceof Error ? err.message : 'Scan failed.',
    };
  }
}

export interface CreateListState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Create another list — a workshop door, a dinner, day two. */
export async function createListAction(
  _prev: CreateListState,
  formData: FormData,
): Promise<CreateListState> {
  const actor = await requireOrganizer();

  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'event') as CheckInListDoc['kind'];

  if (!name) return { error: 'Name the list — "Day 2 door", "Workshop A".' };
  if (!['event', 'session', 'meal', 'workshop'].includes(kind)) {
    return { error: 'Unknown list kind.' };
  }

  try {
    const now = FieldValue.serverTimestamp();
    const ref = await db().collection(COLLECTIONS.checkInLists).add({
      eventId: EVENT_ID,
      name,
      kind,
      createdAt: now,
      updatedAt: now,
    });

    await appendAudit({
      actor,
      action: 'checkinList.create',
      targetPath: `${COLLECTIONS.checkInLists}/${ref.id}`,
      targetId: ref.id,
      before: {},
      after: { name, kind },
    });

    revalidatePath(ROUTES.checkIn);
    return { ok: true, message: `Created ${name} (${ref.id}).` };
  } catch (err) {
    recordError('checkinList.create', err);
    return { error: err instanceof Error ? err.message : 'Could not create the list.' };
  }
}
