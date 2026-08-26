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

export { mirrorDirectory } from './triggers/mirror-directory.js';
export { onAnnouncementCreate } from './triggers/on-announcement-create.js';
export { onPollVoteWrite } from './triggers/on-poll-vote-write.js';
export { onQuestionUpvoteWrite } from './triggers/on-question-upvote-write.js';
export { onQuestionWrite } from './triggers/on-question-write.js';
export { onReactionWrite } from './triggers/on-reaction-write.js';
export { onReplyWrite } from './triggers/on-reply-write.js';
export { rebuildQaBoard } from './triggers/rebuild-qa-board.js';
export { tallyPoll } from './triggers/tally-poll.js';
