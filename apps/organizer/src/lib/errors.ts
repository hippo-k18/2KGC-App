import 'server-only';

/**
 * A 50-entry in-memory ring of server-side failures, for the war-room page.
 *
 * Deliberately not Firestore: the errors most worth seeing are the ones where
 * Firestore is the thing that is broken. Deliberately not Sentry either — that
 * is DECISIONS.md #12 and Phase 1. This buys the war room something real to
 * show during the demo for the cost of twenty lines, and it resets when the
 * dev server restarts, which is the correct lifetime for a single-process tool.
 */
export interface RecordedError {
  at: string;
  context: string;
  message: string;
}

const RING_SIZE = 50;

// Survives the module reloads that `next dev` does on every edit.
const globalRing = globalThis as unknown as { __kgcConsoleErrors?: RecordedError[] };
globalRing.__kgcConsoleErrors ??= [];

export function recordError(context: string, err: unknown): void {
  const ring = globalRing.__kgcConsoleErrors!;
  ring.unshift({
    at: new Date().toISOString(),
    context,
    message: err instanceof Error ? err.message : String(err),
  });
  ring.length = Math.min(ring.length, RING_SIZE);
  console.error(`[console] ${context}:`, err);
}

export function recentErrors(limit = 20): RecordedError[] {
  return globalRing.__kgcConsoleErrors!.slice(0, limit);
}
