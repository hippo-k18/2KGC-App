import { initializeApp } from 'firebase-admin/app';

/**
 * `serviceAccountId` is only consumed by `getFunctions().taskQueue(...).enqueue()`
 * (tallyPoll, rebuildQaBoard — SPEC.md #4-#5), to build a Cloud Tasks OIDC
 * token. Left unset, firebase-admin resolves it by calling the GCE metadata
 * server on every single `enqueue()` — free and instant on real Cloud
 * Functions infrastructure, but in some local/sandboxed environments that
 * server is unreachable in a way that hangs rather than fails fast, which
 * has been observed to block a function for the full 60s default timeout
 * and starve every other trigger sharing the emulator's worker pool.
 * `FUNCTIONS_EMULATOR` is set by the Firebase CLI for every function it
 * hosts; setting `serviceAccountId` there short-circuits the metadata call
 * entirely (see `getExplicitServiceAccountEmail` in firebase-admin's
 * `utils`) — the local Cloud Tasks emulator never verifies this token, so
 * the value itself doesn't matter.
 */
initializeApp(
  process.env.FUNCTIONS_EMULATOR
    ? { serviceAccountId: 'emulated-service-acct@example.com' }
    : undefined,
);

/**
 * ★ DO NOT ADD `setGlobalOptions(...)` BELOW THIS LINE — OR ANYWHERE IN THIS
 * FILE'S BODY.
 *
 * Everything after this comment is a re-export. In ESM, an imported module is
 * fully evaluated before the importing module's body runs, so all fourteen
 * functions are defined — and their endpoint metadata already computed — by the
 * time any statement here executes. A `setGlobalOptions` call placed here
 * compiles, deploys, and caps nothing. You would ship believing instances were
 * bounded when they were not, and find out on the bill.
 *
 * Runtime options are therefore set per function, from
 * `./runtime-options.js`, as an argument to the call that defines each
 * endpoint. That is not verbosity to be tidied away later; it is the version
 * that cannot be evaluated too late. If a global module is ever genuinely
 * wanted, `import './runtime-options.js';` for side effects must be the FIRST
 * line of this file, above every export below — and the result verified in the
 * Cloud Run console, never by reading the source.
 */
export { mirrorDirectory } from './triggers/mirror-directory.js';
export { mirrorExhibitorListing } from './triggers/mirror-exhibitor-listing.js';
export { onAnnouncementCreate } from './triggers/on-announcement-create.js';
export { onBoothAssignmentWrite } from './triggers/on-booth-assignment-write.js';
export { onPollVoteWrite } from './triggers/on-poll-vote-write.js';
export { onQuestionUpvoteWrite } from './triggers/on-question-upvote-write.js';
export { onQuestionWrite } from './triggers/on-question-write.js';
export { onReactionWrite } from './triggers/on-reaction-write.js';
export { onReplyWrite } from './triggers/on-reply-write.js';
export { onSessionAgendaChange } from './triggers/on-session-agenda-change.js';
export { rebuildQaBoard } from './triggers/rebuild-qa-board.js';
export { requestOtp } from './callable/request-otp.js';
export { tallyPoll } from './triggers/tally-poll.js';
export { verifyOtp } from './callable/verify-otp.js';
