import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * `auditLog/{id}` — who changed what, before and after, and when.
 *
 * Not in `packages/shared/src/models.ts` yet (that file belongs to another work
 * package in flight); this is the shape the console writes, and it should move
 * to `@kgc/shared` as `AuditLogDoc` when the two can be edited together.
 *
 * Cheap now, and the only way to answer "who moved that session?" at 09:05 on
 * day two with an angry speaker standing in front of you. `firestore.rules`
 * gives no client any access to this collection — only the Admin SDK writes it.
 */
export interface AuditEntry {
  eventId: string;
  /** Allowlisted organizer email. Replaced by the SSO subject when SSO lands. */
  actor: string;
  action: 'session.update' | 'announcement.create';
  /** Firestore path of the document that changed, e.g. `sessions/abc123`. */
  targetPath: string;
  targetId: string;
  /** Only the fields that actually changed, so a diff is readable at a glance. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  at: FirebaseFirestore.FieldValue;
}

export async function appendAudit(entry: Omit<AuditEntry, 'eventId' | 'at'>): Promise<void> {
  try {
    await db()
      .collection(COLLECTIONS.auditLog)
      .add({ ...entry, eventId: EVENT_ID, at: FieldValue.serverTimestamp() });
  } catch (err) {
    // An audit write must never be the reason an organizer cannot fix a room
    // five minutes before a talk. Losing the trail is bad; blocking the edit
    // during the event is worse. It surfaces on the war-room page instead.
    recordError('auditLog write failed', err);
  }
}

/**
 * The subset of a document that changed, as two flat maps. Firestore stores no
 * `undefined`, so a removed field is recorded as `null`.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};

  for (const key of Object.keys(after)) {
    const was = before[key];
    const now = after[key];
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
    changed.push(key);
    b[key] = was ?? null;
    a[key] = now ?? null;
  }
  return { before: b, after: a, changed };
}
