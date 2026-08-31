import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { db } from './firestore';

/**
 * Making a failure on the public site visible to a human.
 *
 * ── Why this is not a copy of the dashboard's `recordError` ─────────────────
 *
 * `apps/organizer/src/lib/errors.ts` keeps a 50-entry in-memory ring that its
 * war-room page renders. That works there because the dashboard is one
 * long-lived process with a screen to show it on. Neither is true here: this
 * site runs as serverless functions on Netlify, so a ring would live for the
 * duration of one request and be read by nobody, and there is no operator
 * screen on a public marketing site to read it from.
 *
 * The two apps are separate installs and neither may import the other, so this
 * is the same idea reached differently: log it where the deploy log will show
 * it, and append to `auditLog`, which the dashboard already reads and renders
 * (`recentAudit()` → Tools › Report). That gives the organizer one place where
 * "a buyer paid and their account could not be created" is visible, rather than
 * a line in a log nobody opens.
 *
 * ⚠️ This is best-effort by construction. It is called from paths whose whole
 * point is that they must not fail — a failed purchase is worse than an
 * unrecorded failure — so a broken audit write is swallowed after being logged.
 * Sentinels are safe in this file: it is `server-only`, so it is only ever
 * loaded by `apps/web`, which owns the store it writes through.
 */
export async function recordError(
  /** A dotted action, e.g. `account.provision`. Rendered verbatim by the dashboard. */
  context: string,
  err: unknown,
  /** What the failure was about, so the entry points somewhere. */
  target?: { path: string; id: string },
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[web] ${context}:`, err);

  try {
    await db()
      .collection(COLLECTIONS.auditLog)
      .add({
        eventId: EVENT_ID,
        // Not a person. The website takes money without anybody pressing a
        // button, so the honest actor is the process that did it.
        actor: 'website',
        action: context,
        targetPath: target?.path ?? 'website',
        targetId: target?.id ?? '',
        before: {},
        after: { error: message },
        at: FieldValue.serverTimestamp(),
      });
  } catch (writeErr) {
    console.error(`[web] ${context}: could not append the audit entry either`, writeErr);
  }
}

/**
 * Record something that went wrong but is not an exception — an oversold seat,
 * a counter that could not be corrected. Same destination, so an organizer has
 * one feed rather than two.
 */
export async function recordWarning(
  context: string,
  detail: Record<string, unknown>,
  target?: { path: string; id: string },
): Promise<void> {
  console.warn(`[web] ${context}:`, detail);

  try {
    await db()
      .collection(COLLECTIONS.auditLog)
      .add({
        eventId: EVENT_ID,
        actor: 'website',
        action: context,
        targetPath: target?.path ?? 'website',
        targetId: target?.id ?? '',
        before: {},
        after: detail,
        at: FieldValue.serverTimestamp(),
      });
  } catch (writeErr) {
    console.error(`[web] ${context}: could not append the audit entry`, writeErr);
  }
}
