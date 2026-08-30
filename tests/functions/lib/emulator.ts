import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'kgc-conference-app-and-website';
const FUNCTIONS_REGION = 'us-central1';

export function connectToEmulator(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('This test must run against the Firestore emulator (see npm run test:functions).');
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  return getFirestore();
}

/** For `verifyOtp` (functions/SPEC.md #10), which mints real Auth accounts. */
export function connectAuthEmulator(): Auth {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('This test must run against the Auth emulator (see npm run test:functions).');
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  return getAuth();
}

/**
 * Invokes an `onCall` function against the Functions emulator over plain
 * HTTP, using the wire format `onCall` itself implements (`{data}` in,
 * `{result}` or `{error: {status, message}}` out — see
 * `firebase-functions/lib/common/providers/https.js`). There is no callable
 * client SDK in this repo's dependencies (only `@firebase/rules-unit-testing`,
 * for the rules suite), and pulling one in for a single callable would be a
 * new dependency to save one fetch call.
 */
export async function callCallable<T = unknown>(
  name: string,
  data: unknown,
): Promise<{ status: number; result?: T; error?: { status: string; message: string } }> {
  const res = await fetch(`http://127.0.0.1:5001/${PROJECT_ID}/${FUNCTIONS_REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json()) as { result?: T; error?: { status: string; message: string } };
  return { status: res.status, ...body };
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
