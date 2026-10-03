// @vitest-environment jsdom
/**
 * The app's own badge hook, run against `firestore.rules`.
 *
 * `session-seats-app.test.ts` does this for the seat button; this is the same
 * shape for the one screen that has to work while somebody is standing at a
 * desk. It renders the real `useBadge` — not a copy of its lookup — against the
 * real rules on the emulator, with an ID token whose address is spelled the way
 * an account carries it rather than the way a registration stores it.
 *
 * Finding the registration is the whole badge, and it fails silently: a query
 * that matches nothing is indistinguishable from an account that holds no
 * ticket, so the attendee is told "No ticket on this account" while holding a
 * paid one. Both ways of matching nothing are covered below — a capital letter
 * in the address, and a ticket bought under a different address that lists this
 * one as an alternate.
 *
 * jsdom because `react-dom` needs a document to run effects in, and the effects
 * are where the listeners are. Everything the hook reaches for outside
 * Firestore — the signed-in account, the device cache, the Firestore handle —
 * is replaced below; the hook itself, `useCollection`, `useDocument` and the
 * shared queries in `lib/data/registrations.ts` are the code under test.
 *
 * Run with: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = `kgc-badge-app-test-${process.pid}`;

/** What the mocked modules below hand the hook. Set by `signedInAs`. */
let signedIn: { uid: string; email: string | null } | null = null;
let store: Firestore | null = null;

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ user: signedIn, loading: false }),
}));

vi.mock('@/lib/firebase/client', () => ({
  getDb: () => store,
  // Only reached by `retry()`, which these tests do not press. It is here
  // because `lib/data/errors.ts` imports it at module load.
  getFirebaseAuth: () => ({ currentUser: null }),
}));

vi.mock('@react-native-async-storage/async-storage', () => {
  const memory = new Map<string, string>();
  return {
    default: {
      getItem: (k: string) => Promise.resolve(memory.get(k) ?? null),
      setItem: (k: string, v: string) => {
        memory.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        memory.delete(k);
        return Promise.resolve();
      },
    },
  };
});

const { useBadge } = await import('../../app/src/lib/data/badge');

let env: RulesTestEnvironment;
let root: Root | null = null;

/**
 * Renders a hook and keeps its latest return value to hand. React needs a real
 * root to run effects, and `useBadge` is nothing but effects.
 */
function render<T>(hook: () => T): { current: () => T } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let latest: T;
  const Probe = () => {
    latest = hook();
    return null;
  };
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Probe));
  });
  return { current: () => latest };
}

/** Lets listeners answer. A Firestore snapshot arrives on its own schedule. */
async function settle(until: () => boolean, label: string) {
  const deadline = Date.now() + 10_000;
  while (!until()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
}

function signedInAs(uid: string, email: string | null): Firestore {
  signedIn = { uid, email };
  store = env
    .authenticatedContext(uid, {
      registered: true,
      roles: ['attendee'],
      ...(email ? { email, email_verified: true } : {}),
    })
    .firestore() as unknown as Firestore;
  return store;
}

async function admin(fn: (db: Firestore) => Promise<unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

const registration = (over: Record<string, unknown>) => ({
  eventId: 'kgc-2027',
  status: 'active',
  ticketType: 'Full Pass',
  altEmails: [],
  qrSecret: 'secret-xyz',
  claimCode: 'KGC27A',
  ...over,
});

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => env.clearFirestore());

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  signedIn = null;
  store = null;
});

describe('the badge finding its registration', () => {
  it('finds a ticket bought under the address the account spells in capitals', async () => {
    await admin((db) =>
      setDoc(
        doc(db, 'registrations/reg_ada'),
        registration({ email: 'ada.okonkwo@kgc.test', name: 'Ada Okonkwo' }),
      ),
    );
    signedInAs('ada', 'Ada.Okonkwo@KGC.test');

    const badge = render(() => useBadge());
    await settle(() => !badge.current().loading, 'the badge to settle');

    expect(badge.current().error).toBeNull();
    expect(badge.current().source).toBe('live');
    expect(badge.current().badge).toMatchObject({
      registrationId: 'reg_ada',
      qrSecret: 'secret-xyz',
      name: 'Ada Okonkwo',
      claimCode: 'KGC27A',
    });
  });

  it('finds a ticket that holds the signed-in address as an alternate', async () => {
    await admin((db) =>
      setDoc(
        doc(db, 'registrations/reg_desk'),
        registration({
          email: 'bookings@acme.test',
          name: 'Rune Petrova',
          // Stored folded, which is what `normaliseEmail` guarantees and what
          // the rules rely on: they cannot map over a list to fold it.
          altEmails: ['rune@kgc.test'],
        }),
      ),
    );
    signedInAs('rune', 'Rune@KGC.test');

    const badge = render(() => useBadge());
    await settle(() => !badge.current().loading, 'the badge to settle');

    expect(badge.current().error).toBeNull();
    expect(badge.current().source).toBe('live');
    expect(badge.current().badge).toMatchObject({
      registrationId: 'reg_desk',
      qrSecret: 'secret-xyz',
      name: 'Rune Petrova',
    });
  });

  it('still says there is no badge when there is genuinely no ticket', async () => {
    signedInAs('nobody', 'nobody@kgc.test');

    const badge = render(() => useBadge());
    await settle(() => !badge.current().loading, 'the badge to settle');

    expect(badge.current().badge).toBeNull();
    expect(badge.current().source).toBe('none');
    expect(badge.current().error).toBeNull();
  });

  it('settles rather than waiting forever for an account carrying no address', async () => {
    signedInAs('anon', null);

    const badge = render(() => useBadge());
    await settle(() => !badge.current().loading, 'the badge to settle');

    expect(badge.current().badge).toBeNull();
    expect(badge.current().source).toBe('none');
  });
});
