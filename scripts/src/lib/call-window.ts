import type { PublishStatus } from "@kgc/shared";

/**
 * Whether a call for abstracts is accepting submissions right now.
 *
 * ── Why this is its own module, in this package ─────────────────────────────
 *
 * `CFA-PLAN.md` §4 is blunt about it: **"Deadline enforcement is server-side or
 * it is nothing."** A closed call has to refuse the *write*, not hide the
 * button — the collection has no `match` block in `firestore.rules` and there is
 * therefore no rule underneath to catch what the screen lets through.
 *
 * That refusal happens in `apps/web`, in the server action behind the public
 * portal. The same question is asked in `apps/organizer`, which has to say on
 * screen whether the call is open and must agree with the portal to the second.
 * Neither app can import the other, so the answer lives here, with
 * `ensureRegistration`, the email templates and the four token schemes, for the
 * reason all of those are here.
 *
 * It is also the half of the deadline that is worth testing, and `server-only`
 * and Vitest do not mix (AGENTS.md). Everything below is pure: no Firestore, no
 * clock of its own, no sentinels. `now` is a parameter precisely so a test can
 * stand either side of a deadline without waiting for one.
 *
 * ── Instants, not wall clock ────────────────────────────────────────────────
 *
 * The arguments are epoch milliseconds. `CallDoc` authors its deadline as local
 * wall time in a named zone and derives `opensAt`/`closesAt` from it server-side
 * — the same arrangement `SessionDoc` has — so by the time the comparison is
 * made the zone question is already settled. Comparing wall-clock strings here
 * would re-open it, and would do so in whatever zone the server happens to run
 * in, which on Netlify is UTC and on a laptop is not.
 */

/** What a call is doing at one moment. */
export type CallWindowState =
  /** Never published. Nobody outside the dashboard can see it at all. */
  | "draft"
  /** Published, and the opening date has not arrived. */
  | "not-open"
  | "open"
  | "closed"
  /** Withdrawn after publication. Distinct from `closed`: it did not run its course. */
  | "cancelled";

/** The three fields of a `CallDoc` this decision actually depends on. */
export interface CallWindowInput {
  status: PublishStatus;
  /** `CallDoc.opensAt`, as epoch ms. */
  opensAtMs: number;
  /** `CallDoc.closesAt`, as epoch ms. */
  closesAtMs: number;
}

/**
 * The state of the window.
 *
 * ⚠️ The close is **exclusive** and the open is **inclusive**: a submission at
 * exactly `closesAt` is refused, one at exactly `opensAt` is accepted. That is
 * the reading of "closes at 23:59" that does not surprise anybody, and picking
 * the other one for the close would mean a deadline that is one millisecond
 * longer than it says on the poster.
 *
 * A call whose dates are the wrong way round reports `closed`, which is the safe
 * direction to fail: refusing a write that should have been allowed is a support
 * email, and accepting one that should have been refused is a submission the
 * committee has to decide whether to honour.
 */
export function callWindow(call: CallWindowInput, now: number): CallWindowState {
  if (call.status === "draft") return "draft";
  if (call.status === "cancelled") return "cancelled";
  /*
   * The inverted window is checked before either date rather than falling out
   * of the comparisons below. It would otherwise report `not-open` for a while
   * and then `open`, which is the one answer a call with no window at all must
   * never give — and it would do so only for dates nobody looked at twice.
   */
  if (call.closesAtMs <= call.opensAtMs) return "closed";
  if (now < call.opensAtMs) return "not-open";
  if (now >= call.closesAtMs) return "closed";
  return "open";
}

/**
 * Why a submission may not be written, or `null` when it may.
 *
 * Returns the sentence to show the submitter rather than a boolean, because
 * "the call is not open" is four different situations and the person reading it
 * can act on only one of them. Somebody who is early wants a date; somebody who
 * is late wants to know whether it is worth emailing the committee.
 *
 * ⚠️ Call this in the server action, on the value just read from Firestore.
 * Calling it while rendering and then trusting the render is the mistake this
 * whole module exists to make hard: the page and the POST are separate requests,
 * and a form left open across the deadline posts from a page that was honest
 * when it rendered.
 */
export function submissionRefusal(call: CallWindowInput, now: number): string | null {
  switch (callWindow(call, now)) {
    case "open":
      return null;
    case "draft":
      return "This call is not open for submissions.";
    case "cancelled":
      return "This call has been withdrawn and is no longer accepting submissions.";
    case "not-open":
      return "This call has not opened yet. Nothing has been saved.";
    case "closed":
      return "This call has closed and is no longer accepting submissions. Nothing has been saved.";
  }
}

/**
 * Whether an *existing* submission may still be edited by its author.
 *
 * The same window, and deliberately not a looser one. An author who could keep
 * editing after the close would be submitting after the close in every sense
 * that matters — the reviewers read the current text, not the text as it stood
 * at the deadline — and a call that says "closes 30 September" would in fact
 * close whenever the last person stopped typing.
 *
 * Reading is a separate question and is always allowed: the capability token
 * outlives the call on purpose (`submission-token.ts`), because the author still
 * has to be able to see their own work and, later, their decision.
 */
export const canEditSubmission = (call: CallWindowInput, now: number): boolean =>
  callWindow(call, now) === "open";

/**
 * Days remaining before a call closes, rounded up, floored at zero.
 *
 * Rounded **up** so the last partial day still reads as "1 day left" rather than
 * "0 days left" for its final twenty-three hours, which is the difference
 * between a countdown and an obituary.
 */
export function daysUntilClose(call: CallWindowInput, now: number): number {
  const ms = call.closesAtMs - now;
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}
