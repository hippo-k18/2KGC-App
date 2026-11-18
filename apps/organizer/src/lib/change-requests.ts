import 'server-only';

import { createHmac } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type ChangeRequestDoc, type ChangeRequestStatus } from '@kgc/shared';
import { sendChangeRequestBuilt, sendChangeRequestLive, type SendOutcome } from '@kgc/scripts/src/lib/email';
import { limitId, perHourAndDay, takeAllowance } from '@kgc/scripts/src/lib/rate-limit';
import {
  CHANGE_REQUEST_CAPS,
  NOTE_MAX,
  emailForTransition,
  isStatus,
  screenshotPath,
  screenshotType,
  type ChangeEmail,
  type CleanSubmission,
} from './change-requests-core';
import { recordError } from './errors';
import { db } from './firestore';
import { readPrivateObject, removeFolder, storePrivateImage } from './uploads';

/**
 * The change request store (T428). The rules are in `change-requests-core.ts`;
 * this is the Firestore and Storage half, so it is `server-only`.
 *
 * Everything here runs under the Admin SDK. `changeRequests` has no rules
 * block and `change-requests/` in Storage refuses every client, so a browser
 * can neither read a request nor fetch a screenshot by any path but the
 * dashboard's signed-in routes.
 */

const col = () => db().collection(COLLECTIONS.changeRequests);

/**
 * A keyed hash of the sender's IP. Keyed, because an unkeyed hash of an IPv4
 * address is reversed by hashing all four billion of them. The key is the
 * dashboard's session secret, which never leaves the server.
 */
function ipHash(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const key = process.env.CONSOLE_SESSION_SECRET || 'kgc-change-requests';
  return createHmac('sha256', key).update(`change-request:${ip}`).digest('hex').slice(0, 32);
}

/** One more request from this address and this IP, or false when either is full. Fails closed. */
export async function changeRequestAllowed(email: string, ip: string | undefined): Promise<boolean> {
  const caps = perHourAndDay(CHANGE_REQUEST_CAPS.perHour, CHANGE_REQUEST_CAPS.perDay);
  return takeAllowance(db() as unknown as AdminFirestore, [
    { id: limitId('changeRequest', 'email', email), kind: 'change-request-email', caps },
    { id: ip ? limitId('changeRequest', 'ip', ip) : undefined, kind: 'change-request-ip', caps },
  ]);
}

export class ScreenshotRejected extends Error {}

/**
 * Save one request and its screenshots. Every file's type is read from its
 * bytes before anything is written; one bad file refuses the whole request,
 * so a sender never gets a half-saved one.
 */
export async function createChangeRequest(
  value: CleanSubmission,
  files: File[],
  ip: string | undefined,
): Promise<string> {
  const checked: { bytes: Uint8Array; type: NonNullable<ReturnType<typeof screenshotType>> }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = screenshotType(bytes);
    if (!type) throw new ScreenshotRejected(`${file.name || 'One file'} is not a PNG, JPEG or WebP image.`);
    checked.push({ bytes, type });
  }

  const ref = col().doc();
  const screenshots = checked.map((c, i) => screenshotPath(ref.id, i, c.type));
  try {
    await Promise.all(checked.map((c, i) => storePrivateImage(screenshots[i], c.bytes, c.type)));
    const now = Timestamp.now();
    const doc: ChangeRequestDoc = {
      email: value.email,
      description: value.description,
      ...(value.pageUrl ? { pageUrl: value.pageUrl } : {}),
      screenshots,
      status: 'new',
      ...(ipHash(ip) ? { ipHash: ipHash(ip) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await ref.create(doc);
  } catch (err) {
    if (screenshots.length) await removeFolder(`change-requests/${ref.id}`);
    throw err;
  }
  return ref.id;
}

/** One request as the dashboard reads it. Times are epoch ms. */
export interface ChangeRequestRow {
  id: string;
  email: string;
  description: string;
  pageUrl?: string;
  screenshots: string[];
  status: ChangeRequestStatus;
  notes?: string;
  emailed: { built?: number; live?: number };
  updatedBy?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

const ms = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0);

function toRow(id: string, d: ChangeRequestDoc): ChangeRequestRow {
  return {
    id,
    email: d.email,
    description: d.description,
    pageUrl: d.pageUrl,
    screenshots: Array.isArray(d.screenshots) ? d.screenshots : [],
    status: isStatus(d.status) ? d.status : 'new',
    notes: d.notes,
    emailed: {
      ...(d.emailed?.built ? { built: ms(d.emailed.built) } : {}),
      ...(d.emailed?.live ? { live: ms(d.emailed.live) } : {}),
    },
    updatedBy: d.updatedBy,
    createdAtMs: ms(d.createdAt),
    updatedAtMs: ms(d.updatedAt),
  };
}

/**
 * Newest first, at most 500. Filtered here rather than in the query, so the
 * screen needs no composite index: one field ordered is free.
 */
export async function listChangeRequests(status?: ChangeRequestStatus): Promise<{ rows: ChangeRequestRow[]; counts: Record<ChangeRequestStatus, number> }> {
  const snap = await col().orderBy('createdAt', 'desc').limit(500).get();
  const all = snap.docs.map((d) => toRow(d.id, d.data() as ChangeRequestDoc));
  const counts: Record<ChangeRequestStatus, number> = { new: 0, building: 0, built: 0, live: 0, declined: 0 };
  for (const r of all) counts[r.status]++;
  return { rows: status ? all.filter((r) => r.status === status) : all, counts };
}

export async function getChangeRequest(id: string): Promise<ChangeRequestRow | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
  const snap = await col().doc(id).get();
  return snap.exists ? toRow(snap.id, snap.data() as ChangeRequestDoc) : null;
}

/** How many are `new`, for the rail. One aggregation read; zero on any error. */
export async function newChangeRequestCount(): Promise<number> {
  try {
    const agg = await col().where('status', '==', 'new').count().get();
    return agg.data().count;
  } catch (err) {
    recordError('change-requests.count', err);
    return 0;
  }
}

export interface StatusResult {
  ok: boolean;
  /** Which email this move sent, and what happened to it. */
  email?: { kind: ChangeEmail; outcome: SendOutcome };
  error?: string;
}

/**
 * Move a request to `next`, and send the sender the email that move owes.
 *
 * The email is claimed in the same transaction as the status: `emailed.built`
 * (or `.live`) is written before anything is sent, so a double press, two
 * organizers at once, or built → building → built mails exactly once. A send
 * that fails is not retried and never undoes the status; the Email Log row
 * that `send()` writes is the record of it.
 */
export async function setChangeRequestStatus(
  id: string,
  next: ChangeRequestStatus,
  actor: string,
  send: { built: typeof sendChangeRequestBuilt; live: typeof sendChangeRequestLive } = {
    built: sendChangeRequestBuilt,
    live: sendChangeRequestLive,
  },
): Promise<StatusResult> {
  const ref = col().doc(id);
  let owed: { kind: ChangeEmail; doc: ChangeRequestDoc } | null = null;
  try {
    owed = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('not-found');
      const doc = snap.data() as ChangeRequestDoc;
      const kind = emailForTransition(isStatus(doc.status) ? doc.status : 'new', next, doc.emailed);
      tx.update(ref, {
        status: next,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor,
        ...(kind ? { [`emailed.${kind}`]: FieldValue.serverTimestamp() } : {}),
      });
      return kind ? { kind, doc } : null;
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'not-found') return { ok: false, error: 'That request no longer exists.' };
    recordError('change-requests.status', err);
    return { ok: false, error: 'The status could not be saved. Try again.' };
  }

  if (!owed) return { ok: true };
  const input = { to: owed.doc.email, description: owed.doc.description, pageUrl: owed.doc.pageUrl, actor };
  let outcome: SendOutcome = 'failed';
  try {
    outcome = await (owed.kind === "built" ? send.built : send.live)(db(), input);
  } catch (err) {
    // `send()` never throws; this is belt and braces so a status never fails on mail.
    recordError('change-requests.email', err);
  }
  return { ok: true, email: { kind: owed.kind, outcome } };
}

export async function saveChangeRequestNote(id: string, note: string, actor: string): Promise<boolean> {
  const clean = note.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX);
  try {
    await col().doc(id).update({
      notes: clean ? clean : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    });
    return true;
  } catch (err) {
    recordError('change-requests.note', err);
    return false;
  }
}

/** The bytes of a request's nth screenshot (0-based), or null. Only paths stored on the request are read. */
export async function readScreenshot(id: string, index: number): Promise<{ bytes: Buffer; path: string } | null> {
  const row = await getChangeRequest(id);
  const path = row?.screenshots[index];
  if (!path) return null;
  const bytes = await readPrivateObject(path);
  return bytes ? { bytes, path } : null;
}
