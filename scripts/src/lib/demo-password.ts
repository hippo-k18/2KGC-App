/**
 * The demo password a purchase hands out, and the one place its value lives.
 *
 * ── What this is, said plainly ──────────────────────────────────────────────
 *
 * Every account provisioned by a ticket purchase is given the *same* password,
 * that password is printed on the confirmation page, and it is mailed in the
 * receipt. It is a shared secret, publicly displayed, on a project whose
 * `firestore.rules` gate every attendee read on the `registered` claim that
 * this account carries. Anyone who buys a ticket — or reads over somebody's
 * shoulder — can sign in as any other buyer whose address they know, right up
 * until that person changes it.
 *
 * That is not an oversight and it is not a bug report. It was asked for
 * deliberately, to make the app demonstrable without a mail round trip, and it
 * is written down here rather than in four places so that turning it off is one
 * edit and finding it is one grep.
 *
 * ⚠️ **This is exactly what BUILD-PLAN 1.4 deleted.** The previous shared
 * password is still live on ~50 Auth accounts and still in git history
 * (`OWNER-ACTIONS.md` §4). What makes this version defensible where that one
 * was not is the forced rotation: `provisionAttendeeAccount` stamps
 * `mustChangePassword` on the profile, and the app refuses to go anywhere until
 * the attendee has replaced it. The shared value gets somebody in once; it is
 * not the credential they keep.
 *
 * ── Why not `123` ───────────────────────────────────────────────────────────
 *
 * It was asked for and it is impossible. Firebase Auth rejects any password
 * under six characters — verified against the Auth emulator rather than assumed:
 *
 *     createUser({ password: '123'    }) -> auth/invalid-password
 *     createUser({ password: '1234'   }) -> auth/invalid-password
 *     createUser({ password: '12345'  }) -> auth/invalid-password
 *     createUser({ password: '123456' }) -> accepted
 *
 * "The password must be a string with at least 6 characters" is the server's
 * message, not a client-side policy, so no setting turns it off. `123456` is
 * the shortest thing that keeps the spirit of the request and can actually be
 * set. The alternative — accepting `123` in the sign-in box and secretly
 * expanding it before calling Firebase — is the bare-local-part trick this repo
 * already deleted once, and it makes the printed password a lie.
 *
 * ── Turning it off ──────────────────────────────────────────────────────────
 *
 * Set `DEMO_ATTENDEE_PASSWORD=` (empty) and provisioning sets no password at
 * all, the receipt loses its credential block, and the confirmation page stops
 * printing one — which is the pre-2026-09-02 behaviour, reachable without a
 * code change. Set it to something else and that value is used end to end.
 */

/** The default, and the shortest value Firebase Auth will actually accept. */
export const DEFAULT_DEMO_PASSWORD = '123456';

/**
 * Firebase's own floor. Not configurable on the server at any price, so a value
 * below it is a deployment that cannot provision anybody and should fail loudly
 * at the first purchase rather than quietly at the fiftieth.
 */
export const FIREBASE_MIN_PASSWORD_LENGTH = 6;

export class DemoPasswordTooShort extends Error {
  constructor(length: number) {
    super(
      `DEMO_ATTENDEE_PASSWORD is ${length} characters. Firebase Auth requires at ` +
        `least ${FIREBASE_MIN_PASSWORD_LENGTH} and rejects anything shorter with ` +
        `auth/invalid-password. Use at least ${FIREBASE_MIN_PASSWORD_LENGTH} characters, ` +
        `or set it empty to provision accounts with no password at all.`,
    );
    this.name = 'DemoPasswordTooShort';
  }
}

/**
 * The demo password, or `null` when the feature is switched off.
 *
 * Reads the environment every call rather than caching at module load: the
 * websites are long-lived server processes, and a cached value would mean the
 * only way to stop handing out a password is a redeploy. It is one string
 * comparison on a path that is already talking to Stripe.
 *
 * An unset variable means "use the default", and an explicitly empty one means
 * "off" — those are different answers, which is why this reads `undefined`
 * rather than falling back on falsiness.
 */
export function demoPassword(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.DEMO_ATTENDEE_PASSWORD;
  const value = raw === undefined ? DEFAULT_DEMO_PASSWORD : raw.trim();

  if (value === '') return null;
  if (value.length < FIREBASE_MIN_PASSWORD_LENGTH) throw new DemoPasswordTooShort(value.length);
  return value;
}

/** Whether a purchase should hand out a password at all. */
export function demoPasswordEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return demoPassword(env) !== null;
  } catch {
    // A misconfigured value is not "enabled". The throw belongs on the path
    // that would actually try to use it, where the error can name the fix.
    return false;
  }
}
