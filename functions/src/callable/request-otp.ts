import { randomInt } from 'node:crypto';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { OtpCodeDoc, RateLimitDoc } from '@kgc/shared';
/**
 * The same sender the Stripe webhook and the organizer dashboard use.
 *
 * A third copy of a template, a `from` address, a Resend call and an `emailLog`
 * row is how a sign-in mail ends up saying something different from the receipt
 * that told the attendee to expect it — and this particular copy would rot
 * unnoticed, because nobody re-reads a working sign-in mail. `@kgc/scripts` is
 * where AGENTS.md puts shared server-side domain logic precisely so a third
 * caller can join without inverting a dependency.
 *
 * Three things make it importable here rather than only from a Next.js app.
 * The build is `esbuild --bundle`, so the TypeScript is inlined and there is no
 * package-build step to arrange. `firebase-admin` is `--external` and is a
 * single hoisted copy across this workspace, so the `Firestore` handle passed
 * below is the same class the module expects — the three-copies hazard in
 * AGENTS.md gotcha 8 is a `apps/web` / `apps/organizer` / `scripts` problem and
 * not one here. And `email.ts` already obeys the rule that makes it safe
 * anyway: it stamps `new Date()`, never a `FieldValue` sentinel.
 */
import { emailEnabled, sendSignInCode } from '@kgc/scripts/src/lib/email';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { normaliseEmail, otpDocId } from '../lib/otp.js';
import { callerIp, ipCounterId, tickWindow, type WindowCounterDoc } from '../lib/rate-limit.js';
import { OTP_REQUEST_CALLABLE } from '../runtime-options.js';

const CODE_TTL_MINUTES = 10;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * The per-IP limit, which exists because the per-email one above is trivially
 * defeated by cycling addresses — a script asking for a code for a thousand
 * made-up addresses never trips a limit keyed on the address, and every one of
 * those requests is a function invocation plus two Firestore writes.
 *
 * The numbers are set by one uncomfortable constraint: a conference venue is
 * behind NAT. Several hundred attendees on the same wifi share one public IP,
 * and the registration desk on day-one morning is precisely when they all sign
 * in at once. A tight per-IP cap would not stop an attacker — who has other
 * addresses — and would lock the room out of its own conference.
 *
 * So the cap is deliberately generous, and the asymmetry is what makes that
 * safe: a caller sitting at the cap for a whole day produces ~11,500 requests
 * and ~23,000 Firestore writes, which is a few thousand writes past the daily
 * free tier and costs a fraction of a cent. A locked-out attendee costs a
 * support conversation. The limit exists to bound the runaway, not to price
 * the attacker out, and the short window is what keeps a shared IP from
 * colliding with itself across a whole day.
 *
 * If the venue does trip this, raise the cap — do not remove the limit, and do
 * not lengthen the window.
 */
const IP_RATE_LIMIT_WINDOW_MINUTES = 15;
const IP_RATE_LIMIT_MAX_REQUESTS = 120;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * HTTPS callable, no Firestore trigger — see functions/SPEC.md #9.
 *
 * ⚠️ PUBLIC AND UNAUTHENTICATED. This and `verifyOtp` are the only two
 * surfaces in this project an attacker can reach without an account, and every
 * call costs an invocation and two Firestore writes. Everything below that
 * looks like belt-and-braces is load-bearing for the bill: the per-email limit,
 * the per-IP limit, `maxInstances: 3` from `OTP_REQUEST_CALLABLE`, and the
 * `expiresAt` fields that let a TTL policy stop `otpCodes` and `rateLimits`
 * growing without bound.
 *
 * APP CHECK IS NOT ENFORCED, AND THAT IS A DECISION, NOT AN OVERSIGHT. App
 * Check would be the right guard here — it is the one mechanism that proves a
 * call came from a real build of the real app — but the attendee app runs in
 * Expo Go, and Expo Go cannot attest: App Attest and Play Integrity need
 * native modules that only a development build carries, and the JS SDK's
 * reCAPTCHA providers need a browser DOM that React Native does not have.
 * Turning enforcement on today would return 401 to every real attendee while
 * costing an attacker nothing, because nothing that matters is calling this
 * from a browser. `enforceAppCheck: false` is therefore stated explicitly, so
 * it reads as a decision with a date on it rather than a missing option.
 * The moment the development build lands — which push and image upload both
 * need anyway — register `@react-native-firebase/app-check` and flip this to
 * true on both callables. `docs/deploy-functions.md` carries the step.
 *
 * Deliberately does not check `registrations` for a matching ticket. Doing
 * so would make this the enumeration oracle `registrationIsMine` in
 * `firestore.rules` was written to avoid: a response (or even a timing
 * difference) that varies with whether an address holds a ticket turns
 * "request a code" into "check if this email is on the guest list." So the
 * response shape here is identical for every syntactically valid email,
 * ticket or no ticket — the only two outcomes a caller can observe are a
 * malformed address (`invalid-argument`) and having asked too often
 * (`resource-exhausted`), neither of which reveals anything about who else is
 * registered. Note that the per-IP limit does not weaken that property: it is
 * keyed on the caller, not on the address, so it cannot answer a question
 * about somebody else's ticket.
 *
 * ⚠️ Adding delivery is the easiest way to break that, and it has not been
 * broken here. A code is generated, stored and *mailed* for every syntactically
 * valid address — ticket or no ticket, real mailbox or not — and the response
 * is `{ ok: true }` in all of those cases. There is deliberately **no** branch
 * on whether the send succeeded, no error surfaced from a bounce, and no
 * "unknown address" path, because each of those is the enumeration oracle
 * wearing a different hat. The obvious-looking optimisation — "only send if
 * `registrations` has a match, it saves an email" — is precisely the change
 * this paragraph exists to refuse. If a future version needs one, the check
 * belongs in `verifyOtp`, which is already where it lives.
 *
 * Rate limit and code write happen in one transaction: without it, two
 * concurrent requests could each read `count: 4`, both decide they're under
 * the cap of 5, and both proceed — the exact TOCTOU gap `checkIns`'
 * `already-exists` idempotency was designed to avoid elsewhere in this repo,
 * just with a read-modify-write here instead of a duplicate `create`. Both
 * counters are read before either is written, as a transaction requires.
 *
 * Delivery is a real email, through the shared sender in
 * `@kgc/scripts/src/lib/email`. It replaced a `console.log` of the code, which
 * this docblock used to carry a warning about: Cloud Functions logs are not a
 * delivery channel for a sign-in code, and anyone with Logs Viewer on the
 * project could read every attendee's credential out of them. **Nothing in
 * this file may print the code again** — not at `debug` level, not behind an
 * environment flag. To read a code while developing, open the emulator UI and
 * look at `otpCodes`; that is a local database nobody else can reach, which a
 * log aggregator is not.
 *
 * ── Where the send sits, and why ────────────────────────────────────────────
 *
 * **After the transaction commits, never inside it.** Three reasons, in
 * descending order of how badly each would bite:
 *
 * 1. A Firestore transaction is *retried* on contention. Its body must be a
 *    pure function of what it read, and a send inside one would mail a fresh
 *    code on every attempt — the attendee gets three emails, two of which name
 *    a code the database never kept, and picks the wrong one.
 * 2. The code must be durable before it is delivered. Committing first means
 *    the only reachable failure is "stored but not delivered", which the
 *    attendee fixes by asking again. Sending first would allow "delivered but
 *    not stored" — a code that is genuinely correct and that `verifyOtp` will
 *    reject, which is unfixable from the attendee's side and looks exactly
 *    like a broken product.
 * 3. A transaction holds locks on `rateLimits/{id}` for its whole duration.
 *    Putting an HTTP round-trip to a third party inside that window turns a
 *    provider's bad afternoon into contention on the rate limiter for every
 *    caller behind the same NAT.
 *
 * ── A failed send does not refund the rate-limit tick ───────────────────────
 *
 * Deliberately. The tick counts *requests*, because that is what costs money
 * and what a limit has to bound; if it counted deliveries, then any address the
 * provider rejects — a typo'd domain, a full mailbox, a hard bounce — becomes
 * an unmetered channel for making this function run for free. `sendSignInCode`
 * cannot roll it back in any case: it runs after commit and never throws.
 *
 * The code is not lost silently either. Every outcome — sent, failed, or
 * skipped for want of an API key — writes a row to `emailLog` naming the
 * address, the template and the reason, which is the record support answers
 * "I never got a code" from. The `emailLog` row never contains the code.
 */
export const requestOtp = onCall<{ email?: unknown }>(OTP_REQUEST_CALLABLE, async (request) => {
  const email = normaliseEmail(String(request.data?.email ?? ''));
  if (!EMAIL_SHAPE.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }

  const db = getFirestore();
  const id = otpDocId(email);
  const now = Timestamp.now();
  const code = generateCode();
  const ip = callerIp(request.rawRequest);

  await db.runTransaction(async (tx) => {
    const rateLimitRef = db.collection(COLLECTIONS.rateLimits).doc(id);
    const ipRef = ip ? db.collection(COLLECTIONS.rateLimits).doc(ipCounterId('requestOtp', ip)) : undefined;

    // Every read first, then every write — Firestore rejects a transaction
    // that reads after it has queued a write.
    const rateSnap = await tx.get(rateLimitRef);
    const ipSnap = ipRef ? await tx.get(ipRef) : undefined;

    const rateData = rateSnap.data() as RateLimitDoc | undefined;
    const windowMs = RATE_LIMIT_WINDOW_MINUTES * 60_000;
    const withinWindow = Boolean(rateData) && now.toMillis() - rateData!.windowStart.toMillis() < windowMs;

    if (withinWindow && rateData!.count >= RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpsError('resource-exhausted', 'Too many code requests for this address. Try again later.');
    }

    if (ipRef) {
      const nextIpWindow = tickWindow(
        ipSnap!.data() as WindowCounterDoc | undefined,
        'requestOtp-ip',
        now,
        IP_RATE_LIMIT_WINDOW_MINUTES * 60_000,
        IP_RATE_LIMIT_MAX_REQUESTS,
      );
      if (!nextIpWindow) {
        // Same error code and message as the per-email cap. A caller learns
        // "too many", never which of the two limits it hit — the second
        // would tell an attacker exactly how to shape the next attempt.
        throw new HttpsError('resource-exhausted', 'Too many code requests for this address. Try again later.');
      }
      tx.set(ipRef, nextIpWindow);
    }

    tx.set(rateLimitRef, {
      eventId: EVENT_ID,
      email,
      count: withinWindow ? rateData!.count + 1 : 1,
      windowStart: withinWindow ? rateData!.windowStart : now,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + windowMs),
    } satisfies RateLimitDoc);

    tx.set(db.collection(COLLECTIONS.otpCodes).doc(id), {
      eventId: EVENT_ID,
      email,
      code,
      expiresAt: Timestamp.fromMillis(now.toMillis() + CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      createdAt: now,
    } satisfies OtpCodeDoc);
  });

  // Loud, because this is the one skip in the project that breaks a flow
  // rather than a courtesy. `send()` records it in `emailLog` either way, but
  // a receipt that does not go out is an annoyance and a sign-in code that does
  // not go out means no attendee can get into the app at all — that deserves an
  // error line an operator will actually trip over. It carries the address, not
  // the code, and it fires on configuration rather than on any property of the
  // caller, so it observes nothing about who asked.
  if (!emailEnabled()) {
    console.error('[requestOtp] RESEND_API_KEY is not set — no sign-in code was delivered to', email);
  }

  // Awaited, not fired and forgotten. On Cloud Run the instance may be frozen
  // the moment the response is returned, so a floating promise here is a send
  // that sometimes happens. `sendSignInCode` never throws, so awaiting it
  // cannot add a failure path — and therefore cannot add one that varies with
  // the address.
  await sendSignInCode(db, { to: email, code, ttlMinutes: CODE_TTL_MINUTES });

  return { ok: true };
});
