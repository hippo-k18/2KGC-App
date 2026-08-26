import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function connectToEmulator(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('This test must run against the Firestore emulator (see npm run test:functions).');
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-database' });
  return getFirestore();
}

/**
 * Waits for `read()` to return the same value twice in a row, `quietMs`
 * apart.
 *
 * Seeding fires the exact same triggers a real client write would — every
 * seeded reply runs `onReplyWrite` — and those triggers are often still
 * draining when a test file's `beforeAll` runs right after `npm run seed`
 * returns. Without this, a baseline read races the tail of that drain and
 * the test measures a moving target instead of a clean delta.
 */
export async function waitUntilStable(
  read: () => Promise<number>,
  quietMs = 1_000,
  timeoutMs = 15_000,
): Promise<number> {
  const start = Date.now();
  let last = await read();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, quietMs));
    const next = await read();
    if (next === last) return next;
    last = next;
  }
  return last;
}
