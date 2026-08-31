/**
 * Deploy-time runtime options for all fourteen functions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ DO NOT REPLACE THIS WITH `setGlobalOptions()` IN `index.ts`.
 *
 * `index.ts` is nothing but `export … from './triggers/….js'` statements. In
 * ESM, every imported module is fully evaluated *before* the importing
 * module's own body runs, so by the time any statement in `index.ts` executes,
 * all fourteen functions have already been defined and their endpoint metadata
 * already computed. A `setGlobalOptions(...)` call placed there would compile,
 * deploy, and silently do nothing — you would ship believing you had capped
 * instances when you had not. That defect only shows up on the bill.
 *
 * Per-function options do not have that failure mode: the options object is an
 * argument to the call that defines the endpoint, so it cannot be evaluated
 * too late. It also lets the two public callables carry a tighter cap than the
 * triggers, which they need (see PUBLIC_CALLABLE below).
 *
 * If someone does move to a global module in future, it must be imported for
 * side effects on the FIRST line of `index.ts`, above every re-export — and
 * the result must be verified in the Cloud Run console, never by reading this
 * file. See `docs/deploy-functions.md`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { MemoryOption, SupportedRegion } from 'firebase-functions/v2/options';

/**
 * `us-central1` is inside `nam5`, the permanent location of the `(default)`
 * Firestore database. Deploying anywhere else puts cross-region latency on
 * every Firestore read in every trigger and network egress charges on paths
 * that are free today. This is both the correct and the cheapest choice —
 * do not change it.
 */
const REGION: SupportedRegion = 'us-central1';

/** v2 default. Nothing here holds more than a page of documents in memory. */
const MEMORY: MemoryOption = '256MiB';

/**
 * Shared by the ten Firestore triggers and the two Cloud Tasks handlers.
 *
 * `minInstances: 0` is stated explicitly even though 0 is the default. It is
 * the single option in this file that bills you for doing nothing — an idle
 * instance is charged per second, 24/7, whether or not a request arrives — and
 * "unset" reads like an oversight to the next person trying to fix a cold
 * start. Written down, it reads like the decision it is.
 */
export const TRIGGER: {
  region: SupportedRegion;
  memory: MemoryOption;
  timeoutSeconds: number;
  minInstances: number;
  maxInstances: number;
  concurrency: number;
} = {
  region: REGION,
  memory: MEMORY,
  timeoutSeconds: 60,
  minInstances: 0,
  maxInstances: 10,
  concurrency: 80,
};

/**
 * `onSessionAgendaChange` only. One instance, one request at a time.
 *
 * This function is the largest fan-out in the codebase: one changed session
 * becomes one notification write plus one token read per attendee who saved
 * it. A bulk agenda re-import changes hundreds of sessions at once, and
 * hundreds of those fan-outs running concurrently is how a re-import becomes
 * ~100k writes and ~100k real push notifications to real phones.
 *
 * Serialising it does two things. It gives a human time to notice and stop a
 * runaway import instead of the whole thing landing in ten seconds. And it
 * makes the event-wide fan-out budget in that trigger *exact*: the budget is a
 * read-modify-write on one Firestore document, and with concurrency above 1
 * hundreds of transactions would contend on it, retry, and burn latency to
 * arrive at the same answer more slowly.
 *
 * The cost is latency on a genuine single room change — which is none, because
 * there is nothing else in the queue when one session moves.
 */
export const SERIAL_FANOUT_TRIGGER = {
  ...TRIGGER,
  maxInstances: 1,
  concurrency: 1,
};

/**
 * `requestOtp` and `verifyOtp` — the only two internet-reachable surfaces in
 * the set, and the only path an attacker can invoke directly.
 *
 * A tighter `maxInstances` than the triggers on purpose. This is the backstop
 * that holds when the application-level rate limits in those files are
 * defeated: caps stop being about latency and start being about the bill the
 * moment the caller is hostile. Three instances at 80 concurrent requests each
 * is still ample for a 500-person conference, where sign-in happens once per
 * device.
 *
 * `enforceAppCheck` is stated explicitly as `false` — see the docblock on
 * `requestOtp` for why enforcing it today would lock out the app rather than
 * an attacker, and `docs/deploy-functions.md` for the exact moment that
 * changes.
 */
export const PUBLIC_CALLABLE = {
  ...TRIGGER,
  maxInstances: 3,
  enforceAppCheck: false,
};

/**
 * `requestOtp` only — `PUBLIC_CALLABLE` plus the one secret it needs.
 *
 * It is the only function in the set that sends mail, and the shared sender in
 * `@kgc/scripts/src/lib/email.ts` reads `RESEND_API_KEY` out of the process
 * environment. Declaring it here rather than on `PUBLIC_CALLABLE` keeps
 * `verifyOtp` — which sends nothing — from mounting a credential it has no use
 * for, which is the same reason the two have separate option objects at all.
 *
 * ⚠️ The declaration is deliberately in the source even though the secret does
 * not exist yet, so that turning delivery on is a `functions:secrets:set` and a
 * redeploy rather than a code change made under time pressure. The cost is that
 * `firebase deploy` will stop and ask to create the secret the first time —
 * which is the correct place to find out, and `docs/deploy-functions.md` step
 * 8b sets it before Phase C so you never should.
 *
 * Without it the function still runs and still returns `{ ok: true }` — it must,
 * or the response would reveal whether an address is on the guest list — and
 * every send lands in `emailLog` as `skipped` with the reason. That is the
 * degradation, not a silent success.
 *
 * ⚠️ **Do not delete this line to quieten the emulator.** Until the secret
 * exists, every local `firebase emulators:start` and every `npm run
 * test:functions` prints a red `403 … Secret Manager API has not been used in
 * project` block. It is alarming and it is harmless: the emulator carries on,
 * the whole suite passes, and the only consequence is that `RESEND_API_KEY` is
 * unset locally, which is what you want on a machine that should never send
 * real mail. To silence it for yourself, put the key in
 * `functions/.secret.local` — gitignored, and the file the emulator's own error
 * message names.
 */
export const OTP_REQUEST_CALLABLE = {
  ...PUBLIC_CALLABLE,
  secrets: ['RESEND_API_KEY'],
};

/**
 * Congestion control on both Cloud Tasks queues.
 *
 * Cloud Tasks defaults are 500 dispatches/second and 1000 concurrent — sized
 * for a service that wants throughput, not for two debounced recomputes on a
 * conference agenda. Both queues receive at most one task per five-second
 * bucket per poll or session, so these limits are far above anything correct
 * behaviour produces and only bind when something is wrong.
 */
export const TASK_QUEUE_RATE_LIMITS = {
  maxConcurrentDispatches: 5,
  maxDispatchesPerSecond: 10,
};
